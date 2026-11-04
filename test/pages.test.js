const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pages-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
process.env.MEDIA_DIR = path.join(tmp, 'media');
process.env.META_ACCESS_TOKEN = 'MAINTOKEN';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.APP_PASSWORD;

// ---- Meta giả: ghi lại lệnh gọi; cho phép bắt lỗi theo từng Page / tài khoản ----
const calls = [];
let failPages = new Set();
let accounts = {};
const realFetch = global.fetch;
global.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.hostname === '127.0.0.1') return realFetch(url, init); // server nội bộ của test
  const body = init.body instanceof FormData ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : 'FILE']))
    : init.body ? Object.fromEntries(new URLSearchParams(init.body)) : null;
  const rec = { path: u.pathname.replace(/^\/v[\d.]+/, ''), method: init.method || 'GET', q: Object.fromEntries(u.searchParams), body };
  calls.push(rec);
  const reply = (o) => ({ status: 200, json: async () => o });
  const err = (code, message) => reply({ error: { code, message } });
  let m;
  if ((m = rec.path.match(/^\/(\d+)$/)) && rec.method === 'GET') return reply({ access_token: `PT_${m[1]}` });
  if ((m = rec.path.match(/^\/(\d+)\/feed$/))) return failPages.has(m[1]) ? err(17, 'rate') : reply({ id: `${m[1]}_post` });
  if ((m = rec.path.match(/^\/(\d+)\/posts$/))) return reply({ data: [{ id: `${m[1]}_p1`, comments: { data: [{ id: `c_${m[1]}`, message: 'Giá bao nhiêu?', from: { id: 'U', name: 'Khách' }, created_time: new Date().toISOString() }] } }] });
  if (/\/comments$/.test(rec.path)) return reply({ id: 'r1' });
  if ((m = rec.path.match(/^\/act_(\d+)\/campaigns$/))) return accounts[m[1]] === 'fail' ? err(190, 'expired') : reply({ data: accounts[m[1]] || [] });
  if ((m = rec.path.match(/^\/act_(\d+)\/insights$/))) {
    if (accounts[m[1]] === 'fail') return err(190, 'expired');
    const win = rec.q.date_preset === 'today' || rec.q.date_preset === 'last_7d'; // luật tắt đo theo 7 ngày
    return reply({ data: win ? (accounts[m[1]] || []).map((c) => ({ campaign_id: c.id, spend: '400000', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '5' }] })) : [] });
  }
  if (rec.method === 'POST' && /^\/\d+$/.test(rec.path)) return reply({ success: true });
  return err(803, `chưa giả lập ${rec.method} ${rec.path}`);
};
test.after(() => { global.fetch = realFetch; fs.rmSync(tmp, { recursive: true, force: true }); });

const planner = require('../src/planner');
const engine = require('../src/engine');
const social = require('../src/connectors/social');
const { load } = require('../src/db');
const { server } = require('../src/server');

const due = () => new Date(Date.now() - 1000).toISOString();
const post = (extra) => ({ id: 'p' + Math.random().toString(36).slice(2, 6), channel: 'facebook_page', brand: 'the_one', topic: 'Bài thử', text: 'Nội dung', media: [], scheduledAt: due(), status: 'scheduled', ...extra });
const feeds = () => calls.filter((c) => /\/feed$/.test(c.path));

test('Page ID: nhận nhiều dòng/dấu phẩy, bỏ trùng; từ chối ID sai và quá 10 Page', () => {
  planner.updateBrand('the_one', { pageIds: '100000001 100000002,100000003\n100000001' });
  assert.deepStrictEqual(planner.brands().the_one.pageIds, ['100000001', '100000002', '100000003']);
  assert.throws(() => planner.updateBrand('the_one', { pageIds: ['abc'] }), /không hợp lệ/);
  assert.throws(() => planner.updateBrand('the_one', { pageIds: Array.from({ length: 11 }, (_, i) => String(100000 + i)) }), /Tối đa 10/);
  assert.deepStrictEqual(planner.brands().the_one.pageIds, ['100000001', '100000002', '100000003'], 'lỗi thì giữ nguyên danh sách cũ');
  planner.updateBrand('the_one', { pageIds: '' });
  assert.deepStrictEqual(planner.brands().the_one.pageIds, []);
  planner.updateBrand('the_one', { adAccountId: 'act_555555' });
  assert.strictEqual(planner.brands().the_one.adAccountId, '555555');
  assert.throws(() => planner.updateBrand('the_one', { adAccountId: 'xyz' }), /chỉ gồm chữ số/);
});

