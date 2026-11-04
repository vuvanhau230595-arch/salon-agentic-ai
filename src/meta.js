// Gọi Meta Graph API: dùng chung cho Quảng cáo và Page.
// Không bao giờ ghi token vào log hay thông báo lỗi.
const version = () => process.env.META_API_VERSION || 'v26.0';
const base = () => `https://graph.facebook.com/${version()}`;

// Lỗi Meta → câu tiếng Việt dễ hiểu
function friendly(err) {
  const code = err && err.code;
  const msg = (err && err.message) || 'Lỗi không rõ';
  if (code === 190) return 'Token hết hạn hoặc bị thu hồi — tạo lại token (xem HUONG-DAN-META.md).';
  if (code === 10 || code === 200 || code === 299) return `Token thiếu quyền cần thiết (${msg}).`;
  if ([4, 17, 32, 613, 80000, 80003, 80004].includes(code)) return 'Chạm giới hạn số lần gọi Meta API — agent sẽ thử lại ở lần quét sau.';
  // Meta thường kèm câu giải thích cho người dùng (error_user_title/msg) — rõ hơn "Invalid parameter" nhiều
  const human = err && (err.error_user_title || err.error_user_msg) ? ` — ${[err.error_user_title, err.error_user_msg].filter(Boolean).join(': ')}` : '';
  if (code === 100) return `Meta từ chối yêu cầu: ${msg}${human}`;
  return `Meta API: ${msg}${human}`;
}

class MetaError extends Error {
  constructor(err) { super(friendly(err)); this.code = err && err.code; }
}

// files: { tênTrường: { blob, filename } } → gửi multipart (tải ảnh/video lên). host: máy chủ khác (video).
async function callOnce(path, { method = 'GET', params = {}, token = process.env.META_ACCESS_TOKEN, files, host } = {}) {
  if (!token) throw new Error('Thiếu META_ACCESS_TOKEN');
  const all = { ...params, access_token: token };
  const root = host ? `https://${host}/${version()}` : base();
  let res;
  if (files) {
    const form = new FormData();
    for (const [k, v] of Object.entries(all)) form.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    for (const [k, f] of Object.entries(files)) form.set(k, f.blob, f.filename);
    res = await fetch(root + path, { method: 'POST', body: form });
  } else if (method === 'GET') {
    const url = new URL(root + path);
    for (const [k, v] of Object.entries(all)) url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    res = await fetch(url);
  } else {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(all)) body.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    res = await fetch(root + path, { method, body });
  }
  let json;
  try { json = await res.json(); } catch { throw new Error(`Meta trả về dữ liệu không đọc được (HTTP ${res.status})`); }
  if (json.error) throw new MetaError(json.error);
  return json;
}

// Chạm giới hạn gọi API (rate limit) hoặc mạng chập chờn: chỉ đọc (GET) mới tự thử lại, chờ lâu dần.
// Ghi (POST/DELETE) không tự thử lại để không tạo/đổi dữ liệu 2 lần. META_RETRY_MS="1500,4000" (đặt "0,0" khi kiểm thử).
const RATE = new Set([4, 17, 32, 613, 80000, 80003, 80004]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(path, opts = {}) {
  const delays = String(process.env.META_RETRY_MS || (process.env.NODE_TEST_CONTEXT ? '0' : '1500,4000')).split(',').map(Number).filter((n) => n >= 0);
  const canRetry = (opts.method || 'GET') === 'GET' && !opts.files;
  for (let i = 0; ; i++) {
    try { return await callOnce(path, opts); }
    catch (e) {
      const transient = RATE.has(e.code) || (e instanceof TypeError); // TypeError: fetch không tới được máy chủ
      if (!canRetry || !transient || i >= delays.length) throw e;
      await sleep(delays[i]);
    }
  }
}

// Lấy hết các trang kết quả (theo cursor), tối đa maxPages trang
async function all(path, opts = {}, maxPages = 10) {
  const out = [];
  let after;
  for (let i = 0; i < maxPages; i++) {
    const r = await call(path, { ...opts, params: { ...(opts.params || {}), ...(after ? { after } : {}) } });
    out.push(...(r.data || []));
    after = r.paging && r.paging.next && r.paging.cursors && r.paging.cursors.after;
    if (!after) break;
  }
  return out;
}

// ID tài khoản quảng cáo của từng thương hiệu (chỉ chữ số, bỏ tiền tố act_)
const adAccount = (id) => 'act_' + String(id || '').replace(/^act_/, '');

module.exports = { call, all, version, friendly, MetaError, adAccount };
