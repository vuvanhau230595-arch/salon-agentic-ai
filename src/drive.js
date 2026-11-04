// Nạp media từ Google Drive: mỗi thương hiệu 1 thư mục Drive, agent kéo file MỚI về media/<thương hiệu>/ theo lượt quét.
// Xác thực bằng service account (Sếp tạo ở Google Cloud, tải JSON, chia sẻ thư mục Drive cho email của service account):
// tự ký JWT RS256 bằng node:crypto rồi đổi lấy access token (chỉ quyền đọc drive.readonly). Không thư viện ngoài.
// Khoá service account nằm trong data/secrets.json (0600) hoặc file ở GOOGLE_SERVICE_ACCOUNT_FILE — KHÔNG BAO GIỜ in ra log/giao diện/db.json.
// Chỉ ĐỌC Drive: không xoá/sửa gì trên Drive; file Drive bị xoá thì file local vẫn giữ. Không ghi đè file local (trùng tên → thêm hậu tố).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { load, save } = require('./db');
const secrets = require('./secrets');
const media = require('./media');

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const API = () => (process.env.GOOGLE_API_BASE || 'https://www.googleapis.com').replace(/\/+$/, '');
const MAX_PER_RUN = 20;      // mỗi lượt quét tối đa 20 file / thương hiệu để không nghẽn
const PAGE_SIZE = 200;
const MIME_OK = { 'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image', 'video/mp4': 'video', 'video/quicktime': 'video' };
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const brandIds = () => Object.keys(require('./planner').brands());
const brandName = (id) => (require('./planner').brands()[id] || {}).name || id;
const log = (text, extra = {}) => require('./engine').log('media', text, { by: 'Agent Google Drive', ...extra });
const logErr = (text, extra = {}) => require('./engine').log('error', text, { by: 'Agent Google Drive', rule: 'drive', ...extra });

// ----- Khoá service account -----
function parseServiceAccount(obj) {
  let j = obj;
  if (typeof j === 'string') { try { j = JSON.parse(j); } catch { throw bad('File không phải JSON hợp lệ'); } }
  if (!j || typeof j !== 'object') throw bad('File JSON không đúng');
  if (j.type !== 'service_account') throw bad('Đây không phải khoá service account (type phải là "service_account") — tải đúng file JSON của service account ở Google Cloud');
  if (!j.client_email || !/^[^@\s]+@[^@\s]+$/.test(j.client_email)) throw bad('File JSON thiếu client_email');
  if (!j.private_key || !String(j.private_key).includes('PRIVATE KEY')) throw bad('File JSON thiếu private_key');
  try { crypto.createPrivateKey(j.private_key); } catch { throw bad('private_key trong file không đọc được'); }
  return { type: 'service_account', client_email: j.client_email, private_key: j.private_key, token_uri: j.token_uri || 'https://oauth2.googleapis.com/token', project_id: j.project_id || '', client_id: j.client_id || '' };
}

// Ưu tiên file ở GOOGLE_SERVICE_ACCOUNT_FILE (nếu đặt), không thì khoá đã tải lên (secrets.json)
function account() {
  const f = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  if (f) { try { return parseServiceAccount(fs.readFileSync(f, 'utf8')); } catch { /* file hỏng/thiếu: rơi về khoá đã tải lên */ } }
  const s = secrets.load();
  return s.google && s.google.serviceAccount ? s.google.serviceAccount : null;
}
const configured = () => !!account();
const serviceEmail = () => { const a = account(); return a ? a.client_email : ''; };
const keySource = () => (process.env.GOOGLE_SERVICE_ACCOUNT_FILE && account() ? 'env' : account() ? 'upload' : '');

let tokenCache = null; // { email, token, exp }
function setServiceAccount(json) {
  const sa = parseServiceAccount(json);
  const s = secrets.load();
  s.google = s.google || {};
  s.google.serviceAccount = sa;
  secrets.save();
  tokenCache = null;
  return sa.client_email;
}
function clearServiceAccount() {
  const s = secrets.load();
  if (s.google) delete s.google.serviceAccount;
  secrets.save();
  tokenCache = null;
}

