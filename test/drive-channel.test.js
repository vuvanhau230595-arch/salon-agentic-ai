const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-drvch-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
process.env.MEDIA_DIR = path.join(tmp, 'media');
delete process.env.META_ACCESS_TOKEN;
delete process.env.ANTHROPIC_API_KEY;
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const { load } = require('../src/db');
const media = require('../src/media');
const drive = require('../src/drive');
const planner = require('../src/planner');

const dir = path.join(tmp, 'media', 'the_one');
fs.mkdirSync(dir, { recursive: true });
const put = (name, tag) => { fs.writeFileSync(path.join(dir, name), Buffer.alloc(64, 1)); const db = load(); db.mediaInfo = db.mediaInfo || {}; db.mediaInfo[`the_one/${name}`] = tag ? { tags: [tag] } : {}; };
put('fb1.mp4', 'the-one'); put('fb2.mp4', 'the-one'); put('tay.mp4', '');
const tag = require('../src/media-lib').normTag;
put('tt1.mp4', tag('Tóc nam TikTok')); put('tt2.mp4', tag('Tóc nam TikTok'));

test('thư mục có chữ TikTok mặc định chỉ cho TikTok; TikTok chỉ lấy video thư mục đó, Facebook không lấy video TikTok', () => {
  const db = load();
  db.driveSync = { the_one: { on: true, files: {}, folders: [{ id: 'A', label: '', name: 'The One' }, { id: 'B', label: 'Tóc nam TikTok' }] } };
  const tt = media.assign('the_one', 'reel', 4, 'tiktok').flat().map((f) => f.name);
  assert.ok(tt.every((n) => n.startsWith('tt')), tt.join());
  const fb = media.assign('the_one', 'reel', 6, 'facebook_page').flat().map((f) => f.name);
  assert.ok(fb.every((n) => !n.startsWith('tt')), 'Facebook không lấy video của thư mục TikTok');
  assert.ok(fb.includes('tay.mp4'), 'file tải tay (không thuộc thư mục riêng) vẫn dùng chung');
  assert.deepStrictEqual(drive.dedicatedFolders('the_one', 'tiktok'), ['Tóc nam TikTok']);
});

test('đổi "Dùng cho" của thư mục; thư mục TikTok trống thì kế hoạch TikTok để trống video, không lấy video Facebook', async () => {
  drive.setSettings('the_one', { folder: 'A', channel: 'facebook_page' });
  assert.strictEqual(drive.status().brands.the_one.folders.find((f) => f.id === 'A').channel, 'facebook_page');
  const fb = media.assign('the_one', 'reel', 4, 'facebook_page').flat().map((f) => f.name);
  assert.ok(fb.every((n) => n.startsWith('fb')), 'Facebook có thư mục riêng: chỉ lấy thư mục đó');
  assert.throws(() => drive.setSettings('the_one', { folder: 'A', channel: 'zalo' }), /không hợp lệ/);
  drive.setSettings('the_one', { folder: 'B', channel: '' });
  assert.strictEqual(drive.mediaFilter('the_one', 'tiktok')({ tags: ['the-one'] }), false, 'thư mục Facebook vẫn dành riêng cho Facebook');
  drive.setSettings('the_one', { folder: 'B', channel: 'tiktok' });

  // Thư mục TikTok trống: kế hoạch TikTok không có video nào để lấy
  for (const n of ['tt1.mp4', 'tt2.mp4']) fs.rmSync(path.join(dir, n));
  planner.updateBrand('the_one', { channels: { tiktok: { on: true } } });
  const month = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 7);
  const pl = await planner.create({ brand: 'the_one', channel: 'tiktok', type: 'reel', time: '20:00', days: [2], month });
  assert.ok(pl.items.every((it) => !it.media.length), 'không lấy nhầm video Facebook');
  assert.ok(load().actions.some((a) => /thư mục Drive "Tóc nam TikTok" chưa có đủ/.test(a.text)));
});

test('Lái tự động: thư mục TikTok trống thì chờ, không soạn kế hoạch trống; báo 1 lần/ngày', async () => {
  const db = load();
  db.plans = []; db.actions = [];
  db.settings.autopilot = { on: true, draftDaysBefore: 5, autoApprove: false, profiles: [{ id: 'pfT', brand: 'the_one', channel: 'tiktok', type: 'reel', time: '20:00', days: [1, 2, 3, 4, 5, 6, 7], direction: '' }] };
  assert.strictEqual(await planner.autopilot(), 0);
  assert.strictEqual(await planner.autopilot(), 0);
  assert.strictEqual(db.plans.length, 0);
  assert.strictEqual(db.actions.filter((a) => /đang chờ video/.test(a.text)).length, 1);
  put('tt3.mp4', tag('Tóc nam TikTok'));
  assert.ok(await planner.autopilot() >= 1, 'có video thì soạn');
  assert.ok(db.plans[0].items.some((it) => it.media.some((m) => m.name === 'tt3.mp4')));
});
