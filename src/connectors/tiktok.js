// TikTok Content Posting API (Direct Post, tải video lên bằng FILE_UPLOAD).
// Theo tài liệu chính thức developers.tiktok.com (đã đối chiếu 10/2026):
//  - Đăng nhập OAuth từng tài khoản: https://www.tiktok.com/v2/auth/authorize/ (redirect_uri phải https, đã đăng ký đúng)
//  - Đổi mã/làm mới token: POST https://open.tiktokapis.com/v2/oauth/token/ (access 24h, refresh ~365 ngày, refresh có thể đổi)
//  - Thông tin tài khoản: POST /v2/post/publish/creator_info/query/ (privacy_level_options, ...)
//  - Khởi tạo: POST /v2/post/publish/video/init/ → publish_id + upload_url (hiệu lực 1 giờ)
//  - Tải lên: PUT upload_url từng khúc (206 = còn khúc, 201 = xong). Khúc 5–64MB, khúc cuối tối đa 128MB, ≤1000 khúc, tối đa 4GB
//  - Trạng thái: POST /v2/post/publish/status/fetch/
// Ứng dụng CHƯA qua kiểm duyệt (audit) chỉ đăng ở chế độ riêng tư và chỉ lên tài khoản đặt riêng tư.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const secrets = require('../secrets');

const API = 'https://open.tiktokapis.com';
const AUTH = 'https://www.tiktok.com/v2/auth/authorize/';
const SCOPES = 'user.info.basic,video.publish';
const MB = 1048576;
const MAX_BYTES = 4 * 1024 * MB;
const STATE_TTL = 10 * 60e3;
const MIME = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };

const clientKey = () => process.env.TIKTOK_CLIENT_KEY;
const clientSecret = () => process.env.TIKTOK_CLIENT_SECRET;
const baseUrl = () => String(process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const redirectUri = () => (baseUrl() ? `${baseUrl()}/auth/tiktok/callback` : '');
// Cách đăng: 'manual' (mặc định) = agent soạn "gói đăng", Sếp đăng bằng TikTok Studio; 'api' = đăng thẳng bằng API (cần audit để đăng công khai)
const mode = () => (require('../db').load().settings.tiktokMode === 'api' ? 'api' : 'manual');
// Cần đủ khóa ứng dụng và địa chỉ HTTPS công khai (TikTok bắt buộc redirect https)
const configured = () => !!(clientKey() && clientSecret() && baseUrl().startsWith('https://'));

const ERR = {
  access_token_invalid: 'Phiên đăng nhập TikTok hết hạn hoặc bị thu hồi — kết nối lại TikTok ở Thương hiệu & Kênh.',
  scope_not_authorized: 'Tài khoản TikTok chưa cấp quyền đăng video (video.publish) — kết nối lại và cho phép đủ quyền.',
  rate_limit_exceeded: 'TikTok giới hạn số lần gọi — thử lại sau ít phút.',
  spam_risk_too_many_posts: 'Tài khoản TikTok đã đạt giới hạn số bài đăng bằng API trong 24 giờ.',
  spam_risk_user_banned_from_posting: 'Tài khoản TikTok đang bị cấm đăng bài.',
  reached_active_user_cap: 'Ứng dụng TikTok đã chạm giới hạn số tài khoản được đăng trong ngày.',
  unaudited_client_can_only_post_to_private_accounts: 'Ứng dụng TikTok chưa qua kiểm duyệt (audit): chỉ đăng được lên tài khoản đang ở chế độ RIÊNG TƯ. Hãy đặt tài khoản TikTok sang riêng tư để thử, hoặc nộp audit.',
  privacy_level_option_mismatch: 'Chế độ hiển thị không khớp với lựa chọn TikTok cho phép của tài khoản này.',
  url_ownership_unverified: 'TikTok chưa xác minh quyền sở hữu địa chỉ video.',
  invalid_param: 'TikTok từ chối thông số gửi lên.',
};

class TikTokError extends Error {
  constructor(code, message) {
    super(ERR[code] || `TikTok: ${message || code}`);
    this.code = code;
    this.fatal = ['access_token_invalid', 'scope_not_authorized', 'spam_risk_user_banned_from_posting', 'unaudited_client_can_only_post_to_private_accounts'].includes(code);
  }
}

async function readJson(res) {
  try { return await res.json(); } catch { return {}; }
}

async function call(pathName, { token, body = {} }) {
  const res = await fetch(API + pathName, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body),
  });
  const j = await readJson(res);
  const code = j.error && j.error.code;
  if (code && code !== 'ok') throw new TikTokError(code, j.error.message);
  if (!res.ok && !code) throw new TikTokError(`http_${res.status}`, `lỗi máy chủ (HTTP ${res.status})`);
  return j.data || {};
}

