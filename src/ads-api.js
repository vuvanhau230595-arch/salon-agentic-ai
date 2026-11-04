// API cho trang Quảng cáo Facebook: đồng bộ chỉ-đọc, chuỗi số liệu theo ngày, nhóm quảng cáo, cảnh báo bất thường,
// và 2 thao tác ghi do Sếp bấm (bật/tắt chiến dịch, đổi ngân sách). Mọi ghi đều qua backend, kiểm tra dữ liệu,
// tôn trọng chế độ chạy thử và ghi nhật ký kèm giá trị trước/sau. Token Meta không bao giờ ra giao diện.
const { load, save } = require('./db');
const { ads } = require('./connectors');
const engine = require('./engine');

const MIN_BUDGET = 50000;
const MAX_BUDGET = 20000000;
const vnd = (n) => Math.round(n || 0).toLocaleString('vi-VN') + 'đ';
const cplOf = (w) => { const m = engine.msgsFor(w); return m ? w.spend / m : null; };

// Cảnh báo bất thường theo luật, tính trên số liệu Meta vừa đồng bộ. Chỉ để Sếp xem — không tự đổi gì.
function alerts(campaigns = db().campaigns) {
  const r = load().settings.rules;
  const al = load().settings.alerts || {};
  const SPIKE = al.spikeRatio || 1.5, SPIKE_MIN = al.spikeMinSpend ?? 200000, CPL_SPIKE = al.cplSpikeRatio || 1.5, CPL_MIN_MSGS = al.cplSpikeMinMsgs || 3;
  const out = [];
  const add = (c, kind, level, text, basis) => out.push({ id: `${kind}:${c.id}`, kind, level, campaignId: c.id, campaign: c.name, brand: c.brand || null, text, basis });
  for (const c of campaigns) {
    if (c.stale) { add(c, 'stale', 'warn', 'Không đọc được số liệu mới của tài khoản này, đang hiển thị bản cũ.', 'lần đồng bộ gần nhất'); continue; }
    if (c.status !== 'ACTIVE' || !engine.isMsgCampaign(c)) continue;
    const lim = engine.thresholds(c);
    const c7 = cplOf(c.d7);
    const base = `Meta Insights, tài khoản ${c.accountId || '—'}`;
    if (c7 !== null && c.d7.spend >= r.highCpl.minSpend && c7 > lim.stop) {
      add(c, 'cpl_high', 'danger', `Giá/tin nhắn 7 ngày ${vnd(c7)}, vượt ngưỡng ${vnd(lim.stop)} (tiêu ${vnd(c.d7.spend)}, ${c.d7.msgs} tin).`, `${base}, 7 ngày`);
    } else if (engine.msgsFor(c.d7) === 0 && c.d7.spend >= r.noResult.minSpend) {
      add(c, 'no_result', 'danger', `Tiêu ${vnd(c.d7.spend)} trong 7 ngày nhưng 0 tin nhắn.`, `${base}, 7 ngày`);
    }
    // Chi tiêu hôm nay so với trung bình 6 ngày trước (hôm nay chưa trọn ngày nên so sánh này chỉ báo sớm, không báo nhầm)
    const prev = Math.max(0, c.d7.spend - c.today.spend) / 6;
    if (prev > 0 && c.today.spend >= SPIKE_MIN && c.today.spend > prev * SPIKE) {
      add(c, 'spend_spike', 'warn', `Hôm nay đã tiêu ${vnd(c.today.spend)}, gấp ${(c.today.spend / prev).toFixed(1)} lần trung bình 6 ngày trước (${vnd(prev)}/ngày).`, `${base}, hôm nay so với 6 ngày trước`);
    }
    const t = cplOf(c.today);
    if (t !== null && c7 !== null && c.today.msgs >= CPL_MIN_MSGS && t > c7 * CPL_SPIKE) {
      add(c, 'cpl_spike', 'warn', `Giá/tin nhắn hôm nay ${vnd(t)}, cao hơn ${((t / c7 - 1) * 100).toFixed(0)}% so với trung bình 7 ngày (${vnd(c7)}).`, `${base}, hôm nay so với 7 ngày`);
    }
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'danger' ? -1 : 1));
}
const db = () => load();

