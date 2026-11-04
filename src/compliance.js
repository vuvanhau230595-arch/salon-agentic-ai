// Kiểm tra bài Xiaohongshu (小红书) trước khi duyệt/đăng.
// Các luật dưới đây tổng hợp từ bài viết của các trang marketing và văn phòng luật (nguồn thứ cấp),
// KHÔNG phải điều khoản chính thức của nền tảng — xem trang "Kênh" để biết chi tiết và đối chiếu lại định kỳ.
// Mức: block = chặn duyệt · warn = cảnh báo, Sếp quyết · info = nhắc nhẹ.
const TITLE_MAX = 20;
const BODY_MAX = 1000;
const TAGS_MAX = 10;

const len = (s) => [...String(s || '')].length;
const uniq = (a) => [...new Set(a)];

// Hashtag trong nội dung: #từ khóa đến khoảng trắng hoặc dấu câu
const TAG_RE = /#[^\s#，。！？、；：,.!?;:"“”（）()]+/g;
const tagsOf = (text) => uniq(String(text || '').match(TAG_RE) || []);

// Để lại thông tin liên hệ / dẫn khách ra ngoài nền tảng
const CONTACT = [
  [/微信|威信|薇信|公众号|小程序|wechat|weixin|zalo|whatsapp|telegram|line\s?id|扫码|二维码|加(我|v)|QQ|电话|手机号|淘宝|天猫|京东|拼多多/i, 'nhắc kênh liên hệ ngoài nền tảng (WeChat/Zalo/điện thoại/QR/sàn TMĐT)'],
  [/(^|[^a-z])v[x信]([^a-z]|$)/i, 'viết tắt WeChat (vx/v信)'],
  [/(?<!\d)(?:\+?84|0)[\s.-]?\d{2,3}[\s.-]?\d{3}[\s.-]?\d{3,4}(?!\d)/, 'có số điện thoại Việt Nam'],
  [/(?<!\d)1[3-9]\d{9}(?!\d)/, 'có số điện thoại Trung Quốc'],
  [/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|cn|vn|net|me)\b|[\w.-]+@[\w-]+\.\w+/i, 'có đường link hoặc email'],
];

// Từ tuyệt đối/cực đoan (Luật Quảng cáo): không được dùng
const EXTREME = /最(?!终|近|后|新|初|先|早)|第一(?!次|步|眼|天|个|周|章|节|印象|时间)|NO\.?\s?1|TOP\s?1|顶级|顶尖|极致|全网|全国|唯一|首选|独家|史上|绝对|万能|国家级|世界级|王牌|领导品牌|销量冠军/i;

// Lời hứa kết quả
const PROMISE = /保证|百分百|100%|一次(到位|成功|搞定)|永久|永不|不伤发|无损伤|零损伤|不掉色|包满意|根治|当然可以|(?<!不)一定(会|能)/;

// Giọng "khách hàng tự kể" trong khi tài khoản là của salon → dễ bị coi là trải nghiệm bịa
const FAKE_VOICE = /旅行顺便在|我(刚|才|今天|昨天)?(在|去)[^，。\n]{0,10}(染|烫|剪|漂|做)|我(染|烫|剪|漂|做)了|我的头发|帮我(点|染|烫|剪)|(?<!客人[^，。\n]{0,10})把头发(漂|染|烫|剪)成/;

// Hạ thấp đối thủ
const COMPARE = /别家|其他(沙龙|店)|同行|不像.{0,4}(店|沙龙)/;

// Tuyên bố công dụng y tế
const MEDICAL = /治疗|治愈|生发|防脱|育发|疗效/;

// Từ khóa marketing nhạy cảm (nguồn không đồng nhất, chỉ nhắc)
const SALESY = /购买|下单|折扣|优惠|团购|秒杀|限时|抢购|特价/;

const OTHER_PLATFORM = /tiktok|douyin|抖音|快手|kuaishou|capcut|剪映|instagram|facebook|youtube/i;

