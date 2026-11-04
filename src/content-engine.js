// Dây chuyền nội dung Facebook: Strategy → Copywriter → Quality Control (chấm 0–100, viết lại tối đa 3 lần) → bản nháp chờ duyệt.
// Nguyên tắc: không bịa — địa chỉ/hotline/ưu đãi chỉ lấy từ dữ liệu đã xác nhận (src/brand-facts.js) và do HỆ THỐNG chèn,
// AI chỉ viết phần thân bài. Thiếu dữ liệu quan trọng thì đánh dấu "cần bổ sung", không đoán.
const { load } = require('./db');
const ai = require('./ai');
const facts = require('./brand-facts');
const lessons = require('./lessons');
const { avoidTerms } = require('./brandcheck');

const PASS = 85;          // điểm tối thiểu để không phải viết lại
const MAX_REWRITES = 3;
const DAY = 864e5;

const CATEGORIES = { custom: 'Chủ đề do Sếp nhập', service: 'Giới thiệu dịch vụ', knowledge: 'Kiến thức tóc', consult: 'Tư vấn', promo: 'Ưu đãi', conversion: 'Chuyển đổi (đặt lịch)' };
const LENGTH = { service: '70–110 từ', knowledge: '120–180 từ', consult: '80–130 từ', promo: '50–80 từ', conversion: '40–70 từ' };

const norm = (s) => String(s || '').toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const digits = (s) => String(s || '').replace(/\D/g, '');
const ymd = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });

// ───────── Dữ liệu thương hiệu ─────────
function servicesOf(brand) {
  return String(brand.services || '').replace(/\([^)]*\)/g, '').split(/[,;\n]+/).map((s) => s.trim()).filter((s) => s.length >= 3);
}
// Địa chỉ cuối bài: mỗi cơ sở 1 dòng (không trộn thương hiệu)
function addressLines(brand) {
  if ((brand.branches || []).length) return brand.branches.filter((b) => b.address).map((b) => `📍 ${b.name}: ${b.address}`);
  return String(brand.address || '').split('|').map((s) => s.trim()).filter(Boolean).map((a) => `📍 ${a}`);
}
const allAddresses = (brand) => [...String(brand.address || '').split('|'), ...(brand.branches || []).map((b) => b.address)].map((s) => s.trim()).filter(Boolean);

function recentTexts(brandId, now = Date.now(), days = 90) {
  const db = load();
  const since = now - days * DAY;
  const out = [];
  for (const p of db.posts) if (p.brand === brandId && p.status !== 'rejected' && p.status !== 'cancelled' && new Date(p.scheduledAt).getTime() >= since) out.push({ topic: p.topic || '', text: p.text || '', at: p.scheduledAt });
  for (const pl of db.plans) if (pl.brand === brandId && pl.status === 'pending') for (const it of pl.items) if (it.status === 'pending') out.push({ topic: it.topic || '', text: it.text || '', at: it.at });
  return out;
}

// ───────── Strategy Agent ─────────
const KNOWLEDGE = [
  'Cách chọn tone màu tóc hợp màu da', 'Phân biệt balayage, ombre và highlight', 'Chăm sóc tóc nhuộm tại nhà để giữ màu lâu',
  'Bao lâu nên phục hồi tóc một lần', 'Cách chọn kiểu tóc hợp khuôn mặt', 'Vì sao tóc xơ rối sau khi tạo kiểu hóa chất',
  'Chải và gội tóc đúng cách để tóc khỏe hơn', 'Tóc yếu có nên làm hóa chất ngay không', 'Cách giữ nếp tóc uốn đẹp mỗi ngày', 'Tạo kiểu tóc nhanh cho buổi sáng bận rộn',
];
const CONSULT = [
  'Chưa biết chọn dịch vụ nào? Cách để stylist tư vấn đúng tình trạng tóc', 'Trước khi nhuộm tóc cần chuẩn bị gì', 'Những câu hỏi thường gặp khi uốn và duỗi tóc',
  'Tóc từng tẩy: nên làm gì tiếp theo', 'Cách chọn màu nhuộm khi đi làm văn phòng',
];
const CONVERSION = [
  'Đặt lịch trước để chọn được khung giờ đẹp', 'Nhắn tin để stylist tư vấn theo tình trạng tóc của bạn', 'Mang ảnh mẫu tóc bạn thích để được tư vấn sát hơn',
];
// Khung 7 ngày: dịch vụ / kiến thức / dịch vụ / tư vấn / ưu đãi (nếu có) / kiến thức / chuyển đổi — không có 2 ngày liền cùng nhóm
const PATTERN = ['service', 'knowledge', 'service', 'consult', 'promo', 'knowledge', 'conversion'];

