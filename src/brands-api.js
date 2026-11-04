// Trung tâm Thương hiệu: gom MỘT thương hiệu thành một bức tranh đầy đủ — hồ sơ, nhận diện, chi nhánh, kênh, ngân sách/KPI, khuyến mãi,
// quảng cáo, nội dung — chỉ từ dữ liệu của chính thương hiệu đó (không lẫn thương hiệu khác). Chỉ đọc, không gọi API bên ngoài.
const { load } = require('./db');
const planner = require('./planner');
const engine = require('./engine');
const media = require('./media');
const channels = require('./channels-api');
const monthplan = require('./monthplan');
const { approvalBrand } = require('./approval-brand');

const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
const VN = 7 * 3600e3;
const DAY = 864e5;

// Hồ sơ đủ chưa? Mỗi mục có gợi ý để Sếp biết cần làm gì
function completeness(b) {
  const items = [
    { key: 'hotline', label: 'Hotline', ok: !!b.hotline, hint: 'Nhập số điện thoại ở thẻ Hồ sơ.' },
    { key: 'address', label: 'Địa chỉ / chi nhánh', ok: !!b.address || b.branches.length > 0, hint: 'Thêm chi nhánh ở thẻ Chi nhánh.' },
    { key: 'services', label: 'Dịch vụ chính', ok: !!b.services, hint: 'Để AI viết đúng dịch vụ.' },
    { key: 'tone', label: 'Giọng văn', ok: !!b.tone, hint: 'Để AI viết đúng giọng thương hiệu.' },
    { key: 'avoid', label: 'Điều không được nói', ok: !!b.avoid, hint: 'Quy định truyền thông — AI sẽ tránh những điều này.' },
    { key: 'hashtags', label: 'Hashtag ưu tiên', ok: !!b.hashtags, hint: 'Thêm hashtag riêng của thương hiệu.' },
    { key: 'page', label: 'Ít nhất 1 Facebook Page', ok: b.pageIds.length > 0, hint: 'Thêm Page ở trang Kênh.' },
    { key: 'ads', label: 'Tài khoản quảng cáo', ok: !!b.adAccountId, hint: 'Nhập ID tài khoản quảng cáo ở thẻ Kênh & tài khoản.' },
    { key: 'logo', label: 'Logo', ok: !!b.identity.logo, hint: 'Tải logo lên Thư viện Media rồi chọn ở thẻ Nhận diện.' },
    { key: 'colors', label: 'Màu chủ đạo', ok: !!b.identity.primary, hint: 'Chọn màu chính ở thẻ Nhận diện.' },
  ];
  const done = items.filter((i) => i.ok).length;
  return { score: done, total: items.length, percent: Math.round((done / items.length) * 100), items };
}

function overview(brandId, now = Date.now()) {
  const brands = planner.brands();
  const b = brands[brandId];
  if (!b) throw bad('Thương hiệu không tồn tại', 404);
  const db = load();
  const month = monthplan.vnMonth(now), next = monthplan.vnMonth(now + 32 * DAY);
  const today = new Date(now + VN).toISOString().slice(0, 10);

  const rows = channels.list(now).rows.filter((r) => r.brand === brandId);
  const mp = monthplan.view(month, now).brands[brandId];
  const promos = [];
  for (const m of [month, next]) {
    for (const x of monthplan.view(m, now).brands[brandId].plan.promos) if (x.to >= today) promos.push({ ...x, month: m, state: x.from <= today ? 'running' : 'upcoming' });
  }
  promos.sort((x, y) => x.from.localeCompare(y.from));

  const camps = db.campaigns.filter((c) => !c.stale && engine.brandOf(c) === brandId);
  const adtest = require('./adtest');
  const adsLive = require('./connectors').ads.mode === 'live';
  const posts = db.posts.filter((p) => p.brand === brandId);
  const t = (p) => new Date(p.scheduledAt).getTime();
  const pending = db.approvals.filter((a) => a.status === 'pending' && approvalBrand(db, a) === brandId).length;
  let mediaCount = 0;
  try { mediaCount = media.list(brandId).length; } catch { /* chưa có thư mục media */ }

  return {
    brand: {
      id: b.id, name: b.name, tagline: b.tagline, taglineZh: b.taglineZh, hotline: b.hotline, services: b.services, tone: b.tone, postTone: b.postTone, avoid: b.avoid, hashtags: b.hashtags,
      address: b.address, addressZh: b.addressZh, locationZh: b.locationZh, adAccountId: b.adAccountId, pageIds: b.pageIds, identity: b.identity, branches: b.branches, channels: b.channels,
    },
    completeness: completeness(b),
    channels: rows.map((r) => ({ channel: r.channel, channelLabel: r.channelLabel, name: r.name, externalId: r.externalId, status: r.status, statusText: r.statusText, enabled: r.enabled })),
    plan: {
      month,
      goals: { done: mp.progress.goalsDone, total: mp.progress.goals },
      kpis: mp.plan.kpis.map((k) => ({ name: k.name, target: k.target, actual: k.actual, pct: k.pct, status: k.status, unit: k.unit })),
      budget: { total: mp.plan.budget.total, spent: mp.actuals.spend, items: mp.plan.budget.items.map((i) => ({ name: i.name, amount: i.amount, actual: i.actual })) },
      tasks: { done: mp.progress.tasksDone, total: mp.progress.tasks, overdue: mp.progress.tasksOverdue },
    },
    promos,
    ads: {
      available: adsLive, activeCampaigns: camps.filter((c) => c.status === 'ACTIVE').length, campaigns: camps.length,
      monthSpend: camps.reduce((s, c) => s + ((c.month || {}).spend || 0), 0), monthMsgs: camps.reduce((s, c) => s + ((c.month || {}).msgs || 0), 0),
      units: db.settings.adTest.units.filter((u) => u.brand === brandId).map((u) => ({ id: u.id, name: u.name, dailyBudget: u.dailyBudget, committed: adtest.committed(u.id) })),
    },
    content: {
      scheduled: posts.filter((p) => p.status === 'scheduled').length,
      upcoming7d: posts.filter((p) => p.status === 'scheduled' && t(p) >= now && t(p) <= now + 7 * DAY).length,
      published30d: posts.filter((p) => p.status === 'published' && t(p) >= now - 30 * DAY).length,
      pendingApprovals: pending,
    },
    assets: { lessons: db.lessons.filter((l) => l.scope === brandId && l.status === 'active').length, media: mediaCount },
  };
}

// Tóm tắt cả 3 thương hiệu cho thanh chọn (rẻ: không đọc kênh/kế hoạch)
function summary() {
  return Object.values(planner.brands()).map((b) => { const c = completeness(b); return { id: b.id, name: b.name, percent: c.percent, missing: c.items.filter((i) => !i.ok).length, color: b.identity.primary || '' }; });
}

async function handleApi(req, res, url, { send }) {
  const p = url.pathname;
  let m;
  if (!p.startsWith('/api/brand-center')) return false;
  try {
    if (req.method === 'GET' && p === '/api/brand-center') return send(res, 200, { brands: summary() }), true;
    if (req.method === 'GET' && (m = p.match(/^\/api\/brand-center\/([\w-]+)$/))) return send(res, 200, overview(m[1])), true;
  } catch (e) { send(res, e.status || 500, { error: e.message }); return true; }
  return false;
}

module.exports = { overview, summary, completeness, handleApi };
