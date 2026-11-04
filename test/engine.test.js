const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
process.env.DB_FILE = path.join(os.tmpdir(), `agent-test-${process.pid}.json`);
require('node:fs').rmSync(process.env.DB_FILE, { force: true });
delete process.env.META_ACCESS_TOKEN;

const { load } = require('../src/db');
const { ads } = require('../src/connectors');
const engine = require('../src/engine');

test('chạy thử: không tắt quảng cáo cũ, đề xuất tăng tiền chờ duyệt', async () => {
  load().settings.rules.highCpl.maxCostPerMsg = 50000; // dữ liệu mẫu cần ngưỡng chặt
  await engine.scan();
  const db = load();
  assert.ok(db.campaigns.every((c) => c.status === 'ACTIVE'));
  assert.strictEqual(db.actions.filter((a) => a.kind === 'pause').length, 0, 'agent không được tắt quảng cáo cũ');
  const inc = db.approvals.filter((a) => a.type === 'budget_increase');
  assert.strictEqual(inc.length, 1);
  assert.deepStrictEqual(inc[0].payload, { campaignId: 'c3', from: 300000, to: 360000 });
});

test('chạy thật: KHÔNG tắt quảng cáo cũ dù giá cao, không tự tăng ngân sách', async () => {
  const db = load();
  db.settings.dryRun = false;
  db.actions = []; db.approvals = [];
  await engine.scan();
  assert.strictEqual(db.campaigns.find((c) => c.id === 'c1').status, 'ACTIVE');
  assert.strictEqual(db.campaigns.find((c) => c.id === 'c2').status, 'ACTIVE');
  assert.strictEqual(db.campaigns.find((c) => c.id === 'c3').budget, 300000);
  // duyệt thì mới tăng
  const a = db.approvals.find((x) => x.type === 'budget_increase');
  await engine.decide(a.id, true);
  assert.strictEqual(db.campaigns.find((c) => c.id === 'c3').budget, 360000);
});

test('chạm trần tháng: chỉ báo, không tắt quảng cáo cũ; dừng khẩn cấp: không làm gì', async () => {
  const db = load();
  await ads.reset();
  db.settings.monthlyCap = 500000;
  await engine.scan();
  assert.ok(db.campaigns.every((c) => c.status === 'ACTIVE'));
  assert.ok(db.actions.some((a) => a.rule === 'monthCap' && /KHÔNG tắt/.test(a.text)));
  await ads.reset();
  db.settings.paused = true;
  const r = await engine.scan();
  assert.strictEqual(r.skipped, 'paused');
  assert.ok(db.campaigns.every((c) => c.status === 'ACTIVE'));
});
