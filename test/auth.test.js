const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-auth-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
process.env.MEDIA_DIR = path.join(tmp, 'media');
process.env.APP_PASSWORD = 'mat-khau-dung';
delete process.env.META_ACCESS_TOKEN;

const { server } = require('../src/server');
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const basic = (pw) => 'Basic ' + Buffer.from(`admin:${pw}`).toString('base64');
let base;
const get = (p, headers = {}) => fetch(base + p, { headers });

test('khởi động server thử', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test('chưa đăng nhập: 401 (kể cả API); /healthz mở nhưng không lộ dữ liệu', async () => {
  assert.strictEqual((await get('/')).status, 401);
  assert.strictEqual((await get('/api/state')).status, 401);
  assert.strictEqual((await get('/api/media/file?brand=the_one&name=a.jpg')).status, 401);
  const h = await get('/healthz');
  assert.strictEqual(h.status, 200);
  assert.strictEqual(await h.text(), 'ok');
  // favicon không đòi đăng nhập: nếu đòi, Chrome mở hộp đăng nhập thứ hai đè lên hộp đang gõ (ô mật khẩu "nhảy")
  const f = await get('/favicon.ico');
  assert.strictEqual(f.status, 204);
  assert.strictEqual(f.headers.get('www-authenticate'), null);
});

test('đúng mật khẩu vào được; sai thì 401', async () => {
  assert.strictEqual((await get('/api/state', { authorization: basic('mat-khau-dung') })).status, 200);
  assert.strictEqual((await get('/api/state', { authorization: basic('sai') })).status, 401);
});

test('sai 5 lần thì khóa IP đó, kể cả khi sau đó gõ đúng; IP khác không bị ảnh hưởng', async () => {
  const A = { 'x-forwarded-for': '203.0.113.7' };
  const B = { 'x-forwarded-for': '203.0.113.8' };
  for (let i = 0; i < 4; i++) assert.strictEqual((await get('/', { ...A, authorization: basic('doan' + i) })).status, 401);
  assert.strictEqual((await get('/', { ...A, authorization: basic('doan4') })).status, 429, 'lần sai thứ 5 bị khóa');
  const locked = await get('/api/state', { ...A, authorization: basic('mat-khau-dung') });
  assert.strictEqual(locked.status, 429, 'đang khóa thì mật khẩu đúng cũng không vào');
  assert.strictEqual(locked.headers.get('retry-after'), '600');
  assert.strictEqual((await get('/api/state', { ...B, authorization: basic('mat-khau-dung') })).status, 200);
});

test('chưa gửi mật khẩu (trình duyệt sắp hỏi) không bị tính là sai', async () => {
  const C = { 'x-forwarded-for': '203.0.113.9' };
  for (let i = 0; i < 10; i++) assert.strictEqual((await get('/', C)).status, 401);
  assert.strictEqual((await get('/api/state', { ...C, authorization: basic('mat-khau-dung') })).status, 200);
});

test('đăng nhập đúng xóa bộ đếm sai', async () => {
  const D = { 'x-forwarded-for': '203.0.113.10' };
  for (let i = 0; i < 4; i++) await get('/', { ...D, authorization: basic('sai') });
  assert.strictEqual((await get('/api/state', { ...D, authorization: basic('mat-khau-dung') })).status, 200);
  for (let i = 0; i < 4; i++) assert.strictEqual((await get('/', { ...D, authorization: basic('sai') })).status, 401);
});

test('mở ra ngoài localhost mà không có mật khẩu thì từ chối khởi động', () => {
  const env = { ...process.env, HOST: '0.0.0.0', PORT: '0', DB_FILE: path.join(tmp, 'x.json'), MEDIA_DIR: path.join(tmp, 'm2') };
  delete env.APP_PASSWORD;
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], { env, encoding: 'utf8', timeout: 15000, cwd: tmp });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /APP_PASSWORD/);
});

