// Agent Báo cáo: tổng hợp báo cáo tuần/tháng từ dữ liệu CÓ THẬT trong hệ thống (Meta Insights đã đồng bộ, bài đăng, duyệt, agent).
// Chỉ đọc — không thao tác gì ra ngoài. Mỗi con số ghi rõ nguồn và khoảng thời gian; thiếu dữ liệu thì ghi "chưa có", không bịa.
// Các nhận định chỉ là ĐỀ XUẤT để Sếp xem; không tự tắt quảng cáo, đổi ngân sách hay đăng bài.
const { load, save, uid } = require('./db');
const engine = require('./engine');
const planner = require('./planner');
const adsApi = require('./ads-api');

const DAY = 864e5;
const VN = 7 * 3600e3;
const vnd = (n) => Math.round(n || 0).toLocaleString('vi-VN') + 'đ';
const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
const dayVN = (t) => new Date(t + VN).toISOString().slice(0, 10);

function range(period, now) {
  if (period === 'week') return { from: now - 7 * DAY, to: now, label: `7 ngày qua (${dayVN(now - 7 * DAY)} → ${dayVN(now)})` };
  if (period === 'month') {
    const d = new Date(now + VN);
    const from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - VN;
    return { from, to: now, label: `Tháng ${d.getUTCMonth() + 1}/${d.getUTCFullYear()} (từ ${dayVN(from)})` };
  }
  throw bad('Kỳ báo cáo chỉ có thể là week hoặc month');
}

function collect(period, now = Date.now()) {
  const db = load();
  const r = range(period, now);
  const win = period === 'week' ? 'd7' : 'month';
  const brands = planner.brands();
  const live = db.campaigns.length > 0 && require('./connectors').ads.mode === 'live';
  const camps = db.campaigns.filter((c) => !c.stale).map((c) => ({ ...c, brand: engine.brandOf(c) }));
  const perBrand = {};
  for (const id of Object.keys(brands)) {
    const cs = camps.filter((c) => c.brand === id);
    const spend = cs.reduce((s, c) => s + c[win].spend, 0), msgs = cs.reduce((s, c) => s + c[win].msgs, 0);
    const posts = db.posts.filter((p) => p.brand === id && p.status === 'published' && new Date(p.scheduledAt).getTime() >= r.from && new Date(p.scheduledAt).getTime() <= r.to).length;
    perBrand[id] = { name: brands[id].name, spend, msgs, cpl: msgs ? Math.round(spend / msgs) : null, activeCampaigns: cs.filter((c) => c.status === 'ACTIVE').length, postsPublished: posts };
  }
  // chiến dịch tốt/xấu: đủ dữ liệu mới xếp hạng (≥ 10 tin và ≥ 500.000đ)
  const ranked = camps.filter((c) => c.status === 'ACTIVE' && engine.isMsgCampaign(c) && c[win].msgs >= 10 && c[win].spend >= 500000)
    .map((c) => ({ id: c.id, name: c.name, brand: c.brand, spend: c[win].spend, msgs: c[win].msgs, cpl: Math.round(c[win].spend / c[win].msgs) })).sort((a, b) => a.cpl - b.cpl);
  const alerts = adsApi.alerts(camps).slice(0, 10).map((a) => ({ level: a.level, campaign: a.campaign, text: a.text, basis: a.basis }));
  const decided = db.approvals.filter((a) => a.decidedAt && new Date(a.decidedAt).getTime() >= r.from);
  const runs = db.runs.filter((x) => new Date(x.at).getTime() >= r.from && x.trigger !== 'simulation');
  const tests = db.adTests.filter((t) => t.finishedAt && new Date(t.finishedAt).getTime() >= r.from);
  const upcoming = db.posts.filter((p) => p.status === 'scheduled' && new Date(p.scheduledAt).getTime() > now && new Date(p.scheduledAt).getTime() <= now + 7 * DAY).length;
  return {
    period, range: { from: new Date(r.from).toISOString(), to: new Date(r.to).toISOString(), label: r.label }, adsLive: live,
    adsWindow: win === 'd7' ? '7 ngày gần nhất' : 'tháng hiện tại', perBrand,
    best: ranked.slice(0, 3), worst: ranked.slice(Math.max(3, ranked.length - 3)).reverse(),
    // Dùng cho đề xuất: xét MỌI chiến dịch đủ dữ liệu, không chỉ các dòng hiển thị
    overLimit: ranked.filter((c) => c.cpl > engine.thresholds({ accountId: (brands[c.brand] || {}).adAccountId, name: c.brand === 'dark_hair' ? 'DH-x' : c.name }).stop).reverse().slice(0, 3),
    cheap: ranked.filter((c) => c.cpl <= engine.thresholds({ accountId: (brands[c.brand] || {}).adAccountId, name: c.brand === 'dark_hair' ? 'DH-x' : c.name }).scale).slice(0, 3),
    alerts,
    approvals: { pending: db.approvals.filter((a) => a.status === 'pending').length, approved: decided.filter((a) => a.status === 'approved').length, rejected: decided.filter((a) => a.status === 'rejected').length },
    agents: { runs: runs.length, errors: runs.filter((x) => x.error).length, lastError: (runs.find((x) => x.error) || {}).error || null },
    adTests: { finished: tests.length, pass: tests.filter((t) => t.status === 'pass').length, fail: tests.filter((t) => t.status === 'fail').length, running: db.adTests.filter((t) => t.status === 'running').length },
    upcomingPosts7d: upcoming,
  };
}

