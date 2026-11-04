const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-auto-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
process.env.MEDIA_DIR = path.join(tmp, 'media');
delete process.env.APP_PASSWORD;
delete process.env.META_ACCESS_TOKEN;
delete process.env.ANTHROPIC_API_KEY;

const { load } = require('../src/db');
const { ads } = require('../src/connectors');
const planner = require('../src/planner');
const engine = require('../src/engine');
const { server } = require('../src/server');
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

let base;
const req = (method, p, body) => fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const camp = (o) => ({ status: 'ACTIVE', budget: 0, objective: 'OUTCOME_ENGAGEMENT', accountId: '11111', today: { spend: 0, msgs: 0 }, d7: { spend: 0, msgs: 0 }, month: { spend: 0, msgs: 0 }, ...o });

test('khởi động server thử', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  planner.updateBrand('the_one', { adAccountId: '11111' });
});

test('danh sách: đủ quy trình, mỗi cái có trigger, điều kiện, hành động, quyền; không tăng tiền tự động', async () => {
  const j = await (await req('GET', '/api/automations')).json();
  const ids = j.workflows.map((w) => w.id);
  assert.deepStrictEqual(ids, ['ads_highcpl', 'ads_noresult', 'ads_monthcap', 'ads_scaleup', 'ads_test_daily', 'ads_boost_organic', 'content_autopilot', 'content_publish', 'comments_draft', 'safety_autopause']);
  for (const w of j.workflows) {
    assert.ok(w.trigger && w.actions.length && w.permission.text, w.id);
    assert.ok(['auto', 'approval', 'alert'].includes(w.permission.mode), w.id);
  }
  // mọi quy trình đụng tới tiền/đăng bài/trả lời khách đều là "approval"
  for (const id of ['ads_scaleup', 'ads_test_daily', 'ads_boost_organic', 'content_autopilot', 'content_publish', 'comments_draft']) assert.strictEqual(j.workflows.find((w) => w.id === id).permission.mode, 'approval', id);
  // quy trình "auto" duy nhất là an toàn hệ thống; luật quảng cáo cũ chỉ cảnh báo (không tắt quảng cáo cũ)
  assert.deepStrictEqual(j.workflows.filter((w) => w.permission.mode === 'auto').map((w) => w.id), ['safety_autopause']);
  assert.deepStrictEqual(j.workflows.filter((w) => w.permission.mode === 'alert').map((w) => w.id), ['ads_highcpl', 'ads_noresult', 'ads_monthcap']);
  assert.strictEqual(j.mode, 'dry');
  const hc = j.workflows.find((w) => w.id === 'ads_highcpl');
  assert.deepStrictEqual(hc.conditions.map((c) => c.key), ['minSpend', 'maxCostPerMsg']);
});

