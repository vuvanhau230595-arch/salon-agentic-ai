const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
process.env.DB_FILE = path.join(os.tmpdir(), `agent-ap-test-${process.pid}.json`);
require('node:fs').rmSync(process.env.DB_FILE, { force: true });
delete process.env.ANTHROPIC_API_KEY;
delete process.env.META_ACCESS_TOKEN;

const { load } = require('../src/db');
const planner = require('../src/planner');

const profile = { id: 'pf1', brand: 'the_one', channel: 'facebook_page', type: 'post', time: '19:00', days: [1, 3, 5], direction: '' };

test('tắt thì không làm gì', async () => {
  const db = load();
  db.settings.autopilot = { on: false, draftDaysBefore: 28, autoApprove: false, profiles: [profile] };
  assert.strictEqual(await planner.autopilot(), 0);
  assert.strictEqual(db.plans.length, 0);
});

test('bật: soạn kế hoạch chờ duyệt, không soạn trùng', async () => {
  const db = load();
  db.settings.autopilot.on = true;
  const n = await planner.autopilot();
  assert.ok(n >= 1);
  assert.ok(db.plans.every((p) => p.status === 'pending'));
  assert.strictEqual(db.posts.length, 0, 'chưa duyệt thì chưa có bài lên lịch');
  assert.strictEqual(await planner.autopilot(), 0, 'chạy lại không tạo trùng');
});

test('tự duyệt: bài lên lịch ngay; dừng khẩn cấp thì không chạy', async () => {
  const db = load();
  db.plans = [];
  db.settings.autopilot.autoApprove = true;
  db.settings.paused = true;
  assert.strictEqual(await planner.autopilot(), 0);
  db.settings.paused = false;
  assert.ok((await planner.autopilot()) >= 1);
  assert.ok(db.plans.every((p) => p.status === 'approved'));
  assert.ok(db.posts.length >= 1 && db.posts.every((p) => p.status === 'scheduled'));
});

test('địa chỉ thương hiệu chỉnh trong cài đặt được chèn vào bài', async () => {
  const db = load();
  db.plans = []; db.posts = [];
  db.settings.brands.dark_hair = { name: 'Dark Hair', address: '1 Đường Thử' };
  const plan = await planner.create({ ...profile, brand: 'dark_hair', month: new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 7) });
  assert.ok(plan.items[0].text.includes('1 Đường Thử'));
});
