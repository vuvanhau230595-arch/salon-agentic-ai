// Trung tâm Lái tự động: gom các quy trình tự động của hệ thống thành danh sách có trigger, điều kiện, hành động,
// quyền hạn và nhật ký. Không tạo engine mới — mỗi quy trình trỏ vào đúng cài đặt/agent đang chạy thật
// (bật/tắt, sửa điều kiện = sửa cài đặt đó). Mọi thay đổi đều kiểm tra khoảng giá trị ở máy chủ và ghi nhật ký trước/sau.
const { load, save } = require('./db');
const engine = require('./engine');

const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
const DAY = 864e5;

// path: đường dẫn trong settings. enabled: nơi bật/tắt. agent: agent chạy nó (tắt agent thì quy trình không chạy).
// permission.mode: auto = tự làm (chỉ giảm/tắt, tôn trọng chế độ chạy thử) · approval = chỉ đề xuất, Sếp duyệt · auto_safe = tự làm việc không rủi ro · alert = chỉ cảnh báo, không thao tác gì ra ngoài
const DEFS = [
  {
    id: 'ads_highcpl', group: 'Quảng cáo', name: 'Cảnh báo chiến dịch giá/tin nhắn quá cao', agent: 'ads', rule: 'highCpl',
    description: 'Mỗi lần quét, nếu chiến dịch tin nhắn trong 7 ngày gần nhất đã tiêu đủ tiền mà giá/tin nhắn (tính cả tuần) vượt ngưỡng thì hiện cảnh báo để Sếp tự quyết. Agent KHÔNG tự tắt quảng cáo cũ. Đo theo tuần, không xét 1 ngày lẻ.',
    enabled: ['rules', 'highCpl', 'on'],
    conditions: [
      { key: 'minSpend', label: 'Đã tiêu trong 7 ngày từ', unit: 'đ', path: ['rules', 'highCpl', 'minSpend'], min: 0, max: 1e8, step: 10000 },
      { key: 'maxCostPerMsg', label: 'Giá/tin nhắn vượt', unit: 'đ', path: ['rules', 'highCpl', 'maxCostPerMsg'], min: 1000, max: 5e6, step: 5000 },
    ],
    trigger: 'Mỗi lần quét (chu kỳ quét chung)',
    actions: ['Hiện cảnh báo ở trang Quảng cáo (chỉ chiến dịch đo bằng tin nhắn)'],
    permission: { mode: 'alert', text: 'Chỉ cảnh báo — không tắt, không đổi gì trên Facebook.' },
    note: 'Ngưỡng riêng từng thương hiệu (Mishang…) nằm ở cài đặt luật quảng cáo và được ưu tiên hơn ngưỡng chung này.',
  },
  {
    id: 'ads_noresult', group: 'Quảng cáo', name: 'Cảnh báo chiến dịch tiêu tiền không ra tin nhắn', agent: 'ads', rule: 'noResult',
    description: 'Nếu chiến dịch tin nhắn trong 7 ngày gần nhất đã tiêu đủ tiền mà 0 tin nhắn thì hiện cảnh báo. Agent KHÔNG tự tắt quảng cáo cũ. Đo theo tuần.',
    enabled: ['rules', 'noResult', 'on'],
    conditions: [{ key: 'minSpend', label: 'Đã tiêu trong 7 ngày từ', unit: 'đ', path: ['rules', 'noResult', 'minSpend'], min: 0, max: 1e8, step: 10000 }],
    trigger: 'Mỗi lần quét (chu kỳ quét chung)',
    actions: ['Hiện cảnh báo ở trang Quảng cáo'],
    permission: { mode: 'alert', text: 'Chỉ cảnh báo — không tắt, không đổi gì trên Facebook.' },
  },
  {
    id: 'ads_monthcap', group: 'Quảng cáo', name: 'Báo khi chạm trần chi tiêu tháng', agent: 'ads', rule: 'monthCap',
    description: 'Khi tổng chi tiêu tháng của mọi tài khoản đạt trần thì ghi thông báo mỗi ngày một lần; agent KHÔNG tắt quảng cáo cũ. Trần = 0 nghĩa là không giới hạn (luật không hoạt động).',
    enabled: ['rules', 'monthCap', 'on'],
    conditions: [{ key: 'monthlyCap', label: 'Trần chi tiêu tháng (0 = không giới hạn)', unit: 'đ', path: ['monthlyCap'], min: 0, max: 1e11, step: 1000000 }],
    trigger: 'Mỗi lần quét (chu kỳ quét chung)',
    actions: ['Ghi thông báo'],
    permission: { mode: 'alert', text: 'Chỉ thông báo — không tắt, không đổi gì trên Facebook.' },
  },
  {
    id: 'ads_scaleup', group: 'Quảng cáo', name: 'Đề xuất tăng ngân sách chiến dịch đang rẻ', agent: 'ads', rule: 'scaleUp',
    description: 'Nếu 7 ngày qua chiến dịch/nhóm quảng cáo có đủ tin nhắn với giá rẻ thì tạo đề xuất tăng ngân sách ngày.',
    enabled: ['rules', 'scaleUp', 'on'],
    conditions: [
      { key: 'minMsgs7d', label: 'Tin nhắn 7 ngày từ', unit: 'tin', path: ['rules', 'scaleUp', 'minMsgs7d'], min: 1, max: 1000, step: 1 },
      { key: 'maxCostPerMsg', label: 'Giá/tin nhắn không quá', unit: 'đ', path: ['rules', 'scaleUp', 'maxCostPerMsg'], min: 1000, max: 5e6, step: 5000 },
      { key: 'pct', label: 'Đề xuất tăng', unit: '%', path: ['rules', 'scaleUp', 'pct'], min: 1, max: 100, step: 1 },
      { key: 'maxDaily', label: 'Ngân sách ngày tối đa', unit: 'đ', path: ['rules', 'scaleUp', 'maxDaily'], min: 0, max: 1e8, step: 50000 },
    ],
    trigger: 'Mỗi lần quét (chu kỳ quét chung)',
    actions: ['Tạo đề xuất "Tăng ngân sách" ở trang Duyệt'],
    permission: { mode: 'approval', text: 'Chỉ đề xuất — không bao giờ tự tăng tiền. Sếp duyệt mới đổi ngân sách.' },
  },
  {
    id: 'ads_test_daily', group: 'Quảng cáo', name: 'Quảng cáo thử bài mới mỗi ngày', agent: 'ads', rule: 'adTestDaily',
    description: 'Mỗi ngày đề xuất chạy thử quảng cáo cho bài Facebook mới đăng, theo ngân sách từng cơ sở; hết kỳ thì chấm điểm, tắt bài không đạt.',
    enabled: ['adTest', 'on'],
    conditions: [
      { key: 'budget', label: 'Ngân sách mỗi bài thử', unit: 'đ/ngày', path: ['adTest', 'budget'], min: 20000, max: 1e6, step: 10000 },
      { key: 'days', label: 'Số ngày chạy thử', unit: 'ngày', path: ['adTest', 'days'], min: 1, max: 14, step: 1 },
      { key: 'perUnitPerDay', label: 'Tối đa bài thử mỗi cơ sở mỗi ngày', unit: 'bài', path: ['adTest', 'perUnitPerDay'], min: 1, max: 10, step: 1 },
      { key: 'raisePct', label: 'Đề xuất tăng ngân sách cơ sở khi mọi bài đạt', unit: '%', path: ['adTest', 'raisePct'], min: 5, max: 100, step: 1 },
    ],
    trigger: 'Mỗi lần quét; chấm điểm khi hết kỳ thử; đo tuần mỗi cơ sở',
    actions: ['Tạo đề xuất quảng cáo thử (chờ duyệt)', 'Tắt bài thử hết kỳ/không đạt', 'Ghi bài học', 'Đề xuất tăng ngân sách ngày của cơ sở khi mọi bài đạt'],
    permission: { mode: 'approval', text: 'Tạo quảng cáo và tăng ngân sách đều chờ Sếp duyệt. Tắt bài hết kỳ là tự động.' },
    note: 'Ngân sách ngày từng cơ sở và ngưỡng đạt/loại chỉnh ở trang Quảng cáo.',
  },
  {
    id: 'ads_boost_organic', group: 'Quảng cáo', name: 'Đẩy quảng cáo video đang lên view tự nhiên', agent: 'ads', rule: 'adBoostOrganic',
    description: 'Mỗi ngày, mỗi cơ sở: tìm video/Reel có nhiều lượt xem tự nhiên nhất mà chưa từng chạy quảng cáo, đề xuất chạy quảng cáo cho bài đó.',
    enabled: ['adTest', 'boost', 'on'],
    conditions: [
      { key: 'minViews', label: 'Lượt xem tự nhiên tối thiểu', unit: 'lượt', path: ['adTest', 'boost', 'minViews'], min: 0, max: 100000, step: 50 },
      { key: 'maxAgeDays', label: 'Chỉ xét video đăng trong', unit: 'ngày', path: ['adTest', 'boost', 'maxAgeDays'], min: 1, max: 60, step: 1 },
    ],
    trigger: 'Mỗi lần quét, tối đa 1 đề xuất mỗi cơ sở mỗi ngày (cần bật "Quảng cáo thử bài mới mỗi ngày")',
    actions: ['Tạo đề xuất chạy quảng cáo cho video nhiều view (chờ duyệt)'],
    permission: { mode: 'approval', text: 'Chỉ đề xuất — Sếp duyệt mới tạo quảng cáo. Dùng chung ngân sách ngày và ngưỡng đạt/loại của cơ sở.' },
  },
  {
    id: 'content_autopilot', group: 'Nội dung', name: 'Tự soạn kế hoạch bài đăng tháng sau', agent: 'content', rule: 'autopilot',
    description: 'Gần cuối tháng, agent dùng AI soạn kế hoạch bài đăng tháng sau theo các hồ sơ (thương hiệu, kênh, ngày, giờ).',
    enabled: ['autopilot', 'on'],
    conditions: [
      { key: 'draftDaysBefore', label: 'Bắt đầu soạn khi còn', unit: 'ngày hết tháng', path: ['autopilot', 'draftDaysBefore'], min: 1, max: 28, step: 1 },
      { key: 'autoApprove', label: 'Tự duyệt bài (KHÔNG khuyến nghị)', unit: '', type: 'bool', path: ['autopilot', 'autoApprove'], dangerous: true },
    ],
    trigger: 'Mỗi lần quét; chỉ soạn khi tới ngưỡng ngày cuối tháng',
    actions: ['Gọi AI soạn bài theo hồ sơ', 'Tạo kế hoạch tháng chờ duyệt', 'Gắn media từ thư viện'],
    permission: { mode: 'approval', text: 'Chỉ đề xuất — bài chờ Sếp duyệt (trừ khi bật "Tự duyệt bài", nên để tắt).' },
    note: 'Hồ sơ lái tự động (kênh, ngày, giờ) chỉnh ở thẻ "Hồ sơ nội dung" bên dưới.',
  },
  {
    id: 'content_publish', group: 'Nội dung', name: 'Đăng các bài đã duyệt đúng giờ', agent: 'content', rule: null, kind: 'publish',
    description: 'Đến giờ hẹn, đăng bài đã được duyệt lên Facebook Page (kênh có API). TikTok/小红书 dùng gói đăng thủ công.',
    enabled: ['agents', 'content', 'on'],
    conditions: [],
    trigger: 'Mỗi lần quét: bài có giờ hẹn đã tới',
    actions: ['Đăng lên từng Page của thương hiệu (thử lại tối đa 3 lần/Page)', 'Ghi kết quả từng Page'],
    permission: { mode: 'approval', text: 'Chỉ đăng bài ĐÃ ĐƯỢC DUYỆT. Chế độ chạy thử thì không đăng thật.' },
  },
  {
    id: 'comments_draft', group: 'Bình luận', name: 'Soạn trả lời bình luận của khách', agent: 'comments', rule: 'comments',
    description: 'Đọc bình luận mới trên các Page và soạn câu trả lời gợi ý.',
    enabled: ['agents', 'comments', 'on'],
    conditions: [],
    trigger: 'Mỗi lần quét',
    actions: ['Đọc bình luận mới của các Page', 'Soạn câu trả lời, tạo mục chờ duyệt'],
    permission: { mode: 'approval', text: 'Chỉ soạn — trả lời khách chỉ gửi khi Sếp duyệt.' },
  },
  {
    id: 'safety_autopause', group: 'An toàn', name: 'Tự tạm dừng agent khi lỗi liên tiếp', agent: null, rule: 'autoPause',
    description: 'Nếu một agent lỗi liên tiếp nhiều lần (ví dụ token Meta hết hạn) thì tự tắt agent đó để khỏi gọi API liên tục, và báo trong thông báo.',
    enabled: ['autoPause', 'on'],
    conditions: [{ key: 'after', label: 'Tạm dừng sau số lần lỗi liên tiếp', unit: 'lần', path: ['autoPause', 'after'], min: 2, max: 10, step: 1 }],
    trigger: 'Sau mỗi lần agent chạy',
    actions: ['Tắt agent bị lỗi', 'Ghi nhật ký kèm lỗi gần nhất'],
    permission: { mode: 'auto', text: 'Tự động — chỉ làm hệ thống AN TOÀN hơn (tắt). Sếp bật lại sau khi xử lý nguyên nhân.' },
  },
];

