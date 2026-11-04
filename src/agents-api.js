// Trung tâm Agent & Tác vụ: hồ sơ từng agent (mục tiêu, phạm vi quyền, công cụ), trạng thái, lịch sử chạy, lượng AI dùng,
// danh sách tác vụ. Agent nào chưa có thật thì ghi "chưa khả dụng" kèm lý do — không giả làm đã có.
const { load } = require('./db');
const engine = require('./engine');
const usage = require('./usage');
const automations = require('./automations');

const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
const DAY = 864e5;

// Hồ sơ 7 agent. engine: id agent chạy thật (null = chưa có). approvalTypes: loại mục duyệt agent này tạo ra.
const PROFILES = [
  {
    id: 'content', engine: 'content', name: 'Content Agent', vi: 'Agent Nội dung',
    goal: 'Soạn kế hoạch bài đăng theo tháng và đăng các bài ĐÃ ĐƯỢC DUYỆT đúng giờ lên Facebook Page.',
    reads: ['Hồ sơ thương hiệu & kênh', 'Thư viện media', 'Bài học của AI', 'Lịch đăng'],
    writes: ['Tạo kế hoạch/bài nháp (chờ duyệt)', 'Đăng bài đã duyệt lên Facebook Page (khi tắt chạy thử)'],
    never: ['Không tự duyệt bài (trừ khi bật "Tự duyệt bài" — nên tắt)', 'Không đăng khi đang chạy thử', 'Không đăng lên TikTok/小红书 (chỉ tạo gói đăng thủ công)'],
    tools: ['Claude AI (soạn bài)', 'Meta Graph API (đăng Page)', 'Thư viện media'], approvalTypes: ['post_publish', 'month_plan'],
  },
  {
    id: 'ads', engine: 'ads', name: 'Ads Analysis Agent', vi: 'Agent Quảng cáo',
    goal: 'Theo dõi chiến dịch Facebook, cảnh báo chiến dịch xấu, lên quảng cáo thử cho bài mới, đề xuất tăng ngân sách. KHÔNG tắt quảng cáo cũ đang chạy.',
    reads: ['Meta Marketing API: chiến dịch, nhóm quảng cáo, insights (chi tiêu, tin nhắn)'],
    writes: ['Chỉ tắt quảng cáo thử do agent tự tạo (hết kỳ/không đạt) — không tắt quảng cáo cũ', 'Đề xuất tăng ngân sách / quảng cáo thử (chờ duyệt)'],
    never: ['Không bao giờ tự tăng ngân sách', 'Không tạo/bật quảng cáo khi chưa được duyệt'],
    tools: ['Meta Marketing API', 'Bộ luật quảng cáo (Lái tự động)'], approvalTypes: ['budget_increase', 'ad_test', 'unit_budget'],
  },
  {
    id: 'comments', engine: 'comments', name: 'Agent Bình luận', vi: 'Agent Bình luận (một phần Customer Insights)',
    goal: 'Đọc bình luận mới của khách trên các Page và soạn câu trả lời gợi ý.',
    reads: ['Bình luận trên các Facebook Page của thương hiệu'],
    writes: ['Soạn câu trả lời (chờ duyệt)'],
    never: ['Không tự trả lời khách — chỉ gửi khi Sếp duyệt'],
    tools: ['Meta Graph API (đọc/gửi bình luận)', 'Claude AI (soạn câu trả lời)'], approvalTypes: ['comment_reply'],
  },
  {
    id: 'reporting', engine: 'reporting', name: 'Reporting Agent', vi: 'Agent Báo cáo',
    goal: 'Tổng hợp báo cáo tuần/tháng từ dữ liệu có thật, nêu rõ nguồn và khoảng thời gian, kèm đề xuất để Sếp tham khảo.',
    reads: ['Số liệu quảng cáo Meta đã đồng bộ', 'Bài đăng, duyệt, lần chạy agent, quảng cáo thử'],
    writes: ['Lưu báo cáo trong hệ thống'],
    never: ['Chỉ đọc — không thao tác nào ra ngoài', 'Không tự tắt quảng cáo, đổi ngân sách hay đăng bài'],
    tools: ['Dữ liệu nội bộ', 'Claude AI (tuỳ chọn: viết nhận xét)'], approvalTypes: [],
  },
  {
    id: 'planning', engine: null, name: 'Marketing Planning Agent', vi: 'Agent Lập kế hoạch marketing',
    unavailable: 'Chưa có agent riêng lập mục tiêu, KPI và ngân sách tháng. Hiện Content Agent chỉ soạn kế hoạch BÀI ĐĂNG; mục tiêu/KPI/ngân sách ở trang Kế hoạch tháng do Sếp nhập. Để làm cần quyết định: agent đề xuất dựa trên dữ liệu những tháng nào, và ai duyệt.',
    goal: 'Đề xuất mục tiêu, KPI, ngân sách cho tháng sau dựa trên kết quả các tháng trước.', reads: [], writes: [], never: [], tools: [], approvalTypes: [],
  },
  {
    id: 'insights', engine: null, name: 'Customer Insights Agent', vi: 'Agent Phân tích khách hàng',
    unavailable: 'Chưa khả dụng: cần quyền pages_messaging để đọc tin nhắn Page, token hiện chưa có quyền này và phần phân tích chưa được viết. Hiện đã có phần "đối tượng quảng cáo đã học" (từ số liệu quảng cáo) ở trang Quảng cáo. Khi làm, hệ thống chỉ đếm/phân loại, không lưu tên hay nội dung từng khách.',
    goal: 'Phân tích nhu cầu và hành vi khách từ tin nhắn/bình luận để đề xuất nội dung và đối tượng.', reads: [], writes: [], never: [], tools: [], approvalTypes: [],
  },
  {
    id: 'brandquality', engine: null, name: 'Brand Quality Agent', vi: 'Agent Chất lượng thương hiệu',
    unavailable: 'Chưa có agent chạy riêng. Hiện đã có kiểm tra tự động (chỉ cảnh báo, Sếp vẫn quyết) ở Kế hoạch tháng: bài AI soạn nhắc điều thương hiệu cấm nói, lời hứa tuyệt đối, giá/khuyến mãi Sếp chưa nêu, hashtag, lời kêu gọi. Kênh 小红书 có bộ kiểm tra tuân thủ riêng. Chưa có: tự sửa bài, chấm giọng văn bằng AI.',
    goal: 'Kiểm tra bài đăng có đúng giọng văn và quy định truyền thông của từng thương hiệu trước khi duyệt.', reads: [], writes: [], never: [], tools: [], approvalTypes: [],
  },
];
const profile = (id) => {
  const p = PROFILES.find((x) => x.id === id);
  if (!p) throw bad('Không có agent này', 404);
  return p;
};

