const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
process.env.DB_FILE = path.join(os.tmpdir(), `agent-adtest-${process.pid}.json`);
require('node:fs').rmSync(process.env.DB_FILE, { force: true });
delete process.env.META_ACCESS_TOKEN;
delete process.env.ANTHROPIC_API_KEY;

const { load } = require('../src/db');
const { ads } = require('../src/connectors');
const planner = require('../src/planner');
const engine = require('../src/engine');
const adtest = require('../src/adtest');

const camp = (o) => ({ status: 'ACTIVE', budget: 0, objective: 'OUTCOME_ENGAGEMENT', today: { spend: 0, msgs: 0 }, d7: { spend: 0, msgs: 0 }, month: { spend: 0, msgs: 0 }, ...o });
const stubList = (list) => { ads.list = async () => list; };

test('gán chiến dịch cho thương hiệu: tài khoản riêng → thương hiệu đó; tài khoản chung → theo tiền tố DH-', () => {
  planner.updateBrand('the_one', { adAccountId: '11111' });
  planner.updateBrand('dark_hair', { adAccountId: '11111' });
  planner.updateBrand('mishang', { adAccountId: '22222' });
  assert.strictEqual(engine.brandOf({ accountId: '11111', name: 'DH-TN-04 (quận 1)' }), 'dark_hair');
  assert.strictEqual(engine.brandOf({ accountId: '11111', name: 'BT-TN-Bảng giá' }), 'the_one');
  assert.strictEqual(engine.brandOf({ accountId: '11111', name: 'Q3' }), 'the_one');
  assert.strictEqual(engine.brandOf({ accountId: '22222', name: 'mi - Bản sao' }), 'mishang');
  assert.strictEqual(engine.brandOf({ accountId: '999', name: 'x' }), null);
});

test('agent không tắt quảng cáo cũ nào (kể cả vượt ngưỡng riêng Mishang)', async () => {
  const db = load();
  db.settings.dryRun = true;
  stubList([
    camp({ id: 'w1', name: 'Q3-WEB-01', accountId: '11111', objective: 'OUTCOME_TRAFFIC', d7: { spend: 900000, msgs: 0 } }),
    camp({ id: 'm1', name: 'mi - Bản sao', accountId: '22222', d7: { spend: 600000, msgs: 5 } }), // 120.000/tin > 100.000 của Mishang
    camp({ id: 'o1', name: 'BT-TN-Bảng giá', accountId: '11111', d7: { spend: 600000, msgs: 5 } }), // 120.000/tin ≤ 200.000
  ]);
  await engine.runAgent('ads', 'manual');
  const stopped = db.actions.filter((a) => a.kind === 'pause').map((a) => a.campaignId);
  assert.deepStrictEqual(stopped, []);
});

test('tăng ngân sách: chiến dịch ngân sách cấp nhóm quảng cáo → đề xuất cho từng nhóm', async () => {
  const db = load();
  db.approvals = []; db.actions = [];
  ads.activeAdsets = async (id) => (id === 'd1' ? [{ id: 's1', name: 'Nhóm 1', budget: 200000 }] : []);
  stubList([camp({ id: 'd1', name: 'DH-TN-04', accountId: '11111', d7: { spend: 1500000, msgs: 25 } })]); // 60.000/tin ≤ 100.000
  await engine.runAgent('ads', 'manual');
  const inc = db.approvals.filter((a) => a.type === 'budget_increase');
  assert.strictEqual(inc.length, 1);
  assert.deepStrictEqual(inc[0].payload, { campaignId: 'd1', adsetId: 's1', from: 200000, to: 240000 });
  // chiến dịch Mishang 60.000/tin không đủ rẻ (ngưỡng tăng 50.000)
  db.approvals = [];
  stubList([camp({ id: 'm2', name: 'mi', accountId: '22222', budget: 300000, d7: { spend: 1500000, msgs: 25 } })]);
  await engine.runAgent('ads', 'manual');
  assert.strictEqual(db.approvals.filter((a) => a.type === 'budget_increase').length, 0);
});

test('duyệt tăng ngân sách nhóm: gọi setBudget bằng ID nhóm khi chạy thật', async () => {
  const db = load();
  db.approvals = [];
  db.approvals.push({ id: 'ap1', type: 'budget_increase', status: 'pending', title: 'x', payload: { campaignId: 'c', adsetId: 's9', from: 100000, to: 120000 } });
  let got;
  ads.setBudget = async (id, v) => { got = [id, v]; };
  db.settings.dryRun = false;
  await engine.decide('ap1', true);
  assert.deepStrictEqual(got, ['s9', 120000]);
  db.settings.dryRun = true;
});

