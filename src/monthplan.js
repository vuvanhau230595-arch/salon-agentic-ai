// Kế hoạch marketing theo tháng cho từng thương hiệu: mục tiêu, KPI, ngân sách, khuyến mãi, công việc (Kanban).
// Số thực tế TỰ ĐỘNG lấy từ dữ liệu có thật: quảng cáo Meta (chỉ tháng hiện tại — Meta chưa kéo số liệu quá khứ ở đây) và bài đăng.
// KPI nhập tay thì Sếp tự cập nhật số thực tế. Không có số liệu thì trả null, không bịa.
const { load, save, uid } = require('./db');
const engine = require('./engine');
const planner = require('./planner');

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ['todo', 'doing', 'review', 'done'];
const METRICS = ['spend', 'msgs', 'cpl', 'posts', 'manual'];
const LIMITS = { goals: 20, kpis: 20, items: 15, promos: 20, tasks: 100 };
const VN = 7 * 3600e3;

const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const num = (v, name) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e13) throw bad(`${name} phải là số từ 0 trở lên`);
  return n;
};
const date = (v, name, allowEmpty) => {
  const s = String(v ?? '').trim();
  if (!s && allowEmpty) return '';
  if (!DATE_RE.test(s) || Number.isNaN(new Date(s + 'T00:00:00Z').getTime())) throw bad(`${name} không đúng định dạng ngày (YYYY-MM-DD)`);
  return s;
};
const list = (v, max, name) => {
  if (!Array.isArray(v)) throw bad(`${name} phải là danh sách`);
  if (v.length > max) throw bad(`${name}: tối đa ${max} mục`);
  return v;
};

const empty = () => ({ goals: [], kpis: [], budget: { total: 0, items: [] }, promos: [], tasks: [], notes: '', updatedAt: null });

// ----- Làm sạch từng phần (chỉ giữ trường hợp lệ, cắt độ dài, gán id) -----
const clean = {
  goals: (v) => list(v, LIMITS.goals, 'Mục tiêu').map((g) => {
    const text = str(g.text, 200);
    if (!text) throw bad('Mục tiêu không được để trống');
    return { id: str(g.id, 40) || uid('g'), text, done: !!g.done };
  }),
  kpis: (v) => list(v, LIMITS.kpis, 'KPI').map((k) => {
    const name = str(k.name, 80);
    if (!name) throw bad('Tên KPI không được để trống');
    if (!METRICS.includes(k.metric)) throw bad(`KPI "${name}": chỉ số không hợp lệ`);
    const out = { id: str(k.id, 40) || uid('k'), name, metric: k.metric, target: num(k.target, `Mục tiêu của KPI "${name}"`), unit: str(k.unit, 12) };
    if (k.metric === 'manual') {
      out.actual = k.actual === null || k.actual === '' || k.actual === undefined ? null : num(k.actual, `Số thực tế của KPI "${name}"`);
      out.direction = k.direction === 'down' ? 'down' : 'up';
    }
    return out;
  }),
  budget: (b) => {
    if (!b || typeof b !== 'object') throw bad('Ngân sách không hợp lệ');
    return {
      total: num(b.total ?? 0, 'Tổng ngân sách'),
      items: list(b.items || [], LIMITS.items, 'Hạng mục ngân sách').map((i) => {
        const name = str(i.name, 60);
        if (!name) throw bad('Tên hạng mục ngân sách không được để trống');
        return { id: str(i.id, 40) || uid('b'), name, amount: num(i.amount, `Số tiền của "${name}"`), auto: i.auto === 'meta_ads' ? 'meta_ads' : '' };
      }),
    };
  },
  promos: (v) => list(v, LIMITS.promos, 'Khuyến mãi').map((p) => {
    const name = str(p.name, 100);
    if (!name) throw bad('Tên khuyến mãi không được để trống');
    const from = date(p.from, `Ngày bắt đầu của "${name}"`), to = date(p.to, `Ngày kết thúc của "${name}"`);
    if (to < from) throw bad(`Khuyến mãi "${name}": ngày kết thúc trước ngày bắt đầu`);
    return { id: str(p.id, 40) || uid('pr'), name, from, to, detail: str(p.detail, 500) };
  }),
  tasks: (v) => list(v, LIMITS.tasks, 'Công việc').map((t) => {
    const title = str(t.title, 120);
    if (!title) throw bad('Tên công việc không được để trống');
    const status = STATUSES.includes(t.status) ? t.status : 'todo';
    return { id: str(t.id, 40) || uid('t'), title, owner: str(t.owner, 60), due: date(t.due, `Hạn của "${title}"`, true), status, channel: str(t.channel, 30), note: str(t.note, 300) };
  }),
  notes: (v) => str(v, 2000),
};

