// Trả lời nhanh cho khách nhắn riêng (小红书 / kênh khác): bán tự động.
// Agent nhận diện khách hỏi gì, chọn mẫu tiếng Trung, điền giá (VNĐ + CNY) và bản dịch tiếng Việt;
// người đọc duyệt rồi tự bấm gửi. KHÔNG tự gửi tin — nền tảng không cho tài khoản thường dùng API tin nhắn.
// Giá lấy từ bảng giá trên theonehairsalon.vn (ưu đãi tháng 10/2026). Hết hạn thì cảnh báo, không tự đoán giá mới.
const { lint } = require('./compliance');
const VI = require('./replies-vi');

const PROMO_END = '2026-10-31';
const DEFAULT_RATE = 3650; // VNĐ cho 1 CNY, tạm tính — Sếp chỉnh trên giao diện

// Giá GỐC (nghìn đồng) theo size S/M/L; group: 'main' giảm 40/45/50% theo số người, hoặc % cố định
const SERVICES = {
  comboA: { zh: '套餐A（意大利产品）染/烫/拉直', vi: 'Combo A (sản phẩm Ý) nhuộm/uốn/duỗi', orig: [800, 1000, 1300], group: 'main', note: 'gồm cắt + gội + tạo kiểu' },
  comboS: { zh: '套餐S（德国产品）染/烫/拉直', vi: 'Combo S (sản phẩm Đức) nhuộm/uốn/duỗi', orig: [1500, 1800, 2200], group: 'main', note: 'gồm cắt + gội + tạo kiểu' },
  ion: { zh: 'ION蒸汽+纯素产品（染或拉直）', vi: 'Combo hơi nước ION + thuần chay (nhuộm hoặc ép)', orig: [1500, 1500, 1500], group: 'main', note: 'một giá cho mọi độ dài tóc' },
  fashionA: { zh: '时尚色 套餐A', vi: 'Màu thời trang Combo A', orig: [2600, 3000, 3500], group: 'main', note: 'có tẩy nâng tone' },
  fashionS: { zh: '时尚色 套餐S', vi: 'Màu thời trang Combo S', orig: [3000, 3500, 4000], group: 'main', note: 'có tẩy nâng tone' },
  balayage: { zh: '挑染渐变 Balayage/Ombre', vi: 'Balayage / Ombre', orig: [3800, 4400, 5200], group: 'main' },
  keratin: { zh: '角蛋白修护 Keratin（意）', vi: 'Phục hồi Keratin (Ý)', orig: [600, 800, 1000], group: 20 },
  olaplex: { zh: 'Olaplex修护（德）', vi: 'Phục hồi Olaplex (Đức)', orig: [null, 900, 1100], group: 20 },
  number3: { zh: 'Number Three修护（德）', vi: 'Phục hồi Number Three (Đức)', orig: [1000, 1200, 1500], group: 20 },
  highlight: { zh: '挑染 Highlight', vi: 'Highlight', orig: [1000, 1000, 1000], group: 'main' },
  tachmau: { zh: '分色', vi: 'Tách màu', orig: [1000, 1000, 1000], group: 10 },
  cut: { zh: '设计剪发', vi: 'Cắt thiết kế', orig: [250, 250, 250], group: 0 },
  wash: { zh: '洗发', vi: 'Gội thường', orig: [100, 100, 100], group: 0 },
  hap: { zh: '修护发膜', vi: 'Hấp phục hồi', orig: [300, 300, 300], group: 0 },
};
const SIZES = ['S', 'M', 'L'];
const SIZE_LABEL = { S: ['短发', 'tóc ngắn'], M: ['及肩', 'tóc ngang vai'], L: ['长发', 'tóc dài'] };

const mainPct = (people) => (people >= 3 ? 50 : people === 2 ? 45 : 40);
const pctOf = (svc, people) => (svc.group === 'main' ? mainPct(people) : svc.group);
const priceK = (svc, size, people) => {
  const o = svc.orig[SIZES.indexOf(size)];
  return o == null ? null : Math.round(o * (100 - pctOf(svc, people)) / 100);
};
const cnyOf = (vndK, rate) => { if (vndK == null) return null; const v = vndK * 1000 / rate; const r = v < 200 ? 5 : 10; return Math.round(v / r) * r; };
const fmtVnd = (k) => k == null ? '—' : (k * 1000).toLocaleString('vi-VN') + 'đ';
const fmtBoth = (k, rate) => (k == null ? '—' : `¥${cnyOf(k, rate)}（约${(k * 1000).toLocaleString('en-US')}越盾）`);

