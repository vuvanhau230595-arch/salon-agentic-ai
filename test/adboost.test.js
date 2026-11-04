// Quy tắc "video đang lên view": ghi lỗi 1 lần mỗi nguyên nhân, đề xuất quá hạn tự đóng, Page thiếu quyền Tạo quảng cáo thì báo rõ
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
process.env.DB_FILE = path.join(os.tmpdir(), `agent-adboost-${process.pid}.json`);
require('node:fs').rmSync(process.env.DB_FILE, { force: true });
delete process.env.META_ACCESS_TOKEN;
delete process.env.ANTHROPIC_API_KEY;

const { load } = require('../src/db');
const { ads, social } = require('../src/connectors');
const planner = require('../src/planner');
const engine = require('../src/engine');
const adtest = require('../src/adtest');

const DAY = 864e5;
const page = '777000111';
const v = (id, views, text) => ({ videoId: id, postId: `${page}_${id}`, pageId: page, views, length: 30, createdAt: new Date().toISOString(), text });

function reset() {
  const db = load();
  db.settings.adTest.on = true;
  db.settings.dryRun = true;
  db.approvals.length = 0;
  db.adTests.length = 0;
  db.actions.length = 0;
  db.channelSync = {};
  planner.updateBrand('dark_hair', { adAccountId: '11111', pageIds: page });
  ads.promotedStories = async () => [];
  social.pageTasks = async () => null;
  return db;
}
const errors = () => load().actions.filter((a) => a.kind === 'error').map((a) => a.text);

test('lỗi quét video cùng nguyên nhân chỉ ghi nhật ký 1 lần; hết lỗi rồi lỗi lại thì ghi lại', async () => {
  const db = reset();
  social.organicVideos = async () => { throw new Error('Token thiếu quyền cần thiết'); };
  await adtest.proposeBoost();
  await adtest.proposeBoost();
  await adtest.proposeBoost();
  assert.strictEqual(errors().filter((t) => t.includes('Chưa quét được video nhiều view của Dark Hair')).length, 1);
  assert.ok(db.channelSync['boost:dark_hair'].error.includes('Token thiếu quyền'));

  social.organicVideos = async () => [v('a', 500, 'Balayage')];
  await adtest.proposeBoost();
  assert.strictEqual(db.channelSync['boost:dark_hair'].error, undefined);
  assert.strictEqual(db.approvals.filter((a) => a.type === 'ad_test').length, 1);

  social.organicVideos = async () => { throw new Error('Token thiếu quyền cần thiết'); };
  db.approvals.length = 0; // ngày khác
  await adtest.proposeBoost();
  assert.strictEqual(errors().filter((t) => t.includes('Chưa quét được video nhiều view của Dark Hair')).length, 2);
});

test('đề xuất video quá 3 ngày chưa duyệt thì tự đóng, không tính là Sếp từ chối, và video được đề xuất lại khi còn lên view', async () => {
  const db = reset();
  social.organicVideos = async () => [v('a', 500, 'Balayage')];
  const now = Date.now();
  await adtest.proposeBoost(now - 4 * DAY);
  assert.strictEqual(db.approvals.length, 1);
  assert.strictEqual(db.approvals[0].status, 'pending');

  await adtest.proposeBoost(now);
  const old = db.approvals.find((a) => a.expired);
  assert.ok(old, 'đề xuất cũ phải được đánh dấu hết hạn');
  assert.strictEqual(old.status, 'rejected');
  assert.strictEqual(old.decidedBy, 'Hệ thống');
  assert.ok(old.note.includes('Hết hạn'));
  assert.ok(db.actions.some((a) => a.kind === 'system' && a.text.includes('Đóng 1 đề xuất quảng cáo video')));
  // Bài vẫn trong danh sách "đã đề xuất" nên không bị đề xuất lại ngay trong cùng lần quét (tránh lặp vô hạn)
  assert.strictEqual(db.approvals.filter((a) => a.status === 'pending').length, 0);
});