// dates: các Date sẽ đăng. Trả về [{ at, category, topic, service }]. Không lặp chủ đề với bài đã có.
function strategy(brandId, dates, { now = Date.now(), hints = [] } = {}) {
  const brand = require('./planner').brands()[brandId];
  const services = servicesOf(brand);
  const used = new Set(recentTexts(brandId, now, 60).map((r) => norm(r.topic)));
  const counters = { service: 0, knowledge: 0, consult: 0, conversion: 0 };
  const pick = (list, k, build) => {
    for (let tries = 0; tries < list.length * 2; tries++) {
      const item = list[counters[k]++ % list.length];
      const topic = build ? build(item) : item;
      if (!used.has(norm(topic))) { used.add(norm(topic)); return { topic, service: build ? item : '' }; }
    }
    const item = list[counters[k]++ % list.length];
    return { topic: build ? build(item) : item, service: build ? item : '' };
  };
  const slots = [];
  let prev = '';
  dates.forEach((at, i) => {
    let cat = PATTERN[i % PATTERN.length];
    let promo = null;
    if (cat === 'promo') {
      const list = facts.activePromos(brandId, at.getTime());
      promo = list.find((p) => !used.has(norm('ưu đãi ' + p.text)));
      if (!promo) cat = services.length ? 'service' : 'knowledge'; // chưa có ưu đãi xác minh: không bịa, đổi nhóm
    }
    if (cat === prev) cat = cat === 'service' ? 'knowledge' : 'service';
    prev = cat;
    let t;
    const h = String(hints[i] || '').trim();
    // Bài gắn ảnh/video có ghi chú/tên rõ nghĩa: chủ đề bám theo file (nhưng ưu đãi vẫn giữ nguyên để không bịa)
    if (cat !== 'promo' && /\p{L}{3,}\s+\p{L}{3,}/u.test(h)) { t = { topic: h.charAt(0).toUpperCase() + h.slice(1), service: '' }; cat = 'service'; used.add(norm(t.topic)); }
    else if (cat === 'promo') { t = { topic: `Ưu đãi: ${promo.text}`.slice(0, 160), service: '' }; used.add(norm('ưu đãi ' + promo.text)); }
    else if (cat === 'service') t = services.length ? pick(services, 'service', (s) => `Giới thiệu dịch vụ ${s}`) : pick(KNOWLEDGE, 'knowledge');
    else if (cat === 'knowledge') t = pick(KNOWLEDGE, 'knowledge');
    else if (cat === 'consult') t = pick(CONSULT, 'consult');
    else t = pick(CONVERSION, 'conversion');
    slots.push({ at, category: cat, hint: h, topic: t.topic, service: t.service, promo: promo ? promo.text : '' });
  });
  return slots;
}