// Số liệu theo ngày, nhớ 10 phút để không gọi Meta mỗi lần mở trang
const cache = new Map();
const TTL = 10 * 60e3;
async function series({ days = 30, campaignId = '', accountId = '', refresh = false, now = Date.now() } = {}) {
  days = Math.min(90, Math.max(1, Math.round(Number(days)) || 30));
  const d = load();
  if (ads.mode !== 'live') return { demo: true, days, points: [], note: 'Chế độ mẫu: chưa có số liệu theo ngày. Nối Meta API để xem biểu đồ.' };
  const accounts = campaignId
    ? [((d.campaigns.find((c) => c.id === campaignId) || {}).accountId)].filter(Boolean)
    : accountId ? [accountId] : [...new Set(Object.values(require('./planner').brands()).map((b) => b.adAccountId).filter(Boolean))];
  if (!accounts.length) return { days, points: [], note: 'Chưa có tài khoản quảng cáo.' };
  const key = `${days}|${campaignId}|${accounts.join(',')}`;
  const hit = cache.get(key);
  if (!refresh && hit && now - hit.at < TTL) return { ...hit.data, cached: true };
  const byDate = new Map();
  const errors = [];
  for (const acc of accounts) {
    try {
      for (const p of await ads.daily(acc, { days, campaignId })) {
        const cur = byDate.get(p.date) || { date: p.date, spend: 0, msgs: 0 };
        cur.spend += p.spend; cur.msgs += p.msgs;
        byDate.set(p.date, cur);
      }
    } catch (e) { errors.push(`${acc}: ${e.message}`); }
  }
  if (errors.length === accounts.length) throw new Error(errors[0]);
  const data = { days, points: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)), fetchedAt: new Date(now).toISOString(), partial: errors.length ? errors : undefined };
  cache.set(key, { at: now, data });
  return data;
}
const creativeCache = new Map(); // chi tiết quảng cáo (ảnh, bài, số liệu từng quảng cáo) nhớ 10 phút
const clearCache = () => { cache.clear(); creativeCache.clear(); };

function findCampaign(id) {
  const c = load().campaigns.find((x) => x.id === String(id));
  if (!c) { const e = new Error('Không thấy chiến dịch này — bấm "Đồng bộ Meta" rồi thử lại'); e.status = 404; throw e; }
  return c;
}
const bad = (msg) => { const e = new Error(msg); e.status = 400; return e; };

// Bật/tắt 1 chiến dịch (Sếp bấm). Chạy thử: chỉ ghi nhật ký.
async function setStatus(id, status, by = 'Sếp') {
  if (!['ACTIVE', 'PAUSED'].includes(status)) throw bad('Trạng thái chỉ có thể là ACTIVE hoặc PAUSED');
  const d = load();
  const c = findCampaign(id);
  if (c.stale) throw bad('Số liệu chiến dịch này đã cũ (không đọc được tài khoản) — đồng bộ lại trước khi thao tác');
  if (c.status === status) throw bad(`Chiến dịch đã ở trạng thái ${status === 'ACTIVE' ? 'đang chạy' : 'đã tắt'}`);
  const dry = engine.isDry();
  const before = c.status;
  if (!dry) { await ads.setStatus(c.id, status); c.status = status; }
  engine.log('ads_change', `${by} ${status === 'ACTIVE' ? 'BẬT' : 'TẮT'} chiến dịch ${c.name}${dry ? ' (chạy thử — chưa đổi trên Facebook)' : ''}`, { dry, by, campaignId: c.id, field: 'status', before, after: status });
  save();
  return { dry, campaign: c };
}