const get = (obj, path) => path.reduce((o, k) => (o == null ? o : o[k]), obj);
function put(obj, path, value) {
  let o = obj;
  for (const k of path.slice(0, -1)) o = o[k];
  o[path[path.length - 1]] = value;
}
const def = (id) => {
  const d = DEFS.find((x) => x.id === id);
  if (!d) throw bad('Không có quy trình này', 404);
  return d;
};

function viewOf(d, now = Date.now()) {
  const db = load();
  const s = db.settings;
  const enabled = !!get(s, d.enabled);
  const agentOn = d.agent ? !!s.agents[d.agent].on : true;
  const day = now - DAY;
  const runs = d.agent ? db.runs.filter((r) => r.agent === d.agent) : [];
  const last = runs.find((r) => r.trigger !== 'simulation') || null;
  const acts = db.actions.filter((a) => new Date(a.at).getTime() > day && (d.rule ? a.rule === d.rule : d.kind ? a.kind === d.kind : false));
  let blocked = null;
  if (s.paused) blocked = 'Đang dừng khẩn cấp';
  else if (d.agent && !agentOn) blocked = `Agent ${engine.AGENTS[d.agent].name} đang tắt`;
  return {
    id: d.id, group: d.group, name: d.name, description: d.description, note: d.note || '', agent: d.agent,
    enabled, effective: enabled && !blocked, blocked,
    trigger: d.trigger, actions: d.actions, permission: d.permission,
    conditions: d.conditions.map((c) => ({ key: c.key, label: c.label, unit: c.unit, type: c.type || 'number', min: c.min, max: c.max, step: c.step, dangerous: !!c.dangerous, value: get(s, c.path) })),
    lastRun: last ? { at: last.at, trigger: last.trigger, changed: last.changed, ms: last.ms, error: last.error } : null,
    activity24h: acts.length,
    errors24h: runs.filter((r) => r.error && r.trigger !== 'simulation' && new Date(r.at).getTime() > day).length,
    simulatable: !!d.agent,
  };
}

