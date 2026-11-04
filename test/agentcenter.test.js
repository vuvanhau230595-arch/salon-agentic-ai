const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-center-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
process.env.MEDIA_DIR = path.join(tmp, 'media');
delete process.env.APP_PASSWORD;
delete process.env.META_ACCESS_TOKEN;
delete process.env.ANTHROPIC_API_KEY;

const { load } = require('../src/db');
const { ads } = require('../src/connectors');
const planner = require('../src/planner');
const engine = require('../src/engine');
const usage = require('../src/usage');
const reports = require('../src/reports');
const { server } = require('../src/server');
const realFetch = global.fetch;
test.after(() => { global.fetch = realFetch; server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

let base;
const req = (method, p, body) => realFetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const camp = (o) => ({ status: 'ACTIVE', budget: 0, objective: 'OUTCOME_ENGAGEMENT', accountId: '11111', today: { spend: 0, msgs: 0 }, d7: { spend: 0, msgs: 0 }, month: { spend: 0, msgs: 0 }, ...o });
const stubAnthropic = (reply = 'Dạ cảm ơn chị ạ', usageObj = { input_tokens: 100, output_tokens: 20 }) => {
  global.fetch = (u, o) => (String(u).includes('anthropic.com')
    ? Promise.resolve({ json: async () => ({ content: [{ text: reply }], usage: usageObj, model: 'claude-test' }) })
    : realFetch(u, o));
};

test('khởi động server thử', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  planner.updateBrand('the_one', { adAccountId: '11111' });
  planner.updateBrand('dark_hair', { adAccountId: '11111' });
});

test('danh sách agent: 4 agent chạy thật + 3 agent "chưa khả dụng" có lý do; mỗi agent có mục tiêu, quyền, công cụ', async () => {
  const j = await (await req('GET', '/api/agent-center')).json();
  assert.deepStrictEqual(j.agents.map((a) => a.id), ['content', 'ads', 'comments', 'reporting', 'planning', 'insights', 'brandquality']);
  const real = j.agents.filter((a) => a.available), none = j.agents.filter((a) => !a.available);
  assert.deepStrictEqual(real.map((a) => a.id), ['content', 'ads', 'comments', 'reporting']);
  for (const a of real) { assert.ok(a.goal && a.reads.length && a.writes.length && a.never.length && a.tools.length, a.id); assert.ok(['on', 'off', 'running', 'paused_all', 'autopaused'].includes(a.status.code)); }
  for (const a of none) { assert.strictEqual(a.status.code, 'unavailable'); assert.ok(a.unavailable.length > 40, a.id); assert.strictEqual(a.runs24h, undefined); }
  assert.match(none.find((a) => a.id === 'insights').unavailable, /pages_messaging/);
  assert.ok(real.find((a) => a.id === 'ads').never.some((x) => /tăng ngân sách/.test(x)));
  assert.deepStrictEqual(real.find((a) => a.id === 'ads').workflows.map((w) => w.id), ['ads_highcpl', 'ads_noresult', 'ads_monthcap', 'ads_scaleup', 'ads_test_daily', 'ads_boost_organic']);
  assert.strictEqual((await req('GET', '/api/agent-center/khong-co')).status, 404);
});

test('trạng thái: bật, tắt, tự tạm dừng do lỗi, dừng khẩn cấp, đang chạy; bật lại xoá dấu tự tạm dừng', async () => {
  const db = load();
  const st = async (id) => (await (await req('GET', `/api/agent-center/${id}`)).json()).status.code;
  assert.strictEqual(await st('ads'), 'on');
  await req('POST', '/api/agents/ads/toggle', { on: false });
  assert.strictEqual(await st('ads'), 'off');
  // tự tạm dừng
  db.settings.agents.ads.on = true; db.runs = [];
  ads.list = async () => { throw new Error('Token hết hạn'); };
  for (let i = 0; i < 3; i++) await engine.runAgent('ads', 'schedule');
  assert.strictEqual(await st('ads'), 'autopaused');
  assert.ok(db.settings.agents.ads.autoPaused);
  await req('POST', '/api/agents/ads/toggle', { on: true });
  assert.strictEqual(await st('ads'), 'on');
  assert.strictEqual(db.settings.agents.ads.autoPaused, undefined);
  // dừng khẩn cấp
  db.settings.paused = true;
  assert.strictEqual(await st('ads'), 'paused_all');
  db.settings.paused = false;
  // đang chạy
  let release;
  ads.list = () => new Promise((r) => { release = () => r([]); });
  const p = engine.runAgent('ads', 'manual');
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(await st('ads'), 'running');
  assert.ok((await (await req('GET', '/api/tasks')).json()).runningNow.ads);
  release();
  await p;
  assert.strictEqual(await st('ads'), 'on');
  assert.deepStrictEqual(engine.runningAgents(), {});
});

test('chi tiết agent: lịch sử chạy, việc chờ duyệt, hành động gần đây, AI theo ngày', async () => {
  const db = load();
  db.runs = []; db.actions = []; db.approvals = [];
  db.settings.dryRun = true;
  ads.list = async () => [camp({ id: 'x1', name: 'BT-xau', today: { spend: 900000, msgs: 3 }, d7: { spend: 900000, msgs: 3 } })];
  db.settings.rules.highCpl.maxCostPerMsg = 50000;
  await engine.runAgent('ads', 'manual');
  db.approvals.push({ id: 'ap1', type: 'budget_increase', status: 'pending', at: new Date().toISOString(), title: 'Tăng', detail: 'x', payload: { campaignId: 'x1', from: 1, to: 2 } });
  db.approvals.push({ id: 'ap2', type: 'post_publish', status: 'pending', at: new Date().toISOString(), title: 'Bài', detail: 'x', payload: { postId: 'zz' } });
  const d = await (await req('GET', '/api/agent-center/ads')).json();
  assert.strictEqual(d.runs.length, 1);
  assert.strictEqual(d.pendingApprovals, 1, 'chỉ tính mục duyệt do agent quảng cáo tạo');
  assert.deepStrictEqual(d.pending.map((x) => x.id), ['ap1']);
  assert.ok(!d.recentActions.some((a) => /Tắt BT-xau/.test(a.text)), 'không tắt quảng cáo cũ');
  assert.strictEqual(d.aiUsageByDay.length, 14);
  const list = await (await req('GET', '/api/agent-center')).json();
  assert.strictEqual(list.agents.find((a) => a.id === 'content').pendingApprovals, 1);
});

test('tác vụ: lọc theo agent/kết quả/kiểu chạy, phân trang, tổng số', async () => {
  const db = load();
  db.runs = [];
  const mk = (i, agent, error, trigger) => ({ id: 'r' + i, agent, trigger, at: new Date(Date.now() - i * 1000).toISOString(), ms: 5, changed: i, error });
  for (let i = 0; i < 12; i++) db.runs.push(mk(i, i % 2 ? 'ads' : 'content', i % 4 === 1 ? 'lỗi' : null, i === 3 ? 'simulation' : 'schedule'));
  let j = await (await req('GET', '/api/tasks?limit=5')).json();
  assert.strictEqual(j.total, 12);
  assert.strictEqual(j.rows.length, 5);
  j = await (await req('GET', '/api/tasks?limit=5&offset=10')).json();
  assert.strictEqual(j.rows.length, 2);
  j = await (await req('GET', '/api/tasks?agent=ads')).json();
  assert.ok(j.rows.every((r) => r.agent === 'ads') && j.total === 6);
  assert.ok(j.rows[0].agentName);
  j = await (await req('GET', '/api/tasks?status=error')).json();
  assert.ok(j.rows.every((r) => r.error));
  j = await (await req('GET', '/api/tasks?trigger=simulation')).json();
  assert.strictEqual(j.total, 1);
  j = await (await req('GET', '/api/tasks?limit=9999')).json();
  assert.ok(j.rows.length <= 100);
});

test('chạy thử an toàn qua trung tâm agent: chặn agent chưa có, agent chỉ đọc, dừng khẩn cấp', async () => {
  const db = load();
  assert.strictEqual((await req('POST', '/api/agent-center/planning/simulate')).status, 400);
  assert.strictEqual((await req('POST', '/api/agent-center/reporting/simulate')).status, 400);
  assert.strictEqual((await req('POST', '/api/agent-center/khong-co/simulate')).status, 404);
  db.settings.paused = true;
  assert.strictEqual((await req('POST', '/api/agent-center/ads/simulate')).status, 400);
  db.settings.paused = false;
  db.settings.dryRun = false;
  let paused = 0;
  ads.pause = async () => { paused++; };
  ads.list = async () => [camp({ id: 'x2', name: 'BT-xau', today: { spend: 900000, msgs: 3 }, d7: { spend: 900000, msgs: 3 } })];
  const r = await (await req('POST', '/api/agent-center/ads/simulate')).json();
  assert.strictEqual(paused, 0);
  assert.strictEqual(r.run.trigger, 'simulation');
  db.settings.dryRun = true;
});

test('lượng AI: tính đúng agent đang chạy; ngoài agent tính "ui"; chỉ lưu số lượng, không lưu nội dung', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  stubAnthropic('Dạ cảm ơn chị ạ', { input_tokens: 120, output_tokens: 30 });
  const db = load();
  db.aiUsage = {}; db.runs = []; db.comments = [{ id: 'cu1', channel: 'facebook_page', author: 'A', text: 'giá nhuộm bao nhiêu', status: 'new' }];
  await engine.runAgent('comments', 'manual');
  const ai = require('../src/ai');
  await ai.draftReply('bí mật của khách'); // ngoài agent
  const t = usage.totals(1);
  assert.deepStrictEqual(t.comments, { calls: 1, in: 120, out: 30 });
  assert.deepStrictEqual(t.ui, { calls: 1, in: 120, out: 30 });
  assert.ok(!JSON.stringify(db.aiUsage).includes('bí mật'), 'không lưu nội dung');
  const d = await (await realFetch(base + '/api/agent-center/comments')).json();
  assert.strictEqual(d.aiUsage7d.calls, 1);
  assert.strictEqual(d.aiUsageByDay.at(-1).in, 120);
  global.fetch = realFetch; delete process.env.ANTHROPIC_API_KEY;
});