// ───────── Quality Control Agent ─────────
const PROMISE = /cam kết 100%|100\s?%|đảm bảo (đẹp|thành công|không hư)|không hư tóc|không hại tóc|vĩnh viễn|mãi mãi|số 1\b|số một|tốt nhất|duy nhất|rẻ nhất|cực kỳ an toàn|không bao giờ hư/i;
// Lưu ý: \b của JavaScript chỉ hiểu chữ ASCII nên với tiếng Việt phải dùng (?![\p{L}\p{N}]) thay cho \b
const OFFER = /\d[\d.,]*\s?(k(?![\p{L}\p{N}])|nghìn|ngàn|triệu|đồng|đ(?![\p{L}\p{N}])|vnđ|vnd)|giảm\s?\d+\s?%|\d+\s?%\s?(off|giảm)|miễn phí|khuyến mãi|ưu đãi|giảm giá|tặng|quà tặng|combo|đồng giá/iu;
const PHONE = /(?<!\d)(?:\+?84|0)[\s.-]?\d{2,3}[\s.-]?\d{3}[\s.-]?\d{3,4}(?!\d)/g;
const FAKE_REVIEW = /khách (hàng )?(chia sẻ|nhận xét|phản hồi|đánh giá|feedback|review|khen)|feedback (từ|của) khách|"[^"]{15,}"|“[^”]{15,}”|5 sao|⭐{2,}|đánh giá \d(\.\d)?\/5|được hàng (trăm|nghìn|ngàn) khách/i;
const HOOK_BAD = /^\s*(dạ|chị yêu|em ơi|chị ơi|anh\/chị ơi)(?![\p{L}\p{N}])/iu;
const CTA = /nhắn tin|inbox|liên hệ|đặt lịch|hotline|gọi|comment|bình luận|ghé|đến salon|để lại tin nhắn/i;
const CLICHE = /bứt phá|đỉnh cao|hoàn hảo tuyệt đối|thiên đường|đẳng cấp thế giới|không thể bỏ lỡ|cơ hội vàng/i;

