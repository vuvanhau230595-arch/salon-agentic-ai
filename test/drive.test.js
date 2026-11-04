// Nạp media từ Google Drive với Drive GIẢ (http server local trả token, files.list và alt=media):
// tách id từ link, nạp file mới, bỏ qua trùng, từ chối file sai định dạng/quá lớn, lỗi quyền báo rõ, không ghi bí mật vào db.json/log,
// giới hạn 20 file mỗi lượt, agent trong engine, phân quyền API.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-drive-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
process.env.MEDIA_DIR = path.join(tmp, 'media');
delete process.env.APP_PASSWORD;
delete process.env.META_ACCESS_TOKEN;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GOOGLE_SERVICE_ACCOUNT_FILE;

const { load } = require('../src/db');
const secrets = require('../src/secrets');
const drive = require('../src/drive');
const engine = require('../src/engine');
const authz = require('../src/authz');
const audit = require('../src/audit');
const { server } = require('../src/server');

const PNG = (w, h) => { const b = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom', 'latin1'), Buffer.alloc(16)]);
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const dir = (b) => path.join(process.env.MEDIA_DIR, b);

// ----- Khoá service account giả (RSA thật, chỉ dùng trong test) -----
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = { type: 'service_account', project_id: 'salon-test', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), client_email: 'media-sync@salon-test.iam.gserviceaccount.com', client_id: '1' };

// ----- Drive giả -----
const fake = { folders: {}, downloads: 0, tokenCalls: 0, badKey: false, apiDisabled: false, lastQ: '' };
const file = (id, name, mimeType, content, extra = {}) => ({ id, name, mimeType, size: String(content.length), md5Checksum: md5(content), modifiedTime: '2026-10-16T01:00:00.000Z', content, ...extra });
const meta = ({ content, ...m }) => m;
const fakeDrive = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.method === 'POST' && u.pathname === '/token') {
    fake.tokenCalls++;
    let body = ''; for await (const c of req) body += c;
    const p = new URLSearchParams(body);
    const jwt = p.get('assertion') || '';
    const [h, c, sig] = jwt.split('.');
    const ok = p.get('grant_type') === 'urn:ietf:params:oauth:grant-type:jwt-bearer' && crypto.verify('RSA-SHA256', Buffer.from(`${h}.${c}`), publicKey, Buffer.from(sig, 'base64url'));
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
    if (!ok || fake.badKey || claims.iss !== SA.client_email || claims.scope !== 'https://www.googleapis.com/auth/drive.readonly') return json(401, { error: 'invalid_grant' });
    return json(200, { access_token: 'tok-' + fake.tokenCalls, expires_in: 3600, token_type: 'Bearer' });
  }
  if (!/^Bearer tok-/.test(req.headers.authorization || '')) return json(401, { error: { code: 401, message: 'Invalid Credentials' } });
  if (fake.apiDisabled) return json(403, { error: { code: 403, message: 'Google Drive API has not been used in project salon-test before or it is disabled.', errors: [{ reason: 'accessNotConfigured' }] } });
  let m;
  if (u.pathname === '/drive/v3/files') {
    fake.lastQ = u.searchParams.get('q');
    const id = (fake.lastQ.match(/^'([^']+)' in parents and trashed=false$/) || [])[1];
    if (id === 'forbidden-folder') return json(403, { error: { code: 403, message: 'The caller does not have permission', errors: [{ reason: 'insufficientFilePermissions' }] } });
    if (!fake.folders[id]) return json(404, { error: { code: 404, message: 'File not found: ' + id, errors: [{ reason: 'notFound' }] } });
    const size = Number(u.searchParams.get('pageSize')) || 100;
    const start = Number(u.searchParams.get('pageToken') || 0);
    const all = fake.folders[id];
    const page = all.slice(start, start + size).map(meta);
    return json(200, { files: page, ...(start + size < all.length ? { nextPageToken: String(start + size) } : {}) });
  }
  if ((m = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/))) {
    const id = decodeURIComponent(m[1]);
    if (fake.folders[id]) return json(200, { id, name: 'Thư mục ' + id, mimeType: 'application/vnd.google-apps.folder' });
    const f = Object.values(fake.folders).flat().find((x) => x.id === id);
    if (!f) return json(404, { error: { code: 404, message: 'not found' } });
    if (u.searchParams.get('alt') !== 'media') return json(200, meta(f));
    fake.downloads++; fake.downloaded = (fake.downloaded || []).concat(id);
    res.writeHead(200, { 'content-type': f.mimeType });
    return res.end(f.content);
  }
  json(404, { error: { code: 404, message: 'no route' } });
});

