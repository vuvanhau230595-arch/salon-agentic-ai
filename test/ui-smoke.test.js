// Vẽ thử MỌI trang giao diện với dữ liệu giống thật (quảng cáo thử đang chạy, đề xuất đủ loại, bài đăng, kế hoạch...)
// trong một "trình duyệt giả" tối thiểu. Bắt lỗi kiểu "biến chưa định nghĩa" làm trắng trang (đã xảy ra với trang Quảng cáo 15/10/2026).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-ui-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
process.env.MEDIA_DIR = path.join(tmp, 'media');
delete process.env.APP_PASSWORD;
delete process.env.META_ACCESS_TOKEN;

// Các hàm tải nền của trang (gọi API giả) có thể hỏng sau khi test xong — không phải lỗi hiển thị, chỉ ghi nhận
const rejections = [];
process.on('unhandledRejection', (e) => rejections.push(e));
const { server } = require('../src/server');
const { load, save } = require('../src/db');
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const PUB = path.join(__dirname, '..', 'public');
const now = Date.now();
const iso = (ms) => new Date(now + ms).toISOString();

function seed() {
  const db = load();
  db.demo = false; db.seeded = true;
  db.settings.dryRun = false;
  db.settings.paused = true; // máy chủ không tự quét trong lúc test (dữ liệu thử chỉ để vẽ giao diện)
  db.settings.adTest.on = true;
  db.settings.adTest.units.find((u) => u.id === 'ms_q1').on = false;
  db.settings.autopilot = { on: true, draftDaysBefore: 5, autoApprove: false, profiles: [{ id: 'pf1', brand: 'the_one', channel: 'facebook_page', type: 'reel', time: '19:00', days: [1, 2, 3], direction: 'video thật' }] };
  db.settings.assistant = { on: true, auto: true, brands: { the_one: true, dark_hair: false, mishang: false } };
  const camp = (o) => ({ status: 'ACTIVE', budget: 0, budgetTotal: 300000, budgetLevel: 'adset', objective: 'OUTCOME_ENGAGEMENT', accountId: '1913415955735981', today: { spend: 50000, msgs: 1 }, d7: { spend: 700000, msgs: 5 }, month: { spend: 2000000, msgs: 20 }, ...o });
  db.campaigns = [
    camp({ id: 'c1', name: 'BT-TN-02 (Bình thạnh - Bản sao 2)' }),
    camp({ id: 'c2', name: 'DH-TN-04 (quận 1 - Bản sao 7)', budget: 300000, budgetLevel: 'campaign' }),
    camp({ id: 'c3', name: 'Q3-WEB-01 (Instagram nu 18-40)', objective: 'OUTCOME_TRAFFIC', status: 'PAUSED' }),
    camp({ id: 'c4', name: 'TEST-to_bt-20261015-POV', budgetTotal: 150000, today: { spend: 78740, msgs: 0 }, d7: { spend: 78740, msgs: 0 } }),
    camp({ id: 'c5', name: 'mi - Bản sao', accountId: '1217163632841898', stale: true }),
  ];
  db.adTests = [
    { id: 't1', unitId: 'to_bt', brand: 'the_one', postId: 'p_x', topic: 'POV: Chị khách mệnh Hoả', accountId: '1913415955735981', name: 'TEST-to_bt', campaignId: 'c4', adsetId: 's', adId: 'a', budget: 150000, days: 7, createdAt: iso(-3600e3), endsAt: iso(6 * 864e5), status: 'running', template: 'BT-TN-03 (70.568đ/tin)', source: 'organic', views: 447 },
    { id: 't2', unitId: 'dh_q1', brand: 'dark_hair', postId: 'p_y', topic: 'Tím than', accountId: '1913415955735981', name: 'TEST-dh', campaignId: 'c9', budget: 150000, days: 7, createdAt: iso(-9 * 864e5), endsAt: iso(-2 * 864e5), finishedAt: iso(-864e5), status: 'fail', early: true, spend: 310000, msgs: 0, source: 'organic' },
    { id: 't3', unitId: 'to_q3', brand: 'the_one', postId: 'p_z', topic: 'Tóc đen mãi cũng chán', accountId: '1913415955735981', name: 'TEST-q3', campaignId: 'c8', budget: 150000, days: 7, createdAt: iso(-9 * 864e5), endsAt: iso(-2 * 864e5), finishedAt: iso(-864e5), status: 'pass', spend: 900000, msgs: 12 },
  ];
  db.posts = [
    { id: 'po1', brand: 'dark_hair', channel: 'facebook_page', status: 'published', live: true, topic: 'Dark Hair Studio xin chào', text: 'Xin chào', media: [], scheduledAt: iso(-2 * 864e5), results: { 459628564196388: '459628564196388_1' } },
    { id: 'po2', brand: 'the_one', channel: 'facebook_page', status: 'scheduled', topic: 'Wolf cut', text: 'Wolf cut cho chị khách Nhật', media: [{ name: '09.mp4', type: 'video' }], scheduledAt: iso(864e5) },
    { id: 'po3', brand: 'the_one', channel: 'facebook_page', status: 'pending', topic: 'Bob nâu tro', text: 'Bob nâu tro', media: [], scheduledAt: iso(2 * 864e5) },
    { id: 'po4', brand: 'the_one', channel: 'xiaohongshu', status: 'awaiting_manual', topic: '染发', title: '越南染发', text: '来The One', media: [], scheduledAt: iso(-3600e3) },
    { id: 'po5', brand: 'the_one', channel: 'tiktok', status: 'failed', topic: 'Lỗi', text: 'x', media: [], scheduledAt: iso(-864e5), problem: 'Token hết hạn' },
  ];
  db.plans = [{ id: 'pl1', brand: 'the_one', channel: 'facebook_page', type: 'reel', month: new Date().toISOString().slice(0, 7), time: '19:00', days: [1, 2, 3], status: 'pending', createdAt: iso(0), items: [
    { id: 'i1', at: iso(864e5), topic: 'Wolf cut', text: 'Wolf cut cho chị khách Nhật', media: [{ name: '09.mp4', type: 'video' }], status: 'pending', selected: true },
    { id: 'i2', at: iso(2 * 864e5), topic: 'Bob', text: 'Bob nâu tro', media: [], status: 'pending', selected: false },
  ] }];
  db.comments = [{ id: 'cm1', channel: 'facebook_page', author: 'Lan', text: 'giá bao nhiêu?', status: 'drafted', brand: 'dark_hair', pageId: '459628564196388' }];
  db.approvals = [
    { id: 'a1', type: 'ad_test', key: 'p_q', status: 'pending', at: iso(-3600e3), title: 'Chạy quảng cáo video đang lên view "Balayage" — The One – Bình Thạnh', detail: 'Video có 320 lượt xem', payload: { unitId: 'to_bt', brand: 'the_one', postId: 'p_q', topic: 'Balayage', pageId: '113782593711490', objectStoryId: '113782593711490_9', accountId: '1913415955735981', budget: 150000, days: 7, source: 'organic', views: 320 } },
    { id: 'a2', type: 'budget_increase', key: 'c1', status: 'pending', at: iso(-7200e3), title: 'BT-TN-02 › nhóm', detail: '7 ngày: 20 tin', payload: { campaignId: 'c1', adsetId: 's1', from: 300000, to: 360000 } },
    { id: 'a3', type: 'comment_reply', key: 'cm1', status: 'pending', at: iso(-7200e3), title: 'Lan (Facebook Page · Dark Hair): "giá bao nhiêu?"', detail: 'Dạ chị nhắn em nha', payload: { commentId: 'cm1', text: 'Dạ chị nhắn em nha' } },
    { id: 'a4', type: 'post_publish', key: 'po3', status: 'pending', at: iso(-7200e3), title: 'Bài: Bob nâu tro', detail: 'Bob nâu tro', payload: { postId: 'po3' } },
    { id: 'a5', type: 'message_reply', key: 'cv:1', status: 'pending', at: iso(-600e3), title: 'Hoa (Messenger · The One): "0912345678"', detail: 'khách gửi SĐT', payload: { brand: 'the_one', pageId: '113782593711490', psid: 'u2', convId: 'cv', text: 'Dạ em giữ lịch rồi ạ', original: '0912345678', author: 'Hoa', reason: 'khách gửi tên/SĐT', intent: 'Khách gửi tên + SĐT' } },
    { id: 'a6', type: 'lead', key: 'ld1', status: 'pending', at: iso(-300e3), title: 'Linh để lại SĐT trên website', detail: 'SĐT: 0987654321', payload: { brand: 'the_one', leadId: 'ld1', name: 'Linh', phone: '0987654321', note: 'uốn' } },
    { id: 'a7', type: 'unit_budget', key: 'to_bt', status: 'pending', at: iso(-300e3), title: 'Tăng ngân sách ngày The One – Bình Thạnh', detail: 'mọi bài thử đều đạt', payload: { unitId: 'to_bt', from: 1500000, to: 1800000 } },
    { id: 'a8', type: 'ad_test', key: 'old', status: 'rejected', at: iso(-4 * 864e5), decidedAt: iso(-864e5), decidedBy: 'Hệ thống', note: 'Hết hạn', expired: true, title: 'Cũ', detail: '', payload: { unitId: 'to_q3', brand: 'the_one', postId: 'old', topic: 'Cũ', budget: 150000, days: 7, source: 'organic' } },
  ];
  db.actions = [{ id: 'x1', at: iso(-60e3), kind: 'error', text: 'Lỗi thử' }, { id: 'x2', at: iso(-120e3), kind: 'reply', text: 'Trợ lý trả lời Mai' }, { id: 'x3', at: iso(-180e3), kind: 'pause', text: 'Tắt Mishang', campaignId: 'c5' }];
  db.runs = [{ id: 'r1', agent: 'ads', trigger: 'schedule', at: iso(-60e3), ms: 900, changed: 1, error: null }, { id: 'r2', agent: 'inbox', trigger: 'schedule', at: iso(-60e3), ms: 100, changed: 0, error: 'Token thiếu quyền' }];
  db.lessons = [{ id: 'l1', scope: 'the_one', text: 'Xưng em – chị', status: 'active', category: 'brand', source: 'manual', createdAt: iso(-864e5) }];
  db.leads = [{ id: 'ld1', at: iso(-300e3), brand: 'the_one', name: 'Linh', phone: '0987654321', note: 'uốn', history: [] }];
  db.settings.leads = { on: true, useForAds: true };
  db.inboxConvs = { cv: { pageId: '113782593711490', brand: 'the_one', psid: 'u2', name: 'Hoa', label: 'lead', score: 5, reasons: ['hỏi giá', 'để lại SĐT'], customerMsgs: 2, media: 0, firstAt: iso(-3600e3), lastAt: iso(-600e3), lastText: '0912345678', lastFrom: 'customer', replied: false, at: iso(-600e3) }, cv2: { pageId: '113782593711490', brand: 'the_one', psid: 'u9', name: 'Bot', label: 'spam', score: -4, reasons: ['gửi link lạ'], customerMsgs: 1, media: 0, firstAt: iso(-7200e3), lastAt: iso(-7200e3), lastText: 'https://x.y', lastFrom: 'customer', replied: false, at: iso(-7200e3) } };
  db.leadScanAt = iso(-300e3);
  db.inbox = { cv: { lastMsgId: 'm', at: iso(-600e3), pageId: '113782593711490', brand: 'the_one' } };
  save();
}

