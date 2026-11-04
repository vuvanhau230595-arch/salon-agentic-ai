const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
process.env.DB_FILE = path.join(os.tmpdir(), `agent-ch-test-${process.pid}.json`);
require('node:fs').rmSync(process.env.DB_FILE, { force: true });
delete process.env.ANTHROPIC_API_KEY;
delete process.env.META_ACCESS_TOKEN;

const { load } = require('../src/db');
const planner = require('../src/planner');
const engine = require('../src/engine');

const month = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 7);
const base = { brand: 'dark_hair', channel: 'tiktok', type: 'post', time: '19:00', days: [1, 3, 5], month };

test('kênh tắt thì không soạn được kế hoạch; bật lên thì soạn được', async () => {
  assert.strictEqual(planner.channelEnabled('dark_hair', 'tiktok'), false);
  await assert.rejects(planner.create(base), /TikTok đang tắt cho Dark Hair/);
  planner.updateBrand('dark_hair', { channels: { tiktok: { on: true } } });
  assert.ok((await planner.create(base)).items.length > 0);
  // thương hiệu khác không bị ảnh hưởng
  await assert.rejects(planner.create({ ...base, brand: 'mishang' }), /đang tắt/);
});

test('Facebook Page bật sẵn cho The One và Dark Hair; Mishang (trang cá nhân) tắt', async () => {
  await assert.rejects(planner.create({ ...base, brand: 'mishang', channel: 'facebook_page' }), /đang tắt/);
  for (const brand of ['the_one', 'dark_hair']) {
    assert.ok((await planner.create({ ...base, brand, channel: 'facebook_page' })).items.length > 0);
  }
});

test('lái tự động bỏ qua hồ sơ có kênh đang tắt, bật lại thì chạy tiếp', async () => {
  const db = load();
  db.plans = [];
  db.settings.autopilot = { on: true, draftDaysBefore: 28, autoApprove: false, profiles: [{ id: 'p1', ...base, direction: '' }] };
  planner.updateBrand('dark_hair', { channels: { tiktok: { on: false } } });
  assert.strictEqual(await planner.autopilot(), 0);
  assert.strictEqual(db.plans.length, 0);
  planner.updateBrand('dark_hair', { channels: { tiktok: { on: true } } });
  assert.ok((await planner.autopilot()) >= 1);
});

test('bài đã lên lịch nhưng kênh bị tắt: không đăng, báo 1 lần; bật lại thì đăng', async () => {
  const db = load();
  db.settings.dryRun = false;
  db.actions = [];
  db.posts = [
    { id: 'a', channel: 'instagram', brand: 'dark_hair', topic: 'Bài A', text: 'x', scheduledAt: new Date(Date.now() - 1000).toISOString(), status: 'scheduled' },
    { id: 'b', channel: 'facebook_page', brand: 'dark_hair', topic: 'Bài B', text: 'y', scheduledAt: new Date(Date.now() - 1000).toISOString(), status: 'scheduled' },
    { id: 'c', channel: 'instagram', topic: 'Bài lẻ không thương hiệu', text: 'z', scheduledAt: new Date(Date.now() - 1000).toISOString(), status: 'scheduled' },
  ];
  planner.updateBrand('dark_hair', { channels: { instagram: { on: true } } });
  planner.updateBrand('dark_hair', { channels: { instagram: { on: false } } });
  await engine.runAgent('content', 'manual');
  await engine.runAgent('content', 'manual');
  const st = Object.fromEntries(db.posts.map((p) => [p.id, p.status]));
  assert.deepStrictEqual(st, { a: 'scheduled', b: 'published', c: 'published' });
  assert.strictEqual(db.actions.filter((x) => /chưa đăng/.test(x.text)).length, 1, 'chỉ báo 1 lần');
  planner.updateBrand('dark_hair', { channels: { instagram: { on: true } } });
  await engine.runAgent('content', 'manual');
  assert.strictEqual(db.posts.find((p) => p.id === 'a').status, 'published');
  assert.strictEqual(db.posts.find((p) => p.id === 'a').skipReason, undefined);
});

test('API: thêm hồ sơ lái tự động cho kênh tắt hoặc kênh lạ bị từ chối', async () => {
  const { server } = require('../src/server');
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/api/autopilot/profiles`;
  const post = (b) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  planner.updateBrand('mishang', { channels: { instagram: { on: false } } });
  const r1 = await post({ ...base, brand: 'mishang', channel: 'instagram' });
  assert.strictEqual(r1.status, 400);
  assert.match((await r1.json()).error, /đang tắt/);
  assert.strictEqual((await post({ ...base, brand: 'mishang', channel: 'khong_co' })).status, 400);
  assert.strictEqual((await post({ ...base, brand: 'dark_hair', channel: 'facebook_page' })).status, 200);
  server.close();
});