let base;
const get = (p) => fetch(base + p);
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
const files = (b) => fs.readdirSync(dir(b)).filter((n) => !n.startsWith('.')).sort();

test('khởi động server thử + Drive giả', async () => {
  await new Promise((r) => fakeDrive.listen(0, '127.0.0.1', r));
  const fb = `http://127.0.0.1:${fakeDrive.address().port}`;
  process.env.GOOGLE_API_BASE = fb;
  process.env.GOOGLE_TOKEN_URL = fb + '/token';
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  require('../src/media').ensureDirs();
  load().settings.paused = true; // không tự quét trong lúc test
});
test.after(() => { server.close(); fakeDrive.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('tách id thư mục từ link Drive: nhiều dạng link, link file thì báo rõ', () => {
  const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456';
  for (const s of [id, `https://drive.google.com/drive/folders/${id}`, `https://drive.google.com/drive/folders/${id}?usp=sharing`, `https://drive.google.com/drive/u/0/folders/${id}`, `https://drive.google.com/open?id=${id}`, `  https://drive.google.com/drive/mobile/folders/${id}  `]) {
    assert.strictEqual(drive.folderIdFromLink(s), id, s);
  }
  assert.throws(() => drive.folderIdFromLink(`https://drive.google.com/file/d/${id}/view`), /link của 1 FILE/);
  assert.throws(() => drive.folderIdFromLink('https://example.com/abc'), /Không nhận ra link/);
  assert.throws(() => drive.folderIdFromLink(''), /Dán link/);
});

test('chưa có khoá: trạng thái nói rõ, nạp ngay báo thiếu khoá; agent nhắc 1 lần rồi thôi', async () => {
  let j = await (await get('/api/drive')).json();
  assert.strictEqual(j.configured, false);
  assert.strictEqual(j.serviceEmail, '');
  assert.deepStrictEqual(Object.keys(j.brands).sort(), ['dark_hair', 'mishang', 'the_one']);
  // đặt thư mục bằng link + bật tự nạp (được phép dù chưa có khoá)
  let r = await post('/api/drive/settings', { brand: 'the_one', link: 'https://drive.google.com/drive/folders/folderTheOne123?usp=sharing', on: true });
  assert.strictEqual(r.status, 200);
  j = await r.json();
  assert.strictEqual(j.brands.the_one.folderId, 'folderTheOne123');
  assert.strictEqual(j.brands.the_one.on, true);
  assert.strictEqual(j.brands.the_one.link, 'https://drive.google.com/drive/folders/folderTheOne123');
  assert.strictEqual((await post('/api/drive/settings', { brand: 'dark_hair', on: true })).status, 400, 'bật mà chưa có thư mục');
  assert.strictEqual((await post('/api/drive/settings', { brand: 'khong-co', link: 'x' })).status, 404);
  r = await post('/api/drive/sync', { brand: 'the_one' });
  assert.strictEqual(r.status, 400);
  assert.match((await r.json()).error, /Chưa có khoá service account/);
  load().actions = [];
  assert.strictEqual(await drive.runAgent('schedule'), 0);
  assert.strictEqual(await drive.runAgent('schedule'), 0);
  const errs = load().actions.filter((a) => a.kind === 'error' && /chưa có khoá/.test(a.text));
  assert.strictEqual(errs.length, 1, 'nhắc thiếu khoá đúng 1 lần, không lặp mỗi lượt');
});

test('tải khoá service account: từ chối file sai, nhận file đúng, chỉ lộ email; bí mật không vào db.json / nhật ký / trạng thái', async () => {
  assert.strictEqual((await post('/api/drive/key', { json: { type: 'authorized_user', client_id: 'x' } })).status, 400, 'không phải service account');
  assert.strictEqual((await post('/api/drive/key', { json: { type: 'service_account', client_email: 'a@b', private_key: 'rác' } })).status, 400, 'private_key hỏng');
  assert.strictEqual((await post('/api/drive/key', { json: 'không phải json' })).status, 400);
  const r = await post('/api/drive/key', { json: SA });
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.strictEqual(j.configured, true);
  assert.strictEqual(j.serviceEmail, SA.client_email);
  assert.strictEqual(j.keySource, 'upload');
  assert.ok(!JSON.stringify(j).includes('PRIVATE KEY'), 'trạng thái không chứa khoá');
  const state = await (await get('/api/state')).json();
  assert.ok(!JSON.stringify(state).includes('PRIVATE KEY'));
  assert.ok(fs.readFileSync(secrets.file(), 'utf8').includes('PRIVATE KEY'), 'khoá nằm trong secrets.json');
  assert.ok(!fs.readFileSync(process.env.DB_FILE, 'utf8').includes('PRIVATE KEY'), 'khoá KHÔNG nằm trong db.json');
  assert.ok(!JSON.stringify(load().actions).includes('PRIVATE KEY'));
  assert.ok(!fs.readFileSync(audit.file(), 'utf8').includes('PRIVATE KEY'), 'khoá không vào nhật ký kiểm toán');
  // kiểm tra kết nối: chỉ khoá (không thư mục)
  const t = await (await post('/api/drive/test', {})).json();
  assert.deepStrictEqual(t, { ok: true, email: SA.client_email });
  assert.ok(fake.tokenCalls >= 1, 'đã đổi JWT lấy token ở Google giả');
});

test('nạp file mới: chỉ ảnh/video, kiểm tra chữ ký, bỏ qua file lạ/quá lớn, trùng tên thêm hậu tố, không tải lại file đã nạp', async () => {
  const big = PNG(1, 1);
  fake.folders.folderTheOne123 = [
    file('f-jpg', 'khach-lan.jpg', 'image/jpeg', JPG),
    file('f-png', 'logo.png', 'image/png', PNG(10, 10)),
    file('f-mp4', 'reel.mp4', 'video/mp4', MP4),
    file('f-mov', 'clip.mov', 'video/quicktime', MP4),
    file('f-doc', 'ghi chu', 'application/vnd.google-apps.document', Buffer.from(''), { size: undefined, md5Checksum: undefined }),
    file('f-exe', 'virus.exe', 'application/octet-stream', Buffer.from('MZ')),
    file('f-fake', 'gia-mao.jpg', 'image/jpeg', PNG(1, 1)), // đuôi jpg nhưng ruột PNG → từ chối khi kiểm tra chữ ký
    file('f-big', 'to.png', 'image/png', big, { size: String(31 * 1048576) }), // quá 30MB theo thông tin Drive → không tải
    file('f-dup', 'logo.png', 'image/png', PNG(20, 20)), // trùng tên với logo.png → logo-1.png
    file('f-noext', 'anh khong duoi', 'image/webp', Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(20)])), // đặt đuôi theo mime
  ];
  const before = fake.downloads;
  load().actions = [];
  const r = await post('/api/drive/sync', { brand: 'the_one' });
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.strictEqual(j.result.added, 6, JSON.stringify(j.result));
  assert.strictEqual(j.result.rejected, 4, 'doc, exe, giả mạo, quá lớn');
  assert.deepStrictEqual(files('the_one'), ['anh khong duoi.webp', 'clip.mov', 'khach-lan.jpg', 'logo-1.png', 'logo.png', 'reel.mp4']);
  assert.strictEqual(fake.downloads - before, 7, JSON.stringify(fake.downloaded) +  'tải 6 file + 1 file giả mạo (bị từ chối sau khi xem ruột); không tải file quá lớn/sai loại');
  assert.ok(!fs.existsSync(path.join(dir('the_one'), 'gia-mao.jpg')));
  assert.ok(!fs.readdirSync(dir('the_one')).some((n) => n.startsWith('.upload-')), 'không để file tạm');
  assert.strictEqual(j.brands.the_one.count, 6);
  assert.strictEqual(j.brands.the_one.lastResult.added, 6);
  assert.ok(j.brands.the_one.lastRun);
  const db = load();
  assert.deepStrictEqual(db.driveSync.the_one.files['f-dup'], { ...db.driveSync.the_one.files['f-dup'], name: 'logo-1.png', driveName: 'logo.png' });
  const logs = db.actions.filter((a) => a.kind === 'media');
  assert.ok(logs.some((a) => /nạp 6 file mới/.test(a.text)), logs.map((a) => a.text).join('\n'));
  assert.ok(logs.some((a) => /gia-mao\.jpg.*không đúng định dạng/.test(a.text)));
  assert.ok(logs.some((a) => /virus\.exe.*không phải ảnh/.test(a.text)));
  assert.ok(logs.some((a) => /to\.png.*quá lớn/.test(a.text)));
  // Lượt 2: không có gì mới → không tải lại, không ghi nhật ký bỏ qua lặp lại
  const d0 = fake.downloads, n0 = load().actions.length;
  const j2 = await (await post('/api/drive/sync', { brand: 'the_one' })).json();
  assert.strictEqual(j2.result.added, 0);
  assert.strictEqual(j2.result.skipped, 10, '6 đã nạp + 4 đã bỏ qua: không thử lại khi nội dung không đổi');
  assert.strictEqual(fake.downloads, d0, 'không tải lại file đã nạp');
  assert.strictEqual(load().actions.length, n0, 'không ghi nhật ký khi không có gì mới');
  assert.deepStrictEqual(files('the_one').length, 6);
  // Đổi tên trên Drive (cùng id + md5) → vẫn coi là đã nạp; xoá trên Drive → file local vẫn còn
  fake.folders.folderTheOne123[0].name = 'khach-lan-doi-ten.jpg';
  fake.folders.folderTheOne123 = fake.folders.folderTheOne123.filter((f) => f.id !== 'f-mp4');
  const j3 = await (await post('/api/drive/sync', { brand: 'the_one' })).json();
  assert.strictEqual(j3.result.added, 0);
  assert.ok(fs.existsSync(path.join(dir('the_one'), 'reel.mp4')), 'xoá trên Drive không xoá file local');
  // Nội dung đổi (md5 khác, cùng id) → nạp bản mới với hậu tố, bản cũ giữ nguyên
  fake.folders.folderTheOne123[0].content = Buffer.concat([JPG, Buffer.from([0])]);
  fake.folders.folderTheOne123[0].md5Checksum = md5(fake.folders.folderTheOne123[0].content);
  const j4 = await (await post('/api/drive/sync', { brand: 'the_one' })).json();
  assert.strictEqual(j4.result.added, 1);
  assert.ok(fs.existsSync(path.join(dir('the_one'), 'khach-lan-doi-ten.jpg')));
  assert.ok(fs.existsSync(path.join(dir('the_one'), 'khach-lan.jpg')), 'bản cũ vẫn còn');
  // Kiểm tra kết nối theo thương hiệu: đếm file
  const t = await (await post('/api/drive/test', { brand: 'the_one' })).json();
  assert.strictEqual(t.folder, 'Thư mục folderTheOne123');
  assert.strictEqual(t.total, 9);
  assert.strictEqual(t.newFiles, 0);
  // Thư viện Media thấy file đã nạp
  const lib = await (await get('/api/media-lib?brand=the_one')).json();
  assert.ok(lib.files.some((f) => f.name === 'logo-1.png'));
});

