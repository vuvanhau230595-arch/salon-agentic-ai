// Kênh 小红书 Xiaohongshu — chế độ "gói đăng thủ công".
// Xiaohongshu không có API đăng bài cho tài khoản thường, nên agent làm phần việc nặng và để người bấm đăng:
//   1) soạn bài tiếng Trung theo giọng salon (AI, hoặc mẫu có sẵn khi chưa có ANTHROPIC_API_KEY)
//   2) kiểm tra tuân thủ (src/compliance.js) — bài vi phạm nặng bị chặn duyệt
//   3) tạo "gói đăng": tiêu đề, nội dung, hashtag, file video/ảnh, giờ hẹn (giờ Bắc Kinh) + các bước
//   4) theo dõi: Sếp đánh dấu "đã hẹn giờ trên 小红书" / "đã đăng" để nhật ký và thư viện media khớp thực tế
const fs = require('node:fs');
const { load, save } = require('./db');
const ai = require('./ai');
const lib = require('./media');
const { lint, tagsOf } = require('./compliance');

const ID = 'xiaohongshu';
const isXhs = (channel) => channel === ID;
const planner = () => require('./planner');
const engine = () => require('./engine');

// Giờ theo múi giờ chỉ định, dạng YYYY-MM-DD HH:mm
function fmtTz(iso, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`;
}
const beijing = (iso) => fmtTz(iso, 'Asia/Shanghai');
const vietnam = (iso) => fmtTz(iso, 'Asia/Ho_Chi_Minh');

// Tách phần hashtag nằm ở cuối bài
function splitCaption(text) {
  const lines = String(text || '').trimEnd().split('\n');
  const hashtags = [];
  while (lines.length && /^\s*(#\S+\s*)+$/.test(lines[lines.length - 1])) hashtags.unshift(...tagsOf(lines.pop()));
  return { body: lines.join('\n').trim(), hashtags };
}

const DEFAULT_TAGS = ['#越南做头发', '#胡志明市做头发', '#旅行变美'];
const normTag = (t) => { const s = String(t || '').trim().replace(/\s+/g, ''); return s ? (s.startsWith('#') ? s : '#' + s) : ''; };

// Dòng nhận diện mở đầu bài: để khách biết ngay đây là quán nào, ở khu nào
const headerLine = (brand) => (brand && brand.locationZh ? `🏠 ${brand.name}｜${brand.locationZh}${brand.taglineZh ? ' · ' + brand.taglineZh : ''}` : '');
// Hashtag thương hiệu + khu vực (VD #TheOneHairSalon #胡志明市美发 #胡志明市三郡)
const brandTags = (brand) => (brand && brand.locationZh ? [`#${String(brand.name).replace(/\s+/g, '')}`, '#胡志明市美发', `#${brand.locationZh}`] : []);

// Ghép dòng nhận diện + thân bài + địa chỉ + hashtag thành 1 chuỗi caption (hashtag ở dòng cuối)
function compose(body, hashtags, brand) {
  let b = String(body || '').trim();
  const head = headerLine(brand);
  if (head && !b.includes(brand.name)) b = `${head}\n\n${b}`;
  if (brand && brand.addressZh && !b.includes(brand.addressZh)) b += `\n📍 地址：${brand.addressZh}`;
  const tags = [...new Set([...(hashtags || []), ...(hashtags && hashtags.length ? [] : DEFAULT_TAGS), ...brandTags(brand)].map(normTag).filter(Boolean))].slice(0, 10);
  return `${b}\n\n${tags.join(' ')}`;
}

// ---- Mẫu có sẵn (khi chưa có AI): không nhắc dịch vụ/màu cụ thể nên không bịa chi tiết ----
const FALLBACKS = [
  { topic: 'Quy trình đặt lịch', title: '到店做头发怎么预约？3步搞定', body: '来越南旅行想做头发，预约其实很简单👇\n\n1️⃣ 私信「预约」\n2️⃣ 发头发现状照片（正面+背面）\n3️⃣ 告诉我们到店日期和人数\n\n我们会先评估发质，再告诉你适合的方案和大概用时，不临时加项目。' },
  { topic: 'Đánh giá chất tóc trước khi làm', title: '染发前，为什么要先评估发质？', body: '很多姐妹直接问“能不能染成这个色”，其实要先看发质👀\n\n✅ 原发色深浅，决定是否需要提亮\n✅ 受损程度，决定做几次、要不要先护理\n✅ 目标颜色，决定用时和方案\n\n把头发照片私信发给我们，发型师帮你评估～' },
  { topic: 'Mẹo giữ màu tóc', title: '染后护色小提示｜洗护这样做', body: '染完头发想让颜色更持久，日常这样做💡\n\n· 前几次洗头用温水，水温不要太高\n· 选择护色洗护产品\n· 少用高温造型工具\n\n颜色会因光线和滤镜有差别，以到店为准。' },
  { topic: 'Không gian salon', title: '来店里坐坐｜木质米色的沙龙空间', body: '想知道我们店里是什么样？🌿\n\n· 暖米色+木质，坐着放松\n· 每个座位有独立镜面\n· 有编号储物柜，随身物品可以放心寄存\n· 等候区有长凳和绿植\n\n旅行途中也可以安心做头发～' },
  { topic: 'Sắp xếp lịch du lịch', title: '旅行几天，怎么安排做头发？', body: '怕做头发耽误行程？可以这样安排🗓\n\n📅 到达后先私信确认方案和时间\n📅 选一个上午到店，下午继续逛\n📅 想做浅色或漂发，行程多留一点时间\n\n用时按发长和发质而定，我们会提前告知。' },
  { topic: 'Câu hỏi thường gặp', title: '做头发前，姐妹们常问的3个问题', body: '整理了大家经常问的👇\n\n❓ 语言不通怎么办？发参考图，沟通更清楚\n❓ 会不会乱收费？到店前先说明，不临时加项目\n❓ 要预约吗？建议提前私信，旺季更容易约满\n\n还有问题，评论区或私信都可以问。' },
];

function fallbackItem(i, brand) {
  const f = FALLBACKS[i % FALLBACKS.length];
  const cta = '\n\n📩 想预约？私信「预约」，告诉我们日期、人数，再发头发照片～';
  return { topic: f.topic, title: f.title, text: compose(f.body + cta, DEFAULT_TAGS, brand) };
}

// ---- Soạn bằng AI ----
const systemZh = (brand) => `Bạn là biên tập viên 小红书 (Xiaohongshu) cho salon tóc tại TP.HCM, viết bằng TIẾNG TRUNG GIẢN THỂ, đối tượng là du khách/Hoa kiều. Bài đăng từ tài khoản của SALON "${brand.name}".
LUẬT CỨNG (vi phạm là bài bị chặn, không được vi phạm):
1. Giọng salon: "客人…在店里做的"、"我们…". KHÔNG viết như khách tự kể ("我染了"、"旅行顺便…"、"我的头发"、"帮我").
2. Không dùng từ cực đoan: 最/第一/顶级/唯一/首选/NO.1/全网/绝对 (trừ "最近"、"最终").
3. Không hứa kết quả (保证/一定/永久/不伤发/不掉色/当然可以). Thay bằng "需要先评估发质".
4. Tuyệt đối không để WeChat/Zalo/số điện thoại/link/mã QR/tên sàn TMĐT. Chỉ mời khách "私信「预约」" kèm gửi ảnh tóc, ngày đến, số người.
5. Không so sánh hay chê salon khác; không tuyên bố công dụng y tế.
6. Tiêu đề (title) ≤ 20 chữ Hán. Nội dung 120–300 chữ, 1–3 emoji, chia dòng ngắn dễ đọc.
7. Khi nhắc màu tóc phải có câu: 颜色会因光线和滤镜有差别，以到店为准.
8. 5–7 hashtag (trường hashtags), luôn có #越南做头发 #胡志明市做头发 (hệ thống tự thêm hashtag thương hiệu/khu vực).
8b. Dòng nhận diện "${brand.name}｜${brand.locationZh || '胡志明市'}" sẽ được hệ thống chèn đầu bài: KHÔNG tự viết lại dòng đó, nhưng trong thân bài hãy nói rõ đây là salon ở TP.HCM (胡志明市) khi hợp lý.
9. Không bịa giá, thời gian làm, hãng thuốc, khuyến mãi, số người; chỉ dùng thông tin có trong tên/ghi chú file.
${brand.addressZh ? `10. Cuối bài chèn địa chỉ: 📍 地址：${brand.addressZh}` : ''}`;

function parseArray(raw) {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
    return Array.isArray(arr) && arr.length ? arr : null;
  } catch { return null; }
}

