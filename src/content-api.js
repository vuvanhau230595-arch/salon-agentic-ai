// API dây chuyền nội dung: dữ liệu động thương hiệu, trạng thái 8 agent (số liệu THẬT), thống kê, kho ví dụ, viết lại bài trong kế hoạch.
const { load, save } = require('./db');
const planner = require('./planner');
const facts = require('./brand-facts');
const ce = require('./content-engine');
const learning = require('./learning');
const engine = require('./engine');
const social = require('./connectors/social');

const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
const DAY = 864e5;
const day = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
const aiMode = () => {
  const cfg = load().settings.ai || {};
  if (cfg.enabled === false) return { code: 'off', label: 'AI đã tắt (dùng bài mẫu)' };
  if (process.env.ANTHROPIC_API_KEY) return { code: 'claude', label: 'Claude' };
  if (process.env.GEMINI_API_KEY) return { code: 'gemini', label: 'Gemini' };
  return { code: 'none', label: 'Chưa có khoá AI (dùng bài mẫu)' };
};

// ───────── Trạng thái 8 agent ─────────
function pipeline(now = Date.now()) {
  const db = load();
  const brands = Object.values(planner.brands()).filter((b) => b.id !== 'mishang');
  const ap = db.settings.autopilot;
  const sch = db.settings.scheduling;
  const posts = db.posts.filter((p) => p.brand && p.channel === 'facebook_page');
  const recent = posts.filter((p) => new Date(p.scheduledAt).getTime() > now - 30 * DAY);
  const scored = recent.filter((p) => p.qc);
  const avg = scored.length ? Math.round(scored.reduce((s, p) => s + p.qc.score, 0) / scored.length) : null;
  const ex = learning.summary();
  const mode = aiMode();
  const dry = !!db.settings.dryRun;
  const live = social.CHANNELS.facebook_page.live();
  const nextScan = db.lastScan ? new Date(new Date(db.lastScan).getTime() + db.settings.scanMinutes * 60e3).toISOString() : null;

  const factRows = brands.map((b) => {
    const v = facts.view(b.id, now);
    const by = (s) => v.filter((x) => x.state === s).length;
    return { brand: b.id, name: b.name, current: by('current'), unverified: by('unverified'), expired: by('expired'), missing: by('missing'), total: v.length, hotline: (v.find((x) => x.key === 'hotline') || {}).state };
  });
  const lessonsPending = db.lessons.filter((l) => l.status === 'pending').length;
  const profiles = brands.map((b) => ({ brand: b.id, name: b.name, n: ap.profiles.filter((p) => p.brand === b.id && p.channel === 'facebook_page').length }));
  const pageCfg = brands.map((b) => ({ brand: b.id, name: b.name, pages: b.pageIds.length, on: planner.channelEnabled(b.id, 'facebook_page') }));
  const lastPub = posts.filter((p) => p.status === 'published').sort((a, b) => new Date(b.scheduledAt) - new Date(a.scheduledAt))[0];
  const aiOk = mode.code === 'claude' || mode.code === 'gemini';
  const missedPolicy = { within: `đăng nếu trễ ≤ ${sch.lateHours} giờ, quá thì đánh dấu bỏ lỡ`, skip: 'luôn đánh dấu bỏ lỡ', late: 'luôn đăng muộn' }[sch.missed] || sch.missed;

  const A = (id, name, role, status, headline, details, needs = []) => ({ id, name, role, status, headline, details, needs });
  return {
    aiMode: mode, dry, live, minScore: ce.PASS, maxRewrites: ce.MAX_REWRITES,
    agents: [
      A('brand_knowledge', 'Brand Knowledge Agent', 'Giữ dữ liệu riêng từng thương hiệu, có phiên bản và hiệu lực',
        factRows.some((r) => r.current === 0) ? 'warn' : 'ok', factRows.map((r) => `${r.name}: ${r.current}/${r.total} dữ kiện hiện hành`).join(' · '),
        factRows.map((r) => `${r.name}: ${r.unverified} chưa xác nhận, ${r.expired} hết hạn, ${r.missing} chưa nhập`),
        factRows.filter((r) => r.hotline !== 'current').map((r) => `${r.name}: nhập và xác nhận hotline (Thương hiệu & Kênh → Dữ liệu động)`)),
      A('strategy', 'Content Strategy Agent', 'Chọn chủ đề theo khung 7 ngày, tránh lặp, không bịa xu hướng', 'ok',
        `${recent.length} bài trong 30 ngày qua`,
        Object.entries(recent.reduce((m, p) => { const k = p.category || 'khác'; m[k] = (m[k] || 0) + 1; return m; }, {})).map(([k, n]) => `${ce.CATEGORIES[k] || k}: ${n}`)),
      A('copywriter', 'Copywriter Agent', 'Viết bài Facebook; địa chỉ/hotline do hệ thống chèn từ dữ liệu đã xác nhận', aiOk ? 'ok' : 'warn',
        `Đang dùng: ${mode.label}`, [`Bài có bản AI viết: ${recent.filter((p) => p.aiText).length}/${recent.length}`], aiOk ? [] : ['Điền ANTHROPIC_API_KEY hoặc GEMINI_API_KEY vào .env để AI tự viết']),
      A('qc', 'Quality Control Agent', `Chấm 0–100, dưới ${ce.PASS} điểm viết lại tối đa ${ce.MAX_REWRITES} lần`, scored.some((p) => p.qc.status === 'needs_info') ? 'warn' : 'ok',
        avg === null ? 'Chưa có bài nào được chấm' : `Điểm trung bình ${avg}/100 (${scored.length} bài)`,
        [`Cần bổ sung dữ liệu: ${scored.filter((p) => p.qc.status === 'needs_info').length}`, `Còn dưới ${ce.PASS} điểm: ${scored.filter((p) => p.qc.status === 'needs_work').length}`, `Số lần viết lại: ${scored.reduce((s, p) => s + (p.qc.attempts || 0), 0)}`]),
      A('learning', 'Learning Agent', 'Lưu bài AI / bài Sếp sửa / bài đã duyệt, đề xuất bài học (chờ duyệt)', 'ok',
        `${ex.total} ví dụ đã duyệt, ${ex.edited} bài có chỉnh sửa`, [`Bài học đang chờ Sếp duyệt: ${lessonsPending}`, 'Không tự fine-tune mô hình; không tự đổi thông tin kinh doanh']),
      A('scheduling', 'Scheduling Agent', `Mặc định 1 bài/ngày lúc ${sch.defaultTime} (giờ VN), chống trùng ngày, tự soạn tháng sau`, ap.on && profiles.every((p) => p.n) ? 'ok' : 'warn',
        ap.on ? `Lái tự động BẬT · quét mỗi ${db.settings.scanMinutes} phút` : 'Lái tự động đang TẮT',
        [`Lần chạy gần nhất: ${db.lastScan || '—'}`, `Lần chạy tiếp theo: ${ap.on ? nextScan || 'sau lần quét đầu' : '—'}`, `Soạn trước ${ap.draftDaysBefore} ngày · bài quá giờ: ${missedPolicy}`, `Bài đang bỏ lỡ: ${posts.filter((p) => p.status === 'missed').length}`],
        [...(ap.on ? [] : ['Bật Lái tự động ở trang Lái tự động']), ...profiles.filter((p) => !p.n).map((p) => `${p.name}: chưa có hồ sơ nội dung Facebook (Lái tự động → Hồ sơ nội dung)`)]),
      A('publishing', 'Publishing Agent', 'Đăng qua Meta Graph API; mặc định chạy thử, đăng thật chỉ khi Sếp bật', dry ? 'warn' : live ? 'ok' : 'warn',
        dry ? 'CHẠY THỬ — chưa đăng thật' : live ? 'ĐĂNG THẬT đang bật' : 'Chế độ mẫu (chưa có META_ACCESS_TOKEN)',
        [...pageCfg.map((p) => `${p.name}: ${p.on ? `${p.pages} Page` : 'kênh Facebook tắt'}`), `Bài đăng gần nhất: ${lastPub ? `${lastPub.topic} (mã ${lastPub.externalId || 'không có'})` : 'chưa có'}`, `Bài lỗi: ${posts.filter((p) => p.status === 'failed').length}`],
        [...(process.env.META_ACCESS_TOKEN ? [] : ['Điền META_ACCESS_TOKEN (xem HUONG-DAN-META.md)']), ...pageCfg.filter((p) => p.on && !p.pages).map((p) => `${p.name}: nhập Page ID`), ...(dry ? ['Muốn đăng thật: tắt "Chạy thử" ở trang Quảng cáo'] : [])]),
      A('analytics', 'Analytics Agent', 'Thống kê bài tạo/duyệt/từ chối/đã đăng; chỉ số Facebook khi API có', 'warn',
        'Thống kê nội bộ: có. Chỉ số tương tác Facebook: chưa lấy được', ['Chưa có phần đọc lượt xem/tương tác từng bài từ Facebook — không tạo số liệu giả'], ['Cần viết phần đọc Page Insights và token có quyền pages_read_engagement']),
    ],
  };
}