test('báo cáo: tổng hợp số thật theo thương hiệu, có nguồn và khoảng thời gian, đề xuất dựa trên ngưỡng', async () => {
  const db = load();
  db.reports = []; db.posts = []; db.approvals = []; db.adTests = []; db.actions = [];
  const had = ads.mode;
  ads.mode = 'live';
  db.settings.rules.highCpl.maxCostPerMsg = 200000;
  db.campaigns = [
    camp({ id: 'g1', name: 'BT-tot', d7: { spend: 2000000, msgs: 40 } }),                  // 50.000/tin ≤ 100.000 → đề xuất tăng
    camp({ id: 'g2', name: 'BT-xau', d7: { spend: 3000000, msgs: 10 } }),                  // 300.000/tin > 200.000 → đề xuất xem xét
    camp({ id: 'g3', name: 'DH-vua', d7: { spend: 1500000, msgs: 15 } }),
    camp({ id: 'g4', name: 'DH-ít-dữ-liệu', d7: { spend: 100000, msgs: 2 } }),
  ];
  db.posts.push({ id: 'rp1', brand: 'the_one', channel: 'facebook_page', status: 'published', scheduledAt: new Date().toISOString(), text: 'x' });
  const rep = reports.create('week');
  assert.match(rep.range.label, /7 ngày qua/);
  assert.strictEqual(rep.data.perBrand.the_one.spend, 5000000);
  assert.strictEqual(rep.data.perBrand.the_one.msgs, 50);
  assert.strictEqual(rep.data.perBrand.the_one.cpl, 100000);
  assert.strictEqual(rep.data.perBrand.the_one.postsPublished, 1);
  assert.strictEqual(rep.data.perBrand.dark_hair.spend, 1600000);
  assert.deepStrictEqual(rep.data.best.map((c) => c.id), ['g1', 'g3', 'g2']);
  assert.ok(!rep.data.best.some((c) => c.id === 'g4'), 'chiến dịch ít dữ liệu không được xếp hạng');
  assert.match(rep.text, /Nguồn: số liệu quảng cáo Meta/);
  assert.match(rep.text, /The One Hair Salon: chi 5\.000\.000đ, 50 tin nhắn, 100\.000đ\/tin/);
  assert.ok(rep.suggestions.some((x) => /Cân nhắc tăng ngân sách "BT-tot"/.test(x)));
  assert.ok(rep.suggestions.some((x) => /Xem xét tắt hoặc sửa "BT-xau"/.test(x)));
  assert.match(rep.text, /hệ thống không tự làm/);
  ads.mode = had;
});

