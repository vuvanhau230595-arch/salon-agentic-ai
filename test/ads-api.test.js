const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-adsapi-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
process.env.MEDIA_DIR = path.join(tmp, 'media');
delete process.env.APP_PASSWORD;
delete process.env.META_ACCESS_TOKEN;
delete process.env.ANTHROPIC_API_KEY;

const { load } = require('../src/db');
const { ads } = require('../src/connectors');
const planner = require('../src/planner');
const adsApi = require('../src/ads-api');
const { server } = require('../src/server');
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const camp = (o) => ({ status: 'ACTIVE', budget: 0, objective: 'OUTCOME_ENGAGEMENT', accountId: '11111', today: { spend: 0, msgs: 0 }, d7: { spend: 0, msgs: 0 }, month: { spend: 0, msgs: 0 }, ...o });
let base;
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });

test('khởi động server thử + gán tài khoản', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  planner.updateBrand('the_one', { adAccountId: '11111' });
  planner.updateBrand('dark_hair', { adAccountId: '11111' });
  planner.updateBrand('mishang', { adAccountId: '22222' });
});

test('cảnh báo: giá/tin cao, tiêu mà 0 tin, chi tiêu bất thường, giá hôm nay tăng; bỏ qua chiến dịch không phải tin nhắn và đã tắt', () => {
  load().settings.rules.highCpl.maxCostPerMsg = 200000;
  const list = [
    camp({ id: 'a1', name: 'BT-cao', d7: { spend: 3000000, msgs: 10 }, today: { spend: 100000, msgs: 1 } }),          // 300.000/tin > 200.000
    camp({ id: 'a2', name: 'BT-khong-tin', d7: { spend: 800000, msgs: 0 } }),                                         // 0 tin
    camp({ id: 'a3', name: 'DH-tang-vot', d7: { spend: 2200000, msgs: 30 }, today: { spend: 1000000, msgs: 10 } }),   // hôm nay 1tr vs 200k/ngày
    camp({ id: 'a4', name: 'BT-hom-nay-dat', d7: { spend: 1800000, msgs: 36 }, today: { spend: 300000, msgs: 3 } }),  // 100k vs 50k = +100%, chi tiêu không vọt
    camp({ id: 'a5', name: 'Q3-WEB', objective: 'OUTCOME_TRAFFIC', d7: { spend: 9000000, msgs: 0 } }),                // không đo bằng tin nhắn
    camp({ id: 'a6', name: 'Tat', status: 'PAUSED', d7: { spend: 9000000, msgs: 0 } }),
    camp({ id: 'a7', name: 'Cu', stale: true }),
  ];
  const al = adsApi.alerts(list);
  const kinds = (id) => al.filter((x) => x.campaignId === id).map((x) => x.kind);
  assert.deepStrictEqual(kinds('a1'), ['cpl_high']);
  assert.deepStrictEqual(kinds('a2'), ['no_result']);
  assert.deepStrictEqual(kinds('a3'), ['spend_spike']);
  assert.deepStrictEqual(kinds('a4'), ['cpl_spike']);
  assert.deepStrictEqual(kinds('a5'), []);
  assert.deepStrictEqual(kinds('a6'), []);
  assert.deepStrictEqual(kinds('a7'), ['stale']);
  assert.ok(al.every((x) => x.basis && x.text), 'mỗi cảnh báo ghi rõ nguồn và khoảng thời gian');
  assert.strictEqual(al[0].level, 'danger'); // nghiêm trọng xếp trước
});

test('bật/tắt: chạy thử chỉ ghi nhật ký; chạy thật mới đổi; trạng thái sai hoặc trùng bị từ chối', async () => {
  const db = load();
  db.campaigns = [camp({ id: 'c100001', name: 'DH-TN-04', budget: 300000 })];
  db.actions = [];
  let calls = [];
  ads.setStatus = async (id, st) => calls.push([id, st]);
  db.settings.dryRun = true;
  let r = await adsApi.setStatus('c100001', 'PAUSED');
  assert.strictEqual(r.dry, true);
  assert.deepStrictEqual(calls, []);
  assert.strictEqual(db.campaigns[0].status, 'ACTIVE');
  assert.ok(db.actions.some((a) => a.kind === 'ads_change' && a.dry && a.before === 'ACTIVE' && a.after === 'PAUSED'));

  db.settings.dryRun = false;
  r = await adsApi.setStatus('c100001', 'PAUSED');
  assert.deepStrictEqual(calls, [['c100001', 'PAUSED']]);
  assert.strictEqual(db.campaigns[0].status, 'PAUSED');
  await assert.rejects(adsApi.setStatus('c100001', 'PAUSED'), /đã ở trạng thái/);
  await assert.rejects(adsApi.setStatus('c100001', 'DELETED'), /ACTIVE hoặc PAUSED/);
  await assert.rejects(adsApi.setStatus('khong-co', 'ACTIVE'), /Không thấy chiến dịch/);
  await adsApi.setStatus('c100001', 'ACTIVE');
  assert.strictEqual(db.campaigns[0].status, 'ACTIVE');
  db.settings.dryRun = true;
});

