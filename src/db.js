// Kho dữ liệu JSON đơn giản, ghi nguyên tử (ghi file tạm rồi đổi tên)
const fs = require('node:fs');
const path = require('node:path');

const FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'db.json');

const DEFAULTS = () => ({
  settings: {
    dryRun: true,            // true = chạy thử: chỉ ghi nhật ký, chưa tắt/đổi thật
    paused: false,           // dừng khẩn cấp: agent không làm gì
    autoPause: { on: true, after: 3 }, // agent lỗi liên tiếp `after` lần thì tự tắt agent đó
    security: { sharedPasswordLogin: true }, // cho phép đăng nhập bằng mật khẩu chung APP_PASSWORD (= chủ hệ thống)
    // Ngưỡng cảnh báo bất thường trên trang Quảng cáo (chỉ để xem, không tự đổi gì)
    alerts: { spikeRatio: 1.5, spikeMinSpend: 200000, cplSpikeRatio: 1.5, cplSpikeMinMsgs: 3 },
    notify: { approvals: true, alerts: true, errors: true }, // nhóm thông báo hiện ở chuông
    ai: { enabled: true, model: '' }, // bật/tắt AI (Claude); model để trống = mặc định / biến môi trường
    monthlyCap: 0,           // 0 = không giới hạn tổng chi tháng
    scanMinutes: 30,
    tiktokMode: 'manual',       // 'manual' = gói đăng thủ công (TikTok Studio); 'api' = đăng thẳng bằng API
    tiktokPrivacy: 'SELF_ONLY', // TikTok: ứng dụng chưa audit chỉ đăng được chế độ riêng tư
    tiktokAigc: false,          // gắn nhãn "nội dung do AI tạo" cho video TikTok
    youtubePrivacy: 'public',   // YouTube: public | unlisted | private (dự án Google chưa audit thì YouTube vẫn khoá video về riêng tư)
    agents: { ads: { on: true }, content: { on: true }, comments: { on: true }, reporting: { on: true }, inbox: { on: true }, drive_sync: { on: true } },
    // Trợ lý nhắn tin: on = đọc Messenger của Page và trả lời; auto = tự gửi câu đơn giản (giá, địa chỉ...), còn lại chờ nhân viên;
    // brands = thương hiệu được bật. Widget chat website luôn dùng được (không gửi gì, chỉ trả lời trên web).
    assistant: { on: false, auto: true, brands: { the_one: true, dark_hair: false, mishang: false } },
    // Chất lượng tin nhắn: on = chấm hội thoại Messenger thành khách tiềm năng/chưa rõ/rác; useForAds = luật quảng cáo dùng số khách thật ước tính
    leads: { on: true, useForAds: false },
    brands: {},              // ghi đè tên/địa chỉ thương hiệu
    autopilot: { on: false, draftDaysBefore: 5, autoApprove: false, profiles: [] },
    // Lịch đăng mặc định cho dây chuyền nội dung (giờ Việt Nam). missed: bài quá giờ mà máy/server tắt —
    // 'within' = vẫn đăng nếu trễ ≤ lateHours giờ, quá thì đánh dấu "bỏ lỡ" chờ Sếp hẹn lại; 'skip' = luôn đánh dấu bỏ lỡ; 'late' = luôn đăng muộn
    scheduling: { defaultTime: '09:00', perDay: 1, minLeadDays: 5, missed: 'within', lateHours: 6 },
    rules: {
      highCpl:   { on: true, minSpend: 300000, maxCostPerMsg: 200000 },
      noResult:  { on: true, minSpend: 200000 },
      monthCap:  { on: true },
      scaleUp:   { on: true, minMsgs7d: 20, maxCostPerMsg: 100000, pct: 20, maxDaily: 1000000 },
      // Ngưỡng riêng từng thương hiệu (giá/tin nhắn): tắt khi vượt "stop", đề xuất tăng khi dưới "scale"
      byBrand:   { mishang: { stop: 100000, scale: 50000 } },
    },
    // Quảng cáo thử bài mới mỗi ngày: mặc định TẮT, mỗi quảng cáo mới phải được Sếp duyệt mới chạy
    // Quảng cáo thử bài mới: mỗi CƠ SỞ có tổng ngân sách ngày riêng; mỗi chiến dịch thử `budget`/ngày × `days` ngày,
    // chấm một lần trên tổng cả kỳ (days=7: đo theo tuần). Không có trần tháng. "match" = mẫu (regex) trong tên chiến dịch;
    // mẫu rỗng = cơ sở còn lại của thương hiệu.
    adTest: {
      // boost = luật "video đang lên view": auto=true thì agent TỰ tạo và bật quảng cáo (trong hạn mức ngày của cơ sở), không chờ duyệt
      on: false, boost: { on: true, auto: false, minViews: 150, maxAgeDays: 14, expireDays: 3 }, perUnitPerDay: 3, budget: 150000, days: 7, checkDays: 2, raisePct: 20, failByBrand: { mishang: 60000 },
      units: [
        { id: 'dh_q1', brand: 'dark_hair', name: 'Dark Hair – Quận 1', dailyBudget: 2000000, match: '' },
        { id: 'to_bt', brand: 'the_one', name: 'The One – Bình Thạnh', dailyBudget: 1500000, match: 'bình *thạnh|^bt[- ]' },
        { id: 'to_q3', brand: 'the_one', name: 'The One – Quận 3', dailyBudget: 1500000, match: '^q3|quận *3' },
        { id: 'ms_q1', brand: 'mishang', name: 'Mishang – Quận 1', dailyBudget: 1300000, match: '' },
        { id: 'ms_bt', brand: 'mishang', name: 'Mishang – Bình Thạnh', dailyBudget: 1000000, match: 'bình *thạnh|binh *thanh' },
      ],
    },
  },
  campaigns: [],
  audiences: {},             // đối tượng nhắm hiệu quả đã học theo thương hiệu (src/adtest.js)
  adTests: [],               // quảng cáo thử bài mới (xem src/adtest.js)
  approvals: [],
  actions: [],
  posts: [],
  plans: [],
  aiUsage: {},               // lượng AI dùng theo ngày/agent: { 'YYYY-MM-DD': { agent: { calls, in, out } } } (src/usage.js)
  reports: [],               // báo cáo do Agent Báo cáo tạo (src/reports.js)
  channelChecks: {},         // kết quả kiểm tra kết nối từng kênh (chỉ đọc, không có token) — src/channels-api.js
  channelPerms: null,        // quyền token Meta lần kiểm tra gần nhất (chỉ tên quyền)
  channelSync: {},           // pageId → { commentsAt, commentsError }; 'boost:<brand>' / 'pageads:<pageId>' → { error, at }: lỗi đã ghi nhật ký (để không ghi lặp)
  monthPlans: {},            // kế hoạch tháng: { 'YYYY-MM': { brandId: { goals, kpis, budget, promos, tasks, notes } } } (src/monthplan.js)
  runs: [],
  lessons: [],
  brandFacts: {},            // brand → { hotline|bookingLink|hours|prices|promotions|warranty: { value, status, validFrom, validTo, version, history } } (src/brand-facts.js)
  approvedExamples: [],      // bài đã duyệt: bản AI viết, bản cuối, có sửa hay không — kho ví dụ cho Learning Agent (src/learning.js)
  lessonUse: {},             // bài học id → { count, last }: số lần được đưa vào lời nhắc AI (src/lessons.js)
  feedback: [],
  comments: [],
  mediaMeta: {},             // brand/tên file → kết quả Gemini xem file (loại, màu tóc, số người hiện mặt...)
  mediaTrash: [],            // file đã "xoá" (chuyển vào media/.trash), khôi phục được; tự dọn sau 30 ngày
  mediaInfo: {},             // brand/tên file → { folder, tags[] }: thư mục ảo và thẻ của Thư viện Media (không động tới file thật)
  mediaFolders: {},          // brand → [tên thư mục ảo] (để thư mục rỗng vẫn còn)
  mediaConsent: {},          // brand/tên file → true khi Sếp xác nhận người trong file đồng ý đăng công khai
  inbox: {},                 // Messenger: cuộc trò chuyện id → { lastMsgId, at, pageId, brand }: tin khách cuối cùng trợ lý đã xử lý
  inboxConvs: {},            // Messenger: cuộc trò chuyện id → nhãn chất lượng (lead/unknown/spam), tên, tin cuối (src/leads.js, giữ 14 ngày)
  leadScanAt: null,          // lần chấm hộp thư gần nhất
  driveSync: {},             // brand → { folderId, on, lastRun, lastResult, files: { driveFileId: { name, md5, at } } }: nạp media từ Google Drive (src/drive.js) — không có khoá ở đây
  leads: [],                 // khách để lại tên + SĐT từ widget chat website (chỉ giữ 200 gần nhất)
  lastScan: null,
  seeded: false,
});

