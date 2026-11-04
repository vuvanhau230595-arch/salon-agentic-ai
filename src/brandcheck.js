// Kiểm tra chuẩn thương hiệu cho bài AI soạn (kênh Facebook/Instagram/TikTok...), chỉ CẢNH BÁO — Sếp vẫn quyết.
// Kết quả cùng dạng với compliance.lint: { issues: [{ level, msg }] } để giao diện dùng chung lintBox.
const len = (s) => [...String(s || '')].length;

// Từ tuyệt đối / lời hứa kết quả: khách dễ kiện, nền tảng dễ gỡ bài
const PROMISE = /cam kết 100%|100%|đảm bảo (đẹp|thành công|không hư)|không hư tóc|không hại tóc|vĩnh viễn|mãi mãi|số 1|số một|tốt nhất (việt nam|sài gòn|tp)|duy nhất|rẻ nhất/i;
// Tự chế khuyến mãi / giá khi Sếp chưa nêu
const PRICE = /\d[\d.,]*\s?(k|nghìn|ngàn|triệu|đ|vnđ|vnd)\b|giảm\s?\d+\s?%|\d+\s?%\s?(off|giảm)|miễn phí/i;

// Cụm cần tránh lấy từ "Điều không được nói": tách theo dấu phẩy/chấm phẩy/xuống dòng, bỏ chữ "không nói/không nêu/không hứa"
function avoidTerms(avoid) {
  return String(avoid || '').split(/[\n;,]+/)
    .map((s) => s.trim().replace(/^(tuyệt đối\s+)?(không|đừng|tránh)\s+(được\s+)?(nói|nêu|hứa|đề cập|nhắc đến|nhắc|ghi|dùng|so sánh|chê)?\s*/i, '').replace(/[.。]+$/, '').trim())
    .filter((s) => len(s) >= 3);
}

function lintText(text, brand = {}, { priceAllowed = false } = {}) {
  const t = String(text || '');
  const low = t.toLowerCase();
  const issues = [];
  for (const term of avoidTerms(brand.avoid)) {
    if (low.includes(term.toLowerCase())) issues.push({ level: 'warn', msg: `Bài nhắc "${term}" — thương hiệu ghi là không được nói điều này` });
  }
  const pr = t.match(PROMISE);
  if (pr) issues.push({ level: 'warn', msg: `Lời hứa/từ tuyệt đối "${pr[0]}" — dễ vi phạm quảng cáo, nên bỏ hoặc nói nhẹ đi` });
  if (!priceAllowed) {
    const p = t.match(PRICE);
    if (p) issues.push({ level: 'warn', msg: `Có giá/khuyến mãi "${p[0]}" nhưng Sếp chưa nêu trong định hướng — kiểm tra có đúng không` });
  }
  const tags = t.match(/#[\p{L}\p{N}_]+/gu) || [];
  if (tags.length > 8) issues.push({ level: 'info', msg: `Nhiều hashtag (${tags.length}) — nên 3–5 cái` });
  if (!tags.length) issues.push({ level: 'info', msg: 'Chưa có hashtag' });
  if (len(t) > 900) issues.push({ level: 'info', msg: 'Bài khá dài, khách ít đọc hết' });
  if (!/nhắn|inbox|liên hệ|đặt lịch|hotline|gọi|comment|bình luận/i.test(t)) issues.push({ level: 'info', msg: 'Chưa có lời kêu gọi nhắn tin/đặt lịch' });
  return { issues, ok: !issues.some((i) => i.level === 'warn') };
}

// Giá/khuyến mãi chỉ hợp lệ khi Sếp đã nêu trong định hướng của kế hoạch
const planItem = (plan, item, brand) => lintText(item.text, brand, { priceAllowed: PRICE.test(String(plan.direction || '')) });

module.exports = { lintText, planItem, avoidTerms };