test('Page chưa cấp quyền Tạo quảng cáo: video của Page đó bị bỏ qua (ghi lỗi 1 lần); cấp xong thì đề xuất và duyệt bình thường; Facebook từ chối vì quyền thì ghép hướng dẫn', async () => {
  const db = reset();
  db.settings.dryRun = false;
  social.organicVideos = async () => [v('a', 500, 'Balayage')];
  social.pageTasks = async (p) => (p === page ? ['MODERATE', 'CREATE_CONTENT'] : null);
  let created = 0;
  ads.createTest = async () => { created++; return { campaignId: 'c', adsetId: 's', adId: 'a' }; };
  ads.adsetTemplate = async () => ({ targeting: { geo_locations: { countries: ['VN'] } } });
  db.audiences = { dark_hair: [{ campaign: 'DH-TN-01', cpl: 90000, targeting: { geo_locations: { countries: ['VN'] } } }] };

  assert.strictEqual(await adtest.proposeBoost(), 0);
  await adtest.proposeBoost();
  assert.strictEqual(db.approvals.length, 0, 'Page chưa có quyền Tạo quảng cáo → không đề xuất video của Page đó');
  assert.strictEqual(errors().filter((t) => t.includes('Bỏ qua video của Page') && t.includes('Tạo quảng cáo')).length, 1);

  // Cấp quyền xong → đề xuất, duyệt tạo được
  social.pageTasks = async () => ['MODERATE', 'CREATE_CONTENT', 'ADVERTISE'];
  social.resetPageToken();
  await adtest.proposeBoost();
  const a = db.approvals.find((x) => x.type === 'ad_test');
  assert.ok(a, 'đủ quyền thì phải có đề xuất');
  assert.ok(!a.detail.includes('⚠'));
  await engine.decide(a.id, true);
  assert.strictEqual(created, 1);
  assert.strictEqual(a.status, 'approved');
  assert.strictEqual(db.adTests.length, 1);

  // Facebook từ chối vì quyền → câu lỗi có kèm cách cấp quyền; lỗi khác giữ nguyên
  db.approvals.length = 0; db.adTests.length = 0;
  await adtest.proposeBoost(Date.now() + 864e5);
  const b = db.approvals.find((x) => x.type === 'ad_test');
  ads.createTest = async () => { throw new Error('Meta từ chối yêu cầu: Invalid parameter — Không đủ quyền đối với Trang để chạy quảng cáo'); };
  await assert.rejects(engine.decide(b.id, true), (e) => /Không đủ quyền đối với Trang/.test(e.message) && /Tạo quảng cáo/.test(e.message));
  assert.strictEqual(b.status, 'pending');
  ads.createTest = async () => { throw new Error('Meta trả về dữ liệu không đọc được (HTTP 502)'); };
  await assert.rejects(engine.decide(b.id, true), (e) => e.message === 'Meta trả về dữ liệu không đọc được (HTTP 502)');

  // Đủ quyền theo token: không báo gì
  assert.strictEqual(await adtest.advertiseProblem(page), '');
  // Page chưa gán cho người dùng hệ thống (không có trong /me/accounts) → báo cách gán
  social.pageTasks = async () => null;
  process.env.META_ACCESS_TOKEN = 'x';
  try { assert.ok((await adtest.advertiseProblem(page)).includes('chưa được gán')); } finally { delete process.env.META_ACCESS_TOKEN; }
});