function statusOf(pr) {
  if (!pr.engine) return { code: 'unavailable', text: 'Chưa khả dụng' };
  const s = load().settings;
  const a = s.agents[pr.engine];
  if (engine.runningAgents()[pr.engine]) return { code: 'running', text: 'Đang chạy' };
  if (s.paused) return { code: 'paused_all', text: 'Dừng khẩn cấp' };
  if (!a.on) return a.autoPaused ? { code: 'autopaused', text: 'Tự tạm dừng do lỗi liên tiếp' } : { code: 'off', text: 'Đã tắt' };
  return { code: 'on', text: 'Đang bật' };
}

function view(pr, now = Date.now()) {
  const db = load();
  const out = { id: pr.id, name: pr.name, vi: pr.vi, goal: pr.goal, reads: pr.reads, writes: pr.writes, never: pr.never, tools: pr.tools, available: !!pr.engine, unavailable: pr.unavailable || '' };
  if (!pr.engine) return { ...out, status: statusOf(pr) };
  const real = db.runs.filter((r) => r.agent === pr.engine && r.trigger !== 'simulation');
  const last = real[0] || null;
  const u7 = usage.totals(7, now)[pr.engine] || { calls: 0, in: 0, out: 0 };
  const pending = db.approvals.filter((a) => a.status === 'pending' && pr.approvalTypes.includes(a.type));
  return {
    ...out, engine: pr.engine, status: statusOf(pr), on: db.settings.agents[pr.engine].on, autoPaused: db.settings.agents[pr.engine].autoPaused || null,
    runningSince: engine.runningAgents()[pr.engine] || null,
    lastRun: last ? { at: last.at, trigger: last.trigger, changed: last.changed, ms: last.ms, error: last.error } : null,
    runs24h: real.filter((r) => new Date(r.at).getTime() > now - DAY).length,
    errors24h: real.filter((r) => r.error && new Date(r.at).getTime() > now - DAY).length,
    pendingApprovals: pending.length,
    aiUsage7d: u7,
    workflows: automations.DEFS.filter((d) => d.agent === pr.engine).map((d) => ({ id: d.id, name: d.name, mode: d.permission.mode })),
    simulatable: pr.engine !== 'reporting',
  };
}