test('tối đa 20 file mỗi lượt / thương hiệu, lượt sau nạp tiếp; phân trang files.list', async () => {
  fake.folders.folderDH = Array.from({ length: 25 }, (_, i) => file(`dh-${i}`, `dh-${String(i).padStart(2, '0')}.png`, 'image/png', PNG(i + 1, 1)));
  await post('/api/drive/settings', { brand: 'dark_hair', link: 'folderDH00000000', on: true });
  // link ngắn hơn 10 ký tự bị từ chối; id thật dùng 'folderDH' qua đường gán trực tiếp để Drive giả hiểu
  load().driveSync.dark_hair.folders[0].id = 'folderDH';
  const j = await (await post('/api/drive/sync', { brand: 'dark_hair' })).json();
  assert.strictEqual(j.result.added, 20);
  assert.strictEqual(j.result.pending, 5);
  assert.strictEqual(files('dark_hair').length, 20);
  assert.ok(load().actions.some((a) => /nạp 20 file mới.*còn 5 file/.test(a.text)));
  // engine: agent chạy theo lượt quét cho mọi thương hiệu đang bật
  assert.ok(engine.AGENTS.drive_sync, 'có agent drive_sync');
  assert.strictEqual(load().settings.agents.drive_sync.on, true);
  const run = await engine.runAgent('drive_sync', 'schedule');
  assert.strictEqual(run.error, null);
  assert.strictEqual(run.changed, 5, 'lượt sau nạp nốt 5 file');
  assert.strictEqual(files('dark_hair').length, 25);
  // phân trang: trang 200 → 2 trang cho thư mục 250 file (chỉ liệt kê, không tải: file không có trong danh sách tải vì đã nạp hết)
  const dh25 = fake.folders.folderDH;
  fake.folders.folderDH = Array.from({ length: 250 }, (_, i) => file(`dh-${i}`, `dh-${i}.png`, 'image/png', PNG(1, 1)));
  const all = await drive.listFolder('folderDH');
  assert.strictEqual(all.length, 250);
  fake.folders.folderDH = dh25; // trả về 25 file đã nạp hết cho các test sau
});