async function oauth(form) {
  const res = await fetch(`${API}/v2/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body: new URLSearchParams({ client_key: clientKey(), client_secret: clientSecret(), ...form }),
  });
  const j = await readJson(res);
  if (j.error || !j.access_token) {
    const why = j.error_description || j.error || `HTTP ${res.status}`;
    const e = new TikTokError('oauth', `đăng nhập thất bại (${why})`);
    e.fatal = true;
    throw e;
  }
  return j;
}

// ---- Đăng nhập (OAuth) ----
function newState(brand) {
  const s = secrets.load();
  const now = Date.now();
  for (const [k, v] of Object.entries(s.tiktok.states)) if (v.exp < now) delete s.tiktok.states[k];
  const state = crypto.randomBytes(18).toString('hex');
  s.tiktok.states[state] = { brand, exp: now + STATE_TTL };
  secrets.save();
  return state;
}

function consumeState(state) {
  const s = secrets.load();
  const st = s.tiktok.states[state];
  if (!st) return null;
  delete s.tiktok.states[state];
  secrets.save();
  return st.exp >= Date.now() ? st.brand : null;
}

function authUrl(state) {
  const qs = new URLSearchParams({ client_key: clientKey(), scope: SCOPES, response_type: 'code', redirect_uri: redirectUri(), state });
  return `${AUTH}?${qs}`;
}

// Mỗi thương hiệu gắn được nhiều tài khoản TikTok: secrets.tiktok.accounts[brand] = { openId: tài khoản }.
// Bài TikTok của thương hiệu đăng lên TẤT CẢ tài khoản này (giống Facebook nhiều Page).
const MAX_ACCOUNTS = 10;
const accMap = (brand) => secrets.load().tiktok.accounts[brand] || {};
const byAge = (a, b) => String(a.connectedAt).localeCompare(String(b.connectedAt));
// Tài khoản theo openId; không truyền openId thì lấy tài khoản kết nối sớm nhất (tài khoản chính)
function accountOf(brand, openId) {
  const m = accMap(brand);
  if (openId) return m[openId] || null;
  return Object.values(m).sort(byAge)[0] || null;
}

// Đổi mã lấy token rồi THÊM tài khoản vào thương hiệu (đăng nhập lại cùng tài khoản thì cập nhật token)
async function connect(brand, code) {
  const t = await oauth({ code, grant_type: 'authorization_code', redirect_uri: redirectUri() });
  if (!String(t.scope || '').split(',').includes('video.publish')) {
    throw new TikTokError('scope_not_authorized');
  }
  const now = Date.now();
  const acc = {
    openId: t.open_id,
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    accessExpiresAt: now + (Number(t.expires_in) || 86400) * 1000,
    refreshExpiresAt: now + (Number(t.refresh_expires_in) || 31536000) * 1000,
    scope: t.scope,
    connectedAt: new Date(now).toISOString(),
    name: '',
    username: '',
  };
  const s = secrets.load();
  // Một tài khoản TikTok chỉ thuộc 1 thương hiệu (tránh 1 video đăng 2 lần lên cùng nick)
  const other = Object.keys(s.tiktok.accounts).find((b) => b !== brand && (s.tiktok.accounts[b] || {})[acc.openId]);
  if (other) throw new TikTokError('account_in_other_brand', 'tài khoản TikTok này đang gắn với thương hiệu khác — ngắt kết nối ở đó trước (tránh đăng trùng)');
  const mine = s.tiktok.accounts[brand] || {};
  if (!mine[acc.openId] && Object.keys(mine).length >= MAX_ACCOUNTS) throw new TikTokError('too_many_accounts', `mỗi thương hiệu tối đa ${MAX_ACCOUNTS} tài khoản TikTok`);
  try {
    const info = await call('/v2/post/publish/creator_info/query/', { token: acc.accessToken });
    acc.name = info.creator_nickname || '';
    acc.username = info.creator_username || '';
  } catch { /* tên chỉ để hiển thị; thiếu cũng không sao */ }
  if (mine[acc.openId]) acc.connectedAt = mine[acc.openId].connectedAt; // kết nối lại: giữ thứ tự
  s.tiktok.accounts[brand] = { ...mine, [acc.openId]: acc };
  secrets.save();
  return { connected: true, ...accountView(acc) };
}

// Token còn hạn thì dùng; sắp hết (còn < 5 phút) thì làm mới. refresh_token có thể bị đổi → lưu lại.
async function freshToken(brand, openId) {
  const acc = accountOf(brand, openId);
  if (!acc) throw new TikTokError('access_token_invalid');
  if (Date.now() < acc.accessExpiresAt - 5 * 60e3) return acc.accessToken;
  if (Date.now() >= acc.refreshExpiresAt) { acc.needsReauth = true; secrets.save(); throw new TikTokError('access_token_invalid'); }
  try {
    const t = await oauth({ grant_type: 'refresh_token', refresh_token: acc.refreshToken });
    const now = Date.now();
    acc.accessToken = t.access_token;
    if (t.refresh_token) acc.refreshToken = t.refresh_token;
    acc.accessExpiresAt = now + (Number(t.expires_in) || 86400) * 1000;
    if (t.refresh_expires_in) acc.refreshExpiresAt = now + Number(t.refresh_expires_in) * 1000;
    delete acc.needsReauth;
    secrets.save();
    return acc.accessToken;
  } catch (e) {
    acc.needsReauth = true;
    secrets.save();
    throw new TikTokError('access_token_invalid');
  }
}

// Thông tin công khai của tài khoản đã nối (KHÔNG có token)
const accountView = (a) => ({ openId: a.openId, name: a.name, username: a.username, needsReauth: !!a.needsReauth, connectedAt: a.connectedAt });
// Danh sách tài khoản của thương hiệu, tài khoản chính trước
const accounts = (brand) => Object.values(accMap(brand)).sort(byAge).map(accountView);
// Tóm tắt cho giao diện: name/username là của tài khoản chính (giữ tương thích), accounts = tất cả
function summary(brand) {
  const list = accounts(brand);
  if (!list.length) return { connected: false, accounts: [] };
  return { connected: true, name: list[0].name, username: list[0].username, needsReauth: list.some((a) => a.needsReauth), connectedAt: list[0].connectedAt, accounts: list };
}
const connected = (brand) => Object.keys(accMap(brand)).length > 0;

// Ngắt 1 tài khoản (openId) hoặc tất cả tài khoản của thương hiệu (không truyền openId)
async function disconnect(brand, openId) {
  const s = secrets.load();
  const m = s.tiktok.accounts[brand] || {};
  const ids = openId ? (m[openId] ? [openId] : []) : Object.keys(m);
  if (!ids.length) return false;
  for (const id of ids) {
    // Thu hồi quyền ở phía TikTok (nếu lỗi vẫn xóa token phía mình)
    try {
      await fetch(`${API}/v2/oauth/revoke/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_key: clientKey() || '', client_secret: clientSecret() || '', token: m[id].accessToken }),
      });
    } catch { /* bỏ qua */ }
    delete m[id];
  }
  if (Object.keys(m).length) s.tiktok.accounts[brand] = m;
  else delete s.tiktok.accounts[brand];
  secrets.save();
  return true;
}