test('đối tượng sao chép từ nhóm cũ: bỏ trường Meta đã gỡ (targeting_optimization), khai báo tắt Advantage+ audience nếu chưa có', () => {
  const { cleanTargeting } = require('../src/connectors/ads-meta');
  const t = cleanTargeting({ geo_locations: { countries: ['VN'] }, age_min: 18, targeting_optimization: 'none', targeting_relaxation_types: { lookalike: 0 } });
  assert.deepStrictEqual(t, { geo_locations: { countries: ['VN'] }, age_min: 18, targeting_automation: { advantage_audience: 0 } });
  const keep = cleanTargeting({ age_min: 20, targeting_automation: { advantage_audience: 1 } });
  assert.deepStrictEqual(keep.targeting_automation, { advantage_audience: 1 });
  assert.deepStrictEqual(cleanTargeting(undefined), { targeting_automation: { advantage_audience: 0 } });
  // age_range chỉ dùng được khi bật Advantage+ audience: tắt thì đổi sang age_min/age_max
  assert.deepStrictEqual(cleanTargeting({ age_range: [22, 40], targeting_automation: { advantage_audience: 0 } }), { age_min: 22, age_max: 40, targeting_automation: { advantage_audience: 0 } });
  assert.deepStrictEqual(cleanTargeting({ age_range: [22, 40], age_min: 18 }), { age_min: 18, age_max: 40, targeting_automation: { advantage_audience: 0 } });
  assert.deepStrictEqual(cleanTargeting({ age_range: [22, 40], targeting_automation: { advantage_audience: 1 } }).age_range, [22, 40]);
});

test('tự chạy (boost.auto): agent tự duyệt ngay trong hạn mức ngày; Facebook từ chối thì giữ đề xuất chờ và ghi lỗi 1 lần; tắt auto thì chỉ đề xuất', async () => {
  const db = reset();
  db.settings.dryRun = false;
  db.settings.adTest.boost.auto = true;
  db.audiences = { dark_hair: [{ campaign: 'DH-TN-01', cpl: 90000, targeting: { geo_locations: { countries: ['VN'] } } }] };
  social.organicVideos = async () => [v('a', 500, 'Balayage'), v('b', 300, 'Uốn')];
  let created = 0;
  ads.createTest = async () => { created++; return { campaignId: 'c' + created, adsetId: 's', adId: 'a' }; };

  const n = await adtest.proposeBoost();
  assert.strictEqual(n, 1);
  const a = db.approvals.find((x) => x.type === 'ad_test');
  assert.strictEqual(a.status, 'approved');
  assert.strictEqual(a.decidedBy, 'Agent Quảng cáo (tự chạy)');
  assert.strictEqual(a.payload.auto, true);
  assert.strictEqual(created, 1);
  assert.strictEqual(db.adTests.filter((t) => t.status === 'running' && t.source === 'organic').length, 1);
  assert.ok(db.actions.some((x) => x.kind === 'propose' && x.text.includes('agent tự chạy')));

  // Ngày sau: Facebook từ chối → đề xuất nằm lại chờ Sếp, lỗi ghi 1 lần dù quét nhiều lần
  ads.createTest = async () => { throw new Error('Meta từ chối yêu cầu: Không đủ quyền đối với Trang'); };
  const tomorrow = Date.now() + 864e5;
  await adtest.proposeBoost(tomorrow);
  const b = db.approvals.find((x) => x.type === 'ad_test' && x.status === 'pending');
  assert.ok(b, 'đề xuất phải còn chờ duyệt');
  assert.strictEqual(b.payload.postId, `${page}_b`);
  await adtest.proposeBoost(tomorrow); // cùng ngày: không tạo thêm, không ghi lỗi thêm
  assert.strictEqual(errors().filter((t) => t.includes('Chưa tự chạy được quảng cáo video')).length, 1);

  // Tắt auto: chỉ đề xuất, không gọi Facebook
  db.settings.adTest.boost.auto = false;
  db.approvals.length = 0; db.adTests.length = 0;
  let called = 0;
  ads.createTest = async () => { called++; return { campaignId: 'x', adsetId: 's', adId: 'a' }; };
  await adtest.proposeBoost(tomorrow + 864e5);
  assert.strictEqual(called, 0);
  assert.strictEqual(db.approvals[0].status, 'pending');
  assert.strictEqual(db.approvals[0].payload.auto, false);
});

