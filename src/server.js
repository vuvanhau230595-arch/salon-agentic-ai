require('./env');
const http = require('node:http');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { load, save, uid } = require('./db');
const { ads, social } = require('./connectors');
const engine = require('./engine');
const adtest = require('./adtest');
const adsApi = require('./ads-api');
const calendarApi = require('./calendar-api');
const monthPlan = require('./monthplan');
const automations = require('./automations');
const agentsApi = require('./agents-api');
const reports = require('./reports');
const channelsApi = require('./channels-api');
const audit = require('./audit');
const brandsApi = require('./brands-api');
const mediaLib = require('./media-lib');
const drive = require('./drive');
const transcode = require('./transcode');
const knowledgeApi = require('./knowledge-api');
const accountApi = require('./account-api');
const ai = require('./ai');
const planner = require('./planner');
const tiktokRoutes = require('./tiktok-routes');
const youtubeRoutes = require('./youtube-routes');
const tiktokManual = require('./tiktok-manual');
const lessons = require('./lessons');
const media = require('./media');
const xhs = require('./xhs');
const assistantApi = require('./assistant-api');
const videoIntel = require('./video-intel');
const replies = require('./replies');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mov': 'video/quicktime' };

const PORT = Number(process.env.PORT || 3950);
const PUBLIC = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

const db = load();
media.ensureDirs();
if (ads.mode === 'live') engine.cleanupDemo();
if (ads.mode === 'mock' && !db.comments.length) {
  db.comments.push(
    { id: 'demo_1', channel: 'facebook_page', author: 'Lan Anh', text: 'Nhuộm balayage bên mình giá bao nhiêu vậy ad?', status: 'new' },
    { id: 'demo_2', channel: 'facebook_page', author: 'Minh Thư', text: 'Nối mi volume có giữ được bao lâu ạ?', status: 'new' },
  );
  save();
}

function send(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const readRaw = (req) => new Promise((resolve, reject) => {
  let s = '';
  req.on('data', (d) => { s += d; if (s.length > 1e6) req.destroy(); });
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
  req.on('error', reject);
});
// Nội dung JSON của yêu cầu ghi được đọc 1 lần ở cổng kiểm tra quyền rồi dùng lại cho các hàm xử lý
const readBody = (req) => (req._body ? (req._body.err ? Promise.reject(req._body.err) : Promise.resolve(req._body.val)) : readRaw(req));

// Đăng nhập Basic + chống dò mật khẩu: sai 5 lần trong 10 phút thì khóa IP đó 10 phút.
// Sau reverse proxy (Caddy) lấy IP thật từ X-Forwarded-For, nhưng chỉ tin khi kết nối đến từ chính máy này.
const FAIL_MAX = 5;
const FAIL_WINDOW = 10 * 60e3;
const fails = new Map(); // ip → { n, first, until }

function clientIp(req) {
  const ra = req.socket.remoteAddress || '';
  const loopback = ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1';
  const xff = req.headers['x-forwarded-for'];
  return loopback && xff ? String(xff).split(',')[0].trim() : ra;
}

const sha = (v) => crypto.createHash('sha256').update(String(v)).digest();

const users = require('./users');
const authz = require('./authz');
const authCtx = require('./auth-ctx');
const SHARED_USER = { id: 'shared', name: 'Chủ hệ thống (mật khẩu chung)', username: '', role: 'owner', brands: [], shared: true };

const sessions = require('./session');
const isLocked = (ip, now = Date.now()) => { const f = fails.get(ip); return !!(f && f.until > now); };
function noteFail(ip, now = Date.now()) {
  const f = fails.get(ip);
  const cur = f && now - f.first < FAIL_WINDOW ? f : { n: 0, first: now, until: 0 };
  cur.n++;
  if (cur.n >= FAIL_MAX) cur.until = now + FAIL_WINDOW;
  fails.set(ip, cur);
  return cur.until > now;
}
const userView = (u) => ({ id: u.id, name: u.name, username: u.username, role: u.role, brands: u.brands || [] });
// Tên đăng nhập trùng tài khoản riêng → chỉ mật khẩu của tài khoản đó đúng. Không trùng → mật khẩu chung (nếu còn bật) = chủ hệ thống.
function checkCredentials(username, given) {
  const pw = process.env.APP_PASSWORD;
  if (username && users.hasUser(username)) {
    const u = users.authenticate(username, given);
    return u ? userView(u) : null;
  }
  if (users.sharedLoginOn() && crypto.timingSafeEqual(sha(given), sha(pw))) return { ...SHARED_USER };
  return null;
}
// Phiên cookie → người dùng hiện tại (tài khoản bị khoá/xoá hoặc mật khẩu chung bị tắt thì phiên hết giá trị ngay)
function sessionUser(sess) {
  if (!sess) return null;
  if (sess.shared) return users.sharedLoginOn() ? { ...SHARED_USER } : null;
  const u = users.activeByUsername(sess.username);
  return u ? userView(u) : null;
}

// { status: 'ok' | 'denied' | 'locked', user, sid? }
// Thứ tự: cookie phiên (trình duyệt, điện thoại) → Basic Auth (script/curl, trình duyệt cũ còn nhớ).
function authorize(req) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return { status: 'ok', user: { ...SHARED_USER, name: 'Sếp' } };
  const ip = clientIp(req);
  if (isLocked(ip)) return { status: 'locked' };
  const sess = sessions.resolve(req);
  if (sess) {
    const user = sessionUser(sess);
    if (user) return { status: 'ok', user, sid: sess.sid };
    sessions.destroy(sess.sid);
  }
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return { status: 'denied' }; // chưa gửi mật khẩu — chưa tính là sai
  const cred = Buffer.from(h.slice(6), 'base64').toString();
  const at = cred.indexOf(':');
  const user = checkCredentials(at < 0 ? '' : cred.slice(0, at), at < 0 ? '' : cred.slice(at + 1));
  if (user) { fails.delete(ip); return { status: 'ok', user }; }
  return { status: noteFail(ip) ? 'locked' : 'denied' };
}