test('bật/tắt và sửa điều kiện ghi đúng vào cài đặt thật, có kiểm tra khoảng và ghi nhật ký trước/sau', async () => {
  const db = load();
  db.actions = [];
  let r = await req('PUT', '/api/automations/ads_highcpl', { enabled: false, conditions: { maxCostPerMsg: 150000 } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(db.settings.rules.highCpl.on, false);
  assert.strictEqual(db.settings.rules.highCpl.maxCostPerMsg, 150000);
  const log = db.actions.filter((a) => a.kind === 'automation');
  assert.strictEqual(log.length, 2);
  assert.ok(log.every((a) => a.by === 'Sếp' && a.before !== undefined && a.after !== undefined && a.workflow === 'ads_highcpl'));
  await req('PUT', '/api/automations/ads_highcpl', { enabled: true });
  // sai đầu vào
  for (const [id, body] of [
    ['ads_highcpl', { conditions: { maxCostPerMsg: 10 } }], ['ads_highcpl', { conditions: { maxCostPerMsg: 'abc' } }], ['ads_highcpl', { conditions: { maxCostPerMsg: 150000.5 } }],
    ['ads_highcpl', { conditions: { khong_co: 1 } }], ['ads_highcpl', {}], ['ads_highcpl', { enabled: true }], // bật khi đã bật = không đổi
    ['ads_scaleup', { conditions: { pct: 500 } }], ['content_autopilot', { conditions: { draftDaysBefore: 0 } }], ['safety_autopause', { conditions: { after: 1 } }],
  ]) assert.strictEqual((await req('PUT', `/api/automations/${id}`, body)).status, 400, id + JSON.stringify(body));
  assert.strictEqual((await req('PUT', '/api/automations/khong-co', { enabled: true })).status, 404);
  // các công tắc trỏ đúng chỗ
  await req('PUT', '/api/automations/ads_test_daily', { enabled: true });
  assert.strictEqual(db.settings.adTest.on, true);
  await req('PUT', '/api/automations/ads_test_daily', { enabled: false });
  await req('PUT', '/api/automations/comments_draft', { enabled: false });
  assert.strictEqual(db.settings.agents.comments.on, false);
  await req('PUT', '/api/automations/comments_draft', { enabled: true });
  await req('PUT', '/api/automations/content_autopilot', { conditions: { autoApprove: true } });
  assert.strictEqual(db.settings.autopilot.autoApprove, true);
  await req('PUT', '/api/automations/content_autopilot', { conditions: { autoApprove: false } });
});

test('quy trình bị chặn thì "effective" = false và nêu lý do (agent tắt / dừng khẩn cấp)', async () => {
  const db = load();
  db.settings.agents.ads.on = false;
  let j = await (await req('GET', '/api/automations')).json();
  const w = j.workflows.find((x) => x.id === 'ads_highcpl');
  assert.strictEqual(w.enabled, true);
  assert.strictEqual(w.effective, false);
  assert.match(w.blocked, /đang tắt/);
  db.settings.agents.ads.on = true;
  db.settings.paused = true;
  j = await (await req('GET', '/api/automations')).json();
  assert.match(j.workflows[0].blocked, /dừng khẩn cấp/);
  db.settings.paused = false;
});

test('chạy thử an toàn và chạy thật: không tắt quảng cáo cũ trên Facebook', async () => {
  const db = load();
  db.settings.dryRun = false;
  db.settings.monthlyCap = 0;
  db.settings.rules.highCpl.maxCostPerMsg = 50000;
  let paused = [];
  ads.pause = async (id) => { paused.push(id); };
  const bad1 = () => [camp({ id: 'x1', name: 'BT-xau', today: { spend: 900000, msgs: 3 }, d7: { spend: 900000, msgs: 3 } })];
  ads.list = async () => bad1();
  db.actions = [];
  const r = await (await req('POST', '/api/automations/ads_highcpl/simulate')).json();
  assert.deepStrictEqual(paused, [], 'chạy thử an toàn không được tắt thật');
  assert.strictEqual(r.run.trigger, 'simulation');
  assert.strictEqual(r.relevant, 0, 'luật giá cao chỉ cảnh báo, không tạo thao tác tắt');
  assert.strictEqual(engine.isDry(), false, 'chạy xong thì trở lại chế độ thật');
  // chạy thật: vẫn không tắt quảng cáo cũ
  ads.list = async () => bad1();
  await engine.runAgent('ads', 'manual');
  assert.deepStrictEqual(paused, []);
  db.settings.dryRun = true;
  // dừng khẩn cấp thì không chạy thử được
  db.settings.paused = true;
  assert.strictEqual((await req('POST', '/api/automations/ads_highcpl/simulate')).status, 400);
  db.settings.paused = false;
  assert.strictEqual((await req('POST', '/api/automations/safety_autopause/simulate')).status, 400); // không có agent riêng
});

test('chạy thử an toàn không bị kẹt chế độ dry khi agent lỗi', async () => {
  const db = load();
  db.settings.dryRun = false;
  ads.list = async () => { throw new Error('Token hết hạn'); };
  const r = await (await req('POST', '/api/automations/ads_highcpl/simulate')).json();
  assert.match(r.run.error, /Token hết hạn/);
  assert.strictEqual(engine.isDry(), false);
  db.settings.dryRun = true;
});

test('tự tạm dừng: agent lỗi liên tiếp đủ số lần thì tự tắt; lần chạy thử an toàn không tính; thành công xen kẽ thì không tắt', async () => {
  const db = load();
  db.runs = []; db.actions = [];
  db.settings.agents.ads.on = true;
  db.settings.autoPause = { on: true, after: 3 };
  ads.list = async () => { throw new Error('Meta lỗi'); };
  await engine.runAgent('ads', 'schedule');
  await engine.runAgent('ads', 'schedule');
  await engine.simulate('ads'); // lần chạy thử: không tính
  assert.strictEqual(db.settings.agents.ads.on, true, 'mới 2 lần lỗi thật');
  await engine.runAgent('ads', 'schedule');
  assert.strictEqual(db.settings.agents.ads.on, false, 'đủ 3 lần lỗi liên tiếp → tự tắt');
  assert.ok(db.actions.some((a) => a.kind === 'error' && a.rule === 'autoPause' && /Tự tạm dừng/.test(a.text)));
  const w = (await (await req('GET', '/api/automations')).json()).workflows.find((x) => x.id === 'ads_highcpl');
  assert.strictEqual(w.effective, false);
  assert.ok(w.errors24h >= 3);
  // xen kẽ 1 lần thành công thì không tắt
  db.settings.agents.ads.on = true; db.runs = [];
  await engine.runAgent('ads', 'schedule');
  ads.list = async () => [];
  await engine.runAgent('ads', 'schedule');
  ads.list = async () => { throw new Error('lỗi'); };
  await engine.runAgent('ads', 'schedule');
  await engine.runAgent('ads', 'schedule');
  assert.strictEqual(db.settings.agents.ads.on, true);
  // tắt tính năng thì không tự tắt agent
  db.settings.autoPause.on = false;
  await engine.runAgent('ads', 'schedule');
  assert.strictEqual(db.settings.agents.ads.on, true);
  db.settings.autoPause.on = true;
});

test('lịch sử: các lần chạy của agent, nhật ký riêng của quy trình, lỗi', async () => {
  const db = load();
  db.runs = []; db.actions = [];
  db.settings.agents.ads.on = true;
  ads.list = async () => [camp({ id: 'h1', name: 'BT-xau', today: { spend: 900000, msgs: 3 }, d7: { spend: 900000, msgs: 3 } })];
  db.settings.dryRun = true;
  await engine.runAgent('ads', 'manual');
  const h = await (await req('GET', '/api/automations/ads_highcpl/history')).json();
  assert.strictEqual(h.runs.length, 1);
  assert.strictEqual(h.runs[0].trigger, 'manual');
  assert.strictEqual(h.actions.length, 0, 'không tắt quảng cáo cũ');
  const j = await (await req('GET', '/api/automations')).json();
  assert.strictEqual(j.workflows.find((w) => w.id === 'ads_highcpl').activity24h, 0);
  assert.strictEqual(j.workflows.find((w) => w.id === 'ads_noresult').activity24h, 0);
  assert.strictEqual((await req('GET', '/api/automations/khong-co/history')).status, 404);
});