// Trình duyệt giả: mọi phần tử là một đối tượng "chịu được mọi thứ"; chỉ #view được theo dõi nội dung
function fakeDom() {
  const mk = () => {
    const e = { innerHTML: '', textContent: '', value: '', className: '', id: '', hidden: false, scrollTop: 0, scrollHeight: 0, style: {}, dataset: {}, children: [], readyState: 'complete',
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      focus() {}, blur() {}, remove() {}, click() {}, appendChild() { return mk(); }, append() {}, prepend() {}, insertBefore() {}, removeChild() {}, setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
      addEventListener() {}, removeEventListener() {}, closest() { return null; }, querySelector() { return mk(); }, querySelectorAll() { return []; }, getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; }, scrollIntoView() {}, select() {}, getContext() { return null; } };
    return e;
  };
  const view = mk();
  const document = { readyState: 'complete', documentElement: mk(), head: mk(), body: mk(), activeElement: null, hidden: false, title: '',
    querySelector: (s) => (s === '#view' ? view : mk()), querySelectorAll: () => [], getElementById: (id) => (id === 'view' ? view : mk()), createElement: () => mk(), createTextNode: () => mk(),
    addEventListener() {}, removeEventListener() {}, execCommand() { return false; } };
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const ctx = {
    console, document, view, location: { hash: '', origin: 'http://127.0.0.1', href: 'http://127.0.0.1/', pathname: '/', reload() {} }, history: { replaceState() {}, pushState() {} },
    localStorage: storage, sessionStorage: storage, navigator: { onLine: true, clipboard: { writeText: async () => {} }, userAgent: 'test' },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }), alert() {}, confirm: () => false, prompt: () => null,
    setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, clearInterval() {}, requestAnimationFrame: () => 0, URL, URLSearchParams, Blob: class {}, FormData: class {}, Intl, Date, Math, JSON, Promise, Map, Set, Number, String, Array, Object, Error, RegExp, encodeURIComponent, decodeURIComponent, isNaN, parseInt, parseFloat, structuredClone,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ...(ctx.__state || {}), user: { name: 'Chủ', roleLabel: 'Chủ', role: 'owner', brands: [], shared: true }, perms: ['view', 'approve', 'content_write', 'knowledge_write', 'ads_write', 'brand_write', 'agents_run', 'emergency', 'settings_write', 'users_admin', 'data_admin'], rows: [], data: [], checks: [], users: [], backups: [], prices: [], intents: [], tasks: [], list: [], items: [], files: [], folders: [] }), text: async () => '' }),
    CustomEvent: class {}, Event: class {}, KeyboardEvent: class {}, HTMLElement: class {}, Element: class {},
  };
  ctx.addEventListener = () => {}; ctx.removeEventListener = () => {}; ctx.dispatchEvent = () => true; ctx.scrollTo = () => {}; ctx.getComputedStyle = () => ({}); ctx.innerWidth = 1280; ctx.innerHeight = 800; ctx.devicePixelRatio = 1; ctx.performance = { now: () => 0 };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
  return ctx;
}