// ───────── Thống kê ─────────
const APPROVED = ['scheduled', 'published', 'awaiting_manual', 'missed', 'failed'];
function analytics({ month, brand } = {}, now = Date.now()) {
  const db = load();
  const m = /^\d{4}-\d{2}$/.test(month || '') ? month : day(now).slice(0, 7);
  const rows = db.posts.filter((p) => p.channel === 'facebook_page' && p.brand && (!brand || p.brand === brand) && day(p.scheduledAt).slice(0, 7) === m);
  const count = (list) => ({
    total: list.length, approved: list.filter((p) => APPROVED.includes(p.status)).length, rejected: list.filter((p) => p.status === 'rejected' || p.status === 'cancelled').length,
    published: list.filter((p) => p.status === 'published').length, pending: list.filter((p) => p.status === 'draft').length, failed: list.filter((p) => p.status === 'failed').length,
  });
  const byBrand = {};
  for (const p of rows) (byBrand[p.brand] = byBrand[p.brand] || []).push(p);
  const byDay = {};
  for (const p of rows) { const k = day(p.scheduledAt); byDay[k] = byDay[k] || { created: 0, published: 0 }; byDay[k].created++; if (p.status === 'published') byDay[k].published++; }
  const cats = {};
  for (const p of rows) {
    const k = p.category || 'khác';
    const c = (cats[k] = cats[k] || { category: k, label: ce.CATEGORIES[k] || 'Khác', total: 0, approved: 0, rejected: 0, sum: 0, scored: 0 });
    c.total++;
    if (APPROVED.includes(p.status)) c.approved++;
    if (p.status === 'rejected' || p.status === 'cancelled') c.rejected++;
    if (p.qc) { c.sum += p.qc.score; c.scored++; }
  }
  const categories = Object.values(cats).map((c) => ({ category: c.category, label: c.label, total: c.total, approved: c.approved, rejected: c.rejected, avgScore: c.scored ? Math.round(c.sum / c.scored) : null }));
  const tips = [];
  for (const c of categories) {
    if (c.total >= 3 && c.rejected / c.total >= 0.4) tips.push(`Nhóm "${c.label}" bị từ chối ${c.rejected}/${c.total} bài — xem lại cách viết hoặc dữ liệu của nhóm này.`);
    if (c.avgScore !== null && c.avgScore < ce.PASS) tips.push(`Nhóm "${c.label}" điểm kiểm tra trung bình ${c.avgScore} (< ${ce.PASS}) — bổ sung dữ liệu hoặc thêm bài mẫu.`);
  }
  const noHotline = Object.values(planner.brands()).filter((b) => b.id !== 'mishang' && !facts.current(b.id, now).hotline).map((b) => b.name);
  if (noHotline.length) tips.push(`${noHotline.join(', ')}: chưa có hotline đã xác nhận nên bài không kèm số điện thoại.`);
  return {
    month: m, total: count(rows), byBrand: Object.fromEntries(Object.entries(byBrand).map(([k, v]) => [k, { name: (planner.brands()[k] || {}).name || k, ...count(v) }])),
    byDay: Object.entries(byDay).sort().map(([date, v]) => ({ date, ...v })), categories, tips,
    metrics: { available: false, reason: 'Chưa có kết nối đọc chỉ số bài đăng từ Facebook (lượt xem, tương tác). Hệ thống không tự tạo số liệu.' },
  };
}

