const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mp-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
process.env.MEDIA_DIR = path.join(tmp, 'media');
delete process.env.APP_PASSWORD;
delete process.env.META_ACCESS_TOKEN;
delete process.env.ANTHROPIC_API_KEY;

const { load } = require('../src/db');
const planner = require('../src/planner');
const mp = require('../src/monthplan');
const { server } = require('../src/server');
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const cur = mp.vnMonth();
const [y, m] = cur.split('-').map(Number);
const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
let base;
const req = (method, p, body) => fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const camp = (o) => ({ status: 'ACTIVE', budget: 0, objective: 'OUTCOME_ENGAGEMENT', accountId: '11111', today: { spend: 0, msgs: 0 }, d7: { spend: 0, msgs: 0 }, month: { spend: 0, msgs: 0 }, ...o });

test('khởi động server thử', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  planner.updateBrand('the_one', { adAccountId: '11111' });
  planner.updateBrand('dark_hair', { adAccountId: '11111' });
});

test('tháng chưa có kế hoạch: trả khung rỗng cho cả 3 thương hiệu; tháng sai định dạng bị từ chối', async () => {
  const j = await (await req('GET', `/api/month-plan?month=${cur}`)).json();
  assert.deepStrictEqual(Object.keys(j.brands), ['the_one', 'dark_hair', 'mishang']);
  assert.deepStrictEqual(j.brands.the_one.plan.goals, []);
  assert.strictEqual(j.brands.the_one.progress.goals, 0);
  assert.strictEqual((await req('GET', '/api/month-plan?month=2026-13')).status, 400);
  assert.strictEqual((await req('GET', '/api/month-plan?month=abc')).status, 400);
});

test('lưu kế hoạch: làm sạch, gán id, từng phần độc lập; kiểm tra đầu vào', async () => {
  const url = `/api/month-plan/${cur}/the_one`;
  let r = await req('PUT', url, { goals: [{ text: '  Tăng khách mới Bình Thạnh ' }, { text: 'Ra mắt gói phục hồi', done: true }], notes: 'Ghi chú' });
  assert.strictEqual(r.status, 200);
  let j = await r.json();
  assert.strictEqual(j.plan.goals[0].text, 'Tăng khách mới Bình Thạnh');
  assert.ok(j.plan.goals[0].id);
  assert.strictEqual(j.progress.goalsDone, 1);
  // gửi phần khác không làm mất phần cũ
  r = await req('PUT', url, { tasks: [{ title: 'Quay video', owner: 'Thư', due: `${cur}-20`, status: 'doing' }] });
  j = await r.json();
  assert.strictEqual(j.plan.goals.length, 2);
  assert.strictEqual(j.plan.notes, 'Ghi chú');
  assert.strictEqual(j.plan.tasks[0].status, 'doing');
  // sai đầu vào
  for (const body of [
    {}, { goals: 'x' }, { goals: [{ text: '' }] }, { kpis: [{ name: 'a', metric: 'khong-co', target: 1 }] }, { kpis: [{ name: 'a', metric: 'msgs', target: -5 }] },
    { budget: { total: 'abc' } }, { promos: [{ name: 'KM', from: '2026-10-10', to: '2026-10-01' }] }, { promos: [{ name: 'KM', from: 'xx', to: '2026-10-01' }] },
    { tasks: [{ title: 'a', due: '31/10' }] }, { goals: Array.from({ length: 21 }, () => ({ text: 'x' })) },
  ]) assert.strictEqual((await req('PUT', url, body)).status, 400, JSON.stringify(body).slice(0, 60));
  assert.strictEqual((await req('PUT', `/api/month-plan/${cur}/khong-co`, { notes: 'x' })).status, 404);
  assert.strictEqual((await req('PUT', `/api/month-plan/2026-99/the_one`, { notes: 'x' })).status, 400);
});