test('cơ sở tắt quảng cáo (on=false): không đề xuất, không tự chạy; bật lại thì chạy; cơ sở khác không ảnh hưởng', async () => {
  const db = reset();
  social.organicVideos = async () => [v('a', 500, 'Balayage')];
  const unit = db.settings.adTest.units.find((u) => u.id === 'dh_q1');
  unit.on = false;
  assert.deepStrictEqual(adtest.activeUnits().map((u) => u.id).includes('dh_q1'), false);
  assert.strictEqual(await adtest.proposeBoost(), 0);
  assert.strictEqual(db.approvals.length, 0);
  assert.strictEqual(adtest.propose(), 0);
  unit.on = true;
  assert.strictEqual(await adtest.proposeBoost(), 1);
  assert.strictEqual(db.approvals.length, 1);
});

test('mức tối đa ngày của cơ sở tính TỔNG mọi chiến dịch đang bật (cũ + bài thử) + đề xuất chờ; chiến dịch thử gán cơ sở theo sổ, chiến dịch cũ theo tên', () => {
  const db = reset();
  planner.updateBrand('the_one', { adAccountId: '11111', pageIds: '555000111' });
  const bt = db.settings.adTest.units.find((u) => u.id === 'to_bt');
  bt.dailyBudget = 1500000;
  db.campaigns = [
    { id: 'old1', name: 'BT-TN-02 (Bình thạnh)', accountId: '11111', status: 'ACTIVE', budget: 0, budgetTotal: 600000, d7: { spend: 0, msgs: 0 }, today: { spend: 0, msgs: 0 } },
    { id: 'old2', name: 'BT-TN-04 (Quận Bình thạnh)', accountId: '11111', status: 'ACTIVE', budget: 300000, budgetTotal: 300000, d7: { spend: 0, msgs: 0 }, today: { spend: 0, msgs: 0 } },
    { id: 'off', name: 'BT-TN-01', accountId: '11111', status: 'PAUSED', budget: 900000, budgetTotal: 900000, d7: { spend: 0, msgs: 0 }, today: { spend: 0, msgs: 0 } },
    { id: 'q3', name: 'Q3-TN-01', accountId: '11111', status: 'ACTIVE', budget: 500000, budgetTotal: 500000, d7: { spend: 0, msgs: 0 }, today: { spend: 0, msgs: 0 } },
    { id: 'tcamp', name: 'TEST-to_bt-20261015-POV', accountId: '11111', status: 'ACTIVE', budget: 0, budgetTotal: 150000, d7: { spend: 0, msgs: 0 }, today: { spend: 0, msgs: 0 } },
  ];
  db.adTests = [{ id: 't1', unitId: 'to_bt', brand: 'the_one', postId: 'p', topic: 'POV', budget: 150000, days: 7, createdAt: new Date().toISOString(), endsAt: new Date(Date.now() + 5 * 864e5).toISOString(), status: 'running', campaignId: 'tcamp' },
    { id: 't2', unitId: 'to_bt', brand: 'the_one', postId: 'p2', topic: 'Mới tạo', budget: 150000, days: 7, createdAt: new Date().toISOString(), endsAt: new Date(Date.now() + 7 * 864e5).toISOString(), status: 'running', campaignId: 'chua-co' }];
  db.approvals = [{ id: 'ap', type: 'ad_test', status: 'pending', payload: { unitId: 'to_bt', budget: 150000 } }];
  assert.strictEqual(adtest.unitOfCampaign(db.campaigns[4]).id, 'to_bt', 'chiến dịch thử gán theo sổ dù tên không khớp mẫu');
  assert.strictEqual(adtest.unitOfCampaign(db.campaigns[3]).id, 'to_q3');
  // 600k + 300k (cũ, Bình Thạnh) + 150k (thử đang có trong danh sách) + 150k (thử vừa tạo) + 150k (đề xuất chờ) = 1.350.000
  assert.strictEqual(adtest.committed('to_bt'), 1350000);
  assert.strictEqual(adtest.committed('to_bt', false), 1200000);
  assert.strictEqual(adtest.capProblem(bt, 150000), null); // 1.350.000 + 150.000 = 1.500.000 vừa đủ
  assert.ok(/vượt ngân sách ngày tối đa/.test(adtest.capProblem(bt, 150001)));
  assert.strictEqual(adtest.committed('to_q3'), 500000);
});

