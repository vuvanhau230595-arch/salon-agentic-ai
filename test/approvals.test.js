const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-appr-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
process.env.MEDIA_DIR = path.join(tmp, 'media');
delete process.env.APP_PASSWORD;
delete process.env.META_ACCESS_TOKEN;
delete process.env.ANTHROPIC_API_KEY;

const { load } = require('../src/db');
const { ads } = require('../src/connectors');
const planner = require('../src/planner');
const { server } = require('../src/server');
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

let base;
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
const state = async () => (await fetch(base + '/api/state')).json();
let n = 0;
function addPostApproval(db, brand = 'the_one', extra = {}) {
  const i = ++n;
  db.posts.push({ id: 'pp' + i, brand, channel: 'facebook_page', status: 'draft', topic: 'Chủ đề ' + i, text: 'Nội dung ' + i, scheduledAt: new Date(Date.now() + 864e5).toISOString(), media: [{ name: 'a.jpg', type: 'image' }], ...extra });
  const a = { id: 'ap' + i, type: 'post_publish', key: 'pp' + i, status: 'pending', at: new Date().toISOString(), title: 'Bài ' + i, detail: 'x', payload: { postId: 'pp' + i } };
  db.approvals.unshift(a);
  return a;
}

test('khởi động server thử', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  planner.updateBrand('the_one', { adAccountId: '11111' });
});

test('hàng đợi có xem trước thật, thương hiệu và giai đoạn', async () => {
  const db = load();
  db.approvals = []; db.posts = []; db.comments = [];
  addPostApproval(db, 'dark_hair');
  db.comments.push({ id: 'cm1', channel: 'facebook_page', author: 'Lan Anh', text: 'Giá nhuộm bao nhiêu ạ?', status: 'drafted', brand: 'mishang' });
  db.approvals.push({ id: 'apc', type: 'comment_reply', key: 'cm1', status: 'pending', at: new Date().toISOString(), title: 'Lan Anh', detail: 'Chào chị', payload: { commentId: 'cm1', text: 'Chào chị, bên em nhắn tin để tư vấn ạ' } });
  db.approvals.push({ id: 'apu', type: 'unit_budget', key: 'ms_q1', status: 'pending', at: new Date().toISOString(), title: 'Tăng', detail: 'x', payload: { unitId: 'ms_q1', from: 1300000, to: 1560000 } });
  const st = await state();
  const byId = Object.fromEntries(st.approvals.map((a) => [a.id, a]));
  const p = byId.ap1;
  assert.strictEqual(p.brand, 'dark_hair');
  assert.strictEqual(p.brandName, 'Dark Hair');
  assert.strictEqual(p.stage, 'pending');
  assert.strictEqual(p.preview.kind, 'post');
  assert.strictEqual(p.preview.text, 'Nội dung 1');
  assert.strictEqual(p.preview.media[0].url, '/api/media/file?brand=dark_hair&name=a.jpg');
  assert.strictEqual(byId.apc.preview.original, 'Giá nhuộm bao nhiêu ạ?');
  assert.strictEqual(byId.apc.brand, 'mishang');
  assert.strictEqual(byId.apu.brand, 'mishang');
  assert.strictEqual(byId.apu.preview, null);
});

test('duyệt/bỏ qua ghi người quyết định, thời gian, ghi chú; vào lịch sử với giai đoạn đúng', async () => {
  const db = load();
  db.approvals = []; db.posts = [];
  const a1 = addPostApproval(db);
  const a2 = addPostApproval(db);
  let r = await post(`/api/approvals/${a1.id}/approve`, { note: '  ok đăng đi  ' });
  assert.strictEqual(r.status, 200);
  r = await post(`/api/approvals/${a2.id}/reject`, { note: 'Sai giá' });
  assert.strictEqual(r.status, 200);
  let st = await state();
  assert.strictEqual(st.approvals.length, 0);
  const h = Object.fromEntries(st.approvalHistory.map((x) => [x.id, x]));
  assert.strictEqual(h[a1.id].status, 'approved');
  assert.strictEqual(h[a1.id].stage, 'approved'); // đã lên lịch, chưa đăng
  assert.strictEqual(h[a1.id].note, 'ok đăng đi');
  assert.strictEqual(h[a1.id].decidedBy, 'Sếp');
  assert.ok(h[a1.id].decidedAt);
  assert.strictEqual(h[a2.id].stage, 'rejected');
  assert.strictEqual(h[a2.id].note, 'Sai giá');
  // bài đã đăng → Đã thực hiện
  db.posts.find((p) => p.id === a1.payload.postId).status = 'published';
  st = await state();
  assert.strictEqual(st.approvalHistory.find((x) => x.id === a1.id).stage, 'done');
  // đã xử lý rồi thì không duyệt lại được
  r = await post(`/api/approvals/${a1.id}/approve`);
  assert.strictEqual(r.status, 400);
});

test('đề xuất tăng ngân sách: chạy thử dừng ở "approved_dry", chạy thật là "done"', async () => {
  const db = load();
  db.approvals = [];
  const mk = (id) => ({ id, type: 'budget_increase', status: 'pending', at: new Date().toISOString(), title: 'c', detail: 'd', payload: { campaignId: 'cc', from: 100000, to: 120000 } });
  db.approvals.push(mk('b1'), mk('b2'));
  ads.setBudget = async () => {};
  db.settings.dryRun = true;
  await post('/api/approvals/b1/approve');
  db.settings.dryRun = false;
  await post('/api/approvals/b2/approve');
  const h = Object.fromEntries((await state()).approvalHistory.map((x) => [x.id, x]));
  assert.strictEqual(h.b1.stage, 'approved_dry');
  assert.strictEqual(h.b1.dry, true);
  assert.strictEqual(h.b2.stage, 'done');
  db.settings.dryRun = true;
});

test('duyệt hàng loạt: từng mục xử lý riêng, mục lỗi không chặn mục khác; kiểm tra đầu vào', async () => {
  const db = load();
  db.approvals = []; db.posts = [];
  const a = addPostApproval(db), b = addPostApproval(db), c = addPostApproval(db);
  let r = await post('/api/approvals/bulk', { action: 'xoa', ids: [a.id] });
  assert.strictEqual(r.status, 400);
  r = await post('/api/approvals/bulk', { action: 'approve', ids: [] });
  assert.strictEqual(r.status, 400);
  r = await post('/api/approvals/bulk', { action: 'approve', ids: Array.from({ length: 26 }, (_, i) => 'x' + i) });
  assert.strictEqual(r.status, 400);
  r = await post('/api/approvals/bulk', { action: 'reject', ids: [a.id, 'khong-co', b.id, a.id], note: 'trùng chủ đề' });
  const j = await r.json();
  assert.deepStrictEqual(j.results.map((x) => [x.id, x.ok]), [[a.id, true], ['khong-co', false], [b.id, true]]); // id trùng chỉ xử lý 1 lần
  assert.match(j.results[1].error, /không còn chờ duyệt/);
  assert.deepStrictEqual(j.state.approvals.map((x) => x.id), [c.id]);
  assert.strictEqual(j.state.approvalHistory.filter((x) => x.note === 'trùng chủ đề').length, 2);
});
