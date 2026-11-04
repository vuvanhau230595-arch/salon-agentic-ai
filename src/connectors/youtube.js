// YouTube Data API v3: tải video (YouTube Shorts) lên kênh của từng thương hiệu.
// Theo tài liệu chính thức developers.google.com/youtube (đã đối chiếu 10/2026):
//  - Đăng nhập OAuth 2.0 "Web application": https://accounts.google.com/o/oauth2/v2/auth (access_type=offline + prompt=consent
//    để Google luôn trả refresh token). Đổi mã/làm mới: POST https://oauth2.googleapis.com/token. Thu hồi: POST /revoke
//  - Kênh của tài khoản: GET /youtube/v3/channels?part=snippet&mine=true (1 đơn vị hạn mức)
//  - Tải lên kiểu resumable: POST /upload/youtube/v3/videos?uploadType=resumable&part=snippet,status → Location (phiên tải lên),
//    PUT cả file vào Location. Đứt giữa chừng: PUT rỗng "Content-Range: bytes */<size>" → 308 + Range = phần đã nhận, gửi tiếp phần còn lại
//  - Mỗi video tải lên tốn ~1600 đơn vị trong hạn mức mặc định 10.000/ngày/dự án → khoảng 6 video/ngày
// Dự án Google Cloud CHƯA qua kiểm tra (audit) YouTube API: mọi video tải lên bằng API bị khoá ở chế độ riêng tư.
// Khoá client (Client ID/secret) lấy từ .env (YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET) hoặc nhập ở Cài đặt → Kết nối API (lưu trong secrets.json).
// Không bao giờ ghi token / client secret ra log, db.json hay giao diện.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const secrets = require('../secrets');

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOKE = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'];
const PRIVACY = ['public', 'unlisted', 'private'];
const CATEGORY = '26'; // Howto & Style
const STATE_TTL = 10 * 60e3;
const MIME = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };

const store = () => secrets.load().youtube;
const clientId = () => process.env.YOUTUBE_CLIENT_ID || store().clientId || '';
const clientSecret = () => process.env.YOUTUBE_CLIENT_SECRET || store().clientSecret || '';
const keySource = () => (process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET ? 'env' : store().clientId && store().clientSecret ? 'web' : '');
const baseUrl = () => String(process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const redirectUri = () => (baseUrl() ? `${baseUrl()}/api/youtube/callback` : '');
// Google chỉ nhận redirect https (riêng localhost được dùng http khi thử trên máy)
const httpsOk = () => /^https:\/\//.test(baseUrl()) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseUrl());
const configured = () => !!(clientId() && clientSecret() && httpsOk());

const ERR = {
  quotaExceeded: 'YouTube báo hết hạn mức API hôm nay (quotaExceeded): mỗi video tải lên tốn khoảng 1.600 đơn vị trong hạn mức mặc định 10.000 đơn vị/ngày của dự án Google Cloud, tức khoảng 6 video/ngày cho tất cả kênh dùng chung dự án. Hạn mức đặt lại lúc 0h giờ Thái Bình Dương (khoảng 14–15h giờ Việt Nam), bài sẽ được thử lại sau. Cần nhiều hơn thì gửi đơn xin tăng hạn mức YouTube API.',
  uploadLimitExceeded: 'Kênh YouTube đã chạm giới hạn số video được tải lên (uploadLimitExceeded — giới hạn riêng của kênh, không phải hạn mức API). Chờ khoảng 24 giờ rồi thử lại; kênh mới hoặc chưa xác minh số điện thoại có giới hạn thấp hơn.',
  invalid_grant: 'Quyền truy cập kênh YouTube đã hết hạn hoặc bị thu hồi (invalid_grant) — vào trang Kênh bấm "Kết nối YouTube" để kết nối lại kênh. Nếu ứng dụng Google (màn hình đồng ý OAuth) còn ở chế độ Testing thì quyền chỉ giữ được 7 ngày: chuyển ứng dụng sang Production (xem HUONG-DAN-YOUTUBE.md).',
  accessNotConfigured: 'Dự án Google Cloud chưa bật "YouTube Data API v3" — vào Google Cloud Console → APIs & Services → Library, tìm "YouTube Data API v3" → Enable, chờ vài phút rồi thử lại.',
  youtubeSignupRequired: 'Tài khoản Google này chưa có kênh YouTube — tạo kênh trên youtube.com rồi kết nối lại.',
  insufficientPermissions: 'Kênh YouTube chưa cấp đủ quyền (cần quyền tải video lên youtube.upload) — kết nối lại và tick đủ các quyền khi Google hỏi.',
  authError: 'Phiên đăng nhập YouTube không hợp lệ — kết nối lại kênh YouTube ở trang Kênh.',
  invalid_client: 'Client ID / Client secret YouTube sai hoặc đã bị xoá trong Google Cloud — nhập lại ở Cài đặt → Kết nối API → YouTube.',
  rateLimitExceeded: 'YouTube giới hạn tốc độ gọi API — thử lại sau ít phút.',
  invalidTitle: 'Tiêu đề video YouTube không hợp lệ (tối đa 100 ký tự, không chứa dấu < >).',
  invalidDescription: 'Mô tả video YouTube không hợp lệ (tối đa 5000 byte, không chứa dấu < >).',
  invalidTags: 'Thẻ (tags) video YouTube không hợp lệ (tổng tối đa 500 ký tự).',
  invalidPublishAt: 'Giờ hẹn đăng YouTube không hợp lệ (phải ở tương lai và video phải để riêng tư).',
  invalidCategoryId: 'Danh mục video YouTube không hợp lệ.',
  no_channel: 'Tài khoản Google đã chọn chưa có kênh YouTube nào — khi Google hỏi, chọn đúng tài khoản/kênh của thương hiệu (ví dụ kênh "THE ONE HAIR SALON").',
  no_refresh: 'Google không trả refresh token — vào https://myaccount.google.com/permissions gỡ quyền của ứng dụng rồi bấm "Kết nối YouTube" lại.',
};
ERR.SERVICE_DISABLED = ERR.accessNotConfigured;
ERR.ACCESS_TOKEN_SCOPE_INSUFFICIENT = ERR.insufficientPermissions;
ERR.userRateLimitExceeded = ERR.rateLimitExceeded;
ERR.unauthorized_client = ERR.invalid_client;

// fatal: thử lại vô ích cho tới khi Sếp sửa cấu hình; retryLater: hết hạn mức/giới hạn — giữ lịch, lần quét sau thử lại (không tính là lần lỗi)
const FATAL = ['invalid_grant', 'authError', 'accessNotConfigured', 'SERVICE_DISABLED', 'youtubeSignupRequired', 'insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT', 'invalid_client', 'unauthorized_client', 'no_channel', 'no_refresh'];
const LATER = ['quotaExceeded', 'uploadLimitExceeded', 'rateLimitExceeded', 'userRateLimitExceeded'];

class YouTubeError extends Error {
  constructor(code, message) {
    super(ERR[code] || `YouTube: ${message || code}`);
    this.code = code;
    this.fatal = FATAL.includes(code);
    this.retryLater = LATER.includes(code);
  }
}

async function readJson(res) {
  try { return await res.json(); } catch { return {}; }
}

// Lỗi API Google: { error: { code, message, errors: [{ reason }], status, details: [{ reason }] } } → mã lý do cụ thể nhất
function apiError(j, status) {
  const e = (j && j.error) || {};
  const reason = ((e.errors || [])[0] || {}).reason || ((e.details || []).find((d) => d && d.reason) || {}).reason || e.status;
  if (reason) return new YouTubeError(reason, e.message);
  return new YouTubeError(`http_${status}`, `lỗi máy chủ (HTTP ${status})`);
}

async function oauth(form) {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), ...form }),
  });
  const j = await readJson(res);
  if (j.error || !j.access_token) {
    const code = typeof j.error === 'string' ? j.error : '';
    const e = new YouTubeError(code || 'oauth', `đăng nhập Google thất bại (${j.error_description || code || `HTTP ${res.status}`})`);
    e.fatal = true;
    throw e;
  }
  return j;
}