test('đăng nhập bằng cookie 30 ngày: trang web nhận trang đăng nhập (không bật hộp Basic Auth), API nhận JSON 401; đăng nhập đúng → cookie; đăng xuất → hết', async () => {
  const E = { 'x-forwarded-for': '203.0.113.20' };
  const home = await get('/', E);
  assert.strictEqual(home.status, 401);
  assert.strictEqual(home.headers.get('www-authenticate'), null, 'không còn hộp Basic Auth của trình duyệt');
  assert.match(home.headers.get('content-type'), /text\/html/);
  assert.match(await home.text(), /Đăng nhập/);
  const api = await get('/api/state', E);
  assert.strictEqual(api.status, 401); assert.strictEqual(api.headers.get('www-authenticate'), null);
  assert.strictEqual((await api.json()).login, '/login');
  const lp = await get('/login', E); assert.strictEqual(lp.status, 200); await lp.text();

  const post = (p, body, h = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...E, ...h }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.strictEqual((await post('/login', { username: 'admin', password: 'sai' })).status, 401);
  const ok = await post('/login', { username: 'admin', password: 'mat-khau-dung' });
  assert.strictEqual(ok.status, 200);
  const cookie = (ok.headers.get('set-cookie') || '').split(';')[0];
  assert.match(cookie, /^salon_sid=[a-f0-9]{64}$/);
  assert.match(ok.headers.get('set-cookie'), /HttpOnly/); assert.match(ok.headers.get('set-cookie'), /SameSite=Lax/); assert.match(ok.headers.get('set-cookie'), /Max-Age=2592000/);
  assert.ok(!/Secure/.test(ok.headers.get('set-cookie')), 'http nội bộ: không gắn Secure');
  const secure = await post('/login', { username: 'admin', password: 'mat-khau-dung' }, { 'x-forwarded-proto': 'https' });
  assert.match(secure.headers.get('set-cookie'), /; Secure/); await secure.text();

  const H = { ...E, cookie };
  assert.strictEqual((await get('/api/state', H)).status, 200);
  const me = await (await get('/api/me', H)).json();
  assert.strictEqual(me.user.shared, true);
  const lg = await fetch(base + '/login', { headers: H, redirect: 'manual' });
  assert.strictEqual(lg.status, 302); assert.strictEqual(lg.headers.get('location'), '/');
  await lg.text(); // đọc hết phản hồi để kết nối đóng, tiến trình test thoát được
  // phiên nằm trong secrets.json (0600), không vào db.json
  assert.ok(/salon_sid|sessions/.test(fs.readFileSync(path.join(tmp, 'secrets.json'), 'utf8')));
  assert.ok(!fs.readFileSync(path.join(tmp, 'db.json'), 'utf8').includes(cookie.slice(10, 40)));
  // ghi bằng cookie phải đến từ chính app
  assert.strictEqual((await post('/api/settings', { scanMinutes: 30 }, { cookie, 'sec-fetch-site': 'cross-site', origin: 'https://ke-xau.com' })).status, 403);
  assert.strictEqual((await post('/api/settings', { scanMinutes: 30 }, { cookie, origin: 'https://ke-xau.com' })).status, 403);
  assert.strictEqual((await post('/api/settings', { scanMinutes: 30 }, { cookie, 'sec-fetch-site': 'same-origin' })).status, 200);
  // đăng xuất
  const out = await post('/logout', undefined, { cookie });
  assert.strictEqual(out.status, 204); assert.match(out.headers.get('set-cookie'), /Max-Age=0/); await out.text();
  assert.strictEqual((await get('/api/state', H)).status, 401);
  // cookie bịa không vào được
  assert.strictEqual((await get('/api/state', { ...E, cookie: 'salon_sid=' + 'a'.repeat(64) })).status, 401);
});

test('đăng nhập sai 5 lần qua trang đăng nhập cũng bị khóa IP; tài khoản bị khoá thì phiên cookie hết giá trị ngay', async () => {
  const F = { 'x-forwarded-for': '203.0.113.21' };
  const post = (p, body, h = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...F, ...h }, body: JSON.stringify(body) });
  for (let i = 0; i < 4; i++) assert.strictEqual((await post('/login', { username: 'admin', password: 'sai' + i })).status, 401);
  assert.strictEqual((await post('/login', { username: 'admin', password: 'sai4' })).status, 429);
  assert.strictEqual((await post('/login', { username: 'admin', password: 'mat-khau-dung' })).status, 429);

  const G = { 'x-forwarded-for': '203.0.113.22' };
  const users = require('../src/users');
  const u = users.create({ name: 'Nhân viên', username: 'nhanvien', role: 'editor', brands: [], password: 'bien-tap-2026-ok' });
  const ok = await fetch(base + '/login', { method: 'POST', headers: { 'content-type': 'application/json', ...G }, body: JSON.stringify({ username: 'nhanvien', password: 'bien-tap-2026-ok' }) });
  assert.strictEqual(ok.status, 200);
  const cookie = ok.headers.get('set-cookie').split(';')[0];
  assert.strictEqual((await (await get('/api/me', { ...G, cookie })).json()).user.name, 'Nhân viên');
  users.update(u.id, { disabled: true });
  assert.strictEqual((await get('/api/me', { ...G, cookie })).status, 401, 'khoá tài khoản là phiên hết ngay');
});