test('lỗi quyền báo rõ bằng tiếng Việt: chưa chia sẻ thư mục, API chưa bật, khoá sai; lỗi cùng nguyên nhân chỉ ghi 1 lần', async () => {
  await post('/api/drive/settings', { brand: 'mishang', link: 'https://drive.google.com/drive/folders/forbidden-folder' });
  let r = await post('/api/drive/sync', { brand: 'mishang' });
  assert.strictEqual(r.status, 502);
  let e = (await r.json()).error;
  assert.match(e, /chia sẻ cho email service account/);
  load().actions = [];
  await post('/api/drive/sync', { brand: 'mishang' });
  await post('/api/drive/sync', { brand: 'mishang' });
  assert.strictEqual(load().actions.filter((a) => a.kind === 'error').length, 0, 'lỗi cùng nguyên nhân không ghi lặp');
  let st = (await (await get('/api/drive')).json()).brands.mishang;
  assert.match(st.lastError, /chia sẻ/);
  await post('/api/drive/settings', { brand: 'mishang', remove: 'forbidden-folder' });
  await post('/api/drive/settings', { brand: 'mishang', link: 'https://drive.google.com/drive/folders/khong-ton-tai-123' });
  r = await post('/api/drive/sync', { brand: 'mishang' });
  assert.strictEqual(r.status, 404);
  assert.match((await r.json()).error, /CHƯA ĐƯỢC CHIA SẺ|link sai/);
  fake.apiDisabled = true;
  drive._resetToken();
  r = await post('/api/drive/test', { brand: 'the_one' });
  assert.match((await r.json()).error, /Google Drive API chưa được bật/);
  fake.apiDisabled = false;
  fake.badKey = true;
  drive._resetToken();
  r = await post('/api/drive/test', {});
  assert.match((await r.json()).error, /Khoá service account Google không hợp lệ/);
  fake.badKey = false;
  drive._resetToken();
  // agent: thương hiệu lỗi không chặn thương hiệu khác
  fake.folders.folderTheOne123.push(file('f-new', 'moi.png', 'image/png', PNG(2, 2)));
  load().driveSync.mishang.on = true;
  const run = await engine.runAgent('drive_sync', 'schedule');
  assert.strictEqual(run.changed, 1);
  assert.strictEqual(run.error, null, 'lỗi 1 thương hiệu không làm agent lỗi');
  assert.ok(fs.existsSync(path.join(dir('the_one'), 'moi.png')));
});