const fromAi = (x, brand) => ({
  topic: String(x.topic || x.title || ''),
  title: String(x.title || '').trim(),
  text: compose(x.body || '', Array.isArray(x.hashtags) ? x.hashtags : tagsOf(x.body), brand),
});

// n bài cho kế hoạch tháng. hints: mô tả file đính kèm từng bài (tên/ghi chú/kết quả Gemini)
async function aiItems(n, brand, type, direction, dates, hints = []) {
  const mediaLines = hints.map((h, i) => (h ? `Bài ${i + 1}: đăng kèm ${type === 'reel' ? 'video' : 'ảnh'} "${h}"` : '')).filter(Boolean);
  const prompt = `Lập ${n} bài 小红书 (${type === 'reel' ? 'video' : 'ảnh + chữ'}) cho "${brand.name}".
Ngày đăng: ${dates.map((d) => d.toLocaleDateString('vi-VN')).join(', ')}.
Định hướng của Sếp: ${direction || '(tự đề xuất đa dạng: kết quả khách, quy trình đặt lịch, lưu ý trước khi làm, không gian salon)'}.
${planner().brandContext(brand)}
${mediaLines.length ? `Mỗi bài đi kèm file có sẵn, nội dung phải hợp với file (không bịa chi tiết ngoài mô tả):\n${mediaLines.join('\n')}\n` : ''}Chỉ trả về JSON thuần: mảng đúng ${n} phần tử {"topic":"chủ đề ngắn tiếng Việt","title":"tiêu đề tiếng Trung ≤20 chữ","body":"nội dung tiếng Trung","hashtags":["#…"]}.`;
  const arr = parseArray(await ai.ask(systemZh(brand), prompt, 6000));
  return arr ? arr.map((x) => fromAi(x, brand)) : null;
}