async function get(pathName, token) {
  const res = await fetch(API + pathName, { headers: { Authorization: `Bearer ${token}` } });
  const j = await readJson(res);
  if (!res.ok || j.error) throw apiError(j, res.status);
  return j;
}

// ---- Đăng nhập (OAuth) ----
function newState(brand) {
  const s = store();
  const now = Date.now();
  for (const [k, v] of Object.entries(s.states)) if (v.exp < now) delete s.states[k];
  const state = crypto.randomBytes(18).toString('hex');
  s.states[state] = { brand, exp: now + STATE_TTL };
  secrets.save();
  return state;
}

function consumeState(state) {
  const s = store();
  const st = s.states[state];
  if (!st) return null;
  delete s.states[state];
  secrets.save();
  return st.exp >= Date.now() ? st.brand : null;
}

function authUrl(state) {
  const qs = new URLSearchParams({
    client_id: clientId(), redirect_uri: redirectUri(), response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  });
  return `${AUTH}?${qs}`;
}

// Kênh đầu tiên của tài khoản đã đăng nhập: { id, title, customUrl }
async function myChannel(token) {
  const j = await get('/channels?part=snippet&mine=true', token);
  const c = (j.items || [])[0];
  if (!c) throw new YouTubeError('no_channel');
  return { id: c.id, title: (c.snippet && c.snippet.title) || '', customUrl: (c.snippet && c.snippet.customUrl) || '' };
}

// Mỗi thương hiệu 1 kênh YouTube: secrets.youtube.channels[brand]. Kết nối lại = thay kênh/làm mới quyền.
async function connect(brand, code) {
  const t = await oauth({ code, grant_type: 'authorization_code', redirect_uri: redirectUri() });
  if (!String(t.scope || '').split(' ').includes(SCOPES[0])) throw new YouTubeError('insufficientPermissions');
  if (!t.refresh_token) throw new YouTubeError('no_refresh');
  const ch = await myChannel(t.access_token);
  const s = store();
  // Một kênh chỉ thuộc 1 thương hiệu (tránh 1 video đăng 2 lần lên cùng kênh)
  const other = Object.keys(s.channels).find((b) => b !== brand && s.channels[b].channelId === ch.id);
  if (other) throw new YouTubeError('channel_in_other_brand', 'kênh YouTube này đang gắn với thương hiệu khác — ngắt kết nối ở đó trước (tránh đăng trùng)');
  const now = Date.now();
  s.channels[brand] = {
    channelId: ch.id, title: ch.title, customUrl: ch.customUrl,
    refreshToken: t.refresh_token, accessToken: t.access_token,
    accessExpiresAt: now + (Number(t.expires_in) || 3600) * 1000,
    scope: t.scope, connectedAt: new Date(now).toISOString(),
  };
  secrets.save();
  return { connected: true, ...channelView(s.channels[brand]) };
}

// Access token sống ~1 giờ: còn > 5 phút thì dùng, không thì làm mới bằng refresh token (Google không đổi refresh token)
async function freshToken(brand) {
  const c = store().channels[brand];
  if (!c) throw new YouTubeError('authError');
  if (c.accessToken && Date.now() < c.accessExpiresAt - 5 * 60e3) return c.accessToken;
  try {
    const t = await oauth({ grant_type: 'refresh_token', refresh_token: c.refreshToken });
    c.accessToken = t.access_token;
    c.accessExpiresAt = Date.now() + (Number(t.expires_in) || 3600) * 1000;
    if (t.refresh_token) c.refreshToken = t.refresh_token;
    delete c.needsReauth;
    secrets.save();
    return c.accessToken;
  } catch (e) {
    if (e.code === 'invalid_grant') { c.needsReauth = true; delete c.accessToken; secrets.save(); }
    throw e;
  }
}

// Thông tin công khai của kênh (KHÔNG có token)
const channelView = (c) => ({ channelId: c.channelId, title: c.title, customUrl: c.customUrl || '', needsReauth: !!c.needsReauth, connectedAt: c.connectedAt });
const connected = (brand) => !!store().channels[brand];
const summary = (brand) => (connected(brand) ? { connected: true, ...channelView(store().channels[brand]) } : { connected: false });