function promoActive(now = new Date()) { return now <= new Date(PROMO_END + 'T23:59:59+07:00'); }

// Bảng giá đầy đủ cho giao diện
function priceTable(rate = DEFAULT_RATE, people = 1) {
  return Object.entries(SERVICES).map(([key, s]) => ({
    key, zh: s.zh, vi: s.vi, note: s.note || '', discountPct: pctOf(s, people),
    sizes: SIZES.map((z) => { const k = priceK(s, z, people); return { size: z, vndK: k, vnd: k == null ? null : k * 1000, cny: cnyOf(k, rate) }; }),
  }));
}

// ---- Nhận diện ý định ----
const INTENTS = [
  ['confirm', 'Khách gửi tên + SĐT', /(?<!\d)0\d{9,10}(?!\d)|(?<!\d)\+?84\d{9,10}(?!\d)/],
  ['payment', 'Thanh toán', /支付|付款|刷卡|现金|转账|信用卡|payment|\bpay\b|credit card|\bcash\b|thanh toán|chuyển khoản|quẹt thẻ|tiền mặt/i],
  ['contact', 'Khách hỏi SĐT/WeChat', /微信|wechat|weixin|电话|手机|联系方式|whatsapp|zalo|line\b|số điện thoại|sđt|phone number/i],
  ['reschedule', 'Đổi lịch / đến trễ', /改期|取消|迟到|晚到|推迟|reschedule|cancel|late|đổi lịch|hủy|huỷ|trễ/i],
  ['warranty', 'Bảo hành', /保修|售后|保证|warranty|guarantee|bảo hành/i],
  ['damage', 'Lo hư tóc / tẩy tóc', /伤发|会伤|烧|烂|断发|漂发|damage|bleach|hư tóc|tẩy|cháy/i],
  ['address', 'Địa chỉ / đường đi', /地址|在哪|怎么去|位置|交通|where|address|location|địa chỉ|ở đâu|đường đi/i],
  ['discount', 'Ưu đãi', /优惠|折扣|活动|打折|promotion|discount|ưu đãi|giảm giá|khuyến mãi/i],
  ['extension', 'Nối tóc', /nối tóc|tóc nối|lông vũ|nối \d|tép/i],
  ['walkin', 'Ghé ngang / không đặt trước', /ghé ngang|không đặt trước|k đăng ký trước|không đăng ký trước|đi ngay|không cần đặt|chưa biết khi nào/i],
  ['price', 'Hỏi giá', /多少钱|价格|价钱|报价|费用|收费|price|how much|cost|giá|bao nhiêu/i],
  ['booking', 'Đặt lịch', /预约|订|约一|想做|book|appointment|đặt lịch|hẹn|明天|后天|今天|tomorrow/i],
  ['thanks', 'Cảm ơn / sau khi làm', /谢谢|感谢|满意|thanks|thank you|cảm ơn/i],
  ['language', 'Ngôn ngữ', /中文|会说|英语|英文|语言|english|chinese|nói tiếng|ngôn ngữ/i],
  ['greeting', 'Chào hỏi', /你好|您好|在吗|hello|hi\b|xin chào|chào/i],
];

function detectIntent(msg) {
  const t = String(msg || '');
  for (const [id, label, re] of INTENTS) if (re.test(t)) return { id, label };
  return { id: 'unknown', label: 'Chưa nhận ra ý khách' };
}