// ----- JWT RS256 → access token -----
const b64u = (b) => Buffer.from(b).toString('base64url');
function signJwt(sa, now = Math.floor(Date.now() / 1000)) {
  const header = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64u(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: tokenUrl(sa), iat: now, exp: now + 3600 }));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), sa.private_key);
  return `${header}.${claims}.${b64u(sig)}`;
}
const tokenUrl = (sa) => process.env.GOOGLE_TOKEN_URL || sa.token_uri || 'https://oauth2.googleapis.com/token';

const ERR_KEY = 'Khoá service account Google không hợp lệ hoặc đã bị thu hồi — tải lại file JSON ở Cài đặt → Kết nối API (hoặc tạo khoá mới trong Google Cloud).';
async function accessToken() {
  const sa = account();
  if (!sa) throw bad('Chưa có khoá service account Google — tải file JSON ở Cài đặt → Kết nối API → Google Drive.');
  if (tokenCache && tokenCache.email === sa.client_email && tokenCache.exp > Date.now() + 60e3) return tokenCache.token;
  let res;
  try {
    res = await fetch(tokenUrl(sa), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signJwt(sa) }) });
  } catch (e) { throw bad(`Không kết nối được tới Google (${e.message}) — kiểm tra mạng của máy chủ.`, 502); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw bad(res.status === 400 || res.status === 401 ? ERR_KEY : `Google không cấp token (HTTP ${res.status}${j.error ? ': ' + j.error : ''})`, 502);
  tokenCache = { email: sa.client_email, token: j.access_token, exp: Date.now() + Math.max(60, Number(j.expires_in) || 3600) * 1000 };
  return j.access_token;
}

// ----- Drive API v3 -----
function driveError(res, j, folderId) {
  const code = res.status;
  const reason = (((j || {}).error || {}).errors || [])[0] || {};
  if (code === 401) return bad(ERR_KEY, 502);
  if (code === 404) return bad(`Không thấy thư mục Drive (${folderId}) — link sai, hoặc thư mục CHƯA ĐƯỢC CHIA SẺ cho email service account. Mở thư mục trên Drive → Chia sẻ → thêm email ở Cài đặt → Kết nối API → Google Drive (quyền Người xem).`, 404);
  if (code === 403) {
    if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason.reason || '') || /has not been used|is disabled/i.test(((j || {}).error || {}).message || '')) return bad('Google Drive API chưa được bật cho dự án Google Cloud này — vào Google Cloud → APIs & Services → bật "Google Drive API" rồi thử lại.', 502);
    return bad(`Google từ chối quyền truy cập thư mục Drive — kiểm tra thư mục đã chia sẻ cho email service account chưa (quyền Người xem là đủ).${reason.reason ? ' (' + reason.reason + ')' : ''}`, 502);
  }
  if (code === 429) return bad('Google giới hạn số lần gọi — thử lại sau ít phút.', 502);
  return bad(`Google Drive báo lỗi HTTP ${code}${((j || {}).error || {}).message ? ': ' + j.error.message : ''}`, 502);
}

async function driveGet(pathName, params, { stream = false, folderId = '' } = {}) {
  const token = await accessToken();
  const u = new URL(API() + pathName);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  let res;
  try { res = await fetch(u, { headers: { authorization: `Bearer ${token}` } }); }
  catch (e) { throw bad(`Không kết nối được tới Google Drive (${e.message})`, 502); }
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw driveError(res, j, folderId); }
  return stream ? res : res.json();
}

// Thông tin thư mục (tên) — dùng khi Kiểm tra
async function folderInfo(folderId) {
  const j = await driveGet(`/drive/v3/files/${encodeURIComponent(folderId)}`, { fields: 'id,name,mimeType', supportsAllDrives: 'true' }, { folderId });
  if (j.mimeType !== 'application/vnd.google-apps.folder') throw bad('Link này là 1 file, không phải thư mục Drive — dán link của THƯ MỤC chứa ảnh/video.');
  return j;
}