test('chấm sớm sau 2 ngày: không ra tin → tắt luôn + báo; có tin → báo và chạy tiếp; chưa tiêu tiền → chỉ nhắc, kiểm tra lại ngày sau', async () => {
  const db = reset();
  db.settings.dryRun = false;
  db.settings.adTest.checkDays = 2;
  let paused = [];
  ads.pause = async (id) => { paused.push(id); };
  const now = new Date('2026-10-15T05:00:00Z').getTime(); // 12:00 giờ VN: cộng thêm 1 giờ vẫn cùng ngày (test không phụ thuộc giờ chạy)
  const mk = (id, campaignId, ageDays) => ({ id, unitId: 'dh_q1', brand: 'dark_hair', postId: id, topic: id, budget: 150000, days: 7, createdAt: new Date(now - ageDays * 864e5).toISOString(), endsAt: new Date(now + (7 - ageDays) * 864e5).toISOString(), status: 'running', campaignId });
  db.adTests = [mk('khong-ra', 'c1', 2.5), mk('co-tin', 'c2', 2.5), mk('chua-tieu', 'c3', 2.5), mk('moi', 'c4', 1), mk('dat', 'c5', 3)];
  const c = (id, spend, msgs) => ({ id, name: 'TEST-' + id, accountId: '11111', status: 'ACTIVE', d7: { spend, msgs }, today: { spend: 0, msgs: 0 } });
  const camps = [c('c1', 310000, 0), c('c2', 300000, 2), c('c3', 5000, 0), c('c4', 150000, 0), c('c5', 450000, 1)];
  const n = await adtest.checkpoint(camps, now);
  const T = (id) => db.adTests.find((t) => t.id === id);
  assert.strictEqual(T('khong-ra').status, 'fail'); assert.ok(T('khong-ra').early);
  assert.strictEqual(T('dat').status, 'fail', '450.000đ/1 tin > ngưỡng loại 200.000 → tắt');
  assert.deepStrictEqual(paused.sort(), ['c1', 'c5']);
  assert.strictEqual(T('co-tin').status, 'running'); assert.ok(T('co-tin').checkedAt); assert.strictEqual(T('co-tin').msgs, 2);
  assert.strictEqual(T('chua-tieu').status, 'running'); assert.ok(!T('chua-tieu').checkedAt);
  assert.strictEqual(T('moi').status, 'running'); assert.ok(!T('moi').checkedAt, 'mới 1 ngày: chưa tới mốc');
  assert.strictEqual(n, 3);
  const logs = db.actions.map((a) => a.text);
  assert.ok(logs.some((x) => x.includes('"khong-ra"') && x.includes('KHÔNG ĐẠT, tắt sớm') && x.includes('0 tin nhắn')));
  assert.ok(logs.some((x) => x.includes('"co-tin"') && x.includes('đang ra kết quả') && x.includes('2 tin nhắn')));
  assert.ok(logs.some((x) => x.includes('"chua-tieu"') && x.includes('chưa tiêu tiền')));
  assert.ok(db.actions.some((a) => a.kind === 'pause' && a.text.includes('không ra tin nhắn')));
  // Quét lại cùng ngày: không chấm lại, không nhắc lại
  const before = db.actions.length;
  assert.strictEqual(await adtest.checkpoint(camps, now + 3600e3), 0);
  assert.strictEqual(db.actions.length, before);
});