function list(now = Date.now()) {
  const db = load();
  return {
    mode: db.settings.dryRun ? 'dry' : 'live', paused: !!db.settings.paused, scanMinutes: db.settings.scanMinutes,
    lastScan: db.lastScan, autoApprove: !!db.settings.autopilot.autoApprove,
    workflows: DEFS.map((d) => viewOf(d, now)),
  };
}

// Bật/tắt và/hoặc sửa điều kiện. Chỉ nhận khoá điều kiện đã khai báo, kiểm tra khoảng giá trị.
function update(id, body) {
  const d = def(id);
  const s = load().settings;
  const changes = [];
  if (body.enabled !== undefined) {
    const v = !!body.enabled;
    const before = !!get(s, d.enabled);
    if (v !== before) { put(s, d.enabled, v); if (v && d.enabled[0] === 'agents') delete s.agents[d.enabled[1]].autoPaused; changes.push(['bật/tắt', before, v]); }
  }
  if (body.conditions !== undefined) {
    if (!body.conditions || typeof body.conditions !== 'object') throw bad('Điều kiện không hợp lệ');
    for (const [key, raw] of Object.entries(body.conditions)) {
      const c = d.conditions.find((x) => x.key === key);
      if (!c) throw bad(`Quy trình này không có điều kiện "${key}"`);
      let v;
      if (c.type === 'bool') v = !!raw;
      else {
        v = Number(raw);
        if (!Number.isFinite(v) || Math.round(v) !== v) throw bad(`${c.label}: phải là số nguyên`);
        if (v < c.min || v > c.max) throw bad(`${c.label}: phải từ ${c.min.toLocaleString('vi-VN')} đến ${c.max.toLocaleString('vi-VN')}`);
      }
      const before = get(s, c.path);
      if (before !== v) { put(s, c.path, v); changes.push([c.label, before, v]); }
    }
  }
  if (!changes.length) throw bad('Không có thay đổi nào');
  for (const [what, before, after] of changes) {
    engine.log('automation', `Sếp đổi quy trình "${d.name}": ${what}: ${before} → ${after}`, { by: 'Sếp', workflow: d.id, field: what, before, after });
  }
  save();
  return viewOf(d);
}