// Liệt kê file trong thư mục (phân trang), chỉ file chưa vào thùng rác Drive
async function listFolder(folderId) {
  const out = [];
  let pageToken = '';
  do {
    const j = await driveGet('/drive/v3/files', {
      q: `'${String(folderId).replace(/['\\]/g, '')}' in parents and trashed=false`,
      fields: 'nextPageToken,files(id,name,mimeType,size,md5Checksum,modifiedTime)',
      pageSize: String(PAGE_SIZE), orderBy: 'createdTime', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', ...(pageToken ? { pageToken } : {}),
    }, { folderId });
    out.push(...(j.files || []));
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
}

// Tải 1 file về đường dẫn tạm, chặn quá dung lượng ngay khi đang tải
async function download(fileId, tmp, limit) {
  const res = await driveGet(`/drive/v3/files/${encodeURIComponent(fileId)}`, { alt: 'media', supportsAllDrives: 'true' }, { stream: true });
  let size = 0;
  const counter = new Transform({ transform(chunk, _e, cb) { size += chunk.length; if (size > limit) cb(bad(`File quá lớn (tối đa ${Math.round(limit / 1048576)}MB)`)); else cb(null, chunk); } });
  try { await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(tmp)); }
  catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  if (!size) { fs.rmSync(tmp, { force: true }); throw bad('File rỗng'); }
  return size;
}