async function disconnect(brand) {
  const s = store();
  const c = s.channels[brand];
  if (!c) return false;
  // Thu hồi quyền ở phía Google (lỗi vẫn xoá token phía mình)
  try { await fetch(REVOKE, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: c.refreshToken }) }); } catch { /* bỏ qua */ }
  delete s.channels[brand];
  secrets.save();
  return true;
}

// Khoá OAuth client nhập qua web (trống = gỡ). Khoá trong .env luôn được ưu tiên.
function setClient(id, secret) {
  const s = store();
  id = String(id || '').trim();
  secret = String(secret || '').trim();
  if (!id && !secret) { delete s.clientId; delete s.clientSecret; secrets.save(); return; }
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(id)) throw new Error('Client ID không đúng dạng (…apps.googleusercontent.com)');
  if (!/^[\w-]{10,100}$/.test(secret)) throw new Error('Client secret không đúng dạng (thường bắt đầu bằng GOCSPX-)');
  s.clientId = id;
  s.clientSecret = secret;
  secrets.save();
}

// ---- Tiêu đề / mô tả / thẻ ----
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}‍︎️⃣]/gu;
const HASHTAG = /#[\p{L}\p{N}_]+/gu;
const clean = (s) => String(s).replace(EMOJI, '').replace(HASHTAG, '').replace(/[<>]/g, '').replace(/\s+/g, ' ')
  .replace(/^[\s\-–—|·:,.]+|[\s\-–—|·:,]+$/g, '').trim();

// Tiêu đề ≤100 ký tự: dòng đầu có chữ của chú thích, bỏ emoji và hashtag; còn chỗ thì thêm "#Shorts"; quá dài thì cắt ở ranh giới từ
function buildTitle(caption, fallback = 'Video') {
  let t = '';
  for (const line of String(caption || '').split(/\r?\n/)) { t = clean(line); if (t) break; }
  if (!t) t = clean(fallback) || 'Video';
  const chars = [...t];
  if (chars.length <= 100 - ' #Shorts'.length) return `${t} #Shorts`;
  if (chars.length <= 100) return t;
  let cut = chars.slice(0, 100).join('');
  const sp = cut.lastIndexOf(' ');
  if (sp >= 60) cut = cut.slice(0, sp);
  return cut.replace(/[\s\-–—|·:,]+$/, '');
}

// Mô tả: YouTube giới hạn 5000 BYTE (UTF-8; chữ Việt có dấu tốn 2–3 byte) và không nhận dấu < >
function buildDescription(text) {
  const s = String(text || '').replace(/[<>]/g, '');
  if (Buffer.byteLength(s, 'utf8') <= 5000) return s;
  let out = '';
  let bytes = 0;
  for (const ch of s) {
    const b = Buffer.byteLength(ch, 'utf8');
    if (bytes + b > 5000) break;
    out += ch;
    bytes += b;
  }
  return out;
}

