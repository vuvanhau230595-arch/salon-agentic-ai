// Chất lượng tin nhắn: chấm từng cuộc trò chuyện Messenger thành KHÁCH TIỀM NĂNG / CHƯA RÕ / RÁC.
// Facebook chỉ báo số "cuộc trò chuyện bắt đầu" (gộp cả spam, bot, người vào chửi) nên Sếp không biết bao nhiêu là khách thật.
// Luật chấm bằng từ khoá (không tốn tiền, chạy mỗi lần quét); lưu nhãn theo cuộc trò chuyện (db.inboxConvs), thống kê theo Page/ngày,
// và nếu Sếp bật "dùng số khách thật" thì các luật quảng cáo (tắt/tăng, chấm bài thử) dùng số tin đã nhân tỷ lệ khách thật của thương hiệu.
// Giới hạn: hộp thư không cho biết khách đến từ quảng cáo nào → tỷ lệ tính theo Page/thương hiệu, không theo từng chiến dịch.
const { load } = require('./db');

const DAY = 864e5;
const VN = 7 * 3600e3;
const dayKey = (t) => new Date(new Date(t).getTime() + VN).toISOString().slice(0, 10);

// Dấu hiệu khách thật: hỏi dịch vụ/giá/lịch/địa chỉ, nói về tóc của mình, để lại SĐT
const LEAD = [
  [/nhuộm|uốn|duỗi|ép|cắt|tẩy|light|balayage|ombre|highlight|phục hồi|keratin|olaplex|nối tóc|nối mi|waxing|gội|hấp|tạo kiểu|màu tóc|tóc (ngắn|dài|ngang vai|hư|xơ|rụng)|mái|layer|bob|wolf cut|hush cut|butterfly/i, 'hỏi dịch vụ', 3],
  [/giá|bao nhiêu|nhiêu tiền|chi phí|phí|bảng giá|khuyến mãi|ưu đãi|giảm giá|combo/i, 'hỏi giá', 3],
  [/đặt lịch|hẹn|book|lịch (hôm|ngày|chiều|sáng|tối)|mấy giờ|giờ (mở|đóng)|có (trống|rảnh|chỗ)|ghé|qua (tiệm|salon|chỗ)|đến (tiệm|salon)/i, 'muốn đặt lịch', 3],
  [/địa chỉ|ở đâu|chi nhánh|cơ sở|quận|bình thạnh|đường đi|map|bản đồ/i, 'hỏi địa chỉ', 2],
  [/(?<!\d)(0|\+?84)\d{9,10}(?!\d)/, 'để lại SĐT', 4],
  [/tóc (em|mình|tôi|chị)|em (muốn|định|đang)|mình (muốn|định|đang)|chị (muốn|định)|cho em hỏi|cho mình hỏi|tư vấn/i, 'nói về nhu cầu của mình', 2],
  [/(bao lâu|mất bao|giữ được|bền|hư tóc|có đau|có hại)/i, 'hỏi kỹ về dịch vụ', 1],
];
// Dấu hiệu rác: link lạ, mời chào kiếm tiền, bán hàng, bot tiếng Anh, chửi/phá, nội dung không liên quan
const SPAM = [
  [/https?:\/\/|www\.|\.(com|net|vn|xyz|top|club|shop|info|me)\/|bit\.ly|t\.me\/|zalo\.me\/g|telegram/i, 'gửi link lạ', 3],
  [/kiếm tiền|việc nhẹ|lương cao|thu nhập|đầu tư|lợi nhuận|hoa hồng|tuyển (cộng tác|ctv)|cộng tác viên|làm thêm tại nhà|chốt đơn|bán sỉ|nguồn hàng|xổ số|lô đề|casino|cá cược|coin|crypto|forex|vay (vốn|tiền|nhanh)|giải ngân|thẻ tín dụng|mở thẻ/i, 'mời chào kiếm tiền/bán hàng', 4],
  [/quảng cáo (dịch vụ|facebook|google|tiktok)|chạy ads|tăng (like|follow|tương tác)|mua (like|follow)|seo|thiết kế web|làm web|phần mềm/i, 'chào bán dịch vụ quảng cáo', 4],
  [/\b(hello dear|dear sir|dear madam|i am interested|interested in your|contact me|whatsapp me|wechat|business proposal|free trial|click here)\b/i, 'bot tiếng Anh', 3],
  [/lừa đảo|đừng tin|lừa|scam|bọn|chúng mày|đmm|vcl|ngu|đồ (điên|khùng)|cút|cmm/i, 'chửi/phá', 3],
  [/^(ok|oke|okie|ừ|uh|hmm|\.|\?|!|k|ko|hi|hello|xin chào|chào)[.!?\s]*$/i, 'chỉ chào/ừ', 0], // không phải rác nhưng cũng không phải tín hiệu khách
];