function list(now = Date.now()) {
  const s = load().settings;
  return { paused: !!s.paused, mode: s.dryRun ? 'dry' : 'live', hasAiKey: !!(process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY), agents: PROFILES.map((p) => view(p, now)) };
}

function detail(id, now = Date.now()) {
  const pr = profile(id);
  const v = view(pr, now);
  if (!pr.engine) return v;
  const db = load();
  const rules = new Set(automations.DEFS.filter((d) => d.agent === pr.engine).map((d) => d.rule).filter(Boolean));
  return {
    ...v,
    runs: db.runs.filter((r) => r.agent === pr.engine).slice(0, 30).map((r) => ({ at: r.at, trigger: r.trigger, changed: r.changed, ms: r.ms, error: r.error })),
    pending: db.approvals.filter((a) => a.status === 'pending' && pr.approvalTypes.includes(a.type)).slice(0, 10).map((a) => ({ id: a.id, type: a.type, title: a.title })),
    recentActions: db.actions.filter((a) => (a.rule && rules.has(a.rule)) || (pr.engine === 'content' && a.kind === 'publish') || (pr.engine === 'reporting' && a.rule === 'reporting')).slice(0, 15).map((a) => ({ at: a.at, kind: a.kind, text: a.text, dry: !!a.dry })),
    aiUsageByDay: usage.byDay(pr.engine, 14, now),
  };
}

// Danh sách tác vụ (mỗi lần agent chạy) có lọc + phân trang
function tasks({ agent, status, trigger, limit = 30, offset = 0 } = {}) {
  let rows = load().runs.slice();
  if (agent) rows = rows.filter((r) => r.agent === agent);
  if (status === 'error') rows = rows.filter((r) => r.error);
  if (status === 'ok') rows = rows.filter((r) => !r.error);
  if (trigger) rows = rows.filter((r) => r.trigger === trigger);
  limit = Math.min(100, Math.max(1, Number(limit) || 30));
  offset = Math.max(0, Number(offset) || 0);
  return { total: rows.length, runningNow: engine.runningAgents(), rows: rows.slice(offset, offset + limit).map((r) => ({ id: r.id, agent: r.agent, agentName: (engine.AGENTS[r.agent] || {}).name || r.agent, trigger: r.trigger, at: r.at, ms: r.ms, changed: r.changed, error: r.error })) };
}

async function handleApi(req, res, url, { send }) {
  const p = url.pathname;
  let m;
  if (!p.startsWith('/api/agent-center') && !p.startsWith('/api/tasks')) return false;
  try {
    if (req.method === 'GET' && p === '/api/agent-center') return send(res, 200, list()), true;
    if (req.method === 'GET' && (m = p.match(/^\/api\/agent-center\/([\w-]+)$/))) return send(res, 200, detail(m[1])), true;
    if (req.method === 'POST' && (m = p.match(/^\/api\/agent-center\/([\w-]+)\/simulate$/))) {
      const pr = profile(m[1]);
      if (!pr.engine) throw bad('Agent này chưa khả dụng');
      if (pr.engine === 'reporting') throw bad('Agent Báo cáo chỉ đọc nên không cần chạy thử — bấm "Chạy ngay" để tạo báo cáo');
      if (load().settings.paused) throw bad('Đang dừng khẩn cấp — bật lại agent trước');
      const r = await engine.simulate(pr.engine);
      return send(res, 200, { run: r.run, actions: r.actions.map((a) => ({ at: a.at, kind: a.kind, text: a.text, dry: !!a.dry })) }), true;
    }
    if (req.method === 'GET' && p === '/api/tasks') {
      const q = url.searchParams;
      return send(res, 200, tasks({ agent: q.get('agent'), status: q.get('status'), trigger: q.get('trigger'), limit: q.get('limit'), offset: q.get('offset') })), true;
    }
  } catch (e) { send(res, e.status || 500, { error: e.message }); return true; }
  return false;
}

module.exports = { list, detail, tasks, handleApi, PROFILES };