test('mọi trang vẽ được với dữ liệu giống thật (quảng cáo thử đang chạy, đề xuất đủ loại, bài đăng, kế hoạch, trợ lý)', async () => {
  seed();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const S = await (await fetch(base + '/api/state')).json();
  assert.ok(S.adTests.length === 3 && S.approvals.length === 7, 'dữ liệu thử phải tới giao diện');
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([a-z-]+\.js)"><\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.includes('app.js') && scripts.includes('shell.js'), 'đọc được thứ tự nạp tệp từ index.html');
  const ctx = vm.createContext(fakeDom());
  ctx.__state = S;
  for (const f of scripts) vm.runInContext(fs.readFileSync(path.join(PUB, f), 'utf8'), ctx, { filename: f });
  vm.runInContext('S = ' + JSON.stringify(S) + '; ME = { user: { name: "Chủ", roleLabel: "Chủ", role: "owner", brands: [], shared: true }, perms: ["view","approve","content_write","knowledge_write","ads_write","brand_write","agents_run","emergency","settings_write","users_admin","data_admin"] };', ctx);
  const pages = vm.runInContext('PAGES.map((p) => p[0])', ctx);
  assert.ok(pages.length >= 13);
  const bad = [];
  for (const id of pages) {
    ctx.location.hash = '#' + id;
    try {
      vm.runInContext('render()', ctx);
      const out = ctx.view.innerHTML;
      if (!out || out.length < 50) bad.push(`${id || 'home'}: trang trống`);
      else if (out.includes('gặp lỗi hiển thị')) bad.push(`${id || 'home'}: ${out.match(/gặp lỗi hiển thị<\/b>([^<]*)/)[1]}`);
    } catch (e) { bad.push(`${id || 'home'}: ${e.message}`); }
  }
  // các thẻ con của trang Cài đặt (mỗi tab) và Quảng cáo (thẻ quảng cáo thử) với dữ liệu trên
  for (const tab of ['auto', 'account', 'system', 'api', 'ai', 'backup', 'activity']) {
    try { vm.runInContext(`ST.tab = '${tab}'; ST.me = ME; ST.users = null; ST.backups = null; ST.ai = null; ST.activity = []; ST.drive = null; stBody()`, ctx); } catch (e) { bad.push(`caidat/${tab}: ${e.message}`); }
  }
  // thẻ Google Drive ở Kết nối API: chưa có khoá / đã có khoá (tải lên) / khoá từ .env
  try {
    vm.runInContext(`ST.tab = 'api'; ST.drive = { configured: false, serviceEmail: '', keySource: '', maxPerRun: 20, brands: { the_one: { brand: 'the_one', on: false } } }; if (!stBody().includes('Tải file JSON service account')) throw new Error('thiếu nút tải khoá');
      ST.drive = { configured: true, serviceEmail: 'sa@p.iam.gserviceaccount.com', keySource: 'upload', maxPerRun: 20, brands: { the_one: { brand: 'the_one', on: true } } }; const h = stBody(); ['sa@p.iam.gserviceaccount.com', 'drive-remove', 'drive-test', 'The One'].forEach((k) => { if (!h.includes(k)) throw new Error('thẻ Drive thiếu: ' + k); });
      ST.drive.keySource = 'env'; if (stBody().includes('drive-remove')) throw new Error('khoá từ .env không được gỡ qua web'); ST.drive = null;`, ctx);
  } catch (e) { bad.push(`caidat/api/drive: ${e.message}`); }
  try { vm.runInContext('adTestCard()', ctx); } catch (e) { bad.push(`adTestCard: ${e.message}`); }
  // Bảng chi tiết chiến dịch: có bài quảng cáo (ảnh, video, số liệu), chế độ mẫu, lỗi tải
  const detailStates = [
    "{ state: 'ok', data: { campaign: { createdAt: '2026-10-15T07:00:00+0000', startAt: '', stopAt: '', objective: 'OUTCOME_ENGAGEMENT' }, ads: [{ id: 'ad1', name: 'QC', status: 'ACTIVE', createdAt: '2026-10-15T07:05:00+0000', adset: { name: 'Nhóm', budget: 150000 }, image: 'https://cdn/x.jpg', video: true, text: 'POV chị khách', title: '', link: 'https://facebook.com/p/1', preview: 'https://fb.com/pre', instagram: '', postedAt: '2026-10-10T10:00:00+0000', spend: 78740, msgs: 0, impressions: 5000, reach: 4000, clicks: 40, cpl: null }, { id: 'ad2', name: 'QC2', status: 'IN_PROCESS', createdAt: '', adset: null, image: '', video: false, text: '', title: 'T', link: '', preview: '', instagram: '', postedAt: '', spend: 0, msgs: 0, impressions: 0, reach: 0, clicks: 0, cpl: null }], cached: true } }",
    "{ state: 'ok', data: { campaign: {}, ads: [], demo: true } }", "{ state: 'err', data: null, err: 'Token hết hạn' }", "{ state: 'loading', data: null, err: '' }",
  ];
  for (const st of detailStates) {
    try { vm.runInContext(`ADS.detail = 'c4'; DETAIL.creatives = ${st}; DETAIL.adsets = { state: 'ok', list: [{ id: 's1', name: 'Nhóm', status: 'ACTIVE', budget: 150000 }], err: '' }; drawer(); ADS.detail = null;`, ctx); }
    catch (e) { bad.push(`drawer ${st.slice(0, 30)}: ${e.message}`); }
  }
  // Thư viện Media với dữ liệu đủ trạng thái: cờ không cho agent, lưu trữ, tên hiển thị, cần xác nhận, lần dùng gần nhất; bảng chi tiết + điều hướng; lọc theo trạng thái
  const mlFiles = `[{ brand: 'the_one', name: '09.mp4', type: 'video', size: 5e6, mtime: Date.now(), uses: 1, note: 'Wolf cut', meta: { summary: 'Khách nữ tóc ngắn', faces: 1 }, consent: false, info: { width: 720, height: 1280, durationSec: 31 }, folder: 'TIKTOK', tags: ['wolf-cut'], title: 'Wolf cut chị Nhật', excluded: false, archived: false, lastUse: { status: 'scheduled', at: new Date(Date.now() + 864e5).toISOString(), topic: 'Wolf cut', channel: 'facebook_page', id: 'po2' } },
    { brand: 'the_one', name: 'a.jpg', type: 'image', size: 2e5, mtime: Date.now() - 864e5, uses: 0, note: '', meta: null, consent: false, info: null, dims: { width: 1080, height: 1350 }, folder: '', tags: [], title: '', excluded: true, archived: false, lastUse: null },
    { brand: 'the_one', name: 'old.png', type: 'image', size: 1e5, mtime: 1, uses: 2, note: '', meta: null, consent: true, info: null, dims: { width: 500, height: 500 }, folder: '', tags: ['cũ'], title: '', excluded: false, archived: true, lastUse: { status: 'published', at: new Date(Date.now() - 5 * 864e5).toISOString(), topic: 'Bài cũ', channel: 'facebook_page', id: 'po9' } }]`;
  try {
    vm.runInContext(`ML.brand = 'the_one'; ML.state = 'ok'; ML.lib = { brand: 'the_one', files: ${mlFiles}, folders: [{ name: 'TIKTOK', count: 1 }], tags: [{ name: 'wolf-cut', count: 1 }], unassigned: 2, totals: { files: 3, images: 2, videos: 1, bytes: 5.3e6, unused: 0, excluded: 1, archived: 1, scheduled: 1, needConsent: 1 }, limits: { image: 1, video: 1 } };
      if (mlFiltered().length !== 2) throw new Error('mặc định phải ẩn file lưu trữ: ' + mlFiltered().length);
      ML.status = 'archived'; if (mlFiltered().map((f) => f.name).join() !== 'old.png') throw new Error('lọc lưu trữ sai');
      ML.status = 'excluded'; if (mlFiltered().map((f) => f.name).join() !== 'a.jpg') throw new Error('lọc không-cho-agent sai');
      ML.status = 'needconsent'; if (mlFiltered().map((f) => f.name).join() !== '09.mp4') throw new Error('lọc cần xác nhận sai');
      ML.status = 'scheduled'; if (mlFiltered().length !== 1) throw new Error('lọc sắp đăng sai');
      ML.status = ''; ML.sel.add('09.mp4'); ML.sel.add('a.jpg');
      // nhãn chuyển mã H.265 → H.264 trên thẻ + dòng trong bảng chi tiết
      [['running', 'Đang chuyển H.264'], ['waiting', 'Chờ chuyển H.264'], ['failed', 'Lỗi chuyển mã']].forEach(([st, txt]) => { const f = { transcode: { status: st, error: 'x' } }; if (!mlCodecTag(f).includes(txt) || !mlCodecLine(f)) throw new Error('nhãn chuyển mã ' + st); });
      if (!mlCodecLine({ transcode: { status: 'failed', error: 'x' } }).includes('d-transcode')) throw new Error('thiếu nút thử lại');
      if (!mlCodecLine({ transcode: { status: 'done', at: new Date().toISOString(), before: 4e7, after: 6e7, backup: 'drive' } }).includes('vẫn còn trên Google Drive')) throw new Error('dòng đã chuyển');
      if (mlCodecTag({ transcode: null }) || mlCodecTag({ transcode: { status: 'done' } })) throw new Error('không cần nhãn khi xong');
      // khối Nạp từ Google Drive: đang tải / chưa có khoá / có khoá + đã nạp + lỗi
      ML.drive = null; if (!mlBody().includes('Nạp từ Google Drive')) throw new Error('thiếu khối Drive khi đang tải');
      ML.drive = { configured: false, serviceEmail: '', keySource: '', maxPerRun: 20, brands: { the_one: { brand: 'the_one', folders: [], folderId: '', link: '', on: false, lastRun: null, lastResult: null, lastError: null, count: 0 } } }; if (!mlBody().includes('Chưa có khoá service account') || !mlBody().includes('Chưa có thư mục Drive nào')) throw new Error('Drive chưa khoá');
      ML.drive = { configured: true, serviceEmail: 'x@y.iam.gserviceaccount.com', keySource: 'upload', maxPerRun: 20, maxFolders: 10, brands: { the_one: { brand: 'the_one', folders: [{ id: 'abc1234567890', label: '', name: 'The One', tag: 'the-one', link: 'https://drive.google.com/drive/folders/abc1234567890', count: 6, error: null }, { id: 'tt1234567890', label: 'TikTok', name: '', tag: 'tiktok', link: 'https://drive.google.com/drive/folders/tt1234567890', count: 2, error: 'Google từ chối quyền' }], folderId: 'abc1234567890', link: 'https://drive.google.com/drive/folders/abc1234567890', on: true, lastRun: new Date().toISOString(), lastResult: { added: 3, skipped: 5, rejected: 1, pending: 2, ms: 10, error: null, total: 11 }, lastError: null, count: 8 } } };
      const dh = mlBody(); ['x@y.iam.gserviceaccount.com', 'drive-sync', 'drive-on', 'drive-test', 'drive-remove', '+3 file', 'chờ lượt sau', 'thẻ #tiktok', 'Google từ chối quyền', 'Thêm thư mục'].forEach((k) => { if (!dh.includes(k)) throw new Error('khối Drive thiếu: ' + k); });
      ML.drive.brands.the_one.lastError = 'Google từ chối quyền'; if (!mlBody().includes('Google từ chối quyền')) throw new Error('Drive lỗi không hiện'); ML.drive.brands.the_one.lastError = null;
      const html = mlBody(); if (!html.includes('Lên bài hàng loạt') || !html.includes('Wolf cut chị Nhật') || !html.includes('Sẽ đăng') || !html.includes('Không cho agent')) throw new Error('thiếu nút/nhãn trên thẻ file');
      const ge = document.getElementById; const dEl = document.createElement('aside'); document.getElementById = (id) => (id === 'mlDrawer' ? dEl : ge(id)); ML.detail = '09.mp4'; mlDrawer(); document.getElementById = ge; const d = dEl.innerHTML; const miss = ['d-title', 'd-archived', 'data-ml="nav"', '1/2'].filter((k) => !d.includes(k)); if (miss.length) throw new Error('bảng chi tiết thiếu: ' + miss.join(', ') + ' | ' + d.slice(0, 300));
      ML.detail = null; mlDrawer(); ML.sel.clear();
      if (!mlBody().includes('card-trash') || !mlBody().includes('Thùng rác')) throw new Error('thiếu nút xoá / mục thùng rác');
      ML.view = 'trash'; ML.trash = null; if (!mlBody().includes('skel')) throw new Error('thùng rác đang tải phải có khung chờ');
      ML.trash = { days: 30, items: [{ id: 't1', brand: 'the_one', name: 'cu.mp4', type: 'video', size: 1e6, at: new Date().toISOString(), daysLeft: 12, exists: true, info: { folder: 'A' }, note: 'ghi chú', uses: 1 }, { id: 't2', brand: 'the_one', name: 'mat.png', type: 'image', size: 1e5, at: new Date().toISOString(), daysLeft: 0, exists: false, info: null, note: '' }] };
      const tb = mlBody(); ['Khôi phục', 'Xoá hẳn', 'Dọn sạch', 'file không còn'].forEach((k) => { if (!tb.includes(k)) throw new Error('thùng rác thiếu: ' + k); });
      ML.trash = { items: [] }; if (!mlBody().includes('Thùng rác trống')) throw new Error('thùng rác trống');
      ML.view = 'lib'; ML.trash = null;`, ctx);
  } catch (e) { bad.push(`thuvien: ${e.message}`); }
  // Cho các hàm tải nền của trang (gọi API giả) chạy xong trong lúc test còn mở; lỗi của chúng chỉ ghi nhận, không phải lỗi hiển thị
  await new Promise((r) => setTimeout(r, 1200));
  if (rejections.length) console.error('Tải nền sau khi vẽ:', rejections.map((e) => String(e && e.stack).split('\n').slice(0, 3).join(' | ')).join('\n'));
  assert.deepStrictEqual(bad, [], bad.join('\n'));
});
