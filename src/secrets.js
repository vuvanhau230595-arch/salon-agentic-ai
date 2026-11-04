// Kho bí mật: token đăng nhập TikTok / YouTube của từng thương hiệu.
// Lưu RIÊNG khỏi data/db.json (db.json được sao lưu, xuất ra, và gửi lên giao diện),
// ghi nguyên tử, quyền 0600 (chỉ tài khoản chạy app đọc được). Không bao giờ đưa vào /api/state hay log.
const fs = require('node:fs');
const path = require('node:path');

const file = () => process.env.SECRETS_FILE || path.join(path.dirname(process.env.DB_FILE || path.join(__dirname, '..', 'data', 'db.json')), 'secrets.json');

let cache = null;
let cacheFile = null;

function load() {
  const f = file();
  if (cache && cacheFile === f) return cache;
  try { cache = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { cache = {}; }
  cacheFile = f;
  cache.tiktok = cache.tiktok || { accounts: {}, states: {} };
  cache.tiktok.accounts = cache.tiktok.accounts || {};
  // Bản cũ lưu 1 tài khoản/thương hiệu ({ openId, accessToken... }); nay mỗi thương hiệu là { openId: tài khoản }
  for (const [b, v] of Object.entries(cache.tiktok.accounts)) {
    if (v && typeof v.accessToken === 'string') cache.tiktok.accounts[b] = { [v.openId || 'acc']: v };
  }
  cache.tiktok.states = cache.tiktok.states || {};
  cache.google = cache.google && typeof cache.google === 'object' ? cache.google : {}; // khoá service account Google Drive (src/drive.js)
  // YouTube (src/connectors/youtube.js): khoá OAuth client nhập qua web + refresh token kênh của từng thương hiệu
  cache.youtube = cache.youtube && typeof cache.youtube === 'object' ? cache.youtube : {};
  cache.youtube.channels = cache.youtube.channels || {};
  cache.youtube.states = cache.youtube.states || {};
  cache.users = Array.isArray(cache.users) ? cache.users : []; // tài khoản người dùng (mật khẩu đã băm) — cùng nơi giữ bí mật, không vào db.json
  return cache;
}

function save() {
  const f = file();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, f);
  try { fs.chmodSync(f, 0o600); } catch { /* Windows không có chmod đầy đủ */ }
}

const reset = () => { cache = null; cacheFile = null; };

module.exports = { load, save, reset, file };
