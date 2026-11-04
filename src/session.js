// Phiên đăng nhập bằng cookie "ghi nhớ 30 ngày" — thay cho hộp Basic Auth của trình duyệt (Safari/iPhone không nhớ,
// mở từ màn hình chính là hỏi lại). Basic Auth vẫn được chấp nhận cho script/curl.
// Phiên lưu trong data/secrets.json (quyền 0600, không vào db.json/sao lưu/giao diện). Cookie HttpOnly, SameSite=Lax, Secure khi qua HTTPS.
const crypto = require('node:crypto');
const secrets = require('./secrets');

const COOKIE = 'salon_sid';
const TTL = 30 * 864e5;            // 30 ngày
const RENEW_AFTER = 7 * 864e5;     // dùng app sau 7 ngày thì gia hạn thêm 30 ngày (phiên trượt)
const MAX_SESSIONS = 200;

function store() {
  const s = secrets.load();
  if (!s.sessions || typeof s.sessions !== 'object' || Array.isArray(s.sessions)) s.sessions = {};
  return s.sessions;
}
function prune(now = Date.now()) {
  const st = store();
  let n = 0;
  for (const [k, v] of Object.entries(st)) if (!v || !(v.expiresAt > now)) { delete st[k]; n++; }
  const keys = Object.keys(st);
  if (keys.length > MAX_SESSIONS) for (const k of keys.sort((a, b) => st[a].expiresAt - st[b].expiresAt).slice(0, keys.length - MAX_SESSIONS)) { delete st[k]; n++; }
  return n;
}
// user: { shared, username } → sid
function create(user, req, now = Date.now()) {
  prune(now);
  const sid = crypto.randomBytes(32).toString('hex');
  store()[sid] = { shared: !!user.shared, username: user.shared ? '' : String(user.username || ''), createdAt: new Date(now).toISOString(), expiresAt: now + TTL, ua: String((req && req.headers['user-agent']) || '').slice(0, 120) };
  secrets.save();
  return sid;
}
function parseCookies(req) {
  const out = {};
  for (const part of String((req && req.headers.cookie) || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
// Phiên hợp lệ của yêu cầu → { sid, shared, username } hoặc null
function resolve(req, now = Date.now()) {
  const sid = parseCookies(req)[COOKIE];
  if (!sid || !/^[a-f0-9]{64}$/.test(sid)) return null;
  const st = store();
  const s = st[sid];
  if (!s) return null;
  if (!(s.expiresAt > now)) { delete st[sid]; secrets.save(); return null; }
  if (now - new Date(s.createdAt).getTime() > RENEW_AFTER && s.expiresAt - now < TTL - RENEW_AFTER) { s.expiresAt = now + TTL; secrets.save(); }
  return { sid, shared: s.shared, username: s.username };
}
function destroy(sid) {
  const st = store();
  if (st[sid]) { delete st[sid]; secrets.save(); return true; }
  return false;
}
const isSecure = (req) => String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
const setCookie = (req, sid) => `${COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(TTL / 1000)}${isSecure(req) ? '; Secure' : ''}`;
const clearCookie = (req) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecure(req) ? '; Secure' : ''}`;

// Yêu cầu ghi bằng cookie phải đến từ chính app (chống trang khác giả mạo): xem Sec-Fetch-Site, không có thì so Origin với host
function crossSite(req) {
  const sfs = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (sfs) return !['same-origin', 'none'].includes(sfs);
  const origin = req.headers.origin || '';
  if (!origin) return false;
  try { return new URL(origin).host !== String(req.headers['x-forwarded-host'] || req.headers.host || ''); } catch { return true; }
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function loginPage(next = '/') {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Đăng nhập · Salon Agentic AI</title><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/icons/icon-180.png"><meta name="theme-color" content="#171717"><meta name="apple-mobile-web-app-capable" content="yes">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#171717;color:#f3f3f3;font:16px/1.5 "Be Vietnam Pro",system-ui,-apple-system,sans-serif}
.box{width:min(92vw,380px);background:#222;border:1px solid #333;border-radius:16px;padding:26px 24px;box-shadow:0 12px 40px rgba(0,0,0,.4)}h1{font-size:20px;margin:0 0 4px}p{margin:0 0 18px;color:#aaa;font-size:14px}
label{display:block;font-size:13px;color:#bbb;margin:12px 0 4px}input{width:100%;box-sizing:border-box;padding:12px 13px;border:1px solid #444;border-radius:10px;background:#111;color:#fff;font:inherit}
button{width:100%;margin-top:18px;padding:13px;border:0;border-radius:10px;background:#C46A3A;color:#fff;font:600 16px inherit;cursor:pointer}button:disabled{opacity:.6}
.err{display:none;margin-top:12px;color:#ff8a80;font-size:14px}.hint{margin-top:14px;font-size:12px;color:#888}</style></head>
<body><form class="box" id="f" autocomplete="on"><h1>✦ Salon Agentic AI</h1><p>Đăng nhập một lần, máy này nhớ 30 ngày.</p>
<label for="u">Tên đăng nhập</label><input id="u" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" placeholder="admin">
<label for="p">Mật khẩu</label><input id="p" name="password" type="password" autocomplete="current-password" required>
<button id="b" type="submit">Đăng nhập</button><div class="err" id="e"></div>
<div class="hint">iPhone: bấm Chia sẻ → "Thêm vào MH chính" để mở như app.</div></form>
<script>
const f=document.getElementById('f'),e=document.getElementById('e'),b=document.getElementById('b');const next=${JSON.stringify(esc(next))};
f.addEventListener('submit',async(ev)=>{ev.preventDefault();b.disabled=true;e.style.display='none';
try{const r=await fetch('/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:f.username.value.trim(),password:f.password.value})});const j=await r.json().catch(()=>({}));
if(r.ok){location.replace(next&&next.startsWith('/')&&!next.startsWith('//')?next:'/');return;}e.textContent=j.error||'Đăng nhập không thành công';e.style.display='block';}
catch(x){e.textContent='Không kết nối được máy chủ, thử lại';e.style.display='block';}b.disabled=false;});
</script></body></html>`;
}

module.exports = { COOKIE, TTL, create, resolve, destroy, prune, setCookie, clearCookie, crossSite, loginPage, parseCookies };