// post = { title, body, media?: [{ name, type, info?, meta?, consent?, note? }] }
function lint(post) {
  const title = String(post.title || '').trim();
  const body = String(post.body || '').trim();
  const text = `${title}\n${body}`;
  const issues = [];
  const add = (level, code, msg) => issues.push({ level, code, msg });

  if (!title) add('block', 'title_empty', 'Thiếu tiêu đề (小红书 nên có tiêu đề, tối đa 20 chữ)');
  else if (len(title) > TITLE_MAX) add('block', 'title_long', `Tiêu đề dài ${len(title)}/${TITLE_MAX} chữ — nền tảng không nhận`);
  if (!body) add('block', 'body_empty', 'Thiếu nội dung bài');
  else if (len(body) > BODY_MAX) add('block', 'body_long', `Nội dung dài ${len(body)}/${BODY_MAX} chữ — nền tảng không nhận`);

  for (const [re, msg] of CONTACT) if (re.test(text)) add('block', 'contact', `Dẫn khách ra ngoài: ${msg}. Nên mời khách "私信" (nhắn riêng) thay vì để liên hệ trong bài`);
  const ex = text.match(EXTREME);
  if (ex) add('block', 'extreme', `Từ cực đoan "${ex[0]}" (cấm theo Luật Quảng cáo) — đổi sang cách nói khác`);

  const pr = text.match(PROMISE);
  if (pr) add('warn', 'promise', `Có vẻ hứa kết quả: "${pr[0]}" — nên nói "cần đánh giá chất tóc trước"`);
  const fv = text.match(FAKE_VOICE);
  if (fv) add('warn', 'fake_voice', `Giọng khách hàng tự kể ("${fv[0]}") trong khi đăng từ tài khoản salon — viết theo giọng salon ("客人…"、"我们…")`);
  if (COMPARE.test(text)) add('warn', 'compare', 'Có so sánh/hạ thấp đối thủ — nền tảng theo dõi nhóm này (拉踩)');
  const md = text.match(MEDICAL);
  if (md) add('warn', 'medical', `Có tuyên bố công dụng y tế "${md[0]}" — tránh với dịch vụ làm tóc`);
  if (SALESY.test(text)) add('info', 'salesy', 'Có từ khuyến mại/bán hàng trực diện — nguồn tham khảo ghi đây là nhóm nhạy cảm, đọc lại cho tự nhiên');

  const tags = tagsOf(body);
  if (!tags.length) add('info', 'no_tags', 'Chưa có hashtag — nên có 3–6 thẻ (VD #越南做头发 #胡志明市做头发)');
  else if (tags.length > TAGS_MAX) add('warn', 'many_tags', `Có ${tags.length} hashtag — nên ≤ ${TAGS_MAX}`);
  // Nhận diện quán: khách phải biết ngay đây là quán nào, ở thành phố nào (cần brandName/locationHint từ hồ sơ thương hiệu)
  if (body && post.brandName && !text.toLowerCase().includes(String(post.brandName).toLowerCase())) add('warn', 'no_brand', `Chưa nêu tên quán "${post.brandName}" trong bài — khách không biết đây là quán nào`);
  if (body && post.locationHint && !text.includes(post.locationHint)) add('warn', 'no_location', `Chưa nêu khu vực (${post.locationHint}) trong bài — khách không biết quán ở đâu`);
  if (body && !/私信/.test(body)) add('info', 'no_cta', 'Chưa có lời mời nhắn riêng (私信「预约」) để khách đặt lịch');

  for (const m of post.media || []) {
    const label = m.name;
    if (m.type === 'video' && m.info && m.info.width) {
      const short = Math.min(m.info.width, m.info.height);
      if (short < 1080) add('warn', 'resolution', `${label}: video ${m.info.width}×${m.info.height} (~${m.info.kbps} kbps) — nền tảng khuyên 1080P trở lên; chất lượng đăng lên bị giới hạn bởi file gốc`);
    }
    if (m.meta && Number(m.meta.faces) > 0 && !m.consent) add('warn', 'consent', `${label}: có ${m.meta.faces} người hiện mặt — cần xác nhận họ đồng ý đăng công khai (đánh dấu ở Thư viện Media)`);
    if (m.meta && m.meta.watermark && OTHER_PLATFORM.test(m.meta.watermark)) add('warn', 'watermark', `${label}: có watermark nền tảng khác (${m.meta.watermark}) — dễ bị giảm hiển thị`);
    if (m.note && /qr|điện thoại|sđt|hotline|số nhà/i.test(m.note)) add('warn', 'media_contact', `${label}: ghi chú cho biết hình có mã QR/số điện thoại — kiểm tra trước khi đăng`);
  }

  return {
    issues,
    blocked: issues.some((i) => i.level === 'block'),
    warns: issues.filter((i) => i.level === 'warn').length,
  };
}

const summarize = (r) => r.issues.filter((i) => i.level !== 'info').map((i) => i.msg).join('; ');

module.exports = { lint, tagsOf, summarize, len, TITLE_MAX, BODY_MAX, TAGS_MAX };