// Đề xuất (không phải hành động): chỉ dựa trên số liệu trong báo cáo
function suggestions(d) {
  const out = [];
  const thr = (brand) => engine.thresholds({ accountId: (planner.brands()[brand] || {}).adAccountId, name: brand === 'dark_hair' ? 'DH-x' : 'x' });
  for (const w of d.overLimit) { const lim = thr(w.brand); out.push(`Xem xét tắt hoặc sửa "${w.name}": ${vnd(w.cpl)}/tin nhắn, vượt ngưỡng ${vnd(lim.stop)} (${w.msgs} tin, tiêu ${vnd(w.spend)}).`); }
  for (const b of d.cheap) { const lim = thr(b.brand); out.push(`Cân nhắc tăng ngân sách "${b.name}": ${vnd(b.cpl)}/tin nhắn, dưới ngưỡng ${vnd(lim.scale)} (${b.msgs} tin).`); }
  if (d.upcomingPosts7d === 0) out.push('Lịch đăng 7 ngày tới đang trống — nên soạn thêm bài ở Lịch đăng hoặc Kế hoạch tháng.');
  if (d.approvals.pending > 5) out.push(`Đang có ${d.approvals.pending} việc chờ duyệt — nên xử lý để không chậm lịch đăng và đề xuất quảng cáo.`);
  if (d.agents.errors) out.push(`Agent gặp ${d.agents.errors} lần lỗi trong kỳ${d.agents.lastError ? ` (gần nhất: ${d.agents.lastError.slice(0, 100)})` : ''} — kiểm tra ở Lái tự động.`);
  if (d.adTests.fail > d.adTests.pass && d.adTests.finished >= 3) out.push('Nhiều bài chạy thử quảng cáo không đạt hơn số đạt — xem lại nội dung/đối tượng.');
  return out;
}

function textOf(d) {
  const L = [`BÁO CÁO ${d.period === 'week' ? 'TUẦN' : 'THÁNG'} — ${d.range.label}`, ''];
  L.push(`Nguồn: số liệu quảng cáo Meta đã đồng bộ (${d.adsWindow}); bài đăng, duyệt và agent trong hệ thống.`, '');
  if (!d.adsLive) L.push('⚠ Hệ thống đang ở chế độ mẫu hoặc chưa đồng bộ Meta — phần quảng cáo bên dưới KHÔNG phải số liệu thật.', '');
  L.push('1. Quảng cáo theo thương hiệu');
  for (const b of Object.values(d.perBrand)) L.push(`- ${b.name}: chi ${vnd(b.spend)}, ${b.msgs} tin nhắn${b.cpl ? `, ${vnd(b.cpl)}/tin` : ''}, ${b.activeCampaigns} chiến dịch đang chạy; ${b.postsPublished} bài đã đăng trong kỳ.`);
  const tot = Object.values(d.perBrand).reduce((a, b) => ({ s: a.s + b.spend, m: a.m + b.msgs }), { s: 0, m: 0 });
  L.push(`- Tổng: chi ${vnd(tot.s)}, ${tot.m} tin nhắn${tot.m ? `, ${vnd(tot.s / tot.m)}/tin` : ''}.`, '');
  if (d.best.length) { L.push('2. Chiến dịch hiệu quả nhất (giá/tin thấp, đủ dữ liệu)'); for (const c of d.best) L.push(`- ${c.name}: ${vnd(c.cpl)}/tin (${c.msgs} tin, chi ${vnd(c.spend)})`); L.push(''); }
  if (d.worst.length) { L.push('3. Chiến dịch kém nhất (giá/tin cao)'); for (const c of d.worst) L.push(`- ${c.name}: ${vnd(c.cpl)}/tin (${c.msgs} tin, chi ${vnd(c.spend)})`); L.push(''); }
  L.push(`4. Cảnh báo bất thường (${d.alerts.length})`);
  if (!d.alerts.length) L.push('- Không có bất thường nào.');
  for (const a of d.alerts) L.push(`- [${a.level === 'danger' ? 'NGHIÊM TRỌNG' : 'Lưu ý'}] ${a.campaign}: ${a.text}`);
  L.push('', '5. Duyệt & vận hành', `- Đã duyệt ${d.approvals.approved}, từ chối ${d.approvals.rejected} trong kỳ; đang chờ duyệt ${d.approvals.pending}.`, `- Agent chạy ${d.agents.runs} lần, ${d.agents.errors} lần lỗi.`, `- Quảng cáo thử: ${d.adTests.finished} bài hết kỳ (${d.adTests.pass} đạt, ${d.adTests.fail} không đạt), ${d.adTests.running} đang chạy.`, `- Bài sắp đăng 7 ngày tới: ${d.upcomingPosts7d}.`, '');
  const sg = suggestions(d);
  L.push('6. Đề xuất (chỉ để Sếp tham khảo — hệ thống không tự làm)');
  if (!sg.length) L.push('- Chưa có đề xuất nào từ số liệu kỳ này.');
  for (const x of sg) L.push(`- ${x}`);
  return L.join('\n');
}