test('nhiều thư mục mỗi thương hiệu: thêm/bỏ, tự gắn thẻ theo nhãn hoặc tên thư mục Drive, 1 thư mục lỗi không chặn thư mục khác', async () => {
  fake.folders.folderTikTok = [file('tt-1', 'nam-cat-tay.mp4', 'video/mp4', MP4), file('tt-2', 'khach-nu.jpg', 'image/jpeg', JPG)];
  fake.folders.folderNoLabel = [file('nl-1', 'khong-nhan.png', 'image/png', PNG(3, 3))];
  let r = await post('/api/drive/settings', { brand: 'the_one', link: 'https://drive.google.com/drive/folders/folderTikTok', label: '  Tóc nam TikTok ' });
  assert.strictEqual(r.status, 200);
  let st = (await r.json()).brands.the_one;
  assert.strictEqual(st.folders.length, 2);
  assert.deepStrictEqual(st.folders[1], { ...st.folders[1], id: 'folderTikTok', label: 'Tóc nam TikTok', tag: 'tóc-nam-tiktok', count: 0 });
  assert.strictEqual(st.folderId, 'folderTheOne123', 'folderId tương thích = thư mục đầu');
  assert.strictEqual((await post('/api/drive/settings', { brand: 'the_one', link: 'folderTikTok' })).status, 400, 'trùng thư mục');
  await post('/api/drive/settings', { brand: 'the_one', link: 'https://drive.google.com/drive/folders/folderNoLabel' });
  await post('/api/drive/settings', { brand: 'the_one', link: 'https://drive.google.com/drive/folders/forbidden-folder', label: 'Lỗi' });
  load().actions = [];
  r = await post('/api/drive/sync', { brand: 'the_one' });
  assert.strictEqual(r.status, 200, 'thư mục lỗi không làm cả lượt lỗi');
  const j = await r.json();
  assert.strictEqual(j.result.added, 3);
  assert.match(j.result.errors[0], /chia sẻ/);
  const lib = await (await get('/api/media-lib?brand=the_one')).json();
  const tags = (n) => (lib.files.find((f) => f.name === n) || {}).tags;
  assert.deepStrictEqual(tags('nam-cat-tay.mp4'), ['tóc-nam-tiktok']);
  assert.deepStrictEqual(tags('khach-nu.jpg'), ['tóc-nam-tiktok']);
  assert.deepStrictEqual(tags('khong-nhan.png'), ['thư-mục-foldernolabel'], 'không có nhãn thì lấy tên thư mục trên Drive');
  st = (await (await get('/api/drive')).json()).brands.the_one;
  assert.strictEqual(st.folders.find((f) => f.id === 'folderTikTok').count, 2);
  assert.match(st.folders.find((f) => f.id === 'forbidden-folder').error, /chia sẻ/);
  assert.strictEqual(st.lastError, null, 'còn thư mục đọc được thì không coi là lỗi cả thương hiệu');
  assert.strictEqual(load().actions.filter((a) => a.kind === 'error').length, 1);
  await post('/api/drive/sync', { brand: 'the_one' });
  assert.strictEqual(load().actions.filter((a) => a.kind === 'error').length, 1, 'lỗi cùng nguyên nhân của thư mục không ghi lặp');
  // kiểm tra: báo từng thư mục
  const tc = await (await post('/api/drive/test', { brand: 'the_one' })).json();
  assert.strictEqual(tc.folders.length, 4);
  assert.strictEqual(tc.failed, 1);
  assert.strictEqual(tc.total, 10 + 2 + 1, 'thư mục The One có 10 file (9 + moi.png) + 2 + 1');
  const one = await (await post('/api/drive/test', { brand: 'the_one', folderId: 'folderTikTok' })).json();
  assert.deepStrictEqual(one.folders.map((f) => f.name), ['Thư mục folderTikTok']);
  // bỏ thư mục: file đã nạp vẫn còn; bỏ hết thì tắt tự nạp
  r = await post('/api/drive/settings', { brand: 'the_one', remove: 'forbidden-folder' });
  assert.strictEqual((await r.json()).brands.the_one.folders.length, 3);
  assert.strictEqual((await post('/api/drive/settings', { brand: 'the_one', remove: 'khong-co' })).status, 404);
  await post('/api/drive/settings', { brand: 'the_one', remove: 'folderTikTok' });
  assert.ok(fs.existsSync(path.join(dir('the_one'), 'nam-cat-tay.mp4')), 'bỏ thư mục không xoá file đã nạp');
  await post('/api/drive/settings', { brand: 'the_one', remove: 'folderNoLabel' });
  assert.strictEqual((await post('/api/drive/settings', { brand: 'the_one', on: true })).status, 200);
  st = (await (await get('/api/drive')).json()).brands.the_one;
  assert.deepStrictEqual(st.folders.map((f) => f.id), ['folderTheOne123']);
  // dữ liệu bản cũ (folderId) tự chuyển sang folders
  load().driveSync.mishang = { folderId: 'folderCu1234567', on: true, files: {} };
  assert.deepStrictEqual((await (await get('/api/drive')).json()).brands.mishang.folders.map((f) => f.id), ['folderCu1234567']);
  assert.strictEqual(load().driveSync.mishang.folderId, undefined);
  load().driveSync.mishang = { folders: [], on: false, files: {} };
  assert.strictEqual((await post('/api/drive/settings', { brand: 'the_one', on: true })).status, 200);
});