// Lịch sử: các lần chạy của agent + nhật ký hành động của riêng quy trình này
function history(id, now = Date.now()) {
  const d = def(id);
  const db = load();
  const runs = d.agent ? db.runs.filter((r) => r.agent === d.agent).slice(0, 20).map((r) => ({ at: r.at, trigger: r.trigger, changed: r.changed, ms: r.ms, error: r.error })) : [];
  const actions = db.actions.filter((a) => (d.rule ? a.rule === d.rule : d.kind ? a.kind === d.kind : false)).slice(0, 30).map((a) => ({ at: a.at, kind: a.kind, text: a.text, dry: !!a.dry }));
  const errors = db.actions.filter((a) => a.kind === 'error' && (d.rule ? a.rule === d.rule : false)).slice(0, 10).map((a) => ({ at: a.at, text: a.text }));
  return { id: d.id, name: d.name, agent: d.agent, agentNote: d.agent ? 'Các lần chạy tính theo cả agent (mọi quy trình cùng agent chạy chung một lượt).' : '', runs, actions, errors, now: new Date(now).toISOString() };
}

// Chạy thử an toàn: cả agent của quy trình chạy 1 lượt, mọi thao tác ra ngoài bị chặn
async function simulate(id) {
  const d = def(id);
  if (!d.agent) throw bad('Quy trình này không chạy riêng được');
  if (load().settings.paused) throw bad('Đang dừng khẩn cấp — bật lại agent trước');
  const r = await engine.simulate(d.agent);
  return { agent: d.agent, agentName: engine.AGENTS[d.agent].name, run: r.run, actions: r.actions.map((a) => ({ at: a.at, kind: a.kind, text: a.text, dry: !!a.dry, rule: a.rule || null })), relevant: r.actions.filter((a) => (d.rule ? a.rule === d.rule : d.kind ? a.kind === d.kind : true)).length };
}

async function handleApi(req, res, url, { readBody, send }) {
  const p = url.pathname;
  let m;
  if (!p.startsWith('/api/automations')) return false;
  try {
    if (req.method === 'GET' && p === '/api/automations') return send(res, 200, list()), true;
    if (req.method === 'PUT' && (m = p.match(/^\/api\/automations\/([\w-]+)$/))) return send(res, 200, { workflow: update(m[1], await readBody(req)) }), true;
    if (req.method === 'GET' && (m = p.match(/^\/api\/automations\/([\w-]+)\/history$/))) return send(res, 200, history(m[1])), true;
    if (req.method === 'POST' && (m = p.match(/^\/api\/automations\/([\w-]+)\/simulate$/))) return send(res, 200, await simulate(m[1])), true;
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
    return true;
  }
  return false;
}

module.exports = { list, update, history, simulate, handleApi, DEFS };