// ---- Đăng video ----
// Khúc 5–64MB (khúc cuối tới 128MB). ≤64MB: gửi 1 khúc nguyên file. Lớn hơn: khúc 32MB, khúc cuối nhận phần dư.
function planChunks(size) {
  if (!(size > 0)) throw new Error('File video rỗng');
  if (size > MAX_BYTES) throw new Error('Video lớn hơn 4GB, TikTok không nhận');
  if (size <= 64 * MB) return { chunkSize: size, total: 1 };
  const chunkSize = 32 * MB;
  return { chunkSize, total: Math.floor(size / chunkSize) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function uploadChunks(uploadUrl, filePath, size, { chunkSize, total }) {
  const blob = await fs.openAsBlob(filePath);
  const mime = MIME[path.extname(filePath).toLowerCase()] || 'video/mp4';
  for (let i = 0; i < total; i++) {
    const start = i * chunkSize;
    const end = i === total - 1 ? size - 1 : start + chunkSize - 1;
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': mime, 'Content-Range': `bytes ${start}-${end}/${size}` },
      body: blob.slice(start, end + 1),
    });
    const expect = i === total - 1 ? 201 : 206;
    if (res.status !== expect) {
      throw new TikTokError(`upload_${res.status}`, `tải video lên bị lỗi ở khúc ${i + 1}/${total} (HTTP ${res.status}${res.status === 403 ? ', liên kết tải lên đã hết hạn' : ''})`);
    }
  }
}