test('KPI tự động lấy số thật: chi tiêu, tin nhắn, giá/tin (tháng hiện tại), bài đã đăng; KPI nhập tay', async () => {
  const db = load();
  db.campaigns = [
    camp({ id: 'a', name: 'BT-1', month: { spend: 6000000, msgs: 60 }, budget: 300000, budgetTotal: 300000 }),
    camp({ id: 'b', name: 'BT-2', month: { spend: 4000000, msgs: 40 } }),
    camp({ id: 'c', name: 'DH-1', month: { spend: 9000000, msgs: 30 } }),
    camp({ id: 'd', name: 'BT-cu', status: 'PAUSED', stale: true, month: { spend: 999, msgs: 9 } }), // số cũ: không tính
  ];
  const day = 864e5;
  db.posts = [
    { id: 'p1', brand: 'the_one', channel: 'facebook_page', status: 'published', scheduledAt: new Date().toISOString(), text: 'x' },
    { id: 'p2', brand: 'the_one', channel: 'facebook_page', status: 'scheduled', scheduledAt: new Date().toISOString(), text: 'x' },
    { id: 'p3', brand: 'the_one', channel: 'facebook_page', status: 'cancelled', scheduledAt: new Date().toISOString(), text: 'x' },
    { id: 'p4', brand: 'dark_hair', channel: 'facebook_page', status: 'published', scheduledAt: new Date(Date.now() - 80 * day).toISOString(), text: 'x' },
  ];
  const r = await req('PUT', `/api/month-plan/${cur}/the_one`, {
    kpis: [
      { name: 'Chi tiêu', metric: 'spend', target: 10000000 }, { name: 'Tin nhắn', metric: 'msgs', target: 100 }, { name: 'Giá/tin', metric: 'cpl', target: 120000 },
      { name: 'Giá/tin chặt', metric: 'cpl', target: 50000 }, { name: 'Bài đăng', metric: 'posts', target: 20 }, { name: 'Khách mới', metric: 'manual', target: 50, actual: 20, unit: 'người' },
      { name: 'Hủy lịch', metric: 'manual', target: 5, actual: 3, direction: 'down' },
    ],
    budget: { total: 12000000, items: [{ name: 'Facebook Ads', amount: 10000000, auto: 'meta_ads' }, { name: 'Quay chụp', amount: 2000000 }] },
  });
  const j = await r.json();
  assert.deepStrictEqual({ spend: j.actuals.spend, msgs: j.actuals.msgs, cpl: j.actuals.cpl, active: j.actuals.activeCampaigns }, { spend: 10000000, msgs: 100, cpl: 100000, active: 2 });
  assert.deepStrictEqual(j.actuals.posts, { planned: 2, published: 1, scheduled: 1, draft: 0, failed: 0 });
  const k = Object.fromEntries(j.plan.kpis.map((x) => [x.name, x]));
  assert.strictEqual(k['Chi tiêu'].actual, 10000000);
  assert.strictEqual(k['Chi tiêu'].pct, 100);
  assert.strictEqual(k['Chi tiêu'].status, 'ok');
  assert.strictEqual(k['Giá/tin'].status, 'ok'); // 100.000 ≤ 120.000
  assert.strictEqual(k['Giá/tin chặt'].status, 'bad'); // 100.000 vượt 120% của 50.000
  assert.strictEqual(k['Bài đăng'].actual, 1);
  assert.strictEqual(k['Khách mới'].pct, 40);
  assert.strictEqual(j.plan.budget.items[0].actual, 10000000); // hạng mục Facebook Ads lấy chi tiêu thật
  assert.strictEqual(j.plan.budget.items[1].actual, null);
  assert.strictEqual(j.progress.budgetUsedPct, 83);
  // thương hiệu khác không lẫn số liệu
  const d = await (await req('GET', `/api/month-plan?month=${cur}`)).json();
  assert.strictEqual(d.brands.dark_hair.actuals.spend, 9000000);
  assert.strictEqual(d.brands.mishang.actuals.spend, 0);
});

test('tháng khác tháng hiện tại: không có số liệu quảng cáo (null, không bịa); KPI ads ở trạng thái "none"', async () => {
  await req('PUT', `/api/month-plan/${prev}/the_one`, { kpis: [{ name: 'Tin nhắn', metric: 'msgs', target: 100 }] });
  const j = await (await req('GET', `/api/month-plan?month=${prev}`)).json();
  assert.strictEqual(j.brands.the_one.actuals.adsAvailable, false);
  assert.strictEqual(j.brands.the_one.actuals.msgs, null);
  assert.strictEqual(j.brands.the_one.plan.kpis[0].status, 'none');
  assert.strictEqual(j.elapsed, 1);
});

test('đánh giá KPI theo tiến độ thời gian của tháng', () => {
  const act = { posts: { published: 0 }, spend: 0, msgs: 40, cpl: null };
  const k = { metric: 'msgs', target: 100 };
  assert.strictEqual(mp.evalKpi(k, act, 0.5).status, 'warn'); // 40% khi lẽ ra 50%: 40 ≥ 45? không; ≥ 30 → warn
  assert.strictEqual(mp.evalKpi({ metric: 'msgs', target: 100 }, { ...act, msgs: 48 }, 0.5).status, 'ok');
  assert.strictEqual(mp.evalKpi(k, { ...act, msgs: 10 }, 0.5).status, 'bad');
  assert.strictEqual(mp.evalKpi(k, { ...act, msgs: 100 }, 0.1).status, 'ok');
  assert.strictEqual(mp.evalKpi({ metric: 'msgs', target: 0 }, act, 0.5).status, 'none');
  assert.strictEqual(mp.elapsed('2999-01'), 0);
  assert.strictEqual(mp.elapsed('2000-01'), 1);
});