// Trang/đường đăng nhập bằng cookie. Trả về true nếu đã xử lý.
async function handleLogin(req, res, url) {
  const p = url.pathname;
  if (p === '/logout' && req.method === 'POST') {
    const sess = sessions.resolve(req);
    if (sess) sessions.destroy(sess.sid);
    res.writeHead(204, { 'set-cookie': sessions.clearCookie(req), 'cache-control': 'no-store' });
    res.end();
    return true;
  }
  if (p !== '/login') return false;
  if (!process.env.APP_PASSWORD) { res.writeHead(302, { location: '/' }); res.end(); return true; } // chạy nội bộ không mật khẩu
  if (req.method === 'GET') {
    if (authorize(req).status === 'ok') { res.writeHead(302, { location: '/' }); res.end(); return true; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(sessions.loginPage(url.searchParams.get('next') || '/'));
    return true;
  }
  if (req.method !== 'POST') { res.writeHead(405); res.end(); return true; }
  const ip = clientIp(req);
  if (isLocked(ip)) return send(res, 429, { error: 'Sai mật khẩu quá nhiều lần. Thử lại sau 10 phút.' }), true;
  let b;
  try { b = await readRaw(req); } catch { return send(res, 400, { error: 'Dữ liệu không hợp lệ' }), true; }
  const user = checkCredentials(String(b.username || '').trim(), String(b.password || ''));
  if (!user) {
    const locked = noteFail(ip);
    return send(res, locked ? 429 : 401, { error: locked ? 'Sai mật khẩu quá nhiều lần. Thử lại sau 10 phút.' : 'Sai tên đăng nhập hoặc mật khẩu' }), true;
  }
  fails.delete(ip);
  const sid = sessions.create(user, req);
  engine.log('security', `${user.name} đăng nhập (phiên 30 ngày, ${String(req.headers['user-agent'] || '').slice(0, 60)})`, { by: user.name, field: 'login' });
  save();
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'set-cookie': sessions.setCookie(req, sid), 'cache-control': 'no-store' });
  res.end(JSON.stringify({ ok: true, user: { name: user.name, role: user.role } }));
  return true;
}

// 小红书: đính kèm kết quả kiểm tra tuân thủ để giao diện hiện cảnh báo
const withLint = (p) => (xhs.isXhs(p.channel) ? { ...p, lint: xhs.lintPost(p) } : p);
const planView = (pl) => {
  if (xhs.isXhs(pl.channel)) return { ...pl, items: pl.items.map((it) => (it.status === 'pending' ? { ...it, lint: xhs.lintItem(pl, it) } : it)) };
  const flow = require('./content-flow');
  // Bài chưa có điểm kiểm tra (kế hoạch cũ) thì chấm tại chỗ
  return { ...pl, items: pl.items.map((it) => (it.status === 'pending' && !it.qc ? { ...it, qc: flow.qcOf({ brand: pl.brand, channel: pl.channel, text: it.text, category: it.category, scheduledAt: it.at }) } : it)) };
};
const { approvalBrand } = require('./approval-brand');
// Giai đoạn: pending → approved/rejected → done (đã thực hiện thật). Chạy thử thì dừng ở approved_dry (chưa đổi gì bên ngoài).
function approvalStage(d, a) {
  if (a.status === 'pending') return 'pending';
  if (a.status === 'rejected') return 'rejected';
  if (a.type === 'post_publish') {
    const p = d.posts.find((x) => x.id === (a.payload || {}).postId);
    if (p && p.status === 'published') return 'done';
    if (p && p.status === 'failed') return 'failed';
    return 'approved';
  }
  if (a.dry === undefined) return 'approved';
  return a.dry ? 'approved_dry' : 'done';
}
// Dữ liệu xem trước ngay trong hàng đợi: nội dung thật của bài / bình luận / đề xuất
function approvalPreview(d, a) {
  const pl = a.payload || {};
  if (a.type === 'post_publish') {
    const p = d.posts.find((x) => x.id === pl.postId);
    if (!p) return null;
    return { kind: 'post', channel: p.channel, channelLabel: (social.CHANNELS[p.channel] || {}).label || p.channel, title: p.title || '', text: p.text, scheduledAt: p.scheduledAt,
      media: (p.media || []).map((m) => ({ name: m.name, type: m.type, url: `/api/media/file?brand=${encodeURIComponent(p.brand || '')}&name=${encodeURIComponent(m.name)}` })) };
  }
  if (a.type === 'comment_reply') {
    const c = d.comments.find((x) => x.id === pl.commentId);
    return { kind: 'comment', author: c ? c.author : '', original: c ? c.text : '', reply: pl.text || '' };
  }
  return null;
}
function approvalView(d, a) {
  const brand = approvalBrand(d, a);
  const base = { ...a, brand, brandName: brand ? (planner.brands()[brand] || {}).name || brand : '', stage: approvalStage(d, a), preview: approvalPreview(d, a) };
  if (a.type !== 'post_publish') return base;
  const p = d.posts.find((x) => x.id === a.payload.postId);
  if (p && xhs.isXhs(p.channel)) return { ...base, lint: xhs.lintPost(p), postTitle: p.title || '' };
  return p ? { ...base, qc: (() => { const q = require('./content-flow').qcOf(p); return p.qc ? { ...q, attempts: p.qc.attempts, mode: p.qc.mode, issues: [...q.issues, ...p.qc.issues.filter((i) => i.code === 'template')] } : q; })(), category: p.category || '', postId: p.id, aiText: p.aiText || '' } : base;
}
// Chỉ tính trường lịch sử cần hiển thị — không qua approvalView (chấm QC lại 120 bài cũ làm /api/state chậm ~4 giây)
function approvalHistory(d) {
  const names = planner.brands();
  return d.approvals.filter((a) => a.status !== 'pending')
    .sort((x, y) => new Date(y.decidedAt || y.at) - new Date(x.decidedAt || x.at)).slice(0, 120)
    .map((a) => { const brand = approvalBrand(d, a); return { id: a.id, type: a.type, title: a.title, detail: a.detail, status: a.status, stage: approvalStage(d, a), brand, brandName: brand ? (names[brand] || {}).name || brand : '', at: a.at, decidedAt: a.decidedAt || null, decidedBy: a.decidedBy || '', note: a.note || '', dry: a.dry }; });
}

// Số liệu bài đăng cho trang Tổng quan, đếm trên TOÀN BỘ bài (không chỉ 50 bài gửi về giao diện)
function postStats(posts, now = Date.now()) {
  const out = { scheduled: 0, upcoming7d: 0, published30d: 0, awaitingManual: 0, failed: 0, byBrand: {} };
  const b = (id) => (out.byBrand[id || '—'] = out.byBrand[id || '—'] || { scheduled: 0, upcoming7d: 0, published30d: 0 });
  for (const p of posts) {
    const t = new Date(p.scheduledAt).getTime();
    if (p.status === 'scheduled') { out.scheduled++; b(p.brand).scheduled++; if (t >= now && t <= now + 7 * 864e5) { out.upcoming7d++; b(p.brand).upcoming7d++; } }
    else if (p.status === 'published' && t >= now - 30 * 864e5) { out.published30d++; b(p.brand).published30d++; }
    else if (p.status === 'awaiting_manual') out.awaitingManual++;
    else if (p.status === 'failed') out.failed++;
  }
  return out;
}