// conv: { messages: [{ from, text, at, media }], pageId }. Trả về { label, score, reasons, customerMsgs, media }
function classify(conv, pageId = conv.pageId) {
  const cust = (conv.messages || []).filter((m) => m.from !== pageId);
  const texts = cust.map((m) => String(m.text || '')).filter(Boolean);
  const text = texts.join('\n');
  const media = cust.reduce((s, m) => s + (Number(m.media) || 0), 0);
  let lead = 0, spam = 0;
  const reasons = [];
  for (const [re, why, w] of LEAD) if (re.test(text)) { lead += w; reasons.push(why); }
  for (const [re, why, w] of SPAM) if (re.test(text) && w) { spam += w; reasons.push(why); }
  if (media > 0) { lead += 2; reasons.push('gửi ảnh/video'); }
  if (texts.length >= 3) lead += 1;
  // cùng một câu lặp lại nhiều lần = bot/spam
  const uniq = new Set(texts.map((t) => t.trim().toLowerCase()));
  if (texts.length >= 3 && uniq.size === 1) { spam += 3; reasons.push('lặp lại cùng một câu'); }
  // Tiếng Anh dài, không nhắc tới tóc → nhiều khả năng bot
  if (/[a-z]{4,}/i.test(text) && !/[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(text) && text.length > 80 && lead === 0) { spam += 2; reasons.push('tiếng nước ngoài, không hỏi về tóc'); }
  let label = 'unknown';
  if (spam >= 3 && spam >= lead) label = 'spam';
  else if (lead >= 3) label = 'lead';
  return { label, score: lead - spam, reasons: [...new Set(reasons)], customerMsgs: cust.length, media };
}

const LABEL = { lead: 'Khách tiềm năng', unknown: 'Chưa rõ', spam: 'Rác' };

// Lưu kết quả chấm cho các cuộc trò chuyện vừa đọc (giữ 14 ngày)
function record(convs, pageId, brand, now = Date.now()) {
  const db = load();
  db.inboxConvs = db.inboxConvs || {};
  let n = 0;
  for (const c of convs) {
    const msgs = c.messages || [];
    const cust = msgs.filter((m) => m.from !== pageId);
    if (!cust.length) continue;
    const r = classify({ messages: msgs }, pageId);
    const prev = db.inboxConvs[c.id] || {};
    const last = msgs[msgs.length - 1];
    const who = (c.participants || []).find((p) => p.id !== pageId) || {};
    db.inboxConvs[c.id] = {
      pageId, brand, psid: cust[0].from, name: who.name || cust[0].name || 'Khách',
      label: r.label, score: r.score, reasons: r.reasons, customerMsgs: r.customerMsgs, media: r.media,
      firstAt: prev.firstAt || cust[0].at || c.updatedAt, lastAt: c.updatedAt || (last && last.at), lastText: String((last && last.text) || '').slice(0, 140), lastFrom: last && last.from === pageId ? 'salon' : 'customer',
      replied: msgs.some((m) => m.from === pageId), at: new Date(now).toISOString(),
    };
    n++;
  }
  for (const [k, v] of Object.entries(db.inboxConvs)) if (now - new Date(v.lastAt || v.at).getTime() > 14 * DAY) delete db.inboxConvs[k];
  return n;
}

const labelOf = (convId) => ((load().inboxConvs || {})[convId] || {}).label || null;

// Thống kê 7 ngày: theo ngày, theo thương hiệu (tỷ lệ khách thật), danh sách gần đây
function stats(now = Date.now()) {
  const db = load();
  const all = Object.entries(db.inboxConvs || {}).map(([id, v]) => ({ id, ...v }));
  const since = now - 7 * DAY;
  const week = all.filter((c) => new Date(c.firstAt || c.at).getTime() >= since);
  const zero = () => ({ lead: 0, unknown: 0, spam: 0, total: 0 });
  const days = {};
  const byBrand = {};
  const byPage = {};
  for (let i = 6; i >= 0; i--) days[dayKey(now - i * DAY)] = { date: dayKey(now - i * DAY), ...zero() };
  for (const c of week) {
    const d = days[dayKey(c.firstAt || c.at)]; if (d) { d[c.label]++; d.total++; }
    const b = (byBrand[c.brand] = byBrand[c.brand] || zero()); b[c.label]++; b.total++;
    const p = (byPage[c.pageId] = byPage[c.pageId] || zero()); p[c.label]++; p.total++;
  }
  for (const b of Object.values(byBrand)) b.ratio = b.total >= 5 ? b.lead / b.total : null; // ít hơn 5 cuộc thì chưa đủ để nói
  const recent = all.sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt))).slice(0, 30)
    .map((c) => ({ id: c.id, brand: c.brand, pageId: c.pageId, name: c.name, label: c.label, labelText: LABEL[c.label], reasons: c.reasons, lastText: c.lastText, lastAt: c.lastAt, replied: c.replied, customerMsgs: c.customerMsgs }));
  const s = db.settings.leads || {};
  return { on: s.on !== false, useForAds: !!s.useForAds, days: Object.values(days), byBrand, byPage, recent, total: all.length, lastScan: db.leadScanAt || null };
}

// Tỷ lệ khách thật 7 ngày của thương hiệu (null = chưa đủ dữ liệu)
function ratio(brand, now = Date.now()) {
  const b = stats(now).byBrand[brand];
  return b && b.ratio !== null && b.ratio !== undefined ? b.ratio : null;
}

// Gắn số "khách thật" ước tính vào từng chiến dịch (c.d7.real …) theo tỷ lệ của thương hiệu; chỉ khi Sếp bật dùng cho luật
function applyToCampaigns(campaigns, now = Date.now()) {
  const engine = require('./engine');
  const cache = {};
  for (const c of campaigns) {
    const brand = engine.brandOf(c);
    if (!brand) continue;
    if (!(brand in cache)) cache[brand] = ratio(brand, now);
    const r = cache[brand];
    for (const w of ['today', 'd7', 'month']) {
      if (!c[w]) continue;
      if (r === null) delete c[w].real; else { c[w].real = Math.round(c[w].msgs * r); c[w].ratio = r; }
    }
  }
  return campaigns;
}

module.exports = { classify, record, labelOf, stats, ratio, applyToCampaigns, LABEL };