test('The One đăng lên mọi Page của thương hiệu, mỗi Page dùng Page token riêng; Dark Hair chỉ lên Page của mình', async () => {
  const db = load();
  db.settings.dryRun = false;
  planner.updateBrand('the_one', { pageIds: ['200000001', '200000002'] });
  planner.updateBrand('dark_hair', { pageIds: ['300000001'] });
  social.resetPageToken();
  db.posts = [post({ id: 'a' }), post({ id: 'b', brand: 'dark_hair' })];
  calls.length = 0;
  await engine.runAgent('content', 'manual');
  assert.deepStrictEqual(db.posts.map((p) => p.status), ['published', 'published']);
  assert.deepStrictEqual(Object.keys(db.posts[0].results).sort(), ['200000001', '200000002']);
  assert.deepStrictEqual(Object.keys(db.posts[1].results), ['300000001']);
  const byPage = Object.fromEntries(feeds().map((c) => [c.path.split('/')[1], c.body.access_token]));
  assert.deepStrictEqual(byPage, { 200000001: 'PT_200000001', 200000002: 'PT_200000002', 300000001: 'PT_300000001' });
});

test('1 Page lỗi: chỉ thử lại Page đó, Page đã đăng không bị đăng trùng; lỗi 3 lần thì đánh dấu thất bại', async () => {
  const db = load();
  failPages = new Set(['200000002']);
  db.posts = [post({ id: 'x' })];
  calls.length = 0;
  await engine.runAgent('content', 'manual');
  const p = db.posts[0];
  assert.strictEqual(p.status, 'scheduled', 'còn Page chưa đăng được nên chưa tính là xong');
  assert.deepStrictEqual(Object.keys(p.results), ['200000001']);
  assert.match(p.error, /giới hạn/);
  assert.strictEqual(feeds().filter((c) => c.path.startsWith('/200000001')).length, 1);

  failPages = new Set();
  calls.length = 0;
  await engine.runAgent('content', 'manual');
  assert.strictEqual(p.status, 'published');
  assert.strictEqual(feeds().filter((c) => c.path.startsWith('/200000001')).length, 0, 'Page 1 không đăng lần nữa');
  assert.strictEqual(feeds().filter((c) => c.path.startsWith('/200000002')).length, 1);
  assert.strictEqual(p.error, undefined);

  failPages = new Set(['200000001', '200000002']);
  db.posts = [post({ id: 'y' })];
  for (let i = 0; i < 3; i++) await engine.runAgent('content', 'manual');
  assert.strictEqual(db.posts[0].status, 'failed');
  assert.strictEqual(db.posts[0].attempts, 3);
  failPages = new Set();
});

test('thật: thương hiệu chưa có Page ID hoặc bài không gắn thương hiệu thì không đăng, báo rõ', async () => {
  const db = load();
  planner.updateBrand('dark_hair', { pageIds: '' });
  db.actions = [];
  db.posts = [post({ id: 'n1', brand: 'dark_hair' }), post({ id: 'n2', brand: undefined })];
  calls.length = 0;
  await engine.runAgent('content', 'manual');
  assert.deepStrictEqual(db.posts.map((p) => p.status), ['scheduled', 'scheduled']);
  assert.match(db.posts[0].skipReason, /chưa có Page ID/);
  assert.match(db.posts[1].skipReason, /chưa gắn thương hiệu/);
  assert.strictEqual(feeds().length, 0);
});