function create(period, trigger = 'manual', now = Date.now()) {
  const db = load();
  const d = collect(period, now);
  const rep = { id: uid('rp'), period, trigger, createdAt: new Date(now).toISOString(), range: d.range, data: d, text: textOf(d), suggestions: suggestions(d), aiText: '' };
  db.reports.unshift(rep);
  db.reports.length = Math.min(db.reports.length, 30);
  engine.log('system', `Agent Báo cáo đã tạo báo cáo ${period === 'week' ? 'tuần' : 'tháng'} (${d.range.label})`, { rule: 'reporting' });
  save();
  return rep;
}

// Chạy theo lịch: mỗi tuần 1 báo cáo tuần. Chạy tay (Sếp bấm) thì luôn tạo mới.
function runAgent(trigger, now = Date.now()) {
  const db = load();
  if (trigger === 'schedule') {
    const last = db.reports.find((r) => r.period === 'week' && r.trigger === 'schedule');
    if (last && now - new Date(last.createdAt).getTime() < 7 * DAY) return 0;
  }
  create('week', trigger === 'simulation' ? 'simulation' : trigger, now);
  return 1;
}

// Nhờ AI viết đoạn nhận xét từ số liệu báo cáo (tuỳ chọn, cần ANTHROPIC_API_KEY). Chỉ gửi số liệu tổng hợp, không có dữ liệu cá nhân.
async function aiNarrative(id) {
  const rep = load().reports.find((r) => r.id === String(id));
  if (!rep) throw bad('Không tìm thấy báo cáo', 404);
  if (!process.env.ANTHROPIC_API_KEY) throw bad('Chưa có ANTHROPIC_API_KEY nên chưa nhờ AI viết nhận xét được.');
  const ai = require('./ai');
  const t = await require('./usage').withAgent('reporting', () => ai.ask('Bạn là chuyên viên phân tích marketing cho chuỗi salon. Viết tiếng Việt có dấu, ngắn gọn, chỉ dựa trên số liệu được cung cấp, không bịa số, chỉ đề xuất không ra lệnh.', `Số liệu báo cáo (JSON):\n${JSON.stringify(rep.data)}\n\nViết nhận xét tối đa 6 gạch đầu dòng: điều đáng chú ý, rủi ro, và 2–3 đề xuất. Nêu rõ khoảng thời gian.`, 800));
  rep.aiText = t || '';
  save();
  return rep;
}

function view(rep) { return { id: rep.id, period: rep.period, trigger: rep.trigger, createdAt: rep.createdAt, range: rep.range, text: rep.text, suggestions: rep.suggestions, aiText: rep.aiText, data: rep.data }; }
function list() { return load().reports.map((r) => ({ id: r.id, period: r.period, trigger: r.trigger, createdAt: r.createdAt, range: r.range, hasAi: !!r.aiText })); }
function get(id) {
  const rep = load().reports.find((r) => r.id === String(id));
  if (!rep) throw bad('Không tìm thấy báo cáo', 404);
  return view(rep);
}

async function handleApi(req, res, url, { readBody, send }) {
  const p = url.pathname;
  let m;
  if (!p.startsWith('/api/reports')) return false;
  try {
    if (req.method === 'GET' && p === '/api/reports') return send(res, 200, { reports: list() }), true;
    if (req.method === 'POST' && p === '/api/reports') return send(res, 200, view(create((await readBody(req)).period || 'week'))), true;
    if (req.method === 'GET' && (m = p.match(/^\/api\/reports\/([\w-]+)$/))) return send(res, 200, get(m[1])), true;
    if (req.method === 'POST' && (m = p.match(/^\/api\/reports\/([\w-]+)\/ai$/))) return send(res, 200, view(await aiNarrative(m[1]))), true;
  } catch (e) { send(res, e.status || 500, { error: e.message }); return true; }
  return false;
}

module.exports = { create, runAgent, collect, textOf, suggestions, aiNarrative, list, get, handleApi };