// opts: { openId, privacy, aigc, pollMs, pollTries } (openId: tài khoản cần đăng, bỏ trống = tài khoản chính).
// Trả về { publishId, status, privacy }
async function publishVideo(brand, filePath, text, opts = {}) {
  const token = await freshToken(brand, opts.openId);
  const info = await call('/v2/post/publish/creator_info/query/', { token });
  const options = info.privacy_level_options || [];
  let privacy = opts.privacy || 'SELF_ONLY';
  if (!options.includes(privacy)) privacy = options.includes('SELF_ONLY') ? 'SELF_ONLY' : options[0];
  if (!privacy) throw new TikTokError('privacy_level_option_mismatch');

  const size = fs.statSync(filePath).size;
  const plan = planChunks(size);
  const postInfo = {
    title: String(text || '').slice(0, 2200),
    privacy_level: privacy,
    disable_comment: !!info.comment_disabled,
    disable_duet: !!info.duet_disabled,
    disable_stitch: !!info.stitch_disabled,
  };
  if (opts.aigc) postInfo.is_aigc = true;
  const init = await call('/v2/post/publish/video/init/', {
    token,
    body: { post_info: postInfo, source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: plan.chunkSize, total_chunk_count: plan.total } },
  });
  if (!init.publish_id || !init.upload_url) throw new TikTokError('invalid_param', 'TikTok không trả về liên kết tải lên');
  await uploadChunks(init.upload_url, filePath, size, plan);

  // Chờ TikTok xử lý (thường dưới 1 phút). Chưa xong thì trả về trạng thái "đang xử lý".
  const tries = opts.pollTries ?? 12;
  const ms = opts.pollMs ?? 5000;
  let status = 'PROCESSING_UPLOAD';
  for (let i = 0; i < tries; i++) {
    const st = await call('/v2/post/publish/status/fetch/', { token, body: { publish_id: init.publish_id } });
    status = st.status || status;
    if (status === 'PUBLISH_COMPLETE') break;
    if (status === 'FAILED') throw new TikTokError('publish_failed', `TikTok xử lý video thất bại (${st.fail_reason || 'không rõ lý do'})`);
    await sleep(ms);
  }
  return { publishId: init.publish_id, status, privacy };
}

// Kiểm tra kết nối (chỉ đọc): mỗi thương hiệu đã nối 1 dòng
async function checks(brandNames) {
  const out = [];
  if (!clientKey() || !clientSecret()) {
    out.push({ name: 'TikTok', ok: true, warn: true, detail: 'Chưa có TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET trong .env — chưa dùng TikTok' });
    return out;
  }
  if (!baseUrl().startsWith('https://')) {
    out.push({ name: 'TikTok', ok: false, detail: 'Thiếu PUBLIC_BASE_URL (địa chỉ https của app) trong .env — TikTok bắt buộc redirect https' });
    return out;
  }
  out.push({ name: 'TikTok — địa chỉ nhận đăng nhập', ok: true, detail: `${redirectUri()} (phải đăng ký đúng y như vậy trong cổng nhà phát triển TikTok)` });
  const all = secrets.load().tiktok.accounts;
  if (!Object.keys(all).length) {
    out.push({ name: 'TikTok', ok: true, warn: true, detail: 'Chưa thương hiệu nào kết nối tài khoản TikTok' });
    return out;
  }
  for (const brand of Object.keys(all)) for (const a of accounts(brand)) {
    const name = `${(brandNames && brandNames[brand]) || brand} — TikTok${a.username ? ' @' + a.username : ''}`;
    try {
      const token = await freshToken(brand, a.openId);
      const info = await call('/v2/post/publish/creator_info/query/', { token });
      const priv = (info.privacy_level_options || []).join(', ');
      const onlyPrivate = (info.privacy_level_options || []).every((p) => p === 'SELF_ONLY');
      out.push({
        name, ok: true, warn: onlyPrivate,
        detail: `@${info.creator_username || a.username} · tối đa ${info.max_video_post_duration_sec || '?'}s/video · chế độ cho phép: ${priv || '—'}${onlyPrivate ? ' · ⚠ chỉ đăng riêng tư (ứng dụng chưa audit hoặc tài khoản đang riêng tư)' : ''}`,
      });
    } catch (e) { out.push({ name, ok: false, detail: e.message }); }
  }
  return out;
}

module.exports = {
  mode, configured, redirectUri, authUrl, newState, consumeState, connect, summary, accounts, connected, disconnect, MAX_ACCOUNTS,
  freshToken, publishVideo, planChunks, checks, call, TikTokError, SCOPES,
};