test('phân quyền: thư mục/nạp theo thương hiệu (content_write), kiểm tra = agents_run, tải khoá = settings_write toàn hệ thống', () => {
  assert.deepStrictEqual(authz.classify('POST', '/api/drive/settings', { brand: 'the_one' }), { perm: 'content_write', brands: ['the_one'] });
  assert.deepStrictEqual(authz.classify('POST', '/api/drive/sync', { brand: 'dark_hair' }), { perm: 'content_write', brands: ['dark_hair'] });
  assert.deepStrictEqual(authz.classify('POST', '/api/drive/test', { brand: 'dark_hair' }), { perm: 'agents_run', brands: ['dark_hair'] });
  assert.deepStrictEqual(authz.classify('POST', '/api/drive/test', {}), { perm: 'agents_run', global: true });
  assert.deepStrictEqual(authz.classify('POST', '/api/drive/key', { json: {} }), { perm: 'settings_write', global: true });
  const editorDH = { role: 'editor', brands: ['dark_hair'], name: 'E' };
  assert.strictEqual(authz.check(editorDH, 'POST', '/api/drive/settings', { brand: 'dark_hair' }), null);
  assert.strictEqual(authz.check(editorDH, 'POST', '/api/drive/settings', { brand: 'the_one' }).status, 403);
  assert.strictEqual(authz.check(editorDH, 'POST', '/api/drive/key', { json: {} }).status, 403);
  assert.strictEqual(authz.check({ role: 'manager', brands: [], name: 'M' }, 'POST', '/api/drive/key', { json: {} }).status, 403);
  assert.strictEqual(authz.check({ role: 'owner', brands: [], name: 'O' }, 'POST', '/api/drive/key', { json: {} }), null);
});

test('gỡ khoá: trạng thái về "chưa có", file đã nạp vẫn còn; khoá từ GOOGLE_SERVICE_ACCOUNT_FILE được ưu tiên và không tải qua web', async () => {
  const r = await post('/api/drive/key', { remove: true });
  assert.strictEqual((await r.json()).configured, false);
  assert.ok(!fs.readFileSync(secrets.file(), 'utf8').includes('PRIVATE KEY'));
  assert.ok(files('the_one').length >= 7);
  const kf = path.join(tmp, 'sa.json');
  fs.writeFileSync(kf, JSON.stringify(SA));
  process.env.GOOGLE_SERVICE_ACCOUNT_FILE = kf;
  const j = await (await get('/api/drive')).json();
  assert.strictEqual(j.configured, true);
  assert.strictEqual(j.keySource, 'env');
  assert.strictEqual((await post('/api/drive/key', { json: SA })).status, 400, 'đang dùng file trong .env thì không tải đè qua web');
  delete process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  assert.strictEqual((await (await get('/api/drive')).json()).configured, false);
});