test('bình luận: nhận từ mọi Page của thương hiệu, gắn đúng thương hiệu; trả lời bằng Page token của Page đó', async () => {
  const db = load();
  db.comments = [];
  db.approvals = [];
  planner.updateBrand('dark_hair', { pageIds: ['300000001'] });
  social.resetPageToken();
  calls.length = 0;
  await engine.runAgent('comments', 'manual');
  assert.deepStrictEqual(db.comments.map((c) => [c.id, c.brand, c.pageId]).sort(), [
    ['c_200000001', 'the_one', '200000001'], ['c_200000002', 'the_one', '200000002'], ['c_300000001', 'dark_hair', '300000001'],
  ]);
  assert.ok(db.approvals.some((a) => /Dark Hair/.test(a.title)), 'tiêu đề duyệt có tên thương hiệu');
  const ap = db.approvals.find((a) => a.payload.commentId === 'c_300000001');
  db.settings.dryRun = false;
  calls.length = 0;
  await engine.decide(ap.id, true);
  const rep = calls.find((c) => /\/comments$/.test(c.path));
  assert.strictEqual(rep.body.access_token, 'PT_300000001');
  await engine.runAgent('comments', 'manual');
  assert.strictEqual(db.comments.length, 3, 'chạy lại không nhận trùng');
});

test('quảng cáo nhiều tài khoản: 1 tài khoản lỗi không làm hỏng tài khoản khác; không tắt quảng cáo cũ', async () => {
  const db = load();
  db.settings.dryRun = false;
  db.settings.monthlyCap = 0;
  db.settings.rules.highCpl.maxCostPerMsg = 50000; // dữ liệu thử cần ngưỡng chặt
  planner.updateBrand('the_one', { adAccountId: '600000001' });
  planner.updateBrand('dark_hair', { adAccountId: '600000002' });
  accounts = { 600000001: [{ id: '7001', name: 'Nhuộm đắt', effective_status: 'ACTIVE', daily_budget: '500000' }], 600000002: 'fail' };
  db.campaigns = [{ id: '7002', name: 'Cũ của tài khoản lỗi', status: 'ACTIVE', accountId: '600000002', budget: 1, today: { spend: 400000, msgs: 0 }, d7: { spend: 0, msgs: 0 }, month: { spend: 0, msgs: 0 } }];
  db.actions = [];
  calls.length = 0;
  const run = await engine.runAgent('ads', 'manual');
  assert.strictEqual(run.error, null);
  const posts = calls.filter((c) => c.method === 'POST');
  assert.deepStrictEqual(posts.map((c) => c.path), [], 'agent không tắt quảng cáo cũ');
  assert.ok(db.campaigns.some((c) => c.id === '7001' && !c.stale), 'đọc được tài khoản còn lại');
  const stale = db.campaigns.find((c) => c.id === '7002');
  assert.ok(stale && stale.stale && stale.status === 'ACTIVE', 'giữ để hiển thị, đánh dấu cũ, không đụng tới');
  assert.ok(db.actions.some((a) => /Không đọc được tài khoản quảng cáo 600000002/.test(a.text)));
});

test('quảng cáo: chưa gán tài khoản nào hoặc mọi tài khoản đều lỗi thì báo lỗi rõ', async () => {
  const db = load();
  planner.updateBrand('the_one', { adAccountId: '' });
  planner.updateBrand('dark_hair', { adAccountId: '' });
  let run = await engine.runAgent('ads', 'manual');
  assert.match(run.error, /Chưa gán tài khoản quảng cáo/);
  planner.updateBrand('dark_hair', { adAccountId: '600000002' });
  accounts = { 600000002: 'fail' };
  run = await engine.runAgent('ads', 'manual');
  assert.match(run.error, /hết hạn/);
  assert.ok(db.runs[0].error);
});

