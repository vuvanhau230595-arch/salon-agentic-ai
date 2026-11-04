// Brand Knowledge Agent: dữ liệu ĐỘNG của từng thương hiệu (hotline, link đặt lịch, giá, ưu đãi, bảo hành, giờ mở cửa).
// Quy tắc: chỉ dữ liệu đã được quản trị viên XÁC NHẬN và còn trong thời gian hiệu lực mới được đưa vào bài viết.
// Mỗi lần đổi tạo 1 phiên bản mới (giữ lịch sử). Dữ liệu cũ/chưa xác nhận không bao giờ tự được coi là hiện hành.
const { load, save } = require('./db');

const KEYS = {
  hotline: { label: 'Hotline', hint: 'Số điện thoại hiển thị trong bài (vd 0909 123 456)' },
  bookingLink: { label: 'Link đặt lịch', hint: 'Đường dẫn đặt lịch (nếu có)' },
  hours: { label: 'Giờ hoạt động', hint: 'vd 9:00–20:00 mỗi ngày' },
  prices: { label: 'Bảng giá dịch vụ', hint: 'Chỉ ghi giá đã chốt; bài chỉ được nêu giá có trong mục này' },
  promotions: { label: 'Ưu đãi', hint: 'Mỗi dòng 1 ưu đãi, kèm điều kiện. BẮT BUỘC có ngày hiệu lực' },
  warranty: { label: 'Chính sách bảo hành', hint: 'vd Bảo hành nhuộm 7 ngày' },
};
const MAX_HISTORY = 30;
const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
const ymd = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

const store = () => { const db = load(); db.brandFacts = db.brandFacts || {}; return db.brandFacts; };
const brandIds = () => Object.keys(require('./planner').brands());

// Trạng thái hiện hành của 1 dữ kiện
function stateOf(f, now = Date.now()) {
  if (!f || !String(f.value || '').trim()) return 'missing';
  if (f.status !== 'verified') return 'unverified';
  const today = ymd(now);
  if (f.validFrom && today < f.validFrom) return 'upcoming';
  if (f.validTo && today > f.validTo) return 'expired';
  return 'current';
}

// Hotline cũ trong hồ sơ thương hiệu: giữ lại làm bản "chưa xác nhận" (không tự coi là hiện hành)
function seed(brandId) {
  const s = store();
  const b = require('./planner').brands()[brandId];
  s[brandId] = s[brandId] || {};
  if (b && b.hotline && !s[brandId].hotline) s[brandId].hotline = { value: b.hotline, status: 'unverified', validFrom: '', validTo: '', version: 1, history: [], note: 'Lấy từ hồ sơ thương hiệu cũ — cần xác nhận' };
  return s[brandId];
}

function set(brandId, key, patch, by = 'Sếp') {
  if (!brandIds().includes(brandId)) throw bad('Thương hiệu không tồn tại', 404);
  if (!KEYS[key]) throw bad('Loại dữ liệu không hợp lệ');
  const cur = seed(brandId);
  const f = cur[key] || { value: '', status: 'unverified', validFrom: '', validTo: '', version: 0, history: [] };
  const next = { ...f };
  if (patch.value !== undefined) next.value = String(patch.value).trim().slice(0, 2000);
  for (const k of ['validFrom', 'validTo']) {
    if (patch[k] === undefined) continue;
    const v = String(patch[k]).trim();
    if (v && !isDate(v)) throw bad('Ngày hiệu lực phải dạng YYYY-MM-DD');
    next[k] = v;
  }
  if (next.validFrom && next.validTo && next.validTo < next.validFrom) throw bad('Ngày hết hiệu lực trước ngày bắt đầu');
  if (key === 'hotline' && next.value && !/^[\d\s.+()-]{8,20}$/.test(next.value)) throw bad('Hotline chỉ gồm số, dấu cách, + . - ( )');
  if (key === 'bookingLink' && next.value && !/^https?:\/\//i.test(next.value)) throw bad('Link đặt lịch phải bắt đầu bằng http:// hoặc https://');
  if (key === 'promotions' && patch.verified === true && next.value && !next.validTo) throw bad('Ưu đãi phải có ngày hết hiệu lực trước khi xác nhận');
  const changed = ['value', 'validFrom', 'validTo'].some((k) => next[k] !== f[k]);
  // Sửa nội dung/hiệu lực thì mất xác nhận cũ; chỉ xác nhận khi quản trị viên chủ động bấm
  if (changed) next.status = 'unverified';
  if (patch.verified === true) {
    if (!next.value) throw bad('Chưa có nội dung để xác nhận');
    next.status = 'verified'; next.verifiedBy = by; next.verifiedAt = new Date().toISOString();
  } else if (patch.verified === false) next.status = 'unverified';
  if (!changed && next.status === f.status) return cur[key] || next;
  next.version = (f.version || 0) + 1;
  next.history = [{ version: next.version, at: new Date().toISOString(), by, value: next.value, status: next.status, validFrom: next.validFrom, validTo: next.validTo }, ...(f.history || [])].slice(0, MAX_HISTORY);
  delete next.note;
  cur[key] = next;
  save();
  return next;
}

// Ưu đãi hiện hành: dòng trong "Ưu đãi" đã xác nhận + khuyến mãi Sếp nhập ở Kế hoạch tháng (đã có ngày bắt đầu/kết thúc)
function activePromos(brandId, now = Date.now()) {
  const out = [];
  const f = (seed(brandId) || {}).promotions;
  if (stateOf(f, now) === 'current') for (const line of String(f.value).split('\n').map((x) => x.trim()).filter(Boolean)) out.push({ text: line, to: f.validTo, source: 'facts' });
  try {
    const mp = require('./monthplan');
    const today = ymd(now);
    for (const m of [today.slice(0, 7)]) {
      const plan = mp.view(m, now).brands[brandId];
      for (const p of (plan && plan.plan.promos) || []) if (p.from <= today && p.to >= today) out.push({ text: `${p.name}${p.detail ? ' — ' + p.detail : ''}`, to: p.to, source: 'monthplan' });
    }
  } catch { /* kế hoạch tháng chưa có: bỏ qua */ }
  return out;
}

// Dữ kiện dùng được cho bài viết: chỉ cái đã xác nhận và còn hiệu lực
function current(brandId, now = Date.now()) {
  const cur = seed(brandId);
  const val = (k) => (stateOf(cur[k], now) === 'current' ? cur[k].value : '');
  return { hotline: val('hotline'), bookingLink: val('bookingLink'), hours: val('hours'), prices: val('prices'), warranty: val('warranty'), promos: activePromos(brandId, now) };
}

function view(brandId, now = Date.now()) {
  const cur = seed(brandId);
  return Object.entries(KEYS).map(([key, def]) => {
    const f = cur[key] || null;
    return { key, label: def.label, hint: def.hint, value: f ? f.value : '', status: f ? f.status : 'unverified', state: stateOf(f, now), validFrom: f ? f.validFrom : '', validTo: f ? f.validTo : '', version: f ? f.version : 0, verifiedBy: f ? f.verifiedBy || '' : '', verifiedAt: f ? f.verifiedAt || '' : '', history: f ? f.history || [] : [] };
  });
}

module.exports = { KEYS, set, view, current, activePromos, stateOf };