function detectSize(msg) {
  const t = String(msg || '');
  const sz = t.match(/\bsize\s*([sml])\b/i);
  if (sz) return sz[1].toUpperCase();
  if (/短发|short|ngắn|ngang cằm|bob|齐耳/i.test(t)) return 'S';
  if (/及肩|锁骨|shoulder|ngang vai|qua vai|chấm vai/i.test(t)) return 'M';
  if (/长发|long|dài|qua ngực|qua lưng|腰/i.test(t)) return 'L';
  return null;
}
function detectPeople(msg) {
  const t = String(msg || '');
  const m = t.match(/(\d)\s*(人|个人|位|people|persons|người)/i);
  if (m) return Math.min(9, Math.max(1, Number(m[1])));
  if (/三个人|三人|3人|ba người/.test(t)) return 3;
  if (/两个人|两人|俩|二人|hai người|2 people/.test(t)) return 2;
  return 1;
}
function detectLang(msg) {
  const t = String(msg || '');
  if (/[\u4e00-\u9fff]/.test(t)) return 'zh';
  if (/[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(t) || /\b(dạ|ạ|nha|nhé|chị|em|giá|bao nhiêu|tóc|nhuộm|uốn|duỗi|cắt|đặt lịch|tư vấn|mình|shop|salon ơi)\b/i.test(t)) return 'vi';
  return 'zh';
}
function peopleKnown(msg) {
  const t = String(msg || '');
  return /(\d)\s*(人|个人|位|people|persons|người)|三个人|三人|两个人|两人|俩|二人|ba người|hai người|đi 1 mình|đi một mình|mình đi 1|đi cùng bạn|đi nhóm/i.test(t);
}
function detectService(msg) {
  const t = String(msg || '');
  if (/balayage|ombre|渐变/i.test(t)) return 'balayage';
  if (/highlight|挑染|\blight\b/i.test(t)) return 'highlight';
  if (/olaplex/i.test(t)) return 'olaplex';
  if (/number\s*three|n°3/i.test(t)) return 'number3';
  if (/keratin|角蛋白|修护|护理|phục hồi/i.test(t)) return 'keratin';
  if (/ion|蒸汽|纯素|thuần chay/i.test(t)) return 'ion';
  if (/粉|红|蓝|紫|灰|铂金|银|金发|漂|时尚色|fashion|hồng|đỏ|xanh|tím|bạch kim|thời trang/i.test(t)) return 'fashionA';
  if (/染|dye|color|colour|nhuộm|烫|perm|uốn|拉直|直发|straight|ép|duỗi/i.test(t)) return 'comboA';
  if (/剪|cut|cắt/i.test(t)) return 'cut';
  if (/洗|wash|gội/i.test(t)) return 'wash';
  return null;
}

// ---- Mẫu trả lời: mỗi mẫu trả {zh, vi} ----
function ctx(brand, o) {
  const b = brand || {};
  return {
    name: b.name || 'The One Hair Salon',
    addrZh: b.addressZh || '胡志明市三郡 Nhiêu Lộc坊 Đỗ Thị Lời街 436/29号',
    addrVi: '436/29 Đỗ Thị Lời (436/29 Cách Mạng Tháng Tám), P. Nhiêu Lộc, Quận 3',
    rate: o.rate, people: o.people, size: o.size, service: o.service,
  };
}

function quoteLines(c) {
  const svc = SERVICES[c.service];
  if (!svc) return null;
  const sizes = c.size ? [c.size] : SIZES;
  const zh = sizes.map((z) => `${c.size ? '' : SIZE_LABEL[z][0] + '：'}${fmtBoth(priceK(svc, z, c.people), c.rate)}`).join(c.size ? '' : '\n');
  const vi = sizes.map((z) => `${c.size ? '' : SIZE_LABEL[z][1] + ': '}${fmtVnd(priceK(svc, z, c.people))} (~¥${cnyOf(priceK(svc, z, c.people), c.rate)})`).join(c.size ? '' : '\n');
  return { zh, vi, svc };
}

const T = {
  greeting: (c) => ({
    zh: `你好呀～欢迎来到 ${c.name}🌿 我们在胡志明市三郡。请问你想做什么项目呢（染发 / 烫发 / 拉直 / 护理 / 剪发）？可以发一张你现在的头发照片和想做的参考图，我们帮你评估并报价～`,
    vi: `Chào bạn, chào mừng đến ${c.name}, chúng tôi ở Quận 3, TP.HCM. Bạn muốn làm dịch vụ gì (nhuộm / uốn / duỗi / phục hồi / cắt)? Gửi ảnh tóc hiện tại và ảnh tham khảo, chúng tôi đánh giá và báo giá.`,
  }),
  price: (c) => {
    const q = quoteLines(c);
    if (!q) {
      return {
        zh: `价格会根据发长（短发 / 及肩 / 长发）、发质和是否需要漂发来定。自然色染发套餐 ${fmtBoth(priceK(SERVICES.comboA, 'S', c.people), c.rate)} 起（短发），时尚色 ${fmtBoth(priceK(SERVICES.fashionA, 'S', c.people), c.rate)} 起。你发一下头发照片和发长，我们给你更准确的报价～`,
        vi: `Giá phụ thuộc độ dài tóc, chất tóc và việc có cần tẩy. Nhuộm màu tự nhiên combo từ ${fmtVnd(priceK(SERVICES.comboA, 'S', c.people))} (~¥${cnyOf(priceK(SERVICES.comboA, 'S', c.people), c.rate)}, tóc ngắn), màu thời trang từ ${fmtVnd(priceK(SERVICES.fashionA, 'S', c.people))}. Gửi ảnh tóc và độ dài để báo giá chính xác.`,
      };
    }
    const nZh = q.svc.note ? `（${q.svc.note.replace('gồm cắt + gội + tạo kiểu', '含剪发+洗发+造型').replace('có tẩy nâng tone', '含漂发提亮').replace('một giá cho mọi độ dài tóc', '不分发长同价')}）` : '';
    return {
      zh: `${q.svc.zh}${nZh}：\n${q.zh}\n具体价格以到店后设计师看过发质为准，做之前会先说明价格和流程，不会临时加项目。${c.people >= 2 ? `\n${c.people}人一起已按优惠价计算。` : ''}`,
      vi: `${q.svc.vi}${q.svc.note ? ` (${q.svc.note})` : ''}:\n${q.vi}\nGiá chính xác tuỳ stylist xem tóc tại salon; báo giá và quy trình trước khi làm, không phát sinh.${c.people >= 2 ? ` Đã tính ưu đãi đi ${c.people} người.` : ''}`,
    };
  },
  booking: () => ({
    zh: '好的，帮你预约～ 请告诉我们：\n1）到店日期和时间（营业时间 9:00–21:30）\n2）人数\n3）想做的项目\n4）怎么称呼你\n我们确认后会回复你。到店前如果行程有变，请提前告诉我们哦。',
    vi: 'Bên mình đặt lịch cho bạn. Cho biết: 1) ngày giờ đến (9:00–21:30), 2) số người, 3) dịch vụ muốn làm, 4) cách xưng hô. Xác nhận xong sẽ phản hồi. Nếu lịch trình đổi, báo trước giúp.',
  }),
  address: (c) => ({
    zh: `我们在胡志明市三郡：${c.addrZh}（也写作 Cách Mạng Tháng Tám 436/29）。营业时间 9:00–21:30。打车或用 Grab 搜索 "${c.name}"，或直接输入这个地址即可。`,
    vi: `Chúng tôi ở ${c.addrVi}. Mở cửa 9:00–21:30. Đi taxi/Grab, tìm "${c.name}" hoặc nhập địa chỉ.`,
  }),
  discount: () => ({
    zh: '十月优惠（10 月 1 日至 31 日）：主要项目单人优惠 40%，两人一起优惠 45%，三人及以上优惠 50%（需同时做主要项目）。修护项目优惠 20%，其他单项优惠 10%。剪发和洗发为原价。优惠不叠加，按优惠力度较大的一档计算。',
    vi: 'Ưu đãi tháng 10 (01–31/10): dịch vụ chính 1 người giảm 40%, 2 người 45%, từ 3 người 50% (cùng làm dịch vụ chính). Phục hồi giảm 20%, dịch vụ lẻ 10%. Cắt và gội giữ giá niêm yết. Không cộng dồn, áp dụng mức cao nhất.',
  }),
  damage: () => ({
    zh: '我们会先看你的发质和染烫历史再决定方案，必要时建议先做修护，不会勉强。漂发的效果会因原发色和发质有差别，设计师会在做之前和你说清楚。',
    vi: 'Chúng tôi xem chất tóc và lịch sử nhuộm/uốn trước rồi mới quyết định, cần thì khuyên phục hồi trước, không ép làm. Kết quả tẩy tuỳ màu gốc và chất tóc; stylist nói rõ trước khi làm.',
  }),
  warranty: () => ({
    zh: '我们有保修：拉直 90 天、烫发 60 天、染发（不漂）60 天、染发（漂发）30 天，并赠送一次补色。具体条件到店时设计师会说明。',
    vi: 'Bảo hành: duỗi 90 ngày, uốn 60 ngày, nhuộm không tẩy 60 ngày, nhuộm có tẩy 30 ngày + tặng 1 lần phủ màu. Điều kiện cụ thể stylist nói khi tới.',
  }),
  language: () => ({
    zh: '没问题～ 你可以把想要效果的图片带来，我们沟通方案时会尽量说清楚。也可以先在这里把想法发给我们。',
    vi: 'Không sao, bạn mang ảnh kiểu muốn làm, chúng tôi trao đổi cho rõ. Có thể gửi trước ý tưởng qua tin nhắn.',
  }),
  reschedule: () => ({
    zh: '没关系，请告诉我们新的日期和时间，我们帮你调整。如果会迟到，请提前告诉我们，我们会尽量帮你安排。',
    vi: 'Không sao, cho biết ngày giờ mới để bên mình điều chỉnh. Nếu đến trễ, báo trước, chúng tôi cố gắng sắp xếp.',
  }),
  thanks: (c) => ({
    zh: `谢谢你来 ${c.name}🌿 头发回去后有什么问题可以随时告诉我们。如果你满意，欢迎在小红书分享，但完全不勉强哦～`,
    vi: 'Cảm ơn bạn đã đến. Về nhà có vấn đề gì cứ báo. Nếu hài lòng, hoan nghênh chia sẻ trên 小红书, hoàn toàn không ép.',
  }),
  payment: () => ({
    zh: '我们支持现金、刷卡和银行转账，都可以～ 结账时告诉我们用哪种方式就行。',
    vi: 'Salon nhận tiền mặt, quẹt thẻ và chuyển khoản. Khi thanh toán bạn cho biết dùng hình thức nào.',
  }),
  contact: () => ({
    zh: '可以在这里直接私信我们预约哦～ 如果之后需要进一步沟通，我们会在私信里告诉你。',
    vi: 'Bạn cứ nhắn riêng ở đây để đặt lịch. Nếu sau này cần trao đổi thêm, chúng tôi sẽ báo trong tin nhắn riêng.',
  }),
  unknown: (c) => T.greeting(c),
};

const NOTES = {
  payment: 'Chỉ có tiền mặt, quẹt thẻ, chuyển khoản. Nếu khách hỏi Alipay/WeChat Pay thì chưa xác nhận salon có — hỏi lại Sếp, đừng hứa.',
  language: 'Chỉ gửi mẫu này nếu salon thực sự có người giao tiếp được tiếng Trung/Anh.',
  contact: 'Không gửi số điện thoại/WeChat trong bài đăng. Trong tin nhắn riêng chỉ gửi khi khách thật sự cần.',
  thanks: 'Không xin đánh giá kèm quà/tiền: dễ bị coi là đánh giá giả.',
  unknown: 'Agent chưa hiểu khách hỏi gì — đọc lại tin gốc và sửa tay trước khi gửi.',
  damage: 'Không hứa "không hư tóc". Với tóc tẩy nhiều lần, để stylist xem ảnh trước.',
  price: 'Giá là ước tính theo ảnh/độ dài tóc; stylist chốt khi xem tóc thật.',
};

function listIntents() {
  return [...INTENTS.map(([id, label]) => ({ id, label })), { id: 'reminder', label: 'Nhắc lịch hẹn (gửi ngày khách có lịch)' }, { id: 'unknown', label: 'Chưa nhận ra' }];
}

// opts: { intent?, size?, people?, service?, rate?, brand? }
function draft(message, opts = {}) {
  const rate = Number(opts.rate) > 0 ? Number(opts.rate) : DEFAULT_RATE;
  let auto = detectIntent(message);
  // khách chỉ trả lời độ dài tóc ("tóc dài qua ngực nha") → tiếp tục luồng báo giá
  if (auto.id === 'unknown' && detectSize(message)) auto = { id: 'price', label: 'Hỏi giá (khách trả lời độ dài tóc)' };
  const lang = ['vi', 'zh'].includes(opts.lang) ? opts.lang : detectLang(message);
  const intentId = opts.intent && (T[opts.intent] || VI.V[opts.intent]) ? opts.intent : auto.id;
  const known = INTENTS.find((i) => i[0] === intentId);
  const intent = known ? { id: intentId, label: known[1] } : intentId === 'reminder' ? { id: 'reminder', label: 'Nhắc lịch hẹn' } : { id: 'unknown', label: auto.label };
  const size = SIZES.includes(opts.size) ? opts.size : detectSize(message);
  const people = Number(opts.people) >= 1 ? Math.min(9, Number(opts.people)) : detectPeople(message);
  const service = SERVICES[opts.service] ? opts.service : detectService(message);
  const c = ctx(opts.brand, { rate, people, size, service });
  const flags = [];
  if (lang === 'vi') {
    const svc = service ? SERVICES[service] : null;
    const vc = { people, peopleKnown: Number(opts.people) >= 1 || peopleKnown(message), size, service, svc, price: svc && size ? priceK(svc, size, people) : null, pct: svc ? pctOf(svc, people) : 0, promo: promoActive(opts.now) };
    const text = (VI.V[intent.id] || VI.V.unknown)(vc);
    if (!promoActive(opts.now)) flags.push(`Ưu đãi tháng 10 đã hết hạn (${PROMO_END}) — giá trong mẫu có thể lỗi thời (quà tặng kèm vẫn còn), kiểm tra bảng giá mới trước khi gửi.`);
    if (VI.NOTES[intent.id]) flags.push(VI.NOTES[intent.id]);
    if (intent.id === 'price' && svc && !size) flags.push('Khách chưa nói độ dài tóc nên mẫu hỏi lại độ dài trước khi báo giá (đúng quy trình nhân viên).');
    return { intent, intentAuto: auto, lang: 'vi', size, people, service, serviceLabel: svc ? svc.vi : '', rate, zh: '', vi: text, flags, promoActive: promoActive(opts.now), needsHuman: intent.id === 'unknown' };
  }
  if (!T[intent.id]) { intent.id = 'unknown'; intent.label = 'Mẫu này chỉ có tiếng Việt'; flags.push('Mẫu này chưa có bản tiếng Trung — chọn ngôn ngữ trả lời "Tiếng Việt" hoặc soạn tay.'); }
  const { zh, vi } = T[intent.id](c);
  if (!promoActive(opts.now)) flags.push(`Ưu đãi tháng 10 đã hết hạn (${PROMO_END}) — giá trong mẫu có thể lỗi thời, kiểm tra bảng giá mới trước khi gửi.`);
  if (['price'].includes(intent.id) && service && !size) flags.push('Khách chưa nói độ dài tóc nên mẫu liệt kê cả 3 size — hỏi thêm hoặc chọn size ở trên.');
  if (NOTES[intent.id]) flags.push(NOTES[intent.id]);
  const l = lint({ title: '回复', body: zh });
  const bad = l.issues.filter((i) => ['contact', 'extreme', 'promise', 'compare', 'medical', 'fake_voice'].includes(i.code));
  for (const i of bad) flags.push(`Kiểm tra tuân thủ: ${i.msg}`);
  return {
    intent, intentAuto: auto, size, people, service, serviceLabel: service ? SERVICES[service].vi : '', rate,
    lang: 'zh', zh, vi, flags, promoActive: promoActive(opts.now), needsHuman: intent.id === 'unknown',
  };
}

module.exports = { draft, priceTable, listIntents, detectIntent, detectLang, peopleKnown, detectSize, detectPeople, detectService, priceK, cnyOf, promoActive, SERVICES, DEFAULT_RATE, PROMO_END };
