const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
process.env.DB_FILE = path.join(os.tmpdir(), `agent-ag-test-${process.pid}.json`);
require('node:fs').rmSync(process.env.DB_FILE, { force: true });
delete process.env.META_ACCESS_TOKEN;

const { load } = require('../src/db');
const ai = require('../src/ai');
const engine = require('../src/engine');

test('tắt 1 agent: agent đó không chạy, các agent khác vẫn chạy', async () => {
  const db = load();
  db.comments.push({ id: 'demo_x', channel: 'facebook_page', author: 'A', text: 'giá?', status: 'new' });
  db.settings.agents.ads.on = false;
  await engine.scan('schedule');
  assert.deepStrictEqual(db.runs.map((r) => r.agent).sort(), ['comments', 'content', 'drive_sync', 'inbox', 'reporting']);
  assert.ok(db.runs.every((r) => r.trigger === 'schedule'));
  assert.strictEqual(db.campaigns.length, 0, 'agent quảng cáo tắt nên chưa kéo số liệu');
});

test('1 agent lỗi: ghi lịch sử lỗi, agent khác vẫn chạy', async () => {
  const db = load();
  db.runs = [];
  db.settings.agents.ads.on = true;
  db.comments.push({ id: 'demo_y', channel: 'facebook_page', author: 'B', text: 'ở đâu?', status: 'new' });
  const orig = ai.draftReply;
  ai.draftReply = async () => { throw new Error('hết hạn mức'); };
  try { await engine.scan('manual'); } finally { ai.draftReply = orig; }
  const byAgent = Object.fromEntries(db.runs.map((r) => [r.agent, r]));
  assert.match(byAgent.comments.error, /hết hạn mức/);
  assert.strictEqual(byAgent.ads.error, null);
  assert.ok(byAgent.ads.changed >= 1);
  assert.ok(byAgent.content);
});

test('dừng khẩn cấp: không agent nào chạy', async () => {
  const db = load();
  db.runs = [];
  db.settings.paused = true;
  assert.strictEqual((await engine.scan()).skipped, 'paused');
  assert.strictEqual(db.runs.length, 0);
});