function seed() {
  const db = load();
  db.posts = []; db.adTests = []; db.approvals = []; db.actions = [];
  planner.updateBrand('the_one', { pageIds: '100107638949140' });
  db.posts.push({ id: 'post1', brand: 'the_one', channel: 'facebook_page', status: 'published', live: true, topic: 'Nhuộm nâu', scheduledAt: new Date().toISOString(), results: { 100107638949140: '100107638949140_555' } });
  db.campaigns = [camp({ id: 'good', name: 'BT-TN-01', accountId: '11111', d7: { spend: 1000000, msgs: 20 } })];
  return db;
}

test('quảng cáo thử: mặc định tắt → không đề xuất', async () => {
  const db = seed();
  assert.strictEqual(db.settings.adTest.on, false);
  assert.strictEqual(adtest.propose(), 0);
  assert.strictEqual(db.approvals.length, 0);
});

test('quảng cáo thử: bật → đề xuất 1 bài/thương hiệu/ngày, không đề xuất lại bài đã bỏ qua', async () => {
  const db = seed();
  db.settings.adTest.on = true;
  assert.strictEqual(adtest.propose(), 1);
  assert.strictEqual(adtest.propose(), 0); // đã có đề xuất hôm nay
  const a = db.approvals[0];
  assert.strictEqual(a.type, 'ad_test');
  assert.strictEqual(a.payload.objectStoryId, '100107638949140_555');
  await engine.decide(a.id, false);
  assert.strictEqual(adtest.propose(), 0); // bỏ qua rồi thì không đề xuất lại
});

test('quảng cáo thử: bài video (không có mã pageId_postId) bị bỏ qua', () => {
  const db = seed();
  db.settings.adTest.on = true;
  db.posts[0].results = { 100107638949140: '987654' };
  assert.strictEqual(adtest.propose(), 0);
});

test('duyệt khi chạy thử: không tạo gì; chạy thật: tạo và ghi nhận, chấm điểm khi hết hạn', async () => {
  const db = seed();
  db.settings.adTest.on = true;
  adtest.propose();
  const a = db.approvals[0];
  db.settings.dryRun = true;
  let created = 0;
  ads.adsetTemplate = async () => ({ targeting: { geo_locations: { countries: ['VN'] } } });
  ads.createTest = async () => { created++; return { campaignId: 'tc1', adsetId: 'ts1', adId: 'ta1' }; };
  await engine.decide(a.id, true);
  assert.strictEqual(created, 0);
  assert.strictEqual(db.adTests.length, 0);

  const b = seed(); b.settings.adTest.on = true; b.settings.dryRun = false;
  adtest.propose();
  await engine.decide(b.approvals[0].id, true);
  assert.strictEqual(created, 1);
  assert.strictEqual(db.adTests.length, 1);
  assert.strictEqual(db.adTests[0].status, 'running');
  assert.strictEqual(db.adTests[0].template, 'BT-TN-01');

  // chưa hết hạn: chưa chấm
  const pausedIds = [];
  ads.pause = async (id) => { pausedIds.push(id); };
  await adtest.evaluate([camp({ id: 'tc1', name: 'TEST', accountId: '11111', d7: { spend: 40000, msgs: 1 } })]);
  assert.strictEqual(db.adTests[0].status, 'running');
  // hết hạn, đạt: 100.000đ / 2 tin = 50.000 ≤ 100.000 → ĐẠT, tắt quảng cáo, ghi bài học chờ duyệt
  const later = Date.now() + 8 * 864e5; // kỳ chạy thử mặc định 7 ngày
  await adtest.evaluate([camp({ id: 'tc1', name: 'TEST', accountId: '11111', d7: { spend: 100000, msgs: 2 } })], later);
  assert.strictEqual(db.adTests[0].status, 'pass');
  assert.deepStrictEqual(pausedIds, ['tc1']);
  assert.ok(db.lessons.some((l) => l.source === 'ads' && l.status === 'pending' && /đạt/.test(l.text)));
  db.settings.dryRun = true;
});