test('API đăng bài lẻ: bắt buộc chọn thương hiệu và kênh phải đang bật cho thương hiệu', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/api/posts`;
  const send = (b) => realFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  try {
    const r1 = await send({ channel: 'facebook_page', topic: 'Thử', text: 'x' });
    assert.strictEqual(r1.status, 400);
    assert.match((await r1.json()).error, /Chọn thương hiệu/);
    const r2 = await send({ channel: 'facebook_page', brand: 'mishang', topic: 'Thử', text: 'x' });
    assert.strictEqual(r2.status, 400);
    assert.match((await r2.json()).error, /đang tắt/);
    const r3 = await send({ channel: 'facebook_page', brand: 'dark_hair', topic: 'Thử', text: 'Nội dung' });
    assert.strictEqual(r3.status, 200);
    assert.strictEqual(load().posts[0].brand, 'dark_hair');
  } finally { server.close(); }
});

test('lỗi đọc bình luận cùng nguyên nhân chỉ ghi nhật ký 1 lần; hết lỗi rồi lỗi lại thì ghi lại', async () => {
  const social = require('../src/connectors/social');
  const db = load();
  planner.updateBrand('the_one', { pageIds: '700000001' });
  planner.updateBrand('dark_hair', { pageIds: '' });
  db.actions = []; db.channelSync = {};
  const orig = social.fetchComments;
  let mode = 'err';
  social.fetchComments = async () => { if (mode === 'err') throw new Error('Token thiếu quyền X'); return []; };
  try {
    for (let i = 0; i < 4; i++) await engine.runAgent('comments', 'schedule');
    const n = () => db.actions.filter((a) => /Không đọc được bình luận/.test(a.text)).length;
    assert.strictEqual(n(), 1, 'lỗi lặp lại không ghi thêm');
    mode = 'ok';
    await engine.runAgent('comments', 'schedule');
    assert.strictEqual(db.channelSync['700000001'].commentsError, undefined);
    assert.ok(db.channelSync['700000001'].commentsAt);
    mode = 'err';
    await engine.runAgent('comments', 'schedule');
    assert.strictEqual(n(), 2, 'lỗi xuất hiện lại sau khi đã ổn thì ghi lại');
  } finally { social.fetchComments = orig; }
});

test('cài đặt "video đang lên view": lưu bật/tắt, tự chạy, ngưỡng view; số ngoài khoảng bị kẹp; ghi nhật ký trước → sau', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/api/settings`;
  const send = (b) => realFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  try {
    const db = load();
    const before = db.actions.length;
    assert.strictEqual((await send({ adTest: { boost: { auto: true, minViews: 300, expireDays: 99 } } })).status, 200);
    assert.strictEqual(db.settings.adTest.boost.auto, true);
    assert.strictEqual(db.settings.adTest.boost.minViews, 300);
    assert.strictEqual(db.settings.adTest.boost.expireDays, 14, 'kẹp về tối đa 14 ngày');
    assert.strictEqual(db.settings.adTest.boost.on, true, 'không đụng cài đặt không gửi');
    assert.ok(db.actions.slice(0, db.actions.length - before).some((a) => a.kind === 'settings' && a.text.includes('adTest.boost.auto: false → true')));
    assert.strictEqual((await send({ adTest: { boost: { auto: false, on: false } } })).status, 200);
    assert.strictEqual(db.settings.adTest.boost.auto, false);
    assert.strictEqual(db.settings.adTest.boost.on, false);
    // Tắt quảng cáo cho 1 cơ sở
    assert.strictEqual((await send({ adTest: { units: [{ id: 'ms_q1', on: false }] } })).status, 200);
    assert.strictEqual(db.settings.adTest.units.find((u) => u.id === 'ms_q1').on, false);
    assert.strictEqual(db.settings.adTest.units.find((u) => u.id === 'dh_q1').on, undefined, 'cơ sở khác không đổi');
    assert.ok(db.actions.some((a) => a.kind === 'settings' && a.text.includes('unitsOn.ms_q1: true → false')));
  } finally { server.close(); }
});