// ───────── Viết lại / chấm lại bài trong kế hoạch tháng ─────────
function planItem(planId, itemId) {
  const plan = load().plans.find((x) => x.id === planId);
  if (!plan) throw bad('Không tìm thấy kế hoạch', 404);
  const item = plan.items.find((x) => x.id === itemId);
  if (!item) throw bad('Không tìm thấy bài', 404);
  if (item.status !== 'pending') throw bad('Bài này đã được xử lý');
  return { plan, item };
}
async function rewritePlanItem(planId, itemId, instruction) {
  const { plan, item } = planItem(planId, itemId);
  if (require('./xhs').isXhs(plan.channel)) throw bad('Kênh 小红书 viết lại ở chỗ riêng');
  const brand = planner.brands()[plan.brand];
  const slot = { at: new Date(item.at), category: item.category || 'custom', topic: item.topic };
  const r = await ce.produce(brand, slot, { instruction: String(instruction || '').slice(0, 500), selfText: item.text });
  if (r.mode !== 'ai') throw bad('Chưa viết lại được vì AI chưa sẵn sàng (thiếu khoá hoặc đã tắt AI)');
  require('./lessons').record({ type: 'rewrite', kind: 'plan_item', brand: plan.brand, topic: item.topic, ...(instruction ? { note: String(instruction).slice(0, 300) } : {}) });
  item.text = r.text; item.qc = r.qc; item.aiText = item.aiText || r.text;
  save();
  return item;
}
function recheckPlanItem(planId, itemId) {
  const { plan, item } = planItem(planId, itemId);
  item.qc = require('./content-flow').qcOf({ brand: plan.brand, channel: plan.channel, text: item.text, category: item.category, scheduledAt: item.at });
  save();
  return item.qc;
}