function brandCheck(brandId) {
  if (!planner.brands()[brandId]) throw bad('Thương hiệu không tồn tại', 404);
}
function monthCheck(m) {
  if (!MONTH_RE.test(String(m))) throw bad('Tháng phải dạng YYYY-MM');
}
const vnMonth = (t = Date.now()) => new Date(t + VN).toISOString().slice(0, 7);
function elapsed(month, now = Date.now()) {
  const cur = vnMonth(now);
  if (month < cur) return 1;
  if (month > cur) return 0;
  const d = new Date(now + VN);
  const days = new Date(d.getUTCFullYear(), d.getUTCMonth() + 1, 0).getDate();
  return Math.min(1, d.getUTCDate() / days);
}

function plan(month, brand, create = false) {
  const db = load();
  db.monthPlans = db.monthPlans || {};
  if (!db.monthPlans[month]) { if (!create) return empty(); db.monthPlans[month] = {}; }
  if (!db.monthPlans[month][brand]) { if (!create) return empty(); db.monthPlans[month][brand] = empty(); }
  return db.monthPlans[month][brand];
}

// ----- Số thực tế tự động -----
function actuals(month, brand, now = Date.now()) {
  const db = load();
  const isCur = month === vnMonth(now);
  const out = { adsAvailable: isCur, spend: null, msgs: null, cpl: null, activeCampaigns: null, dailyBudget: null };
  if (isCur) {
    const cs = db.campaigns.filter((c) => !c.stale && engine.brandOf(c) === brand);
    const spend = cs.reduce((s, c) => s + ((c.month || {}).spend || 0), 0);
    const msgs = cs.reduce((s, c) => s + ((c.month || {}).msgs || 0), 0);
    Object.assign(out, { spend, msgs, cpl: msgs ? spend / msgs : null, activeCampaigns: cs.filter((c) => c.status === 'ACTIVE').length, dailyBudget: cs.filter((c) => c.status === 'ACTIVE').reduce((s, c) => s + (c.budgetTotal ?? c.budget ?? 0), 0) });
  }
  const posts = db.posts.filter((p) => p.brand === brand && vnMonth(new Date(p.scheduledAt).getTime()) === month && !['cancelled', 'rejected'].includes(p.status));
  out.posts = {
    planned: posts.length,
    published: posts.filter((p) => p.status === 'published').length,
    scheduled: posts.filter((p) => ['scheduled', 'awaiting_manual', 'external_scheduled'].includes(p.status)).length,
    draft: posts.filter((p) => p.status === 'draft').length,
    failed: posts.filter((p) => p.status === 'failed').length,
  };
  return out;
}

// Đánh giá 1 KPI: so tiến độ thực tế với tiến độ thời gian của tháng
function evalKpi(k, act, el) {
  let actual = null, direction = 'up';
  if (k.metric === 'manual') { actual = k.actual ?? null; direction = k.direction || 'up'; }
  else if (k.metric === 'posts') actual = act.posts.published;
  else { actual = act[k.metric]; if (k.metric === 'cpl') direction = 'down'; }
  if (actual === null || actual === undefined) return { actual: null, pct: null, status: 'none', direction };
  if (!k.target) return { actual, pct: null, status: 'none', direction };
  if (direction === 'down') {
    const r = actual / k.target; // ≤ 1 là đạt
    return { actual, pct: Math.round((k.target / Math.max(actual, 1e-9)) * 100), status: r <= 1 ? 'ok' : r <= 1.2 ? 'warn' : 'bad', direction };
  }
  const pct = (actual / k.target) * 100;
  const need = el * 100; // tiến độ lẽ ra phải đạt vào lúc này
  const status = pct >= 100 || pct >= need * 0.9 ? 'ok' : pct >= need * 0.6 ? 'warn' : 'bad';
  return { actual, pct: Math.round(pct), status, direction };
}

function view(month, now = Date.now()) {
  monthCheck(month);
  const el = elapsed(month, now);
  const brands = {};
  for (const id of Object.keys(planner.brands())) {
    const p = plan(month, id);
    const act = actuals(month, id, now);
    const kpis = p.kpis.map((k) => ({ ...k, ...evalKpi(k, act, el) }));
    const tasksDone = p.tasks.filter((t) => t.status === 'done').length;
    const today = new Date(now + VN).toISOString().slice(0, 10);
    const budgetItems = p.budget.items.map((i) => ({ ...i, actual: i.auto === 'meta_ads' ? act.spend : null }));
    brands[id] = {
      plan: { ...p, kpis, budget: { ...p.budget, items: budgetItems } },
      actuals: act,
      progress: {
        goalsDone: p.goals.filter((g) => g.done).length, goals: p.goals.length,
        tasksDone, tasks: p.tasks.length, tasksOverdue: p.tasks.filter((t) => t.status !== 'done' && t.due && t.due < today && month <= vnMonth(now)).length,
        kpiOk: kpis.filter((k) => k.status === 'ok').length, kpiBad: kpis.filter((k) => k.status === 'bad').length, kpis: kpis.length,
        budgetUsedPct: p.budget.total && act.spend !== null ? Math.round((act.spend / p.budget.total) * 100) : null,
      },
    };
  }
  return { month, elapsed: Math.round(el * 100) / 100, brands };
}