test('Kanban: đổi cột công việc, từ chối trạng thái sai/không có; ghi nhật ký trước-sau', async () => {
  const db = load();
  const j = await (await req('GET', `/api/month-plan?month=${cur}`)).json();
  const task = j.brands.the_one.plan.tasks[0];
  let r = await req('POST', `/api/month-plan/${cur}/the_one/tasks/${task.id}`, { status: 'done' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await r.json()).progress.tasksDone, 1);
  assert.ok(db.actions.some((a) => a.kind === 'monthplan' && a.before === 'doing' && a.after === 'done'));
  assert.strictEqual((await req('POST', `/api/month-plan/${cur}/the_one/tasks/${task.id}`, { status: 'done' })).status, 400);
  assert.strictEqual((await req('POST', `/api/month-plan/${cur}/the_one/tasks/${task.id}`, { status: 'xoa' })).status, 400);
  assert.strictEqual((await req('POST', `/api/month-plan/${cur}/the_one/tasks/khong-co`, { status: 'todo' })).status, 404);
});

test('công việc quá hạn được đếm; công việc đã xong thì không', async () => {
  await req('PUT', `/api/month-plan/${cur}/dark_hair`, { tasks: [{ title: 'Trễ', due: '2000-01-01', status: 'todo' }, { title: 'Trễ nhưng xong', due: '2000-01-01', status: 'done' }, { title: 'Chưa hạn', due: '2999-01-01' }] });
  const j = await (await req('GET', `/api/month-plan?month=${cur}`)).json();
  assert.strictEqual(j.brands.dark_hair.progress.tasksOverdue, 1);
});

test('sao chép khung từ tháng khác: giữ mục tiêu/KPI/ngân sách, đặt lại tiến độ; không ghi đè kế hoạch đã có', async () => {
  const src = `/api/month-plan/${cur}/the_one`;
  const dstMonth = '2999-02';
  let r = await req('POST', `/api/month-plan/${dstMonth}/the_one/copy`, { from: cur });
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.strictEqual(j.plan.goals.length, 2);
  assert.ok(j.plan.goals.every((g) => g.done === false));
  assert.strictEqual(j.plan.kpis.find((k) => k.name === 'Khách mới').actual, null);
  assert.strictEqual(j.plan.budget.total, 12000000);
  assert.strictEqual(j.plan.tasks.length, 0);
  assert.strictEqual((await req('POST', `/api/month-plan/${dstMonth}/the_one/copy`, { from: cur })).status, 400); // đã có kế hoạch
  assert.strictEqual((await req('POST', `/api/month-plan/${dstMonth}/dark_hair/copy`, { from: '2999-03' })).status, 400); // nguồn rỗng
  assert.strictEqual((await req('POST', `${src}/copy`, { from: cur })).status, 400); // cùng tháng
});

test('tự đề xuất kế hoạch tháng: thương hiệu chưa có kế hoạch được đề xuất 1 lần, duyệt thì ghi vào chỗ trống', () => {
  const { load } = require('../src/db');
  const mp = require('../src/monthplan');
  const engine = require('../src/engine');
  const db = load();
  db.approvals.length = 0;
  const month = '2031-03';
  const now = new Date('2031-03-25T03:00:00Z').getTime();
  db.monthPlans = {};
  const n = mp.propose(now);
  assert.ok(n >= 3);
  const a = db.approvals.find((x) => x.type === 'month_plan' && x.key === `${month}/dark_hair`);
  assert.ok(a && a.payload.plan.kpis.length >= 2);
  assert.ok(db.approvals.some((x) => x.key === '2031-04/dark_hair')); // từ ngày 20 đề xuất cả tháng sau
  assert.strictEqual(mp.propose(now), 0); // không lặp lại
  db.monthPlans[month] = { dark_hair: { goals: [{ id: 'g1', text: 'Mục tiêu của Sếp', done: false }], kpis: [], budget: { total: 0, items: [] }, promos: [], tasks: [], notes: '', updatedAt: null } };
  mp.applyProposal(a);
  const p = db.monthPlans[month].dark_hair;
  assert.strictEqual(p.goals[0].text, 'Mục tiêu của Sếp'); // không đè phần Sếp đã nhập
  assert.ok(p.kpis.length >= 2 && p.tasks.length === 4);
});