async function handleApi(req, res, url, { readBody, send }) {
  const p = url.pathname;
  let m;
  if (!p.startsWith('/api/content') && !p.startsWith('/api/brands/') && !(p.startsWith('/api/plans/') && /\/(rewrite|qc)$/.test(p))) return false;
  try {
    if (req.method === 'GET' && p === '/api/content/pipeline') return send(res, 200, pipeline()), true;
    if (req.method === 'GET' && p === '/api/content/analytics') return send(res, 200, analytics({ month: url.searchParams.get('month'), brand: url.searchParams.get('brand') })), true;
    if (req.method === 'GET' && p === '/api/content/learning') return send(res, 200, learning.summary(url.searchParams.get('brand') || undefined)), true;
    if (req.method === 'GET' && (m = p.match(/^\/api\/brands\/([^/]+)\/facts$/))) {
      if (!planner.brands()[m[1]]) throw bad('Thương hiệu không tồn tại', 404);
      return send(res, 200, { brand: m[1], facts: facts.view(m[1]), activePromos: facts.activePromos(m[1]) }), true;
    }
    if (req.method === 'PUT' && (m = p.match(/^\/api\/brands\/([^/]+)\/facts\/(\w+)$/))) {
      const b = await readBody(req);
      const f = facts.set(m[1], m[2], b, require('./auth-ctx').actorName('Sếp'));
      engine.log('brand', `Dữ liệu động ${m[2]} của ${planner.brands()[m[1]].name} → phiên bản ${f.version}${f.status === 'verified' ? ' (đã xác nhận)' : ' (chưa xác nhận)'}`, { by: 'Sếp', brand: m[1], field: m[2] });
      return send(res, 200, { facts: facts.view(m[1]) }), true;
    }
    if (req.method === 'POST' && (m = p.match(/^\/api\/plans\/([^/]+)\/items\/([^/]+)\/rewrite$/))) {
      const b = await readBody(req).catch(() => ({}));
      return send(res, 200, { item: await rewritePlanItem(m[1], m[2], b.instruction) }), true;
    }
    if (req.method === 'POST' && (m = p.match(/^\/api\/plans\/([^/]+)\/items\/([^/]+)\/qc$/))) return send(res, 200, { qc: recheckPlanItem(m[1], m[2]) }), true;
  } catch (e) { send(res, e.status || 500, { error: e.message }); return true; }
  return false;
}

module.exports = { pipeline, analytics, handleApi, rewritePlanItem, recheckPlanItem };