// Ảnh chụp các cài đặt quan trọng để ghi nhật ký "trước → sau" khi Sếp đổi (không gồm token)
function flatSettings(st) {
  const out = {};
  const walk = (o, pre) => { for (const [k, v] of Object.entries(o || {})) { if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, pre + k + '.'); else out[pre + k] = JSON.stringify(v); } };
  walk({ dryRun: st.dryRun, monthlyCap: st.monthlyCap, scanMinutes: st.scanMinutes, tiktokMode: st.tiktokMode, tiktokPrivacy: st.tiktokPrivacy, tiktokAigc: st.tiktokAigc, youtubePrivacy: st.youtubePrivacy, rules: st.rules, adTest: { ...st.adTest, units: undefined }, assistant: st.assistant, leads: st.leads, units: Object.fromEntries((st.adTest.units || []).map((u) => [u.id, u.dailyBudget])), unitsOn: Object.fromEntries((st.adTest.units || []).map((u) => [u.id, u.on !== false])) }, '');
  return out;
}

function stateView() {
  const d = load();
  const campaigns = d.campaigns.map((c) => ({ ...c, brand: engine.brandOf(c) }));
  const monthSpend = (d.campaigns || []).reduce((s, c) => s + (c.month ? c.month.spend : 0), 0);
  return {
    mode: ads.mode,
    tiktok: tiktokRoutes.stateSlice(),
    youtube: youtubeRoutes.stateSlice(),
    settings: d.settings,
    lastScan: d.lastScan,
    monthSpend,
    campaigns,
    adAlerts: adsApi.alerts(campaigns),
    leadStats: require('./leads').stats(),
    postStats: postStats(d.posts),
    lastSync: d.lastSync || null,
    adTests: d.adTests.slice(0, 40),
    pageNames: channelsApi.pageNames(),
    adUnits: d.settings.adTest.units.map((u) => ({
      ...u, committed: adtest.committed(u.id),
      today: d.campaigns.filter((c) => engine.brandOf(c) === u.brand && (adtest.unitOf(u.brand, c.name) || {}).id === u.id).reduce((s, c) => s + (c.today ? c.today.spend : 0), 0),
    })),
    audiences: Object.fromEntries(Object.entries(d.audiences || {}).map(([k, v]) => [k, v.map(({ targeting, ...rest }) => rest)])),
    approvals: d.approvals.filter((a) => a.status === 'pending').map((a) => approvalView(d, a)),
    approvalHistory: approvalHistory(d),
    actions: d.actions.slice(0, 60),
    posts: d.posts.slice(0, 50).map(withLint),
    plans: d.plans.slice(0, 12).map(planView),
    runs: d.runs.slice(0, 40),
    media: media.summary(),
    mediaRoot: media.root(),
    lessons: d.lessons,
    feedback: d.feedback.slice(0, 15),
    feedbackTotal: d.feedback.length,
    agents: Object.entries(engine.AGENTS).map(([id, a]) => ({ id, name: a.name, desc: a.desc, on: d.settings.agents[id].on })),
    nextScanAt,
    brands: Object.entries(planner.brands()).map(([id, b]) => ({ id, ...b })),
    env: { meta: !!process.env.META_ACCESS_TOKEN, apiVersion: require('./meta').version(), anthropic: !!process.env.ANTHROPIC_API_KEY, gemini: videoIntel.enabled(), password: !!process.env.APP_PASSWORD, model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5' },
    types: planner.TYPES,
    channels: Object.entries(social.CHANNELS).map(([id, c]) => ({ id, label: c.label, live: c.live(), manual: !!c.manual })),
    adsLabel: ads.label,
  };
}

let nextScanAt = null;
const MERGEABLE = ['dryRun', 'paused', 'monthlyCap', 'scanMinutes'];

async function api(req, res, url) {
  const d = load();
  const p = url.pathname;
  let m;

  if (req.method === 'GET' && p === '/api/state') return send(res, 200, stateView());

  if (req.method === 'POST' && p === '/api/scan') {
    const r = await engine.scan();
    return send(res, 200, { result: r, state: stateView() });
  }

  if (req.method === 'POST' && (m = p.match(/^\/api\/agents\/([^/]+)\/(run|toggle)$/))) {
    const [, id, what] = m;
    if (!engine.AGENTS[id]) return send(res, 404, { error: 'Không có agent này' });
    if (what === 'toggle') {
      const on = !!(await readBody(req)).on;
      engine.setAgentOn(id, on);
      engine.log('system', `${engine.AGENTS[id].name}: ${on ? 'BẬT' : 'TẮT'}`);
      save();
    } else {
      if (d.settings.paused) return send(res, 400, { error: 'Agent đang dừng khẩn cấp — bật lại trước' });
      const run = await engine.runAgent(id, 'manual');
      if (run.error) return send(res, 500, { error: `${engine.AGENTS[id].name} lỗi: ${run.error}` });
    }
    return send(res, 200, stateView());
  }

  // ---- Thư viện media ----
  if (req.method === 'GET' && p === '/api/media') {
    try { return send(res, 200, { root: media.root(), files: media.list(url.searchParams.get('brand')) }); }
    catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (req.method === 'POST' && p === '/api/media/upload') {
    let up;
    try { up = media.prepareUpload(url.searchParams.get('brand'), url.searchParams.get('name')); }
    catch (e) { return send(res, 400, { error: e.message }); }
    let size = 0;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        size += chunk.length;
        if (size > up.limit) cb(new Error(`File quá lớn (tối đa ${Math.round(up.limit / 1048576)}MB)`)); else cb(null, chunk);
      },
    });
    try {
      await pipeline(req, counter, fs.createWriteStream(up.tmp));
      if (!size) throw new Error('File rỗng');
      mediaLib.verifySignature(up.tmp, up.name); // nội dung phải đúng định dạng, không tin đuôi file
      fs.renameSync(up.tmp, up.dest);
    } catch (e) {
      fs.rmSync(up.tmp, { force: true });
      return send(res, 400, { error: e.message });
    }
    engine.log('system', `Đã thêm vào thư viện: ${up.name}`);
    save();
    transcode.enqueue(url.searchParams.get('brand'), up.name); // video H.265 → tự chuyển H.264 ở nền
    return send(res, 200, { name: up.name, state: stateView() });
  }
  if (req.method === 'GET' && p === '/api/media/file') {
    let file;
    try { file = media.resolve(url.searchParams.get('brand'), url.searchParams.get('name')); }
    catch { res.writeHead(404); return res.end('Không tìm thấy'); }
    return serveFile(file, req, res, 'private, max-age=300');
  }
  if (req.method === 'POST' && p === '/api/media/note') {
    const b = await readBody(req);
    try { media.resolve(b.brand, b.name); media.setNote(b.brand, b.name, b.note); } catch (e) { return send(res, 400, { error: e.message }); }
    return send(res, 200, stateView());
  }
  // Nhờ Gemini xem file: 1 file (có name) hoặc mọi file chưa phân tích của thương hiệu
  if (req.method === 'POST' && p === '/api/media/analyze') {
    const b = await readBody(req);
    try {
      if (b.name) { await videoIntel.analyze(b.brand, b.name); engine.log('system', `Gemini đã xem file ${b.name}`); }
      else {
        const r = await videoIntel.analyzeMissing(b.brand);
        engine.log('system', `Gemini xem ${r.done} file của ${b.brand}${r.failed.length ? `, ${r.failed.length} lỗi (${r.failed[0]})` : ''}`);
        save();
        return send(res, 200, { result: r, state: stateView() });
      }
    } catch (e) { return send(res, 400, { error: e.message }); }
    save();
    return send(res, 200, stateView());
  }
  // Sếp xác nhận người trong file đã đồng ý đăng công khai
  if (req.method === 'POST' && p === '/api/media/consent') {
    const b = await readBody(req);
    try { media.setConsent(b.brand, b.name, !!b.value); } catch (e) { return send(res, 400, { error: e.message }); }
    return send(res, 200, stateView());
  }
  // Kiểm tra tuân thủ 小红书 cho nội dung đang soạn (chưa lưu)
  if (req.method === 'POST' && p === '/api/xhs/lint') {
    const b = await readBody(req);
    try {
      const set = Array.isArray(b.media) && b.media.length ? media.validateSet(b.brand, b.media.map(String)) : [];
      return send(res, 200, xhs.lintParts(b.brand, b.title, b.text, set));
    } catch (e) { return send(res, 400, { error: e.message }); }
  }

  // Trả lời nhanh cho khách nhắn riêng: soạn bản tiếng Trung + dịch Việt, người gửi tay
  if (req.method === 'GET' && p === '/api/replies/info') {
    const q = new URL(req.url, 'http://x').searchParams;
    const rate = Number(q.get('rate')) > 0 ? Number(q.get('rate')) : replies.DEFAULT_RATE;
    const people = Math.max(1, Number(q.get('people')) || 1);
    return send(res, 200, { intents: replies.listIntents(), prices: replies.priceTable(rate, people), rate, defaultRate: replies.DEFAULT_RATE, promoEnd: replies.PROMO_END, promoActive: replies.promoActive() });
  }
  if (req.method === 'POST' && p === '/api/replies/draft') {
    const b = await readBody(req);
    if (!String(b.message || '').trim() && !b.intent) return send(res, 400, { error: 'Dán tin khách nhắn hoặc chọn loại câu trả lời' });
    return send(res, 200, replies.draft(b.message, { intent: b.intent, size: b.size, people: b.people, service: b.service, rate: b.rate, lang: b.lang, brand: planner.brands()[b.brand] || planner.brands().the_one }));
  }

  if (req.method === 'POST' && p === '/api/lessons') {
    const b = await readBody(req);
    const scope = b.scope === 'all' || planner.brands()[b.scope] ? b.scope : 'all';
    try { lessons.add({ text: b.text, scope, source: 'manual', category: b.category, evidence: b.evidence }); engine.log('lesson', `Sếp thêm bài học AI (${scope === 'all' ? 'chung' : scope}): "${String(b.text).trim().slice(0, 80)}"`, { by: 'Sếp', after: String(b.text).trim().slice(0, 120) }); } catch (e) { return send(res, 400, { error: e.message }); }
    return send(res, 200, stateView());
  }
  if (req.method === 'POST' && p === '/api/lessons/suggest') {
    const r = await lessons.suggest();
    return send(res, 200, { ...stateView(), suggest: r });
  }
  if (req.method === 'PUT' && (m = p.match(/^\/api\/lessons\/([^/]+)$/))) {
    try {
      const patch = await readBody(req);
      const old = d.lessons.find((x) => x.id === m[1]) || {};
      const was = { status: old.status, text: old.text, category: old.category, scope: old.scope };
      lessons.update(m[1], patch);
      const now = d.lessons.find((x) => x.id === m[1]);
      for (const f of ['status', 'text', 'category', 'scope']) if (patch[f] !== undefined && was[f] !== now[f]) engine.log('lesson', `Sếp sửa bài học AI (${f}): "${String(now.text).slice(0, 60)}"`, { by: 'Sếp', field: f, before: was[f], after: now[f] });
    } catch (e) { return send(res, 400, { error: e.message }); }
    return send(res, 200, stateView());
  }
  if (req.method === 'DELETE' && (m = p.match(/^\/api\/lessons\/([^/]+)$/))) {
    try { const old = d.lessons.find((x) => x.id === m[1]); lessons.remove(m[1]); engine.log('lesson', `Sếp xoá bài học AI: "${old ? old.text.slice(0, 80) : ''}"`, { by: 'Sếp', before: old ? old.text.slice(0, 120) : '' }); } catch (e) { return send(res, 400, { error: e.message }); }
    return send(res, 200, stateView());
  }

  if (req.method === 'POST' && p === '/api/meta/check') {
    const names = Object.fromEntries(Object.entries(planner.brands()).map(([id, b]) => [id, b.name]));
    const checks = [...(await require('./meta-check').runChecks()), ...(await require('./connectors/tiktok').checks(names))];
    return send(res, 200, { checks });
  }
  if (await tiktokRoutes.handleApi(req, res, url, { readBody, send, stateView })) return;
  if (await youtubeRoutes.handleApi(req, res, url, { readBody, send, stateView })) return;
  if (await adsApi.handleApi(req, res, url, { readBody, send })) return;
  if (await calendarApi.handleApi(req, res, url, { readBody, send })) return;
  if (await monthPlan.handleApi(req, res, url, { readBody, send })) return;
  if (await automations.handleApi(req, res, url, { readBody, send })) return;
  if (await agentsApi.handleApi(req, res, url, { readBody, send })) return;
  if (await require('./content-api').handleApi(req, res, url, { readBody, send })) return;
  if (await reports.handleApi(req, res, url, { readBody, send })) return;
  if (await channelsApi.handleApi(req, res, url, { readBody, send })) return;
  if (await assistantApi.handleApi(req, res, url, { readBody, send })) return;
  if (await audit.handleApi(req, res, url, { send })) return;
  if (await brandsApi.handleApi(req, res, url, { send })) return;
  if (await mediaLib.handleApi(req, res, url, { readBody, send })) return;
  if (await drive.handleApi(req, res, url, { readBody, send })) return;
  if (await knowledgeApi.handleApi(req, res, url, { readBody, send })) return;
  if (await accountApi.handleApi(req, res, url, { readBody, send }, req.user)) return;

  if (req.method === 'POST' && p === '/api/analyze') {
    const campaigns = await ads.list();
    return send(res, 200, { text: await ai.analyze(campaigns, d.actions) });
  }

  if (req.method === 'POST' && p === '/api/settings') {
    const b = await readBody(req);
    const beforeSettings = flatSettings(d.settings);
    for (const k of MERGEABLE) if (b[k] !== undefined) d.settings[k] = b[k];
    const tkErr = tiktokRoutes.validateSettings(b, d);
    if (tkErr) return send(res, 400, { error: tkErr });
    const ytErr = youtubeRoutes.validateSettings(b, d);
    if (ytErr) return send(res, 400, { error: ytErr });
    if (b.rules) for (const [k, v] of Object.entries(b.rules)) d.settings.rules[k] = { ...d.settings.rules[k], ...v };
    assistantApi.applySettings(b, d);
    if (b.leads && typeof b.leads === 'object') {
      if (b.leads.on !== undefined) d.settings.leads.on = !!b.leads.on;
      if (b.leads.useForAds !== undefined) d.settings.leads.useForAds = !!b.leads.useForAds;
    }
    if (b.adTest) {
      const t = d.settings.adTest;
      const n = (k, min, max) => { if (b.adTest[k] !== undefined) t[k] = Math.min(max, Math.max(min, Number(b.adTest[k]) || 0)); };
      if (b.adTest.on !== undefined) t.on = !!b.adTest.on;
      n('perUnitPerDay', 1, 10); n('budget', 20000, 1000000); n('days', 1, 14); n('checkDays', 1, 14); n('raisePct', 5, 100);
      if (b.adTest.boost && typeof b.adTest.boost === 'object') {
        const bo = b.adTest.boost;
        t.boost = t.boost || {};
        if (bo.on !== undefined) t.boost.on = !!bo.on;
        if (bo.auto !== undefined) t.boost.auto = !!bo.auto;
        const bn = (k, min, max) => { if (bo[k] !== undefined) t.boost[k] = Math.min(max, Math.max(min, Math.round(Number(bo[k]) || 0))); };
        bn('minViews', 0, 1000000); bn('maxAgeDays', 1, 60); bn('expireDays', 1, 14);
      }
      for (const u of b.adTest.units || []) {
        const cur = t.units.find((x) => x.id === u.id);
        if (cur && u.dailyBudget !== undefined) cur.dailyBudget = Math.min(50000000, Math.max(0, Math.round(Number(u.dailyBudget) || 0)));
        if (cur && u.pageId !== undefined) {
          // Page Facebook của cơ sở (dùng cho "Lên bài & chạy QC"): phải thuộc thương hiệu của cơ sở; rỗng = bỏ gán
          const pid = String(u.pageId || '').trim();
          if (pid && !(planner.brands()[cur.brand] || { pageIds: [] }).pageIds.includes(pid)) return send(res, 400, { error: `Page ${pid} không thuộc thương hiệu của ${cur.name}` });
          if (pid) cur.pageId = pid; else delete cur.pageId;
        }
        if (cur && u.on !== undefined) cur.on = !!u.on; // tắt = cơ sở không chạy quảng cáo thử/video (không đề xuất, không tự chạy)
      }
    }
    {
      const after = flatSettings(d.settings);
      for (const key of Object.keys(after).filter((x) => after[x] !== beforeSettings[x]).slice(0, 20)) engine.log('settings', `Sếp đổi cài đặt ${key}: ${beforeSettings[key] ?? '—'} → ${after[key]}`, { by: 'Sếp', field: key, before: beforeSettings[key], after: after[key] });
    }
    if (b.paused !== undefined) engine.log('system', b.paused ? 'DỪNG KHẨN CẤP — agent ngừng mọi hành động' : 'Đã bật lại agent');
    if (b.scanMinutes !== undefined) {
      d.settings.scanMinutes = Math.min(1440, Math.max(5, Number(b.scanMinutes) || 30));
      schedule();
    }
    save();
    return send(res, 200, stateView());
  }

  if (req.method === 'POST' && p === '/api/autopilot') {
    const b = await readBody(req);
    const ap = d.settings.autopilot;
    if (b.on !== undefined) ap.on = !!b.on;
    if (b.autoApprove !== undefined) ap.autoApprove = !!b.autoApprove;
    if (b.draftDaysBefore !== undefined) ap.draftDaysBefore = Math.min(28, Math.max(0, Number(b.draftDaysBefore) || 0));
    if (b.on !== undefined || b.autoApprove !== undefined) engine.log('system', `Lái tự động: ${ap.on ? 'BẬT' : 'TẮT'}, tự duyệt bài: ${ap.autoApprove ? 'có' : 'không'}`);
    save();
    return send(res, 200, stateView());
  }
  if (req.method === 'POST' && p === '/api/autopilot/profiles') {
    const b = await readBody(req);
    const days = (b.days || []).map(Number).filter((x) => x >= 1 && x <= 7);
    if (!social.CHANNELS[b.channel]) return send(res, 400, { error: 'Chọn kênh' });
    if (planner.brands()[b.brand] && !planner.channelEnabled(b.brand, b.channel)) return send(res, 400, { error: `Kênh ${social.CHANNELS[b.channel].label} đang tắt cho thương hiệu này — bật ở trang Thương hiệu & Kênh trước.` });
    if (!planner.brands()[b.brand] || !days.length || !/^\d{1,2}:\d{2}$/.test(b.time || '') || !planner.TYPES[b.type]) return send(res, 400, { error: 'Hồ sơ chưa đủ thông tin' });
    d.settings.autopilot.profiles.push({ id: uid('pf'), brand: b.brand, channel: b.channel, type: b.type, time: b.time, days, direction: String(b.direction || '') });
    save();
    return send(res, 200, stateView());
  }
  if (req.method === 'DELETE' && (m = p.match(/^\/api\/autopilot\/profiles\/([^/]+)$/))) {
    const ap = d.settings.autopilot;
    ap.profiles = ap.profiles.filter((x) => x.id !== m[1]);
    save();
    return send(res, 200, stateView());
  }

  if (req.method === 'POST' && p === '/api/brands') {
    const b = await readBody(req);
    const beforeBrand = JSON.stringify(planner.brands()[b.id] || null);
    try { planner.updateBrand(b.id, b); } catch (e) { return send(res, 400, { error: e.message }); }
    if (JSON.stringify(planner.brands()[b.id]) !== beforeBrand) engine.log('brand', `Sếp cập nhật hồ sơ thương hiệu ${planner.brands()[b.id].name}: ${Object.keys(b).filter((k) => k !== 'id').join(', ')}`, { by: 'Sếp', brand: b.id, field: Object.keys(b).filter((k) => k !== 'id').join(',').slice(0, 60) });
    return send(res, 200, stateView());
  }

  if (req.method === 'GET' && p === '/api/export') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="salon-agentic-backup-${new Date().toISOString().slice(0, 10)}.json"` });
    return res.end(JSON.stringify(d, null, 2));
  }

  if (req.method === 'POST' && p === '/api/reset-demo') {
    if (ads.mode !== 'mock') return send(res, 400, { error: 'Chỉ dùng được ở chế độ mẫu' });
    await ads.reset();
    d.approvals = []; d.actions = [];
    for (const c of d.comments) c.status = 'new';
    save();
    return send(res, 200, stateView());
  }

  if (req.method === 'POST' && (m = p.match(/^\/api\/approvals\/([^/]+)\/(approve|reject)$/))) {
    const b = await readBody(req).catch(() => ({}));
    try { await engine.decide(m[1], m[2] === 'approve', { note: b.note }); } catch (e) { return send(res, 400, { error: e.message }); }
    return send(res, 200, stateView());
  }
  // Duyệt / bỏ qua nhiều mục một lúc: từng mục xử lý riêng, mục lỗi không chặn các mục khác
  if (req.method === 'POST' && p === '/api/approvals/bulk') {
    const b = await readBody(req);
    if (!['approve', 'reject'].includes(b.action)) return send(res, 400, { error: 'action phải là approve hoặc reject' });
    const ids = [...new Set(Array.isArray(b.ids) ? b.ids.map(String) : [])];
    if (!ids.length || ids.length > 25) return send(res, 400, { error: 'Chọn từ 1 đến 25 mục' });
    const one = async (id) => {
      try { await engine.decide(id, b.action === 'approve', { note: b.note }); return { id, ok: true }; }
      catch (e) { return { id, ok: false, error: e.message }; }
    };
    // Mục tiền/quảng cáo xử lý lần lượt (kiểm tra trần ngân sách); các mục còn lại xử lý song song cho nhanh
    const MONEY = new Set(['ad_test', 'budget_increase', 'unit_budget']);
    const typeOf = (id) => ((load().approvals.find((x) => x.id === id)) || {}).type;
    const results = await Promise.all(ids.filter((id) => !MONEY.has(typeOf(id))).map(one));
    for (const id of ids.filter((i) => MONEY.has(typeOf(i)))) results.push(await one(id));
    return send(res, 200, { results, state: stateView() });
  }

  if (req.method === 'POST' && p === '/api/posts') {
    const b = await readBody(req);
    if (!social.CHANNELS[b.channel] || !b.topic) return send(res, 400, { error: 'Thiếu kênh hoặc chủ đề' });
    const brand = planner.brands()[b.brand];
    if (!brand) return send(res, 400, { error: 'Chọn thương hiệu để biết đăng lên Page nào' });
    if (!planner.channelEnabled(b.brand, b.channel)) return send(res, 400, { error: `Kênh ${social.CHANNELS[b.channel].label} đang tắt cho ${brand.name} — bật ở trang Thương hiệu & Kênh trước.` });
    // Chỉ đăng lên 1 số Page của thương hiệu (mặc định: tất cả Page). Instagram: chỉ đăng lên tài khoản IG liên kết với các Page đã chọn
    let pageIds = [];
    if (Array.isArray(b.pageIds) && b.pageIds.length) {
      if (!['facebook_page', 'instagram'].includes(b.channel)) return send(res, 400, { error: 'Chọn Page chỉ áp dụng cho bài Facebook Page và Instagram' });
      pageIds = [...new Set(b.pageIds.map(String))];
      const notMine = pageIds.filter((id) => !brand.pageIds.includes(id));
      if (notMine.length) return send(res, 400, { error: `Page ${notMine.join(', ')} không thuộc ${brand.name}` });
    }
    const zh = xhs.isXhs(b.channel);
    let text = b.text;
    let title = String(b.title || '').trim();
    if (!text && zh) { const dr = await xhs.draftOne(brand, b.topic, planner.brandContext(brand)); text = dr.text; title = title || dr.title; }
    const when = b.scheduledAt ? new Date(b.scheduledAt) : new Date(Date.now() + 3600e3);
    if (Number.isNaN(when.getTime())) return send(res, 400, { error: 'Thời gian không hợp lệ' });
    let made = null;
    if (!zh) {
      // Copywriter → Quality Control (viết lại tối đa 3 lần). Sếp tự gõ nội dung thì không viết đè, chỉ chấm điểm.
      const ce = require('./content-engine');
      const slot = { at: when, category: /ưu đãi|khuyến mãi/i.test(b.topic) ? 'promo' : 'custom', topic: String(b.topic) };
      if (text) made = { text, qc: ce.review(text, { brand, category: slot.category, now: when.getTime(), selfText: text }), topicCategory: slot.category, mode: 'manual' };
      else { made = await ce.produce(brand, slot, {}); text = made.text; }
    }
    let files = [];
    try { if (Array.isArray(b.media) && b.media.length) files = media.validateSet(b.brand, b.media.map(String)); }
    catch (e) { return send(res, 400, { error: e.message }); }
    // TikTok nhiều nick: bài soạn tay phải chọn 1 nick (mỗi nick video riêng)
    let tiktokNick = '';
    if (b.channel === 'tiktok') {
      const nicks = tiktokManual.nicksOf(b.brand);
      if (nicks.length > 1) {
        tiktokNick = String(b.tiktokNick || '');
        if (!nicks.includes(tiktokNick)) return send(res, 400, { error: `Chọn nick TikTok để đăng (${nicks.join(', ')})` });
      }
    }
    const post = { id: uid('post'), channel: b.channel, brand: b.brand, topic: b.topic, ...(zh ? { title } : {}), text, scheduledAt: when.toISOString(), status: 'draft', ...(files.length ? { media: files } : {}), ...(tiktokNick ? { tiktokNick } : {}), ...(pageIds.length ? { pageIds } : {}),
      ...(made ? { category: made.topicCategory, qc: made.qc, ...(made.mode === 'ai' ? { aiText: made.text } : {}) } : {}) };
    d.posts.unshift(post);
    const apId = uid('p');
    d.approvals.unshift({
      id: apId, type: 'post_publish', key: post.id, status: 'pending', at: new Date().toISOString(),
      title: `Bài ${social.CHANNELS[b.channel].label} · ${brand.name}: ${b.topic}`, detail: zh ? `${title}\n\n${text}` : text, payload: { postId: post.id },
    });
    engine.log('propose', `Soạn bài ${social.CHANNELS[b.channel].label} "${b.topic}", chờ Sếp duyệt`);
    save();
    // Sếp tích "Duyệt luôn" ngay trong hộp soạn bài: coi như Sếp bấm duyệt, bài lên lịch đúng giờ đã chọn
    if (b.approveNow === true) { try { await engine.decide(apId, true, { note: 'Duyệt luôn khi soạn bài' }); } catch (e) { return send(res, 400, { error: 'Đã tạo bài nhưng chưa duyệt được: ' + e.message }); } }
    return send(res, 200, stateView());
  }

  // 小红书: gói đăng (tiêu đề, nội dung, file, giờ Bắc Kinh, các bước) và đánh dấu trạng thái đăng tay
  if (req.method === 'GET' && (m = p.match(/^\/api\/posts\/([^/]+)\/package$/))) {
    const post = d.posts.find((x) => x.id === m[1]);
    if (!post) return send(res, 404, { error: 'Không tìm thấy bài' });
    try { return send(res, 200, (tiktokManual.isTiktok(post.channel) ? tiktokManual : xhs).buildPackage(post)); } catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (req.method === 'POST' && (m = p.match(/^\/api\/posts\/([^/]+)\/manual$/))) {
    const b = await readBody(req);
    const target = d.posts.find((x) => x.id === m[1]);
    try {
      if (target && tiktokManual.isTiktok(target.channel)) tiktokManual.markPost(m[1], b.action, b.url, b.nick ? String(b.nick) : '');
      else xhs.markPost(m[1], b.action, b.url);
    } catch (e) { return send(res, 400, { error: e.message }); }
    return send(res, 200, stateView());
  }
  // TikTok đăng tay: các bài cần hẹn giờ trên TikTok Studio trong 10 ngày tới, theo từng nick
  if (req.method === 'GET' && p === '/api/tiktok/batch') return send(res, 200, tiktokManual.batch(url.searchParams.get('brand') || ''));

  // Thư viện Media → "Lên bài & chạy QC": mỗi file × mỗi cơ sở 1 bài trên Page của cơ sở, đăng xong tự chạy quảng cáo thử
  if (req.method === 'POST' && p === '/api/posts/with-ads') {
    let r;
    try { r = await require('./post-ads').create(await readBody(req)); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
    return send(res, 200, { ...r, state: stateView() });
  }

  // Sếp chỉ định chạy thử 1 bài đã đăng cho các cơ sở: tạo đề xuất chờ duyệt (approveNow: duyệt luôn, lần lượt từng cơ sở)
  if (req.method === 'POST' && p === '/api/adtests/manual') {
    const b = await readBody(req);
    let ids;
    try { ids = await require('./adtest').proposeManual(b); } catch (e) { return send(res, 400, { error: e.message }); }
    save();
    const results = [];
    if (b.approveNow === true) {
      for (const id of ids) {
        try { await engine.decide(id, true, { note: 'Duyệt luôn khi tạo quảng cáo thử' }); results.push({ id, ok: true }); }
        catch (e) { results.push({ id, ok: false, error: e.message }); }
      }
    }
    return send(res, 200, { ids, results, state: stateView() });
  }

  if (req.method === 'POST' && p === '/api/plans') {
    try { await planner.create(await readBody(req)); } catch (e) { return send(res, 400, { error: e.message }); }
    return send(res, 200, stateView());
  }
  if (req.method === 'PUT' && (m = p.match(/^\/api\/plans\/([^/]+)\/items\/([^/]+)$/))) {
    try { planner.editItem(m[1], m[2], await readBody(req)); } catch (e) { return send(res, 400, { error: e.message }); }
    return send(res, 200, stateView());
  }
  if (req.method === 'POST' && (m = p.match(/^\/api\/plans\/([^/]+)\/approve$/))) {
    try { planner.approve(m[1]); } catch (e) { return send(res, 400, { error: e.message }); }
    return send(res, 200, stateView());
  }

  return send(res, 404, { error: 'Không tìm thấy' });
}

// Tệp tĩnh trong public/. Giao diện (html/js/css) luôn hỏi lại máy chủ: đẩy bản mới là người dùng nhận ngay, không bị cache cũ gây lỗi trộn tệp
function serveStatic(pathname, res) {
  const file = path.normalize(path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('404');
  }
  const ext = path.extname(file);
  const cache = ['.html', '.js', '.css'].includes(ext) ? 'no-cache' : 'private, max-age=3600';
  res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': cache });
  fs.createReadStream(file).pipe(res);
}
// Gửi 1 file thư viện, hỗ trợ tải từng đoạn (Range) cho video
function serveFile(file, req, res, cache) {
  const size = fs.statSync(file).size;
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff', 'cache-control': cache };
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start > end || start >= size) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'content-length': size });
  if (req.method === 'HEAD') return res.end();
  return fs.createReadStream(file).pipe(res);
}
// Link tạm có chữ ký cho Meta kéo ảnh/video khi đăng Instagram (xem src/connectors/instagram.js): không cần đăng nhập,
// chỉ mở đúng 1 file, hết hạn sau 24 giờ; sai/hết hạn trả 404 như không tồn tại.
function servePubMedia(req, res, p) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  const link = require('./connectors/instagram').verifyLink(p.slice('/pub/media/'.length));
  let file;
  try { if (!link) throw new Error(); file = link.cached ? require('./igimage').resolveCached(link.brand, link.name) : media.resolve(link.brand, link.name); }
  catch { res.writeHead(404); return res.end('Không tìm thấy'); }
  return serveFile(file, req, res, 'public, max-age=3600');
}
// Biểu tượng và manifest cho "Thêm vào màn hình chính" trên điện thoại: trình duyệt tải không kèm mật khẩu, nên mở công khai (không có dữ liệu)
// + file xác minh tên miền của TikTok for Developers (public/tiktok<mã>.txt, nội dung công khai)
const isPublicAsset = (p) => p === '/manifest.webmanifest' || /^\/icons\/[a-z0-9-]+\.png$/.test(p) || /^\/tiktok[A-Za-z0-9]{8,64}\.txt$/.test(p);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); } // cho giám sát, không lộ dữ liệu
    // Trình duyệt tự xin /favicon.ico ngay cả khi trang chính đang đòi đăng nhập; nếu favicon cũng trả 401 thì Chrome mở
    // hộp đăng nhập THỨ HAI đè lên hộp đang gõ → ô mật khẩu "nhảy", gõ không được. Trả 204 không cần đăng nhập (không lộ gì).
    if (url.pathname === '/favicon.ico') { res.writeHead(204, { 'cache-control': 'public, max-age=86400' }); return res.end(); }
    if (tiktokRoutes.isPublic(url.pathname)) return tiktokRoutes.servePublic(url.pathname, res); // Chính sách riêng tư / Điều khoản (TikTok yêu cầu công khai)
    // Trợ lý trên website salon: widget + chat + để lại SĐT, không cần đăng nhập (giới hạn theo IP, chỉ web của salon được nhúng)
    if (assistantApi.isPublic(url.pathname)) { await assistantApi.handlePublic(req, res, url, clientIp(req)); return; }
    if (isPublicAsset(url.pathname)) return serveStatic(url.pathname, res);
    if (url.pathname.startsWith('/pub/media/')) return servePubMedia(req, res, url.pathname);
    if (await handleLogin(req, res, url)) return;
    const auth = authorize(req);
    if (auth.status === 'locked') { res.writeHead(429, { 'retry-after': '600' }); return res.end('Sai mật khẩu quá nhiều lần. Thử lại sau 10 phút.'); }
    if (auth.status !== 'ok') {
      // Không gửi WWW-Authenticate: trình duyệt không bật hộp Basic Auth nữa; trang web nhận trang đăng nhập, API nhận JSON 401 (giao diện tự chuyển)
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return send(res, 401, { error: 'Cần đăng nhập', login: '/login' });
      res.writeHead(401, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(sessions.loginPage(url.pathname + url.search));
    }
    // Yêu cầu ghi bằng cookie phải đến từ chính app (chặn trang khác lợi dụng phiên đang đăng nhập)
    if (auth.sid && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) && sessions.crossSite(req)) return send(res, 403, { error: 'Yêu cầu không đến từ chính ứng dụng' });
    req.user = auth.user;
    if (url.pathname.startsWith('/auth/tiktok/')) {
      // Kết nối TikTok là thao tác thương hiệu: cần quyền sửa thương hiệu (và đúng thương hiệu được giao)
      const deny = authz.check(req.user, 'POST', '/api/tiktok/disconnect', { brand: url.searchParams.get('brand') }, url.searchParams);
      if (deny) { res.writeHead(deny.status, { 'content-type': 'text/plain; charset=utf-8' }); return res.end(deny.error); }
      return await authCtx.runAs(req.user, () => tiktokRoutes.handleAuth(req, res, url));
    }
    // Kết nối YouTube (Google chuyển trình duyệt về /api/youtube/callback): youtube-routes tự kiểm tra quyền sửa thương hiệu
    if (youtubeRoutes.isAuth(url.pathname)) return await authCtx.runAs(req.user, () => youtubeRoutes.handleAuth(req, res, url));
    if (url.pathname.startsWith('/api/')) {
      // Cổng phân quyền: đọc nội dung yêu cầu ghi 1 lần (trừ tải file), kiểm tra quyền + thương hiệu, rồi mới xử lý
      if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) && url.pathname !== '/api/media/upload') {
        try { req._body = { val: await readRaw(req) }; } catch (e) { req._body = { err: e, val: {} }; }
      }
      const deny = authz.check(req.user, req.method, url.pathname, req._body ? req._body.val : {}, url.searchParams);
      if (deny) { engine.log('error', `Từ chối quyền: ${req.user.name} (${req.user.role}) ${req.method} ${url.pathname} — ${deny.error}`, { by: req.user.name, rule: 'authz' }); return send(res, deny.status, { error: deny.error }); }
      return await authCtx.runAs(req.user, () => api(req, res, url));
    }
    return serveStatic(url.pathname, res);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
});

// Vòng quét định kỳ (mặc định 30 phút)
let timer;
function schedule() {
  clearTimeout(timer);
  const ms = Math.max(1, Number(load().settings.scanMinutes) || 30) * 60e3;
  nextScanAt = new Date(Date.now() + ms).toISOString();
  timer = setTimeout(async () => {
    try { await engine.scan('schedule'); } catch (e) { console.error('Quét lỗi:', e.message); engine.log('error', `Quét lỗi: ${e.message}`); save(); }
    try { transcode.sweep(); } catch (e) { console.error('Chuyển mã lỗi:', e.message); } // video chép tay / mới khôi phục
    schedule();
  }, ms);
  if (timer.unref) timer.unref(); // máy chủ thật sống nhờ cổng đang lắng nghe; trong kiểm thử hẹn giờ này không được giữ tiến trình lại
}

// Mặc định chỉ lắng nghe localhost; đặt HOST=0.0.0.0 + APP_PASSWORD khi đưa lên VPS
const HOST = process.env.HOST || '127.0.0.1';
const LOOPBACK = ['127.0.0.1', 'localhost', '::1'];
if (require.main === module) {
  // Mở ra ngoài localhost mà không có mật khẩu = ai cũng vào được tài khoản quảng cáo → không cho chạy
  if (!LOOPBACK.includes(HOST) && !process.env.APP_PASSWORD) {
    console.error('Từ chối khởi động: HOST không phải localhost nhưng chưa đặt APP_PASSWORD trong .env');
    process.exit(1);
  }
  server.listen(PORT, HOST, () => {
    console.log(`Salon Agentic AI: http://${HOST}:${PORT}  (quảng cáo: ${ads.mode === 'live' ? 'THẬT' : 'chế độ mẫu'})`);
    ads.list().then(() => { load().campaigns = load().campaigns; }).catch(() => {});
    schedule();
    transcode.start();
    setTimeout(() => { try { transcode.sweep(); } catch (e) { console.error('Chuyển mã lỗi:', e.message); } }, 15e3).unref();
  });
}

module.exports = { server };