let db = null;

// Bổ sung giá trị mặc định cho dữ liệu đọc từ file / từ bản sao lưu (dữ liệu cũ thiếu trường mới vẫn chạy được)
function normalize(obj) {
  const x = obj && typeof obj === 'object' ? obj : DEFAULTS();
  const d = DEFAULTS();
  x.settings = { ...d.settings, ...x.settings, rules: { ...d.settings.rules, ...(x.settings || {}).rules } };
  x.settings.adTest = { ...d.settings.adTest, ...(x.settings.adTest || {}) };
  x.settings.adTest.boost = { ...d.settings.adTest.boost, ...(x.settings.adTest.boost || {}) };
  x.settings.agents = { ...d.settings.agents, ...(x.settings.agents || {}) };
  x.settings.autoPause = { ...d.settings.autoPause, ...(x.settings.autoPause || {}) };
  x.settings.security = { ...d.settings.security, ...(x.settings.security || {}) };
  x.settings.alerts = { ...d.settings.alerts, ...(x.settings.alerts || {}) };
  x.settings.notify = { ...d.settings.notify, ...(x.settings.notify || {}) };
  x.settings.scheduling = { ...d.settings.scheduling, ...(x.settings.scheduling || {}) };
  x.settings.ai = { ...d.settings.ai, ...(x.settings.ai || {}) };
  x.settings.leads = { ...d.settings.leads, ...(x.settings.leads || {}) };
  x.settings.assistant = { ...d.settings.assistant, ...(x.settings.assistant || {}), brands: { ...d.settings.assistant.brands, ...((x.settings.assistant || {}).brands || {}) } };
  // Chuyển 1 lần: ngưỡng cũ (50.000đ/25.000đ) làm tắt gần hết chiến dịch thật → đổi sang ngưỡng mới
  if (!x.settings.rulesV2) {
    const r = x.settings.rules;
    if (r.highCpl && r.highCpl.maxCostPerMsg === 50000) r.highCpl.maxCostPerMsg = 200000;
    if (r.scaleUp && r.scaleUp.maxCostPerMsg === 25000) r.scaleUp.maxCostPerMsg = 100000;
    x.settings.rulesV2 = true;
  }
  for (const k of Object.keys(d)) if (x[k] === undefined) x[k] = d[k];
  return x;
}

function load() {
  if (db) return db;
  let raw;
  try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { raw = null; }
  db = normalize(raw);
  return db;
}

// Thay TOÀN BỘ dữ liệu bằng obj (khôi phục từ bản sao lưu). Sửa tại chỗ để mọi nơi đang giữ tham chiếu vẫn thấy dữ liệu mới.
function replaceAll(obj) {
  const cur = load();
  const next = normalize(JSON.parse(JSON.stringify(obj)));
  for (const k of Object.keys(cur)) delete cur[k];
  Object.assign(cur, next);
  save();
}

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}

let seq = 0;
const uid = (p) => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}`;

module.exports = { load, save, uid, replaceAll, normalize, DEFAULTS };
