// Đăng Instagram qua Graph API (Instagram Business/Creator liên kết với Facebook Page của thương hiệu).
// Cách Meta cho đăng: không tải file lên trực tiếp mà đưa ĐỊA CHỈ công khai để máy chủ Meta tự kéo về,
// nên app tạo link tạm có chữ ký (hết hạn sau 24 giờ) tới đúng file trong thư viện: /pub/media/<dữ liệu>.<chữ ký>.
// Các bước: tạo "container" (ảnh / Reel / carousel) → chờ Meta xử lý xong (video) → media_publish.
// Video xử lý lâu: chờ một lúc, chưa xong thì trả về container đang chờ để lần quét sau đăng tiếp (container sống 24 giờ).
const crypto = require('node:crypto');
const meta = require('../meta');
const secrets = require('../secrets');

const baseUrl = () => String(process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const LINK_TTL = 24 * 3600e3;
const MAX_CAPTION = 2200;
const MAX_ITEMS = 10;

// Khoá ký link: sinh 1 lần, giữ trong kho bí mật (không vào db.json)
function key() {
  const s = secrets.load();
  if (!s.mediaLinkKey) { s.mediaLinkKey = crypto.randomBytes(32).toString('hex'); secrets.save(); }
  return s.mediaLinkKey;
}
const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sign = (data) => b64(crypto.createHmac('sha256', key()).update(data).digest());

// cached = true: file là bản JPG đã đổi cho Instagram (src/igimage.js), không phải file gốc trong thư viện
function signedUrl(brand, name, now = Date.now(), cached = false) {
  if (!baseUrl()) throw new Error('Thiếu PUBLIC_BASE_URL (địa chỉ https của app) trong .env — Instagram cần link công khai để lấy ảnh/video');
  const data = b64(JSON.stringify({ b: brand, n: name, e: now + LINK_TTL, ...(cached ? { c: 1 } : {}) }));
  return `${baseUrl()}/pub/media/${data}.${sign(data)}`;
}
// Trả về { brand, name, cached } nếu link đúng chữ ký và còn hạn, ngược lại null
function verifyLink(token, now = Date.now()) {
  const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(token || ''));
  if (!m) return null;
  const want = Buffer.from(sign(m[1]));
  const got = Buffer.from(m[2]);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  let o;
  try { o = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')); } catch { return null; }
  if (!o || typeof o.b !== 'string' || typeof o.n !== 'string' || !(o.e > now)) return null;
  return { brand: o.b, name: o.n, cached: o.c === 1 };
}

// Kiểm tra bài trước khi đăng (rỗng = ổn). files: [{ type, name }]
function problemOf(text, files) {
  if (!files.length) return 'Instagram bắt buộc có ảnh hoặc video — gắn media cho bài';
  if (files.length > MAX_ITEMS) return `Instagram chỉ cho tối đa ${MAX_ITEMS} ảnh/video trong 1 bài`;
  if (String(text || '').length > MAX_CAPTION) return `Chú thích Instagram tối đa ${MAX_CAPTION} ký tự (bài đang ${String(text).length})`;
  if ((String(text || '').match(/#[^\s#]+/g) || []).length > 30) return 'Instagram cho tối đa 30 hashtag mỗi bài';
  return '';
}

// Tài khoản Instagram liên kết với Page (giữ 10 phút)
const igCache = new Map();
async function accountOf(pageId, pageToken) {
  const c = igCache.get(pageId);
  if (c && Date.now() - c.at < 10 * 60e3) return c.ig;
  const r = await meta.call(`/${pageId}`, { token: pageToken, params: { fields: 'instagram_business_account{id,username}' } });
  const ig = r.instagram_business_account ? { id: String(r.instagram_business_account.id), username: r.instagram_business_account.username || '' } : null;
  igCache.set(pageId, { at: Date.now(), ig });
  return ig;
}
const resetCache = () => igCache.clear();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pollMs = () => Number(process.env.IG_POLL_MS ?? 5000);
const pollTries = () => Number(process.env.IG_POLL_TRIES ?? 24); // ~2 phút

// Chờ container xử lý xong. true = xong; false = vẫn đang xử lý (lần sau thử tiếp)
async function waitReady(id, token) {
  for (let i = 0; ; i++) {
    const s = await meta.call(`/${id}`, { token, params: { fields: 'status_code,status' } });
    if (s.status_code === 'FINISHED' || s.status_code === 'PUBLISHED') return true;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`Instagram không xử lý được media (${s.status || s.status_code}) — kiểm tra định dạng/thời lượng video`);
    if (i >= pollTries()) return false;
    await sleep(pollMs());
  }
}

// files: [{ type, name, url }]. pending: container đã tạo ở lần trước (nếu có).
// Trả về { externalId, permalink } khi đã đăng, hoặc { pending: containerId } khi video còn đang xử lý.
async function publish(igId, token, caption, files, { pending } = {}) {
  let container = pending;
  if (!container) {
    if (files.length === 1) {
      const f = files[0];
      const params = f.type === 'video'
        ? { media_type: 'REELS', video_url: f.url, caption, share_to_feed: true }
        : { image_url: f.url, caption };
      container = (await meta.call(`/${igId}/media`, { method: 'POST', token, params })).id;
    } else {
      const children = [];
      for (const f of files) {
        const params = f.type === 'video' ? { media_type: 'VIDEO', video_url: f.url, is_carousel_item: true } : { image_url: f.url, is_carousel_item: true };
        const id = (await meta.call(`/${igId}/media`, { method: 'POST', token, params })).id;
        if (f.type === 'video' && !(await waitReady(id, token))) throw new Error('Video trong carousel xử lý quá lâu — thử lại ở lần quét sau');
        children.push(id);
      }
      container = (await meta.call(`/${igId}/media`, { method: 'POST', token, params: { media_type: 'CAROUSEL', children: children.join(','), caption } })).id;
    }
  }
  if (!(await waitReady(container, token))) return { pending: container };
  const j = await meta.call(`/${igId}/media_publish`, { method: 'POST', token, params: { creation_id: container } });
  let permalink = '';
  try { permalink = (await meta.call(`/${j.id}`, { token, params: { fields: 'permalink' } })).permalink || ''; } catch { /* không bắt buộc */ }
  return { externalId: j.id, permalink };
}

module.exports = { signedUrl, verifyLink, problemOf, accountOf, resetCache, publish, baseUrl, MAX_CAPTION };