// 1 bài lẻ theo chủ đề Sếp gõ
async function draftOne(brand, topic, extra = '') {
  const prompt = `Viết 1 bài 小红书 về: ${topic}.\n${extra}\nChỉ trả về JSON thuần: mảng 1 phần tử {"topic":"…","title":"…","body":"…","hashtags":["#…"]}.`;
  const arr = parseArray(await ai.ask(systemZh(brand), prompt, 1500));
  return arr ? fromAi(arr[0], brand) : { ...fallbackItem(0, brand), topic };
}

// ---- Kiểm tra tuân thủ ----
function lintParts(brandId, title, text, mediaSet) {
  const b = planner().brands()[brandId] || {};
  return lint({ title, body: text, media: lib.facts(brandId, mediaSet), brandName: b.name, locationHint: b.locationZh ? b.locationZh.replace(/市.*$/, '市') : '' });
}
const lintPost = (p) => lintParts(p.brand, p.title, p.text, p.media);
const lintItem = (plan, it) => lintParts(plan.brand, it.title, it.text, it.media);

// ---- Gói đăng ----
function buildPackage(post) {
  if (!isXhs(post.channel)) throw new Error('Chỉ tạo gói đăng cho bài 小红书');
  const brand = planner().brands()[post.brand] || {};
  const { body, hashtags } = splitCaption(post.text);
  const files = (post.media || []).map((m) => {
    const f = { name: m.name, type: m.type, path: null, size: 0, info: null, missing: false };
    try {
      f.path = lib.resolve(post.brand, m.name);
      f.size = fs.statSync(f.path).size;
      if (m.type === 'video') f.info = require('./mp4info').info(f.path);
    } catch { f.missing = true; }
    return f;
  });
  const isVideo = files.some((f) => f.type === 'video');
  return {
    postId: post.id,
    status: post.status,
    brand: post.brand,
    brandName: brand.name || '',
    title: post.title || '',
    body,
    hashtags,
    caption: post.text,
    address: brand.addressZh || '',
    scheduledAt: post.scheduledAt,
    scheduledBeijing: beijing(post.scheduledAt),
    scheduledVietnam: vietnam(post.scheduledAt),
    media: files,
    lint: lintPost(post),
    steps: [
      'Mở trang creator (creator.rednote.com hoặc creator.xiaohongshu.com), đăng nhập bằng tài khoản của salon (quét QR bằng app, nhớ bấm xác nhận trên điện thoại).',
      `Bấm 发布笔记 → ${isVideo ? '上传视频 và chọn file video bên dưới' : '上传图文 và chọn ảnh bên dưới (tối đa 18 ảnh)'}.`,
      'Dán tiêu đề vào ô tiêu đề, dán nội dung vào ô nội dung (đợi trang tải xong rồi mới gõ — lần gõ đầu có thể bị mất ký tự).',
      'Hashtag: nên chọn bằng nút 话题 để thành chủ đề có liên kết.',
      `Kéo xuống bật 定时发布 và đặt giờ ${beijing(post.scheduledAt)} (giờ Bắc Kinh = ${vietnam(post.scheduledAt)} giờ Việt Nam), rồi bấm 定时发布.`,
      'Quay lại agent bấm "Đã hẹn giờ trên 小红书" (hoặc "Đã đăng" nếu đăng ngay). Nhớ: vị trí (POI) của quán ở Việt Nam không gắn được, địa chỉ đã nằm trong nội dung.',
    ],
  };
}