const similarity = (a, b) => {
  const g = (s) => { const w = norm(s).split(' ').filter(Boolean); const out = new Set(); for (let i = 0; i < w.length - 1; i++) out.add(w[i] + ' ' + w[i + 1]); return out; };
  const A = g(a), B = g(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
};

// text: bài hoàn chỉnh (kèm địa chỉ/hotline do hệ thống chèn). ctx: { brand, category, now, exclude(post id), body(thân bài) }
function review(text, ctx = {}) {
  const brand = ctx.brand || {};
  const now = ctx.now || Date.now();
  const f = facts.current(brand.id, now);
  const t = String(text || '');
  const issues = [];
  const add = (level, code, msg, points) => issues.push({ level, code, msg, points });

  // 1. Đúng thương hiệu / fanpage: không nhắc thương hiệu, địa chỉ của nơi khác
  const brands = require('./planner').brands();
  for (const o of Object.values(brands)) {
    if (o.id === brand.id) continue;
    const names = [o.name, o.name.replace(/\b(hair|salon|beauty)\b/gi, '').trim()].filter((n) => n.length >= 4);
    if (names.some((n) => norm(t).includes(norm(n))) && !norm(brand.name).includes(norm(o.name.replace(/\b(hair|salon|beauty)\b/gi, '').trim()))) add('block', 'brand_mix', `Bài nhắc thương hiệu khác ("${o.name}") — fanpage này là ${brand.name}`, 40);
    for (const a of allAddresses(o)) {
      const key = norm(a).split(' ').slice(0, 4).join(' ');
      if (key.length > 8 && norm(t).includes(key) && !allAddresses(brand).some((x) => norm(x).includes(key))) add('block', 'brand_mix', `Bài có địa chỉ của thương hiệu khác ("${a}")`, 40);
    }
  }
  // 2. Địa chỉ: mọi địa chỉ nêu trong bài phải thuộc thương hiệu
  const own = allAddresses(brand).map(norm);
  const streetRe = /(?<![\d/])\d{1,4}(?:\/\d+)*\s+(?:đường\s+)?[A-ZĐ][\p{L}]+(?:\s+[A-ZĐ][\p{L}]+){0,3}/gu;
  for (const m of t.match(streetRe) || []) {
    const k = norm(m);
    if (!own.some((a) => a.includes(k) || k.includes(a.split(' ').slice(0, 3).join(' ')))) add('block', 'address', `Địa chỉ "${m}" không có trong dữ liệu của ${brand.name}`, 30);
  }
  // 3. Hotline: mọi số điện thoại phải trùng hotline đã xác nhận
  for (const m of t.match(PHONE) || []) {
    if (!f.hotline) add('block', 'hotline', `Bài có số điện thoại "${m}" nhưng hotline chưa được xác nhận`, 40);
    else if (!digits(f.hotline).endsWith(digits(m).slice(-9))) add('block', 'hotline', `Số "${m}" khác hotline đã xác nhận (${f.hotline})`, 40);
  }
  // 4. Giá / ưu đãi: chỉ được nêu khi có dữ liệu đã xác nhận còn hiệu lực
  const offers = t.match(new RegExp(OFFER.source, 'giu')) || [];
  if (offers.length) {
    const allowed = norm([f.prices, ...f.promos.map((p) => p.text)].join(' '));
    const bad = offers.filter((o) => {
      const k = norm(o);
      if (!allowed) return true;
      if (/^\d/.test(k)) return !allowed.includes(k);
      return !f.promos.length && !allowed.includes(k); // chữ "ưu đãi/tặng..." cần có ưu đãi hiện hành
    });
    if (bad.length) add('block', 'offer', `Nêu giá/ưu đãi ("${[...new Set(bad.map((x) => x.trim()))].slice(0, 3).join('", "')}") nhưng chưa có dữ liệu đã xác nhận còn hiệu lực`, 35);
  }
  // 5. Cam kết quá mức và điều thương hiệu cấm
  const pr = [...new Set(t.match(new RegExp(PROMISE.source, 'gi')) || [])];
  if (pr.length) add('warn', 'promise', `Cam kết/từ tuyệt đối: "${pr.slice(0, 3).join('", "')}" — nói kết quả tuỳ chất tóc`, Math.min(40, 20 * pr.length));
  for (const term of avoidTerms(brand.avoid)) if (norm(t).includes(norm(term))) add('warn', 'avoid', `Nhắc "${term}" — thương hiệu ghi là không được nói`, 25);
  // 6. Đánh giá khách hàng bịa
  if (ctx.category !== 'review' && FAKE_REVIEW.test(t)) add('block', 'fake_review', 'Có vẻ trích lời/đánh giá của khách — chưa có dữ liệu đánh giá thật nên không được viết', 35);
  // 7. Chính tả, xưng hô, văn sáo rỗng
  const body = t.split('\n').filter((l) => !/^\s*(📍|☎|🔗|#)/.test(l)).join('\n');
  if (HOOK_BAD.test(body)) add('warn', 'voice', 'Mở bài kiểu trả lời tin nhắn ("Dạ", "chị yêu"…) — bài đăng công khai nên viết cho nhiều người đọc', 15);
  if (/\bem\b.{0,40}\bchị\b|\bchị\b.{0,40}\bem\b/i.test(body) && !/chị em/i.test(body)) add('warn', 'voice', 'Trộn cách xưng hô em – chị như tin nhắn; dùng "salon/tên thương hiệu" và "bạn/chị em/nàng"', 10);
  if (/(!{2,}|\?{2,}|\.{4,})|[ 	]{3,}|(?<![\p{L}\p{N}])(\p{L}{2,})\s+\2(?![\p{L}\p{N}])/iu.test(body)) add('warn', 'spelling', 'Dấu câu lặp, khoảng trắng thừa hoặc lặp từ — cần rà chính tả', 5);
  if ((body.match(/(?<![\p{L}\p{N}])\p{Lu}{4,}(?![\p{L}\p{N}])/gu) || []).length > 3) add('warn', 'spelling', 'Viết hoa cả từ quá nhiều', 5);
  const cl = body.match(CLICHE);
  if (cl) add('warn', 'cliche', `Văn sáo rỗng: "${cl[0]}"`, 10);
  // 8. Lặp bài cũ
  let best = { s: 0, topic: '' };
  for (const r of recentTexts(brand.id, now).filter((r) => r.text !== ctx.selfText)) { const s = similarity(body, r.text.split('\n').filter((l) => !/^\s*(📍|☎|🔗|#)/.test(l)).join('\n')); if (s > best.s) best = { s, topic: r.topic }; }
  if (best.s >= 0.55) add('block', 'duplicate', `Gần giống bài đã có (${Math.round(best.s * 100)}%: "${best.topic.slice(0, 50)}")`, 40);
  else if (best.s >= 0.4) add('warn', 'duplicate', `Khá giống bài đã có (${Math.round(best.s * 100)}%)`, 15);
  // 9. CTA, hashtag, độ dài
  if (!CTA.test(t)) add('warn', 'cta', 'Chưa có lời kêu gọi nhắn tin/đặt lịch', 15);
  const tags = t.match(/#[\p{L}\p{N}_]+/gu) || [];
  if (!tags.length) add('info', 'hashtag', 'Chưa có hashtag', 5);
  else if (tags.length > 5) add('info', 'hashtag', `Nhiều hashtag (${tags.length}) — nên 3–5`, 5);
  if ([...body].length > 1400) add('info', 'length', 'Bài rất dài', 5);
  if (!f.hotline) add('info', 'no_hotline', 'Chưa có hotline đã xác nhận — bài không kèm số điện thoại', 0);

  // Thiếu dữ liệu quan trọng → cần bổ sung (không viết lại, không bịa)
  const needsInfo = [];
  if (ctx.category === 'promo' && !f.promos.length) needsInfo.push('Chưa có ưu đãi đã xác nhận còn hiệu lực (Thương hiệu & Kênh → Dữ liệu động, hoặc Kế hoạch tháng → Khuyến mãi)');
  if (ctx.needs) needsInfo.push(...ctx.needs);

  const score = Math.max(0, 100 - issues.reduce((s, i) => s + i.points, 0));
  const status = needsInfo.length ? 'needs_info' : score >= PASS ? 'ok' : 'needs_work';
  return { score, status, issues, needsInfo, at: new Date(now).toISOString() };
}

// ───────── Copywriter Agent ─────────
const POST_STYLE = ai.POST_STYLE;
const cut = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function promptFor(brand, slot, { n = 1, previous, feedback, instruction, hint } = {}) {
  const f = facts.current(brand.id, slot.at ? slot.at.getTime() : Date.now());
  const factLines = [];
  if (f.promos.length) factLines.push('Ưu đãi hiện hành (được nêu, đúng nguyên văn, kèm điều kiện): ' + f.promos.map((p) => `${p.text} (đến ${p.to})`).join(' | '));
  if (f.prices) factLines.push('Bảng giá đã xác nhận: ' + cut(f.prices, 600));
  if (f.warranty) factLines.push('Bảo hành: ' + f.warranty);
  if (f.hours) factLines.push('Giờ hoạt động: ' + f.hours);
  const examples = (load().approvedExamples || []).filter((e) => e.brand === brand.id).slice(0, 3);
  const recent = recentTexts(brand.id).slice(0, 5).map((r) => '- ' + cut(r.text.split('\n')[0], 90));
  return `Viết bài đăng Facebook cho fanpage "${brand.name}" (TP.HCM).
Giọng bài đăng: ${brand.postTone || brand.tone || 'thân thiện, tự nhiên, có chuyên môn'}.
Dịch vụ của thương hiệu: ${brand.services || '(chưa khai báo)'}.
CHỦ ĐỀ: ${slot.topic} (nhóm: ${CATEGORIES[slot.category] || slot.category}).
DỮ KIỆN ĐÃ XÁC MINH — chỉ được nêu đúng những dữ kiện này, KHÔNG bịa giá/ưu đãi/bảo hành/số liệu/xu hướng thị trường:
${factLines.length ? factLines.map((x) => '- ' + x).join('\n') : '- (Không có giá, ưu đãi hay bảo hành nào được phép nêu — tuyệt đối không nhắc đến.)'}
KHÔNG viết địa chỉ, số điện thoại, link — hệ thống tự thêm ở cuối bài.
${brand.avoid ? 'TUYỆT ĐỐI KHÔNG nói/hứa: ' + brand.avoid : ''}
${examples.length ? 'Bài mẫu đã được chủ salon duyệt (học giọng văn và cấu trúc, không chép lại):\n' + examples.map((e) => '---\n' + cut(e.finalText, 700)).join('\n') + '\n---' : ''}
${recent.length ? 'Các bài đăng gần đây (không lặp ý và câu mở đầu):\n' + recent.join('\n') : ''}
${hint ? `Ảnh/video đính kèm: "${hint}" — nội dung phải hợp với file, không bịa chi tiết ngoài tên/ghi chú.` : ''}
Yêu cầu: tiếng Việt tự nhiên, KHÔNG văn sáo rỗng, không khoa trương; mở bằng hook theo nhu cầu hoặc cảm hứng làm đẹp; nội dung có giá trị thực tế (giải thích dễ hiểu); kết bằng lời mời nhắn tin/đặt lịch rõ ràng; 3–5 hashtag ở dòng cuối; độ dài khoảng ${LENGTH[slot.category] || '80–120 từ'}.
${previous ? `\nBẢN TRƯỚC (chưa đạt):\n${previous}\nLỖI CẦN SỬA:\n${feedback}\nHãy viết lại khắc phục hết các lỗi trên.` : ''}${instruction ? `\nYÊU CẦU CỦA CHỦ SALON: ${instruction}` : ''}
Trả về JSON thuần, không giải thích: {"versions":[{"text":"..."}]} gồm đúng ${n} phiên bản khác nhau về cách mở bài và bố cục.`;
}

function parseVersions(raw) {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    const v = (j.versions || []).map((x) => String(x.text || '').trim()).filter(Boolean);
    if (v.length) return v;
  } catch { /* AI không trả JSON: dùng nguyên văn */ }
  const t = String(raw).replace(/^```\w*\n?|```$/g, '').trim();
  return t.length > 40 ? [t] : null;
}

// Ghép bài hoàn chỉnh: thân bài (AI) + địa chỉ/hotline/link (hệ thống, từ dữ liệu đã xác nhận) + hashtag
function assemble(brand, body, now = Date.now()) {
  const f = facts.current(brand.id, now);
  let text = String(body || '').replace(PHONE, '').trim();
  const tags = [...new Set(text.match(/#[\p{L}\p{N}_]+/gu) || [])];
  text = text.split('\n').filter((l) => !/^\s*(#[\p{L}\p{N}_]+\s*)+$/u.test(l)).join('\n').trim();
  text = text.split('\n').filter((l) => !/^\s*(📍|☎|📞)/.test(l)).join('\n').trim();
  const foot = [...addressLines(brand)];
  if (f.hotline) foot.push(`☎ Hotline: ${f.hotline}`);
  if (f.bookingLink) foot.push(`🔗 Đặt lịch: ${f.bookingLink}`);
  const tagSrc = tags.length ? tags : String(brand.hashtags || '').split(/\s+/).filter(Boolean);
  const hashtags = tagSrc.slice(0, 5).join(' ');
  return [text, foot.join('\n'), hashtags].filter(Boolean).join('\n\n');
}

function templateBody(brand, slot) {
  const s = slot.service || 'làm đẹp tóc';
  const cta = 'Nhắn tin cho salon để được tư vấn và đặt lịch nhé.';
  if (slot.category === 'promo') return `${slot.topic.replace(/^Ưu đãi:\s*/, '✨ ')}\n\n${cta}`;
  if (slot.category === 'service') return `${brand.name} có dịch vụ ${s.toLowerCase()}. Stylist sẽ xem tình trạng tóc rồi tư vấn kiểu và tone phù hợp với bạn.\n\n${cta}`;
  return `${slot.topic}\n\n${cta}`;
}

async function writeVersions(brand, slot, opts = {}) {
  const n = Math.max(1, Math.min(3, opts.n || 1));
  let versions = null;
  let mode = 'template';
  try {
    versions = parseVersions(await ai.ask(`Bạn là copywriter fanpage chuyên nghiệp của ngành salon tóc. Viết tiếng Việt tự nhiên, trung thực, không bịa.\n\n${POST_STYLE}`, promptFor(brand, slot, opts), 4000 * Math.min(n, 2)));
    if (versions) mode = 'ai';
  } catch (e) { opts.onError && opts.onError(e); }
  if (!versions) versions = [templateBody(brand, slot)];
  return { versions: versions.slice(0, n).map((b) => assemble(brand, b, slot.at ? slot.at.getTime() : Date.now())), mode };
}

const feedbackText = (qc) => qc.issues.filter((i) => i.level !== 'info').map((i) => `- ${i.msg}`).join('\n');

// Viết → chấm → viết lại (tối đa 3 lần) cho 1 slot. Không bao giờ ném lỗi AI ra ngoài: lỗi AI thì dùng mẫu và đánh dấu.
async function produce(brand, slot, { hint, instruction, n = 1, now = Date.now(), selfText } = {}) {
  let err = null;
  const ctx = { brand, category: slot.category, now: slot.at ? slot.at.getTime() : now, selfText };
  const w = await writeVersions(brand, slot, { n, hint, instruction, onError: (e) => { err = e; } });
  const score = (t) => review(t, { ...ctx });
  let best = null;
  const versions = w.versions.map((text) => ({ text, qc: score(text) }));
  versions.sort((a, b) => b.qc.score - a.qc.score);
  best = { ...versions[0], attempts: 0 };
  while (w.mode === 'ai' && best.qc.status === 'needs_work' && best.attempts < MAX_REWRITES) {
    const again = await writeVersions(brand, slot, { n: 1, hint, instruction, previous: best.text, feedback: feedbackText(best.qc), onError: (e) => { err = e; } });
    if (again.mode !== 'ai') break;
    const q = score(again.versions[0]);
    best = q.score >= best.qc.score ? { text: again.versions[0], qc: q, attempts: best.attempts + 1 } : { ...best, attempts: best.attempts + 1 };
  }
  if (w.mode === 'template') best.qc.issues.push({ level: 'info', code: 'template', msg: err ? `Chưa viết được bằng AI (${String(err.message).slice(0, 120)}) — đang dùng bài mẫu ngắn` : 'Chưa có khoá AI — đang dùng bài mẫu ngắn', points: 0 });
  best.qc.attempts = best.attempts;
  best.qc.mode = w.mode;
  return { text: best.text, qc: best.qc, versions: versions.map((v) => ({ text: v.text, score: v.qc.score })), mode: w.mode, topicCategory: slot.category };
}

// Chạy nhiều slot song song có giới hạn (tránh quá hạn mức AI)
async function produceMany(brand, slots, { hints = [], limit = 3 } = {}) {
  const out = new Array(slots.length);
  let next = 0;
  const worker = async () => {
    while (next < slots.length) {
      const i = next++;
      out[i] = await produce(brand, slots[i], { hint: hints[i] });
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, slots.length) }, worker));
  return out;
}

module.exports = { CATEGORIES, PASS, MAX_REWRITES, strategy, review, produce, produceMany, writeVersions, assemble, servicesOf, addressLines, recentTexts, similarity };