// Đổi ngân sách ngày: cấp chiến dịch (campaign.budgetLevel = 'campaign') hoặc 1 nhóm quảng cáo của chiến dịch (adsetId)
async function setBudget(id, budget, adsetId, by = 'Sếp') {
  const d = load();
  const c = findCampaign(id);
  const amount = Number(budget);
  if (!Number.isFinite(amount) || Math.round(amount) !== amount) throw bad('Ngân sách phải là số nguyên (đồng)');
  if (amount < MIN_BUDGET || amount > MAX_BUDGET) throw bad(`Ngân sách ngày phải từ ${vnd(MIN_BUDGET)} đến ${vnd(MAX_BUDGET)}`);
  if (c.stale) throw bad('Số liệu chiến dịch này đã cũ — đồng bộ lại trước khi thao tác');
  const dry = engine.isDry();
  let target = c.id, before = c.budget, label = c.name;
  if (adsetId) {
    if (!/^\d{5,25}$/.test(String(adsetId))) throw bad('Mã nhóm quảng cáo không hợp lệ');
    const sets = await ads.adsets(c.id);
    const s = sets.find((x) => x.id === String(adsetId));
    if (!s) throw bad('Nhóm quảng cáo không thuộc chiến dịch này');
    target = s.id; before = s.budget; label = `${c.name} › ${s.name}`;
    if (!s.budget) throw bad('Nhóm quảng cáo này không đặt ngân sách riêng (ngân sách nằm ở chiến dịch)');
  } else if (!c.budget) {
    throw bad('Chiến dịch này đặt ngân sách ở cấp nhóm quảng cáo — chọn nhóm quảng cáo trong panel chi tiết để sửa');
  }
  if (amount === before) throw bad('Ngân sách mới trùng ngân sách hiện tại');
  if (!dry) {
    await ads.setBudget(target, amount);
    if (!adsetId) { c.budget = amount; c.budgetTotal = amount; }
  }
  engine.log('ads_change', `${by} đổi ngân sách ${label}: ${vnd(before)} → ${vnd(amount)}/ngày${dry ? ' (chạy thử — chưa đổi trên Facebook)' : ''}`, { dry, by, campaignId: c.id, field: adsetId ? 'adset_budget' : 'budget', before, after: amount });
  save();
  return { dry, campaign: c, before, after: amount };
}

// Đồng bộ chỉ-đọc: kéo lại chiến dịch từ Meta, KHÔNG áp luật tắt/tăng
async function sync() {
  clearCache();
  const n = await engine.syncCampaigns();
  engine.log('system', `Đồng bộ Meta: ${n} chiến dịch`);
  save();
  return n;
}

async function handleApi(req, res, url, { readBody, send }) {
  const p = url.pathname;
  let m;
  if (!p.startsWith('/api/ads/')) return false;
  try {
    if (req.method === 'GET' && p === '/api/ads/series') {
      const q = url.searchParams;
      return send(res, 200, await series({ days: q.get('days'), campaignId: q.get('campaign') || '', accountId: q.get('account') || '', refresh: q.get('refresh') === '1' })), true;
    }
    if (req.method === 'POST' && p === '/api/ads/sync') { const n = await sync(); return send(res, 200, { synced: n }), true; }
    if (req.method === 'GET' && (m = p.match(/^\/api\/ads\/campaigns\/(\d{5,25})\/creatives$/))) {
      findCampaign(m[1]);
      const refresh = url.searchParams.get('refresh') === '1';
      const hit = creativeCache.get(m[1]);
      if (!refresh && hit && Date.now() - hit.at < TTL) return send(res, 200, { ...hit.data, cached: true }), true;
      const data = { ...(await ads.creatives(m[1])), fetchedAt: new Date().toISOString() };
      creativeCache.set(m[1], { at: Date.now(), data });
      return send(res, 200, data), true;
    }
    if (req.method === 'GET' && (m = p.match(/^\/api\/ads\/campaigns\/(\d{5,25})\/adsets$/))) {
      findCampaign(m[1]);
      return send(res, 200, { adsets: await ads.adsets(m[1]) }), true;
    }
    if (req.method === 'POST' && (m = p.match(/^\/api\/ads\/campaigns\/(\d{5,25}|[\w-]+)\/status$/))) {
      const b = await readBody(req);
      return send(res, 200, await setStatus(m[1], b.status)), true;
    }
    if (req.method === 'POST' && (m = p.match(/^\/api\/ads\/campaigns\/(\d{5,25}|[\w-]+)\/budget$/))) {
      const b = await readBody(req);
      return send(res, 200, await setBudget(m[1], b.budget, b.adsetId)), true;
    }
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
    return true;
  }
  return false;
}

module.exports = { alerts, series, clearCache, setStatus, setBudget, sync, handleApi, MIN_BUDGET, MAX_BUDGET };