test('quảng cáo thử: không đạt khi tiêu hết mà không ra tin; trần ngày chặn đề xuất mới', async () => {
  const db = seed();
  db.settings.adTest.on = true;
  db.adTests = [{ id: 't1', brand: 'the_one', postId: 'old', topic: 'cũ', budget: 50000, days: 2, createdAt: new Date(Date.now() - 864e5).toISOString(), endsAt: new Date(Date.now() - 1000).toISOString(), status: 'running', campaignId: 'x1' }];
  db.settings.dryRun = true;
  await adtest.evaluate([camp({ id: 'x1', name: 'TEST', accountId: '11111', d7: { spend: 100000, msgs: 0 } })]);
  assert.strictEqual(db.adTests[0].status, 'fail');

  // ngân sách ngày của cơ sở nhỏ hơn 1 chiến dịch thử → không đề xuất, có ghi nhật ký
  db.adTests = [];
  db.settings.adTest.budget = 150000;
  for (const u of db.settings.adTest.units) if (u.brand === 'the_one') u.dailyBudget = 100000;
  assert.strictEqual(adtest.propose(), 0);
  assert.ok(db.actions.some((a) => a.kind === 'error' && /vượt ngân sách ngày/.test(a.text)));
  for (const u of db.settings.adTest.units) if (u.brand === 'the_one') u.dailyBudget = 1500000;
});

test('học đối tượng: giữ nhóm giá/tin tốt nhất theo thương hiệu, bỏ nhóm ít dữ liệu; quảng cáo thử dùng đối tượng đã học', async () => {
  const db = seed();
  const tg = (age) => ({ age_min: 18, age_max: age, genders: [2], interests: [] });
  ads.mode = 'live';
  ads.audiences = async () => [
    { adsetId: 'a1', campaign: 'DH-TN-04', spend: 3000000, msgs: 30, destination: 'MESSENGER', targeting: tg(65) }, // 100.000đ/tin
    { adsetId: 'a2', campaign: 'DH-TN-05', spend: 2000000, msgs: 40, destination: 'MESSENGER', targeting: tg(45) }, // 50.000đ/tin → tốt nhất
    { adsetId: 'a3', campaign: 'DH-TN-06', spend: 500000, msgs: 50, destination: 'MESSENGER', targeting: tg(30) },  // ít chi → bỏ
    { adsetId: 'a4', campaign: 'BT-TN-03', spend: 1500000, msgs: 30, destination: 'MESSENGER', targeting: tg(40) },
  ];
  await adtest.learn(Date.now(), true);
  assert.deepStrictEqual(db.audiences.dark_hair.map((a) => a.adsetId), ['a2', 'a1']);
  assert.strictEqual(db.audiences.the_one[0].adsetId, 'a4');
  assert.strictEqual(db.audiences.dark_hair[0].gender, 'Nữ');
  assert.strictEqual(db.audiences.dark_hair[0].age, '18-45');

  // quảng cáo thử của The One dùng đúng đối tượng a4
  db.settings.adTest.on = true; db.settings.dryRun = false;
  let targeting;
  ads.createTest = async (o) => { targeting = o.targeting; return { campaignId: 'tc9', adsetId: 's', adId: 'a' }; };
  adtest.propose();
  await engine.decide(db.approvals[0].id, true);
  assert.strictEqual(targeting.age_max, 40);
  assert.match(db.adTests[0].template, /BT-TN-03/);
  ads.mode = 'mock'; db.settings.dryRun = true;
});

test('ngưỡng loại riêng cho quảng cáo thử: Mishang 60.000đ; kỳ chạy mặc định 7 ngày (đo theo tuần), chấm trên tổng cả kỳ', async () => {
  const db = seed();
  assert.strictEqual(db.settings.adTest.days, 7);
  assert.strictEqual(adtest.limits('mishang').stop, 60000);
  assert.strictEqual(adtest.limits('mishang').scale, 50000);
  assert.strictEqual(adtest.limits('the_one').stop, 200000);
  // Mishang 150.000đ ngân sách cả kỳ, tiêu 150.000đ ra 2 tin = 75.000đ/tin > 60.000đ → không đạt
  db.adTests = [{ id: 'm1', brand: 'mishang', postId: 'p', topic: 'mi', budget: 50000, days: 3, createdAt: new Date(Date.now() - 3 * 864e5).toISOString(), endsAt: new Date(Date.now() - 1000).toISOString(), status: 'running', campaignId: 'mx' }];
  await adtest.evaluate([camp({ id: 'mx', name: 'TEST', accountId: '22222', status: 'PAUSED', d7: { spend: 150000, msgs: 2 } })]);
  assert.strictEqual(db.adTests[0].status, 'fail');
  // cùng số liệu với The One (ngưỡng loại 200.000đ, đạt 100.000đ): 75.000đ/tin → đạt
  db.adTests = [{ id: 'o1', brand: 'the_one', postId: 'p2', topic: 'x', budget: 50000, days: 3, createdAt: new Date(Date.now() - 3 * 864e5).toISOString(), endsAt: new Date(Date.now() - 1000).toISOString(), status: 'running', campaignId: 'ox' }];
  await adtest.evaluate([camp({ id: 'ox', name: 'TEST', accountId: '11111', status: 'PAUSED', d7: { spend: 150000, msgs: 2 } })]);
  assert.strictEqual(db.adTests[0].status, 'pass');
});