// Thẻ: truyền vào hoặc lấy từ hashtag của chú thích; tổng ≤500 ký tự (thẻ có dấu cách tính thêm 2 ngoặc kép, mỗi thẻ thêm 1 dấu phẩy)
function buildTags(tags, caption) {
  const src = Array.isArray(tags) && tags.length ? tags : (String(caption || '').match(HASHTAG) || []);
  const out = [];
  let total = 0;
  for (const raw of src) {
    const t = String(raw).replace(/^#/, '').replace(/[<>,]/g, '').trim().slice(0, 100);
    if (!t || out.some((x) => x.toLowerCase() === t.toLowerCase())) continue;
    const cost = t.length + (t.includes(' ') ? 2 : 0) + (out.length ? 1 : 0);
    if (total + cost > 500) break;
    out.push(t);
    total += cost;
  }
  return out;
}

// ---- Tải video lên (resumable) ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Hỏi máy chủ đã nhận tới byte nào: 308 + "Range: bytes=0-N" → còn thiếu từ N+1; 200/201 = đã nhận đủ (trả về video)
async function uploadedSoFar(sessionUrl, size) {
  const res = await fetch(sessionUrl, { method: 'PUT', redirect: 'manual', headers: { 'Content-Range': `bytes */${size}` }, body: new Uint8Array(0) });
  if (res.status === 200 || res.status === 201) return { done: await readJson(res) };
  if (res.status !== 308) throw apiError(await readJson(res), res.status);
  const m = String(res.headers.get('range') || '').match(/bytes=0-(\d+)/);
  return { next: m ? Number(m[1]) + 1 : 0 };
}

async function sendFile(sessionUrl, filePath, size, mime, { retries = 3, retryMs = 2000 } = {}) {
  const blob = await fs.openAsBlob(filePath);
  let next = 0;
  for (let attempt = 0; ; attempt++) {
    let res = null;
    try {
      res = await fetch(sessionUrl, {
        method: 'PUT', redirect: 'manual',
        headers: { 'Content-Type': mime, ...(next ? { 'Content-Range': `bytes ${next}-${size - 1}/${size}` } : {}) },
        body: next ? blob.slice(next) : blob,
      });
    } catch { /* đứt mạng: hỏi lại phần đã nhận rồi gửi tiếp */ }
    if (res && (res.status === 200 || res.status === 201)) return readJson(res);
    // 4xx (trừ 308) là lỗi thật, không gửi lại
    if (res && res.status !== 308 && res.status < 500) throw apiError(await readJson(res), res.status);
    if (attempt >= retries) throw new YouTubeError('upload_failed', `tải video lên bị gián đoạn, đã thử lại ${retries} lần${res ? ` (HTTP ${res.status})` : ''}`);
    await sleep(retryMs * (attempt + 1));
    const st = await uploadedSoFar(sessionUrl, size);
    if (st.done) return st.done;
    next = st.next;
  }
}

// opts: { title, description, tags, privacy ('public'|'unlisted'|'private'), publishAt, madeForKids:false, retries, retryMs }
// Trả về { videoId, url, privacy }
async function publishVideo(brand, filePath, opts = {}) {
  const size = fs.statSync(filePath).size;
  if (!(size > 0)) throw new Error('File video rỗng');
  const mime = MIME[path.extname(filePath).toLowerCase()] || 'video/mp4';
  let privacy = PRIVACY.includes(opts.privacy) ? opts.privacy : 'public';
  let publishAt = null;
  if (opts.publishAt) {
    const t = new Date(opts.publishAt);
    if (Number.isNaN(t.getTime()) || t.getTime() <= Date.now()) throw new YouTubeError('invalidPublishAt');
    publishAt = t.toISOString();
    privacy = 'private'; // YouTube chỉ hẹn giờ được video riêng tư (tự chuyển công khai đúng giờ)
  }
  const snippet = {
    title: buildTitle(opts.title || opts.description || ''),
    description: buildDescription(opts.description || ''),
    categoryId: CATEGORY,
  };
  const tags = buildTags(opts.tags, opts.description);
  if (tags.length) snippet.tags = tags;
  const status = { privacyStatus: privacy, selfDeclaredMadeForKids: !!opts.madeForKids, ...(publishAt ? { publishAt } : {}) };

  const token = await freshToken(brand);
  const init = await fetch(UPLOAD, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(size), 'X-Upload-Content-Type': mime },
    body: JSON.stringify({ snippet, status }),
  });
  if (!init.ok) throw apiError(await readJson(init), init.status);
  const sessionUrl = init.headers.get('location');
  if (!sessionUrl) throw new YouTubeError('no_session', 'YouTube không trả địa chỉ tải lên');
  const v = await sendFile(sessionUrl, filePath, size, mime, opts);
  if (!v || !v.id) throw new YouTubeError('no_id', 'YouTube không trả mã video — chưa xác nhận được video đã lên');
  return { videoId: v.id, url: `https://youtube.com/shorts/${v.id}`, privacy: (v.status && v.status.privacyStatus) || privacy, ...(publishAt ? { publishAt } : {}) };
}

module.exports = {
  configured, redirectUri, clientId, keySource, setClient, authUrl, newState, consumeState, connect, freshToken, myChannel,
  connected, summary, disconnect, publishVideo, buildTitle, buildDescription, buildTags, YouTubeError, SCOPES, PRIVACY,
};
