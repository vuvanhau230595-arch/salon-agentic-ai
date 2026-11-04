const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-cal-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
process.env.MEDIA_DIR = path.join(tmp, 'media');
delete process.env.APP_PASSWORD;
delete process.env.META_ACCESS_TOKEN;
delete process.env.ANTHROPIC_API_KEY;

const { load } = require('../src/db');
const planner = require('../src/planner');
const media = require('../src/media');
const cal = require('../src/calendar-api');
const { server } = require('../src/server');
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const DAY = 864e5;
let base, n = 0;
const req = (method, p, body) => fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
function mkPost(db, o = {}) {
  const i = ++n;
  const p = { id: 'cp' + i, brand: 'the_one', channel: 'facebook_page', status: 'scheduled', topic: 'Chủ đề ' + i, text: 'Nội dung ' + i, scheduledAt: new Date(Date.now() + 2 * DAY).toISOString(), ...o };
  db.posts.push(p);
  return p;
}
const addApproval = (db, p, status = 'pending') => { const a = { id: 'ca' + p.id, type: 'post_publish', key: p.id, status, at: new Date().toISOString(), title: 't', detail: 'd', payload: { postId: p.id } }; db.approvals.unshift(a); return a; };

test('khởi động server thử', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  planner.updateBrand('the_one', { pageIds: '100107638949140' });
});

test('xem theo khoảng ngày + lọc; trả đủ trạng thái, ảnh, liên kết bài đã đăng', async () => {
  const db = load();
  db.posts = []; db.approvals = [];
  const a = mkPost(db, { scheduledAt: new Date(Date.now() + 1 * DAY).toISOString(), media: [{ name: 'a.jpg', type: 'image' }] });
  const b = mkPost(db, { brand: 'dark_hair', channel: 'tiktok', status: 'draft', scheduledAt: new Date(Date.now() + 5 * DAY).toISOString() });
  const c = mkPost(db, { status: 'published', scheduledAt: new Date(Date.now() - 2 * DAY).toISOString(), results: { 100107638949140: '100107638949140_555' }, live: true });
  mkPost(db, { scheduledAt: new Date(Date.now() + 200 * DAY).toISOString() }); // ngoài khoảng mặc định
  addApproval(db, b);
  let j = await (await req('GET', '/api/posts')).json();
  assert.deepStrictEqual(j.posts.map((x) => x.id), [c.id, a.id, b.id]); // sắp theo giờ
  const byId = Object.fromEntries(j.posts.map((x) => [x.id, x]));
  assert.strictEqual(byId[a.id].media[0].url, '/api/media/file?brand=the_one&name=a.jpg');
  assert.strictEqual(byId[b.id].approvalStatus, 'pending');
  assert.strictEqual(byId[b.id].manual, true); // TikTok mặc định đăng thủ công
  assert.strictEqual(byId[c.id].results[0].link, 'https://www.facebook.com/100107638949140/posts/555');
  assert.strictEqual(byId[c.id].editable, false);
  j = await (await req('GET', '/api/posts?brand=dark_hair')).json();
  assert.deepStrictEqual(j.posts.map((x) => x.id), [b.id]);
  j = await (await req('GET', '/api/posts?status=published&q=' + encodeURIComponent('nội dung'))).json();
  assert.deepStrictEqual(j.posts.map((x) => x.id), [c.id]);
  assert.strictEqual((await req('GET', '/api/posts?from=khong-phai-ngay')).status, 400);
});

test('đổi giờ (kéo thả): chỉ bài chưa đăng, không về quá khứ, bài quá giờ chờ đăng tay được hẹn lại', async () => {
  const db = load();
  db.posts = []; db.approvals = [];
  const p = mkPost(db);
  const when = new Date(Date.now() + 4 * DAY).toISOString();
  let r = await req('POST', `/api/posts/${p.id}/reschedule`, { scheduledAt: when });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(p.scheduledAt, when);
  assert.ok(db.actions.some((a) => a.kind === 'calendar' && a.before && a.after === when));
  assert.strictEqual((await req('POST', `/api/posts/${p.id}/reschedule`, { scheduledAt: when })).status, 400); // trùng giờ
  assert.strictEqual((await req('POST', `/api/posts/${p.id}/reschedule`, { scheduledAt: new Date(Date.now() - DAY).toISOString() })).status, 400);
  assert.strictEqual((await req('POST', `/api/posts/${p.id}/reschedule`, { scheduledAt: 'xx' })).status, 400);
  assert.strictEqual((await req('POST', `/api/posts/khong-co/reschedule`, { scheduledAt: when })).status, 404);
  const done = mkPost(db, { status: 'published' });
  assert.strictEqual((await req('POST', `/api/posts/${done.id}/reschedule`, { scheduledAt: when })).status, 400);
  const late = mkPost(db, { status: 'awaiting_manual', scheduledAt: new Date(Date.now() - DAY).toISOString() });
  r = await req('POST', `/api/posts/${late.id}/reschedule`, { scheduledAt: when });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(late.status, 'scheduled');
});