test('cơ sở: nhận diện theo tên chiến dịch, ngân sách ngày mặc định đúng theo Sếp, không có trần tháng', () => {
  const db = seed();
  const u = Object.fromEntries(db.settings.adTest.units.map((x) => [x.id, x]));
  assert.deepStrictEqual(Object.fromEntries(Object.entries(u).map(([k, v]) => [k, v.dailyBudget])), { dh_q1: 2000000, to_bt: 1500000, to_q3: 1500000, ms_q1: 1300000, ms_bt: 1000000 });
  assert.strictEqual(adtest.unitOf('the_one', 'BT-TN-03 (Quận Bình thạnh - Bản sao 2)').id, 'to_bt');
  assert.strictEqual(adtest.unitOf('the_one', 'quận 3 hight ligh').id, 'to_q3');
  assert.strictEqual(adtest.unitOf('the_one', 'Q3-WEB-01').id, 'to_q3');
  assert.strictEqual(adtest.unitOf('mishang', 'Mishanng Bình thạnh - Bản sao 3').id, 'ms_bt');
  assert.strictEqual(adtest.unitOf('mishang', 'mi - Bản sao').id, 'ms_q1');
  assert.strictEqual(adtest.unitOf('dark_hair', 'DH-TN-04').id, 'dh_q1');
  assert.strictEqual(db.settings.monthlyCap, 0);
  assert.strictEqual(db.settings.adTest.monthCap, undefined);
});

test('ngân sách ngày của cơ sở giới hạn số bài thử đang cam kết; mỗi cơ sở tính riêng', () => {
  const db = seed();
  db.settings.adTest.on = true; db.settings.adTest.budget = 150000;
  const bt = db.settings.adTest.units.find((x) => x.id === 'to_bt');
  const q3 = db.settings.adTest.units.find((x) => x.id === 'to_q3');
  bt.dailyBudget = 300000;
  db.adTests = [1, 2].map((i) => ({ id: 'r' + i, unitId: 'to_bt', brand: 'the_one', postId: 'z' + i, topic: 't', budget: 150000, days: 7, createdAt: new Date().toISOString(), endsAt: new Date(Date.now() + 864e5).toISOString(), status: 'running', campaignId: 'k' + i }));
  assert.ok(adtest.capProblem(bt, 150000)); // 300.000 + 150.000 > 300.000
  assert.strictEqual(adtest.capProblem(q3, 150000), null); // Quận 3 còn trống
  assert.strictEqual(adtest.committed('to_bt'), 300000);
  bt.dailyBudget = 1500000;
});

test('đo tuần: cơ sở có mọi bài thử đạt → đề xuất tăng ngân sách ngày; có bài không đạt → không; duyệt thì tăng', async () => {
  const db = seed();
  const now = Date.now();
  const mk = (id, unitId, status) => ({ id, unitId, brand: unitId.startsWith('ms') ? 'mishang' : 'the_one', postId: id, topic: id, budget: 150000, days: 7, createdAt: new Date(now - 8 * 864e5).toISOString(), endsAt: new Date(now - 864e5).toISOString(), finishedAt: new Date(now - 3600e3).toISOString(), status });
  db.adTests = [mk('a1', 'to_bt', 'pass'), mk('a2', 'to_bt', 'pass'), mk('b1', 'to_q3', 'pass'), mk('b2', 'to_q3', 'fail')];
  assert.strictEqual(adtest.review(now), 1);
  const ap = db.approvals.filter((a) => a.type === 'unit_budget');
  assert.strictEqual(ap.length, 1);
  assert.deepStrictEqual(ap[0].payload, { unitId: 'to_bt', from: 1500000, to: 1800000 });
  assert.strictEqual(adtest.review(now), 0); // đã đo tuần này rồi
  await engine.decide(ap[0].id, true);
  assert.strictEqual(db.settings.adTest.units.find((x) => x.id === 'to_bt').dailyBudget, 1800000);
  assert.strictEqual(db.settings.adTest.units.find((x) => x.id === 'to_q3').dailyBudget, 1500000);
});

