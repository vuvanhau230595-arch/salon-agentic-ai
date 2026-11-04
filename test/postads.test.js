const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-postads-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
process.env.MEDIA_DIR = path.join(tmp, 'media');
delete process.env.APP_PASSWORD;
delete process.env.META_ACCESS_TOKEN;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;

const { load } = require('../src/db');
const media = require('../src/media');
const planner = require('../src/planner');
const adtest = require('../src/adtest');
const postAds = require('../src/post-ads');
const lib = require('../src/media-lib');
const { social } = require('../src/connectors');
const { server } = require('../src/server');
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom', 'latin1'), Buffer.alloc(16)]);
const put = (name) => { const d = path.join(process.env.MEDIA_DIR, 'the_one'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, name), MP4); };
const Q3 = '100107638949140', BT = '473474989395654';
const unit = (id) => load().settings.adTest.units.find((u) => u.id === id);
let base;
const call = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

test('chuẩn bị: 2 video, 2 Page, cơ sở có Page', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  media.ensureDirs();
  put('a.mp4'); put('b.mp4');
  planner.updateBrand('the_one', { adAccountId: '11111', pageIds: `${Q3},${BT}` });
  const db = load();
  db.campaigns = []; db.adTests = []; db.approvals = []; db.posts = [];
  db.settings.dryRun = false;
  // gán Page qua Cài đặt: Page không thuộc thương hiệu thì báo lỗi
  assert.strictEqual((await call('/api/settings', { adTest: { units: [{ id: 'to_q3', pageId: '999' }] } })).status, 400);
  assert.strictEqual((await call('/api/settings', { adTest: { units: [{ id: 'to_q3', pageId: Q3 }, { id: 'to_bt', pageId: BT }] } })).status, 200);
  assert.strictEqual(unit('to_q3').pageId, Q3);
});

test('lên bài & chạy QC: mỗi file × cơ sở 1 bài đúng Page, giữ chỗ ngân sách, chặn khi vượt trần', async () => {
  unit('to_bt').dailyBudget = 1000000; unit('to_q3').dailyBudget = 250000;
  // Q3 chỉ còn 250k: 2 file × 150k = 300k → từ chối, không tạo bài nào
  let r = await call('/api/posts/with-ads', { brand: 'the_one', items: [{ name: 'a.mp4', topic: 'Uốn layer nâu' }, { name: 'b.mp4' }], unitIds: ['to_bt', 'to_q3'], budget: 150000, days: 3 });
  assert.strictEqual(r.status, 400);
  assert.match(r.body.error, /Quận 3: vượt ngân sách/);
  assert.strictEqual(load().posts.length, 0);
  // cơ sở chưa gán Page → báo rõ
  r = await call('/api/posts/with-ads', { brand: 'the_one', items: [{ name: 'a.mp4' }], unitIds: ['ms_q1'], budget: 100000, days: 3 });
  assert.strictEqual(r.status, 400);
  r = await call('/api/posts/with-ads', { brand: 'the_one', items: [{ name: 'a.mp4', topic: 'Uốn layer nâu' }, { name: 'b.mp4' }], unitIds: ['to_bt', 'to_q3'], budget: 100000, days: 3, gapMinutes: 30, approveNow: true });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body.error));
  assert.strictEqual(r.body.posts.length, 4);
  assert.deepStrictEqual(r.body.errors, []);
  const ps = load().posts;
  const a = ps.filter((p) => p.media[0].name === 'a.mp4');
  assert.deepStrictEqual(a.map((p) => p.pageIds[0]).sort(), [Q3, BT].sort());
  assert.ok(a.every((p) => p.status === 'scheduled' && p.adPlan.status === 'waiting' && p.adPlan.budget === 100000 && p.topic === 'Uốn layer nâu'));
  assert.strictEqual(a[0].text, a[1].text); // AI viết 1 lần cho mỗi file
  assert.strictEqual(load().mediaNotes['the_one/a.mp4'], 'Uốn layer nâu'); // mô tả Sếp gõ thành ghi chú cho AI
  // giữ chỗ: Q3 còn 250k − 2×100k = 50k → đợt sau 100k bị chặn
  assert.strictEqual(adtest.committed('to_q3'), 200000);
  r = await call('/api/posts/with-ads', { brand: 'the_one', items: [{ name: 'a.mp4' }], unitIds: ['to_q3'], budget: 100000, days: 3 });
  assert.strictEqual(r.status, 400);
});

test('agent đăng xong thì tự tạo quảng cáo thử đúng cơ sở; video chưa có mã bài thì chờ lượt sau', async () => {
  const { ads } = require('../src/connectors');
  const db = load();
  const created = [];
  ads.createTest = async (o) => { created.push(o); return { campaignId: `c${created.length}`, adsetId: 's', adId: 'a' }; };
  db.campaigns = [{ id: 'old', name: 'BT-TN-01', accountId: '11111', status: 'ACTIVE', objective: 'OUTCOME_ENGAGEMENT', budget: 0, today: { spend: 0, msgs: 0 }, d7: { spend: 100000, msgs: 10 }, month: { spend: 0, msgs: 0 } }];
  ads.adsetTemplate = async () => ({ targeting: { geo_locations: { countries: ['VN'] } } });
  // giả lập đã đăng: a.mp4 có mã bài, b.mp4 video còn xử lý
  for (const p of db.posts) { p.status = 'published'; p.live = true; p.results = { [p.pageIds[0]]: p.media[0].name === 'a.mp4' ? 'vidA' : 'vidB' }; }
  social.videoPostId = async (pid, v) => (v === 'vidA' ? `${pid}_111` : null);
  assert.strictEqual(await adtest.runPlans(), 2);
  assert.deepStrictEqual(created.map((c) => c.objectStoryId).sort(), [`${BT}_111`, `${Q3}_111`].sort());
  assert.ok(created.every((c) => c.budget === 100000 && c.days === 3));
  const a = db.posts.filter((p) => p.media[0].name === 'a.mp4');
  assert.ok(a.every((p) => p.adPlan.status === 'running'));
  assert.ok(db.posts.filter((p) => p.media[0].name === 'b.mp4').every((p) => p.adPlan.status === 'waiting'));
  // Thư viện: thẻ a.mp4 có 2 quảng cáo chạy, b.mp4 2 kế hoạch chờ
  const files = lib.library('the_one').files;
  assert.strictEqual(files.find((f) => f.name === 'a.mp4').ads.running, 2);
  assert.strictEqual(files.find((f) => f.name === 'b.mp4').ads.waiting, 2);
  // lượt sau video đã có mã bài → tạo nốt; không tạo trùng
  social.videoPostId = async (pid) => `${pid}_222`;
  assert.strictEqual(await adtest.runPlans(), 2);
  assert.strictEqual(await adtest.runPlans(), 0);
  assert.strictEqual(created.length, 4);
});

test('bài bị bỏ qua: kế hoạch QC huỷ, trả lại chỗ ngân sách', async () => {
  const db = load();
  db.posts.unshift({ id: 'px', brand: 'the_one', channel: 'facebook_page', status: 'rejected', media: [{ name: 'a.mp4', type: 'video' }], pageIds: [Q3], adPlan: { unitId: 'to_q3', budget: 50000, days: 3, status: 'waiting' } });
  const before = adtest.committed('to_q3');
  await adtest.runPlans();
  assert.strictEqual(db.posts[0].adPlan.status, 'cancelled');
  assert.strictEqual(adtest.committed('to_q3'), before);
});