const MARK_FROM = ['scheduled', 'awaiting_manual', 'external_scheduled'];
// action: 'external_scheduled' | 'published' | 'reset'
function markPost(postId, action, url) {
  const db = load();
  const p = db.posts.find((x) => x.id === postId);
  if (!p) throw new Error('Không tìm thấy bài');
  if (!isXhs(p.channel)) throw new Error('Chỉ dùng cho bài 小红书');
  if (action === 'reset') {
    if (!['external_scheduled', 'published'].includes(p.status)) throw new Error('Bài chưa ở trạng thái đã hẹn/đã đăng');
    p.status = 'scheduled';
    delete p.skipReason; delete p.url; delete p.publishedAt;
  } else if (['external_scheduled', 'published'].includes(action)) {
    if (!MARK_FROM.includes(p.status)) throw new Error('Bài này chưa được duyệt hoặc đã đăng rồi');
    p.status = action;
    if (action === 'published') { p.publishedAt = new Date().toISOString(); p.manual = true; p.live = false; }
    const link = String(url || '').trim().slice(0, 300);
    if (link) p.url = link;
  } else throw new Error('Hành động không hợp lệ');
  engine().log('publish', `小红书 "${p.topic}": ${action === 'published' ? 'Sếp xác nhận ĐÃ ĐĂNG' : action === 'external_scheduled' ? 'đã hẹn giờ trên 小红书' : 'đưa về chờ đăng'}`);
  save();
  return p;
}

// Chặn duyệt nếu có bài vi phạm nặng. entries: [{ label, result }]
function assertApprovable(entries) {
  const bad = entries.filter((e) => e.result.blocked);
  if (!bad.length) return;
  const lines = bad.map((e) => `• ${e.label}: ${e.result.issues.filter((i) => i.level === 'block').map((i) => i.msg).join('; ')}`);
  throw new Error(`${bad.length} bài 小红书 vi phạm nặng, sửa trước khi duyệt:\n${lines.join('\n')}`);
}

module.exports = { ID, isXhs, beijing, vietnam, splitCaption, compose, aiItems, draftOne, fallbackItem, FALLBACKS, lintPost, lintItem, lintParts, buildPackage, markPost, assertApprovable };