function update(month, brand, patch) {
  monthCheck(month); brandCheck(brand);
  if (!patch || typeof patch !== 'object') throw bad('Dữ liệu không hợp lệ');
  const next = {};
  for (const k of ['goals', 'kpis', 'budget', 'promos', 'tasks', 'notes']) if (patch[k] !== undefined) next[k] = clean[k](patch[k]);
  if (!Object.keys(next).length) throw bad('Không có gì để cập nhật');
  const p = plan(month, brand, true);
  Object.assign(p, next, { updatedAt: new Date().toISOString() });
  engine.log('monthplan', `Sếp cập nhật kế hoạch ${month} · ${planner.brands()[brand].name}: ${Object.keys(next).join(', ')}`, { by: 'Sếp', month, brand, sections: Object.keys(next) });
  save();
  return view(month).brands[brand];
}

// Kéo thẻ công việc sang cột khác
function setTaskStatus(month, brand, taskId, status) {
  monthCheck(month); brandCheck(brand);
  if (!STATUSES.includes(status)) throw bad('Trạng thái công việc không hợp lệ');
  const p = plan(month, brand);
  const t = p.tasks.find((x) => x.id === String(taskId));
  if (!t) throw bad('Không tìm thấy công việc', 404);
  if (t.status === status) throw bad('Công việc đã ở cột này');
  const before = t.status;
  t.status = status;
  load().monthPlans[month][brand].updatedAt = new Date().toISOString();
  engine.log('monthplan', `Công việc "${t.title}" (${month}): ${before} → ${status}`, { by: 'Sếp', month, brand, taskId: t.id, field: 'status', before, after: status });
  save();
  return view(month).brands[brand];
}

// Sao chép khung kế hoạch (mục tiêu, KPI, ngân sách) từ tháng khác; công việc và khuyến mãi không chép
function copyFrom(month, brand, from) {
  monthCheck(month); monthCheck(from); brandCheck(brand);
  if (from === month) throw bad('Chọn tháng khác để sao chép');
  const src = plan(from, brand);
  if (!src.goals.length && !src.kpis.length && !src.budget.items.length && !src.budget.total) throw bad(`Tháng ${from} chưa có kế hoạch để sao chép`);
  const dst = plan(month, brand, true);
  if (dst.goals.length || dst.kpis.length || dst.budget.total || dst.budget.items.length) throw bad(`Tháng ${month} đã có kế hoạch — xoá bớt hoặc sửa trực tiếp, không ghi đè`);
  dst.goals = src.goals.map((g) => ({ ...g, id: uid('g'), done: false }));
  dst.kpis = src.kpis.map((k) => ({ ...k, id: uid('k'), ...(k.metric === 'manual' ? { actual: null } : {}) }));
  dst.budget = { total: src.budget.total, items: src.budget.items.map((i) => ({ ...i, id: uid('b') })) };
  dst.updatedAt = new Date().toISOString();
  engine.log('monthplan', `Sao chép khung kế hoạch ${from} → ${month} · ${planner.brands()[brand].name}`, { by: 'Sếp', month, brand });
  save();
  return view(month).brands[brand];
}

// ----- Tự đề xuất kế hoạch tháng -----
// Với mỗi thương hiệu CHƯA có kế hoạch cho tháng này (và tháng sau, từ ngày 20), agent dựng bản nháp từ số liệu thật
// (ngân sách ngày đang chạy trên Meta, ngưỡng giá/tin của thương hiệu) và gửi ở trang Duyệt. Sếp duyệt mới ghi vào kế hoạch.
const vndp = (n) => Math.round(n).toLocaleString('vi-VN') + 'đ';
const isEmptyPlan = (p) => !p.goals.length && !p.kpis.length && !p.budget.total && !p.budget.items.length && !p.tasks.length;