// ----- Tách id thư mục từ link -----
function folderIdFromLink(input) {
  const s = String(input || '').trim();
  if (!s) throw bad('Dán link thư mục Google Drive (hoặc ID thư mục)');
  let m;
  if ((m = s.match(/\/folders\/([A-Za-z0-9_-]{10,})/))) return m[1];
  if ((m = s.match(/[?&]id=([A-Za-z0-9_-]{10,})/))) return m[1];
  if (/^[A-Za-z0-9_-]{10,}$/.test(s)) return s;
  if (/\/file\/d\//.test(s)) throw bad('Đây là link của 1 FILE — dán link THƯ MỤC trên Drive (mở thư mục → Chia sẻ → Sao chép liên kết).');
  throw bad('Không nhận ra link thư mục Drive — link đúng có dạng https://drive.google.com/drive/folders/…');
}
const folderLink = (id) => (id ? `https://drive.google.com/drive/folders/${id}` : '');

// ----- Trạng thái theo thương hiệu (db.driveSync) -----
// Mỗi thương hiệu có NHIỀU thư mục Drive: folders = [{ id, label, name, addedAt }]. File nạp từ thư mục nào thì tự gắn thẻ theo
// nhãn (label) của thư mục đó, không có nhãn thì theo tên thư mục trên Drive (đọc lần nạp đầu). Bản cũ chỉ có folderId → chuyển sang folders.
const MAX_FOLDERS = 10;
const tagOf = (f) => require('./media-lib').normTag((f && (f.label || f.name)) || '');
// Mỗi thư mục Drive dùng cho kênh nào: '' = mọi kênh. Chưa chọn thì thư mục có chữ "TikTok" mặc định chỉ cho TikTok.
const FOLDER_CHANNELS = { '': 'Mọi kênh', tiktok: 'TikTok', facebook_page: 'Facebook', instagram: 'Instagram' };
const chanOf = (f) => (f && typeof f.channel === 'string' ? f.channel : /tik\s*tok/i.test((f && (f.label || f.name)) || '') ? 'tiktok' : '');
// Bộ lọc video/ảnh cho 1 kênh khi agent tự chọn media: kênh có thư mục riêng thì CHỈ lấy file từ thư mục đó;
// kênh không có thư mục riêng thì lấy mọi file trừ file thuộc thư mục dành riêng cho kênh khác. (Nhận ra thư mục qua thẻ tự gắn khi nạp.)
function mediaFilter(brand, channel) {
  const e = (load().driveSync || {})[brand];
  const byTag = {};
  let dedicated = false;
  for (const f of (e && e.folders) || []) {
    const c = chanOf(f);
    if (!c) continue;
    byTag[tagOf(f)] = c;
    if (c === channel) dedicated = true;
  }
  if (!Object.keys(byTag).length) return () => true;
  return (file) => {
    const cs = (file.tags || []).map((t) => byTag[t]).filter(Boolean);
    return dedicated ? cs.includes(channel) : !cs.length || cs.includes(channel);
  };
}
// Kênh này có thư mục Drive riêng không (để báo "thư mục trống" thay vì lấy nhầm video kênh khác)
function dedicatedFolders(brand, channel) {
  const e = (load().driveSync || {})[brand];
  return ((e && e.folders) || []).filter((f) => chanOf(f) === channel).map((f) => f.label || f.name || f.id);
}
function entry(brand) {
  const db = load();
  db.driveSync = db.driveSync || {};
  const e = (db.driveSync[brand] = db.driveSync[brand] || { folders: [], on: false, lastRun: null, files: {} });
  e.files = e.files || {};
  if (!Array.isArray(e.folders)) e.folders = [];
  if (e.folderId) { if (!e.folders.some((f) => f.id === e.folderId)) e.folders.unshift({ id: e.folderId, label: '', addedAt: new Date().toISOString() }); delete e.folderId; }
  return e;
}

// { link|folderId, label } = thêm thư mục; { remove: id } = bỏ thư mục (file đã nạp vẫn còn); { on } = bật/tắt tự nạp
function setSettings(brand, { folderId, link, label, remove, on, folder, channel } = {}) {
  if (!brandIds().includes(brand)) throw bad('Thương hiệu không tồn tại', 404);
  const e = entry(brand);
  const raw = link !== undefined ? link : folderId;
  const what = [];
  if (raw !== undefined) {
    const id = folderIdFromLink(raw);
    if (e.folders.some((f) => f.id === id)) throw bad('Thư mục này đã có trong danh sách');
    if (e.folders.length >= MAX_FOLDERS) throw bad(`Tối đa ${MAX_FOLDERS} thư mục Drive mỗi thương hiệu`);
    const lb = String(label || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (channel !== undefined && !(String(channel) in FOLDER_CHANNELS)) throw bad('Kênh không hợp lệ');
    e.folders.push({ id, label: lb, addedAt: new Date().toISOString(), ...(channel !== undefined ? { channel: String(channel) } : {}) });
    delete e.lastError;
    what.push(`thêm thư mục Drive${lb ? ` "${lb}"` : ''} (${id})`);
  }
  if (remove !== undefined) {
    const i = e.folders.findIndex((f) => f.id === String(remove));
    if (i < 0) throw bad('Không thấy thư mục này trong danh sách', 404);
    const [gone] = e.folders.splice(i, 1);
    delete e.lastError;
    if (!e.folders.length) e.on = false;
    what.push(`bỏ thư mục Drive${gone.label || gone.name ? ` "${gone.label || gone.name}"` : ''} (${gone.id}) — file đã nạp vẫn còn`);
  }
  // Đổi kênh dùng cho 1 thư mục đã có
  if (folder !== undefined && channel !== undefined) {
    const f = e.folders.find((x) => x.id === String(folder));
    if (!f) throw bad('Không thấy thư mục này trong danh sách', 404);
    if (!(String(channel) in FOLDER_CHANNELS)) throw bad('Kênh không hợp lệ');
    f.channel = String(channel);
    what.push(`thư mục "${f.label || f.name || f.id}" dùng cho: ${FOLDER_CHANNELS[f.channel]}`);
  }
  if (on !== undefined) {
    if (on && !e.folders.length) throw bad('Dán link thư mục Drive trước khi bật tự nạp');
    e.on = !!on;
    what.push(`tự nạp: ${e.on ? 'BẬT' : 'TẮT'}`);
  }
  if (!what.length) throw bad('Không có thay đổi nào');
  log(`Sếp ${what.join(', ')} — ${brandName(brand)}`, { brand, by: 'Sếp', field: 'driveSync', after: `${e.folders.length} thư mục · ${e.on ? 'bật' : 'tắt'}` });
  save();
  return view(brand);
}

function view(brand) {
  const e = entry(brand);
  const counts = {};
  for (const f of Object.values(e.files)) counts[f.folder || ''] = (counts[f.folder || ''] || 0) + 1;
  const folders = e.folders.map((f) => ({ id: f.id, label: f.label || '', name: f.name || '', tag: tagOf(f), channel: chanOf(f), link: folderLink(f.id), count: counts[f.id] || 0, error: f.error || null }));
  const first = folders[0] || null;
  return { brand, folders, folderId: first ? first.id : '', link: first ? first.link : '', on: !!e.on, lastRun: e.lastRun || null, lastResult: e.lastResult || null, lastError: e.lastError || null, count: Object.keys(e.files).length };
}
function status() {
  const out = {};
  for (const b of brandIds()) out[b] = view(b);
  return { configured: configured(), serviceEmail: serviceEmail(), keySource: keySource(), maxPerRun: MAX_PER_RUN, maxFolders: MAX_FOLDERS, limits: { image: media.LIMIT.image, video: media.LIMIT.video }, brands: out };
}

// ----- Đồng bộ 1 thương hiệu -----
function eligible(f) {
  const type = MIME_OK[f.mimeType] || media.kindOf(f.name || '');
  if (!type) return { ok: false, why: 'không phải ảnh jpg/png/webp hay video mp4/mov' };
  const limit = media.LIMIT[type];
  if (Number(f.size) > limit) return { ok: false, why: `quá lớn (${Math.round(Number(f.size) / 1048576)}MB > ${Math.round(limit / 1048576)}MB)` };
  // Drive có mime đúng nhưng tên không có đuôi / đuôi lạ → đặt đuôi theo mime để thư viện nhận
  const name = media.kindOf(f.name || '') ? f.name : `${f.name || f.id}${{ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/quicktime': '.mov' }[f.mimeType] || ''}`;
  return { ok: true, name, type };
}
const fingerprint = (f) => f.md5Checksum || `mt:${f.modifiedTime || ''}:${f.size || ''}`;
const isNew = (e, f) => { const fp = fingerprint(f), k = e.files[f.id], s = (e.skipped || {})[f.id]; return !(k && k.md5 === fp) && !(s && s.md5 === fp); };
// Gắn thẻ theo thư mục Drive cho file vừa nạp (chỉ ghi dữ liệu app, không động tới file)
function tagFile(brand, name, tag) {
  if (!tag) return;
  const db = load();
  db.mediaInfo = db.mediaInfo || {};
  const it = (db.mediaInfo[`${brand}/${name}`] = db.mediaInfo[`${brand}/${name}`] || {});
  it.tags = [...new Set([...(it.tags || []), tag])].slice(0, 10);
}

async function syncBrand(brand, { max = MAX_PER_RUN, trigger = 'schedule' } = {}) {
  if (!brandIds().includes(brand)) throw bad('Thương hiệu không tồn tại', 404);
  const e = entry(brand);
  if (!e.folders.length) throw bad('Thương hiệu này chưa có thư mục Drive — dán link thư mục ở Thư viện Media');
  const r = { brand, added: 0, skipped: 0, rejected: 0, pending: 0, total: 0, names: [], errors: [] };
  const t0 = Date.now();
  let n = 0;
  let stop = false;
  for (const folder of e.folders) {
    if (stop) break;
    let files;
    try {
      if (!folder.name && !folder.label) { try { folder.name = (await folderInfo(folder.id)).name; } catch { /* không có tên cũng nạp được */ } }
      files = await listFolder(folder.id);
      delete folder.error;
    } catch (err) {
      // 1 thư mục lỗi (chưa chia sẻ, link sai) không chặn thư mục khác; lỗi cùng nguyên nhân chỉ ghi 1 lần
      if (folder.error !== err.message) logErr(`Google Drive (${brandName(brand)}${folder.label || folder.name ? ' · ' + (folder.label || folder.name) : ''}): ${err.message}`, { brand });
      folder.error = err.message;
      r.errors.push(err.message);
      continue;
    }
    r.total += files.length;
    const todo = files.filter((f) => isNew(e, f));
    r.skipped += files.length - todo.length;
    const tag = tagOf(folder);
    for (const f of todo) {
      if (n >= max) { r.pending++; continue; }
      const el = eligible(f);
      if (!el.ok) {
        e.skipped = e.skipped || {}; // ghi nhật ký 1 lần cho mỗi file bị bỏ qua (lần sau không còn trong todo nếu nội dung không đổi)
        e.skipped[f.id] = { name: f.name, why: el.why, md5: fingerprint(f), at: new Date().toISOString() };
        log(`Google Drive (${brandName(brand)}): bỏ qua "${f.name}" — ${el.why}`, { brand });
        r.rejected++;
        continue;
      }
      n++;
      let up;
      try {
        up = media.prepareUpload(brand, el.name);
        await download(f.id, up.tmp, up.limit);
        require('./media-lib').verifySignature(up.tmp, up.name); // nội dung phải đúng định dạng, không tin đuôi/mime
        fs.renameSync(up.tmp, up.dest);
      } catch (err) {
        if (up) fs.rmSync(up.tmp, { force: true });
        if (err.status === 502 || err.status === 404) { r.errors.push(err.message); stop = true; break; } // lỗi kết nối/quyền: dừng lượt này, lần sau thử lại
        e.skipped = e.skipped || {};
        e.skipped[f.id] = { name: f.name, why: err.message, md5: fingerprint(f), at: new Date().toISOString() };
        log(`Google Drive (${brandName(brand)}): không nạp được "${f.name}" — ${err.message}`, { brand });
        r.rejected++;
        continue;
      }
      e.files[f.id] = { name: up.name, md5: fingerprint(f), at: new Date().toISOString(), driveName: f.name, folder: folder.id };
      tagFile(brand, up.name, tag);
      require('./transcode').enqueue(brand, up.name); // video H.265 → tự chuyển H.264 ở nền
      r.added++;
      r.names.push(up.name);
    }
  }
  const allFailed = r.errors.length && e.folders.every((f) => f.error);
  if (allFailed) e.lastError = r.errors[0]; else delete e.lastError;
  e.lastRun = new Date().toISOString();
  e.lastResult = { added: r.added, skipped: r.skipped, rejected: r.rejected, pending: r.pending, ms: Date.now() - t0, error: r.errors[0] || null, total: r.total };
  if (r.added) log(`Google Drive → ${brandName(brand)}: nạp ${r.added} file mới${r.pending ? ` (còn ${r.pending} file, lượt sau nạp tiếp)` : ''}: ${r.names.slice(0, 5).join(', ')}${r.names.length > 5 ? '…' : ''}`, { brand, trigger });
  save();
  if (allFailed) throw Object.assign(new Error(r.errors[0]), { status: /CHƯA ĐƯỢC CHIA SẺ|link sai/.test(r.errors[0]) ? 404 : 502, result: r });
  return r;
}

// Agent chạy theo lượt quét: mọi thương hiệu đã bật tự nạp. Chưa có khoá thì nhắc 1 lần (không lặp mỗi lượt).
async function runAgent(trigger) {
  const db = load();
  const on = brandIds().filter((b) => entry(b).on && entry(b).folders.length);
  if (!on.length) return 0;
  db.driveSync = db.driveSync || {};
  if (!configured()) {
    if (!db.driveSync._noKey) { logErr('Google Drive: có thương hiệu bật tự nạp nhưng chưa có khoá service account — tải file JSON ở Cài đặt → Kết nối API → Google Drive'); db.driveSync._noKey = true; }
    return 0;
  }
  delete db.driveSync._noKey;
  let changed = 0;
  for (const b of on) {
    try { changed += (await syncBrand(b, { trigger })).added; }
    catch { /* lỗi đã ghi nhật ký trong syncBrand; thương hiệu khác vẫn chạy */ }
  }
  return changed;
}

// Kiểm tra kết nối: khoá hợp lệ → (nếu có thương hiệu) đọc từng thư mục và đếm file; 1 thư mục lỗi vẫn báo các thư mục khác
async function testConnection(brand, folderId = '') {
  await accessToken();
  const out = { ok: true, email: serviceEmail() };
  if (brand) {
    const e = entry(brand);
    const list = folderId ? e.folders.filter((f) => f.id === folderId) : e.folders;
    if (!list.length) throw bad('Thương hiệu này chưa có thư mục Drive');
    out.folders = [];
    for (const f of list) {
      try {
        const info = await folderInfo(f.id);
        const files = await listFolder(f.id);
        const ok = files.filter((x) => eligible(x).ok);
        out.folders.push({ id: f.id, name: info.name, label: f.label || '', tag: tagOf({ label: f.label, name: info.name }), total: files.length, usable: ok.length, newFiles: ok.filter((x) => isNew(e, x)).length, error: null });
      } catch (err) { out.folders.push({ id: f.id, name: f.name || '', label: f.label || '', total: 0, usable: 0, newFiles: 0, error: err.message }); }
    }
    const good = out.folders.filter((f) => !f.error);
    if (!good.length) throw bad(out.folders[0].error, 502);
    Object.assign(out, { folder: good.map((f) => f.name).join(', '), total: good.reduce((s, f) => s + f.total, 0), usable: good.reduce((s, f) => s + f.usable, 0), newFiles: good.reduce((s, f) => s + f.newFiles, 0), failed: out.folders.length - good.length });
  }
  return out;
}

// ----- API -----
async function handleApi(req, res, url, { readBody, send }) {
  const p = url.pathname;
  if (p !== '/api/drive' && !p.startsWith('/api/drive/')) return false;
  try {
    if (req.method === 'GET' && p === '/api/drive') return send(res, 200, status()), true;
    if (req.method === 'POST' && p === '/api/drive/settings') {
      const b = await readBody(req);
      const result = setSettings(b.brand, b);
      return send(res, 200, { ...status(), result }), true;
    }
    if (req.method === 'POST' && p === '/api/drive/sync') {
      const b = await readBody(req);
      if (!brandIds().includes(b.brand)) throw bad('Thương hiệu không tồn tại', 404);
      if (!configured()) throw bad('Chưa có khoá service account Google — tải file JSON ở Cài đặt → Kết nối API → Google Drive.');
      const result = await syncBrand(b.brand, { trigger: 'manual' });
      return send(res, 200, { ...status(), result }), true;
    }
    if (req.method === 'POST' && p === '/api/drive/test') {
      const b = await readBody(req);
      if (b.brand && !brandIds().includes(b.brand)) throw bad('Thương hiệu không tồn tại', 404);
      return send(res, 200, await testConnection(b.brand || '', b.folderId || '')), true;
    }
    if (req.method === 'POST' && p === '/api/drive/key') {
      const b = await readBody(req);
      if (b.remove) { clearServiceAccount(); log('Sếp gỡ khoá service account Google Drive', { by: 'Sếp', field: 'driveKey', after: 'đã gỡ' }); save(); return send(res, 200, status()), true; }
      if (process.env.GOOGLE_SERVICE_ACCOUNT_FILE && configured()) throw bad('Khoá đang lấy từ file GOOGLE_SERVICE_ACCOUNT_FILE trong .env — bỏ dòng đó mới tải khoá qua web được');
      const email = setServiceAccount(b.json !== undefined ? b.json : b);
      log(`Sếp tải khoá service account Google Drive (${email})`, { by: 'Sếp', field: 'driveKey', after: email });
      save();
      return send(res, 200, status()), true;
    }
  } catch (e) { send(res, e.status || 400, { error: e.message }); return true; }
  return false;
}

module.exports = { mediaFilter, dedicatedFolders, FOLDER_CHANNELS, MAX_FOLDERS, handleApi, status, setSettings, syncBrand, runAgent, testConnection, folderIdFromLink, listFolder, download, signJwt, accessToken, configured, serviceEmail, setServiceAccount, clearServiceAccount, parseServiceAccount, MAX_PER_RUN, _resetToken: () => { tokenCache = null; } };