test('video nhiều view tự nhiên: mỗi cơ sở 1 đề xuất/ngày, bỏ bài đã chạy quảng cáo, chọn bài view cao nhất', async () => {
  const { social } = require('../src/connectors');
  const db = load();
  db.settings.adTest.on = true;
  db.approvals.length = 0;
  db.adTests.length = 0;
  planner.updateBrand('dark_hair', { adAccountId: '11111' });
  planner.updateBrand('dark_hair', { pageIds: '777000111' });
  const page = '777000111';
  const v = (id, views, text) => ({ videoId: id, postId: `${page}_${id}`, pageId: page, views, length: 30, createdAt: new Date().toISOString(), text });
  social.organicVideos = async (p) => (p === page ? [v('a', 500, 'Balayage'), v('b', 900, 'Uốn layer'), v('c', 2000, 'Đã chạy QC'), v('d', 40, 'Ít view')] : []);
  ads.promotedStories = async () => [`${page}_c`];
  const n = await adtest.proposeBoost();
  const mine = db.approvals.filter((a) => a.type === 'ad_test' && a.payload.unitId === 'dh_q1');
  assert.ok(n >= 1);
  assert.strictEqual(mine.length, 1);
  assert.strictEqual(mine[0].payload.postId, `${page}_b`); // c đã chạy QC, d dưới ngưỡng, b > a
  assert.strictEqual(mine[0].payload.source, 'organic');
  assert.strictEqual(await adtest.proposeBoost(), 0); // cùng ngày: không đề xuất thêm
  assert.strictEqual(db.approvals.filter((a) => a.payload && a.payload.unitId === 'dh_q1').length, 1);
});

test('Sếp chỉ định chạy thử 1 bài video cho 2 cơ sở: tra mã bài từ mã video, đúng ngân sách/số ngày, chặn trùng và trần ngày', async () => {
  const { social } = require('../src/connectors');
  const db = load();
  db.approvals.length = 0; db.adTests.length = 0; db.campaigns = [];
  planner.updateBrand('the_one', { adAccountId: '11111', pageIds: '100107638949140,102865385331544' });
  db.posts.push({ id: 'vid1', brand: 'the_one', channel: 'facebook_page', status: 'published', live: true, topic: 'Layer nâu', scheduledAt: new Date().toISOString(), pageIds: ['102865385331544'], results: { 102865385331544: '9988' } });
  social.videoPostId = async (pid, ext) => (ext === '9988' ? `${pid}_777` : null);
  const u = (id) => db.settings.adTest.units.find((x) => x.id === id);
  u('to_bt').dailyBudget = 1000000; u('to_q3').dailyBudget = 150000;
  await assert.rejects(adtest.proposeManual({ postId: 'vid1', unitIds: ['to_bt'], budget: 100000, days: 0 }), /Số ngày/);
  await assert.rejects(adtest.proposeManual({ postId: 'vid1', unitIds: ['dh_q1'], budget: 100000, days: 3 }), /không thuộc/);
  const ids = await adtest.proposeManual({ postId: 'vid1', unitIds: ['to_bt', 'to_q3'], budget: 100000, days: 3 });
  assert.strictEqual(ids.length, 2);
  const a = db.approvals.find((x) => x.id === ids[1]);
  assert.deepStrictEqual([a.payload.unitId, a.payload.objectStoryId, a.payload.pageId, a.payload.budget, a.payload.days, a.payload.source], ['to_q3', '102865385331544_777', '102865385331544', 100000, 3, 'manual']);
  await assert.rejects(adtest.proposeManual({ postId: 'vid1', unitIds: ['to_bt'], budget: 100000, days: 3 }), /đã có quảng cáo thử/);
  db.posts.push({ ...db.posts.at(-1), id: 'vid2' });
  await assert.rejects(adtest.proposeManual({ postId: 'vid2', unitIds: ['to_q3'], budget: 100000, days: 3 }), /vượt ngân sách ngày tối đa/); // Q3: 100k chờ + 100k > 150k
  social.videoPostId = async () => null;
  db.posts.push({ ...db.posts.at(-1), id: 'vid3' });
  await assert.rejects(adtest.proposeManual({ postId: 'vid3', unitIds: ['to_bt'], budget: 100000, days: 3 }), /chưa có mã bài viết/);
  u('to_bt').dailyBudget = 1500000; u('to_q3').dailyBudget = 1500000;
});