test('báo cáo ở chế độ mẫu có cảnh báo "không phải số liệu thật"', () => {
  const rep = reports.create('month');
  assert.match(rep.text, /KHÔNG phải số liệu thật/);
  assert.match(rep.range.label, /^Tháng \d+\/\d{4}/);
});

test('Agent Báo cáo: chạy theo lịch chỉ tạo 1 báo cáo mỗi tuần; chạy tay luôn tạo mới; chạy thử an toàn không ghi ra ngoài', async () => {
  const db = load();
  db.reports = []; db.runs = [];
  assert.strictEqual(reports.runAgent('schedule'), 1);
  assert.strictEqual(reports.runAgent('schedule'), 0, 'đã có báo cáo tuần này');
  assert.strictEqual(reports.runAgent('schedule', Date.now() + 8 * 864e5), 1, 'tuần sau tạo tiếp');
  assert.strictEqual(reports.runAgent('manual'), 1);
  assert.strictEqual(db.reports.length, 3);
  const j = await (await req('GET', '/api/reports')).json();
  assert.strictEqual(j.reports.length, 3);
  const one = await (await req('GET', `/api/reports/${j.reports[0].id}`)).json();
  assert.ok(one.text && one.data);
  assert.strictEqual((await req('GET', '/api/reports/khong-co')).status, 404);
  assert.strictEqual((await req('POST', '/api/reports', { period: 'year' })).status, 400);
  assert.strictEqual((await req('POST', '/api/reports', { period: 'month' })).status, 200);
  // agent chạy qua engine ghi lịch sử
  const run = await engine.runAgent('reporting', 'manual');
  assert.strictEqual(run.error, null);
  assert.strictEqual(run.changed, 1);
});

test('nhận xét AI cho báo cáo: cần khoá AI; có khoá thì lưu và tính vào agent báo cáo', async () => {
  const db = load();
  const id = db.reports[0].id;
  let r = await req('POST', `/api/reports/${id}/ai`);
  assert.strictEqual(r.status, 400);
  assert.match((await r.json()).error, /ANTHROPIC_API_KEY/);
  process.env.ANTHROPIC_API_KEY = 'test-key';
  stubAnthropic('- Điểm đáng chú ý: ok', { input_tokens: 500, output_tokens: 80 });
  db.aiUsage = {};
  r = await req('POST', `/api/reports/${id}/ai`);
  assert.strictEqual(r.status, 200);
  assert.match((await r.json()).aiText, /Điểm đáng chú ý/);
  assert.deepStrictEqual(usage.totals(1).reporting, { calls: 1, in: 500, out: 80 });
  assert.strictEqual((await req('POST', '/api/reports/khong-co/ai')).status, 404);
  global.fetch = realFetch; delete process.env.ANTHROPIC_API_KEY;
});