function draft(month, brand, now = Date.now()) {
  const [y, mo] = month.split('-').map(Number);
  const days = new Date(y, mo, 0).getDate();
  const act = actuals(vnMonth(now), brand, now);
  const scale = require('./adtest').limits(brand).scale;
  const daily = act.dailyBudget || 0;
  const total = Math.round((daily * days) / 100000) * 100000;
  const posts = Math.round((days / 7) * 3);
  const kpis = [{ name: 'Giá mỗi tin nhắn', metric: 'cpl', target: scale, unit: 'đ' }, { name: 'Bài đăng', metric: 'posts', target: posts, unit: 'bài' }];
  if (total && scale) kpis.unshift({ name: 'Tin nhắn', metric: 'msgs', target: Math.round(total / scale), unit: 'tin' });
  const d2 = (d) => `${month}-${String(Math.min(d, days)).padStart(2, '0')}`;
  return {
    goals: [{ text: `Giữ giá mỗi tin nhắn ≤ ${vndp(scale)}` }, { text: `Đăng đủ ${posts} bài trong tháng` }],
    kpis,
    budget: { total, items: total ? [{ name: 'Quảng cáo Meta', amount: total, auto: 'meta_ads' }] : [] },
    tasks: [7, 14, 21, 28].map((d, i) => ({ title: `Đo tuần ${i + 1}: xem quảng cáo thử, duyệt đề xuất`, due: d2(d), status: 'todo', channel: 'ads' })),
    basis: { dailyBudget: daily, days, scale, posts },
  };
}

function propose(now = Date.now()) {
  const db = load();
  const d = new Date(now + VN);
  const months = [vnMonth(now)];
  if (d.getUTCDate() >= 20) months.push(vnMonth(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).getTime()));
  let n = 0;
  for (const month of months) {
    for (const brand of Object.keys(planner.brands())) {
      const key = `${month}/${brand}`;
      if (!isEmptyPlan(plan(month, brand))) continue;
      if (db.approvals.some((a) => a.type === 'month_plan' && a.key === key)) continue; // đã đề xuất (kể cả bị từ chối): không lặp lại
      const dr = draft(month, brand, now);
      const b = dr.basis;
      db.approvals.unshift({
        id: uid('p'), type: 'month_plan', key, status: 'pending', at: new Date(now).toISOString(),
        title: `Kế hoạch tháng ${month} — ${planner.brands()[brand].name}`,
        detail: `Dựa trên ngân sách ngày đang chạy ${vndp(b.dailyBudget)} × ${b.days} ngày = ${vndp(dr.budget.total)}. KPI: giá/tin ≤ ${vndp(b.scale)}${dr.kpis.find((k) => k.metric === 'msgs') ? `, ${dr.kpis.find((k) => k.metric === 'msgs').target} tin nhắn` : ''}, ${b.posts} bài đăng (mặc định 3 bài/tuần). Kèm 4 việc đo tuần. Sếp duyệt rồi vẫn sửa được ở trang Kế hoạch tháng.`,
        payload: { month, brand, plan: { goals: dr.goals, kpis: dr.kpis, budget: dr.budget, tasks: dr.tasks } },
      });
      engine.log('propose', `Đề xuất kế hoạch tháng ${month} cho ${planner.brands()[brand].name}, chờ Sếp duyệt`, { brand, month, rule: 'monthPlanAuto' });
      n++;
    }
  }
  return n;
}

// Sếp duyệt: ghi bản nháp vào kế hoạch, chỉ phần còn trống (không đè thứ Sếp đã nhập)
function applyProposal(a) {
  const { month, brand, plan: dr } = a.payload;
  const p = plan(month, brand, true);
  if (!p.goals.length) p.goals = clean.goals(dr.goals);
  if (!p.kpis.length) p.kpis = clean.kpis(dr.kpis);
  if (!p.budget.total && !p.budget.items.length) p.budget = clean.budget(dr.budget);
  if (!p.tasks.length) p.tasks = clean.tasks(dr.tasks);
  p.updatedAt = new Date().toISOString();
  engine.log('approve', `Sếp duyệt kế hoạch tháng ${month} · ${planner.brands()[brand].name}`, { by: 'Sếp', month, brand });
}

async function handleApi(req, res, url, { readBody, send }) {
  const p = url.pathname;
  let m;
  if (!p.startsWith('/api/month-plan')) return false;
  try {
    if (req.method === 'GET' && p === '/api/month-plan') return send(res, 200, view(url.searchParams.get('month') || vnMonth())), true;
    if (req.method === 'PUT' && (m = p.match(/^\/api\/month-plan\/([^/]+)\/([^/]+)$/))) return send(res, 200, update(m[1], m[2], await readBody(req))), true;
    if (req.method === 'POST' && (m = p.match(/^\/api\/month-plan\/([^/]+)\/([^/]+)\/copy$/))) return send(res, 200, copyFrom(m[1], m[2], (await readBody(req)).from)), true;
    if (req.method === 'POST' && (m = p.match(/^\/api\/month-plan\/([^/]+)\/([^/]+)\/tasks\/([^/]+)$/))) return send(res, 200, setTaskStatus(m[1], m[2], m[3], (await readBody(req)).status)), true;
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
    return true;
  }
  return false;
}

module.exports = { propose, applyProposal, draft, view, update, setTaskStatus, copyFrom, evalKpi, elapsed, vnMonth, handleApi, STATUSES };