test('ngân sách: kiểm tra khoảng và số nguyên; cấp chiến dịch hoặc nhóm quảng cáo; chạy thử không đổi thật', async () => {
  const db = load();
  db.campaigns = [camp({ id: 'c200002', name: 'BT-CBO', budget: 300000, budgetLevel: 'campaign' }), camp({ id: 'c300003', name: 'DH-ABO', budget: 0 })];
  db.actions = [];
  const set = [];
  ads.setBudget = async (id, v) => set.push([id, v]);
  ads.adsets = async (id) => (id === 'c300003' ? [{ id: '77777', name: 'Nhóm A', status: 'ACTIVE', budget: 400000 }, { id: '88888', name: 'Nhóm B', status: 'PAUSED', budget: 0 }] : []);
  db.settings.dryRun = true;
  await assert.rejects(adsApi.setBudget('c200002', 10000), /từ 50\.000đ/);
  await assert.rejects(adsApi.setBudget('c200002', 99999999), /từ 50\.000đ/);
  await assert.rejects(adsApi.setBudget('c200002', 250000.5), /số nguyên/);
  await assert.rejects(adsApi.setBudget('c200002', 300000), /trùng/);
  await assert.rejects(adsApi.setBudget('c300003', 500000), /cấp nhóm quảng cáo/);
  await assert.rejects(adsApi.setBudget('c300003', 500000, '99999'), /không thuộc chiến dịch/);
  await assert.rejects(adsApi.setBudget('c300003', 500000, '88888'), /không đặt ngân sách riêng/);
  let r = await adsApi.setBudget('c200002', 360000);
  assert.strictEqual(r.dry, true);
  assert.deepStrictEqual(set, []);
  assert.strictEqual(db.campaigns[0].budget, 300000);

  db.settings.dryRun = false;
  await adsApi.setBudget('c200002', 360000);
  await adsApi.setBudget('c300003', 500000, '77777');
  assert.deepStrictEqual(set, [['c200002', 360000], ['77777', 500000]]);
  assert.strictEqual(db.campaigns[0].budget, 360000);
  const log = db.actions.filter((a) => a.kind === 'ads_change' && !a.dry);
  assert.strictEqual(log.length, 2);
  assert.ok(log.every((a) => a.by && a.before !== undefined && a.after !== undefined), 'nhật ký có người làm và giá trị trước/sau');
  db.settings.dryRun = true;
});

test('đồng bộ chỉ đọc: không áp luật tắt/tăng, không tạo đề xuất', async () => {
  const db = load();
  db.settings.dryRun = false;
  db.actions = []; db.approvals = [];
  let paused = 0;
  ads.pause = async () => { paused++; };
  ads.list = async () => [camp({ id: 'c400004', name: 'BT-xau', today: { spend: 900000, msgs: 1 }, d7: { spend: 900000, msgs: 1 } })]; // chắc chắn bị luật tắt nếu chạy agent
  const n = await adsApi.sync();
  assert.strictEqual(n, 1);
  assert.strictEqual(paused, 0);
  assert.strictEqual(db.approvals.length, 0);
  assert.ok(!db.actions.some((a) => a.kind === 'pause'));
  assert.ok(db.lastSync);
  db.settings.dryRun = true;
});

test('số liệu theo ngày: chế độ mẫu trả nhãn demo; chế độ thật gộp theo ngày, nhớ 10 phút, refresh thì gọi lại', async () => {
  adsApi.clearCache();
  const demo = await adsApi.series({ days: 30 });
  assert.strictEqual(demo.demo, true);
  assert.deepStrictEqual(demo.points, []);

  ads.mode = 'live';
  let calls = 0;
  ads.daily = async (acc) => { calls++; return acc === '11111' ? [{ date: '2026-10-01', spend: 100, msgs: 1 }, { date: '2026-10-02', spend: 200, msgs: 2 }] : [{ date: '2026-10-01', spend: 50, msgs: 5 }]; };
  const t0 = Date.now();
  const a = await adsApi.series({ days: 30, now: t0 });
  assert.deepStrictEqual(a.points, [{ date: '2026-10-01', spend: 150, msgs: 6 }, { date: '2026-10-02', spend: 200, msgs: 2 }]);
  assert.strictEqual(calls, 2);
  assert.strictEqual((await adsApi.series({ days: 30, now: t0 + 60e3 })).cached, true);
  assert.strictEqual(calls, 2);
  await adsApi.series({ days: 30, now: t0 + 11 * 60e3 });
  assert.strictEqual(calls, 4);
  await adsApi.series({ days: 30, refresh: true, now: t0 + 12 * 60e3 });
  assert.strictEqual(calls, 6);
  ads.daily = async () => { throw new Error('Token hết hạn'); };
  await assert.rejects(adsApi.series({ days: 7, now: t0 }), /Token hết hạn/);
  ads.mode = 'mock';
});