test('sửa nội dung: bài chờ duyệt cập nhật mục duyệt; bài đã duyệt quay về chờ duyệt với mục duyệt mới', async () => {
  const db = load();
  db.posts = []; db.approvals = [];
  const draft = mkPost(db, { status: 'draft' });
  const ap = addApproval(db, draft);
  let r = await req('PUT', `/api/posts/${draft.id}`, { text: 'Nội dung mới', topic: 'Chủ đề mới' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(draft.text, 'Nội dung mới');
  assert.match(ap.title, /Chủ đề mới/);
  assert.strictEqual(ap.detail, 'Nội dung mới');
  assert.strictEqual(db.approvals.filter((a) => a.status === 'pending').length, 1);

  const sched = mkPost(db, { status: 'scheduled' });
  addApproval(db, sched, 'approved');
  r = await req('PUT', `/api/posts/${sched.id}`, { text: 'Sửa sau khi đã duyệt' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(sched.status, 'draft', 'sửa sau khi duyệt phải duyệt lại');
  const pend = db.approvals.filter((a) => a.status === 'pending' && a.payload.postId === sched.id);
  assert.strictEqual(pend.length, 1);
  assert.strictEqual(pend[0].detail, 'Sửa sau khi đã duyệt');
});

test('sửa nội dung: kiểm tra đầu vào, không sửa bài đã đăng, media phải có trong thư viện', async () => {
  const db = load();
  db.posts = []; db.approvals = [];
  const p = mkPost(db, { status: 'draft' });
  addApproval(db, p);
  assert.strictEqual((await req('PUT', `/api/posts/${p.id}`, { text: '   ' })).status, 400);
  assert.strictEqual((await req('PUT', `/api/posts/${p.id}`, { text: 'x'.repeat(10001) })).status, 400);
  assert.strictEqual((await req('PUT', `/api/posts/${p.id}`, { topic: '' })).status, 400);
  assert.strictEqual((await req('PUT', `/api/posts/${p.id}`, {})).status, 400); // không đổi gì
  assert.strictEqual((await req('PUT', `/api/posts/${p.id}`, { text: p.text })).status, 400);
  assert.strictEqual((await req('PUT', `/api/posts/${p.id}`, { media: ['khong-co.jpg'] })).status, 400);
  assert.strictEqual((await req('PUT', `/api/posts/${p.id}`, { media: 'a.jpg' })).status, 400);
  assert.strictEqual((await req('PUT', `/api/posts/${p.id}`, { scheduledAt: new Date(Date.now() - DAY).toISOString() })).status, 400);
  const done = mkPost(db, { status: 'published' });
  assert.strictEqual((await req('PUT', `/api/posts/${done.id}`, { text: 'sửa' })).status, 400);
  // media hợp lệ
  media.ensureDirs();
  fs.mkdirSync(path.join(process.env.MEDIA_DIR, 'the_one'), { recursive: true });
  fs.writeFileSync(path.join(process.env.MEDIA_DIR, 'the_one', 'anh1.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const ok = await req('PUT', `/api/posts/${p.id}`, { media: ['anh1.jpg'] });
  assert.strictEqual(ok.status, 200);
  assert.deepStrictEqual(p.media.map((m) => m.name), ['anh1.jpg']);
  // bài Reel bắt buộc có video: không bỏ hết media
  const reel = mkPost(db, { status: 'draft', requireMedia: true, media: [{ name: 'anh1.jpg', type: 'image' }] });
  addApproval(db, reel);
  assert.strictEqual((await req('PUT', `/api/posts/${reel.id}`, { media: [] })).status, 400);
});

test('huỷ bài: không đăng nữa, đóng mục duyệt đang chờ; bài đã đăng thì không huỷ được', async () => {
  const db = load();
  db.posts = []; db.approvals = [];
  const p = mkPost(db, { status: 'draft' });
  const ap = addApproval(db, p);
  const r = await req('DELETE', `/api/posts/${p.id}`);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(p.status, 'cancelled');
  assert.strictEqual(ap.status, 'rejected');
  assert.strictEqual(ap.note, 'Huỷ bài từ Lịch đăng');
  assert.strictEqual((await req('DELETE', `/api/posts/${p.id}`)).status, 400); // đã huỷ
  const done = mkPost(db, { status: 'published' });
  assert.strictEqual((await req('DELETE', `/api/posts/${done.id}`)).status, 400);
  assert.strictEqual(cal.list({}).find((x) => x.id === p.id).status, 'cancelled');
});