test('HTTP: lỗi trả đúng mã; /api/state có cảnh báo và thương hiệu của chiến dịch; không lộ token', async () => {
  const db = load();
  db.campaigns = [camp({ id: 'c500005', name: 'DH-TN-04', d7: { spend: 3000000, msgs: 5 } })];
  let r = await post('/api/ads/campaigns/khong-co/status', { status: 'PAUSED' });
  assert.strictEqual(r.status, 404);
  r = await post('/api/ads/campaigns/c500005/status', { status: 'XOA' });
  assert.strictEqual(r.status, 400);
  r = await post('/api/ads/campaigns/c500005/budget', { budget: 'abc' });
  assert.strictEqual(r.status, 400);
  const st = await (await fetch(base + '/api/state')).json();
  assert.strictEqual(st.campaigns[0].brand, 'dark_hair');
  assert.ok(st.adAlerts.some((a) => a.campaignId === 'c500005'));
  assert.ok(!JSON.stringify(st).includes('access_token'));
});

test('postStats trong /api/state: đếm trên toàn bộ bài, tách theo thương hiệu', async () => {
  const db = load();
  const day = 864e5, now = Date.now();
  const mk = (i, brand, status, offsetDays) => ({ id: 'ps' + i, brand, channel: 'facebook_page', status, topic: 't' + i, text: 'x', scheduledAt: new Date(now + offsetDays * day).toISOString() });
  db.posts = [
    mk(1, 'the_one', 'scheduled', 1), mk(2, 'the_one', 'scheduled', 3), mk(3, 'the_one', 'scheduled', 20), // 2 trong 7 ngày
    mk(4, 'dark_hair', 'published', -2), mk(5, 'dark_hair', 'published', -40), // chỉ 1 trong 30 ngày
    mk(6, 'mishang', 'awaiting_manual', -1), mk(7, 'mishang', 'failed', -1), mk(8, 'the_one', 'scheduled', -3), // quá giờ: không tính sắp đăng
  ];
  for (let i = 0; i < 70; i++) db.posts.push(mk(100 + i, 'the_one', 'draft', 5)); // nhiều hơn 50 bài gửi về giao diện
  const st = await (await fetch(base + '/api/state')).json();
  assert.strictEqual(st.postStats.scheduled, 4);
  assert.strictEqual(st.postStats.upcoming7d, 2);
  assert.strictEqual(st.postStats.published30d, 1);
  assert.strictEqual(st.postStats.awaitingManual, 1);
  assert.strictEqual(st.postStats.failed, 1);
  assert.deepStrictEqual(st.postStats.byBrand.the_one, { scheduled: 4, upcoming7d: 2, published30d: 0 });
  assert.deepStrictEqual(st.postStats.byBrand.dark_hair, { scheduled: 0, upcoming7d: 0, published30d: 1 });
});

test('API chi tiết quảng cáo: trả ảnh/bài/số liệu từng quảng cáo, nhớ 10 phút, refresh=1 đọc lại, chiến dịch lạ báo 404', async () => {
  const db = load();
  db.campaigns = [camp({ id: '120000000000001', name: 'TEST-dh_q1' })];
  let calls = 0;
  ads.creatives = async (id) => { calls++; return { campaign: { id, name: 'TEST-dh_q1', createdAt: '2026-10-15T07:00:00+0000' }, ads: [{ id: 'ad1', image: 'https://cdn/full.jpg', text: 'Tím than', link: 'https://facebook.com/p/1', spend: 97037, msgs: 0, cpl: null }] }; };
  const r1 = await (await fetch(base + '/api/ads/campaigns/120000000000001/creatives')).json();
  assert.strictEqual(r1.ads[0].image, 'https://cdn/full.jpg'); assert.ok(r1.fetchedAt); assert.ok(!r1.cached);
  const r2 = await (await fetch(base + '/api/ads/campaigns/120000000000001/creatives')).json();
  assert.strictEqual(r2.cached, true); assert.strictEqual(calls, 1, 'lần 2 lấy từ bộ nhớ tạm');
  await fetch(base + '/api/ads/campaigns/120000000000001/creatives?refresh=1');
  assert.strictEqual(calls, 2);
  assert.strictEqual((await fetch(base + '/api/ads/campaigns/120000000000009/creatives')).status, 404);
});
