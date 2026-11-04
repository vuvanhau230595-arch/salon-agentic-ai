const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-medialib-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
process.env.MEDIA_DIR = path.join(tmp, 'media');
delete process.env.APP_PASSWORD;
delete process.env.META_ACCESS_TOKEN;
delete process.env.ANTHROPIC_API_KEY;

const { load } = require('../src/db');
const media = require('../src/media');
const lib = require('../src/media-lib');
const audit = require('../src/audit');
const { server } = require('../src/server');
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const PNG = (w, h) => { const b = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const JPG = (w, h) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom', 'latin1'), Buffer.alloc(16)]);
const dir = (b) => path.join(process.env.MEDIA_DIR, b);
let base;
const get = (p) => fetch(base + p);
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
const put = (brand, name, buf) => { fs.mkdirSync(dir(brand), { recursive: true }); fs.writeFileSync(path.join(dir(brand), name), buf); };

test('khởi động server thử + tạo file mẫu', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  media.ensureDirs();
  put('the_one', 'logo.png', PNG(512, 256));
  put('the_one', 'khach-lan.jpg', JPG(1080, 1350));
  put('the_one', 'reel.mp4', MP4);
  put('dark_hair', 'dh1.png', PNG(100, 100));
});

test('chữ ký file: nhận diện theo nội dung, từ chối file đội lốt, không tin đuôi', () => {
  const f = (name, buf) => { const p = path.join(tmp, name); fs.writeFileSync(p, buf); return p; };
  assert.doesNotThrow(() => lib.verifySignature(f('a.png', PNG(1, 1)), 'a.png'));
  assert.doesNotThrow(() => lib.verifySignature(f('a.jpg', JPG(1, 1)), 'a.jpg'));
  assert.doesNotThrow(() => lib.verifySignature(f('a.jpeg', JPG(1, 1)), 'a.jpeg'));
  assert.doesNotThrow(() => lib.verifySignature(f('a.mp4', MP4), 'a.mp4'));
  assert.doesNotThrow(() => lib.verifySignature(f('a.mov', MP4), 'a.mov'));
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(20)]);
  assert.doesNotThrow(() => lib.verifySignature(f('a.webp', webp), 'a.webp'));
  assert.throws(() => lib.verifySignature(f('b.jpg', PNG(1, 1)), 'b.jpg'), /đuôi \.jpg nhưng nội dung là PNG/);
  assert.throws(() => lib.verifySignature(f('c.png', Buffer.from('MZ\x90\x00exe')), 'c.png'), /không phải ảnh\/video hợp lệ/);
  assert.throws(() => lib.verifySignature(f('d.mp4', JPG(1, 1)), 'd.mp4'), /nội dung là JPEG/);
  assert.throws(() => lib.verifySignature(f('e.exe', MP4), 'e.exe'), /Chỉ nhận ảnh/);
  assert.throws(() => lib.verifySignature(f('f.jpg', Buffer.alloc(0)), 'f.jpg'), /không đúng định dạng/);
});

test('kích thước ảnh: PNG, JPEG, WebP (VP8X); file hỏng không làm sập', () => {
  assert.deepStrictEqual(lib.imageSize(path.join(dir('the_one'), 'logo.png')), { width: 512, height: 256 });
  assert.deepStrictEqual(lib.imageSize(path.join(dir('the_one'), 'khach-lan.jpg')), { width: 1080, height: 1350 });
  const vp8x = Buffer.alloc(40); vp8x.write('RIFF', 0); vp8x.write('WEBP', 8); vp8x.write('VP8X', 12); vp8x.writeUIntLE(799, 24, 3); vp8x.writeUIntLE(599, 27, 3);
  const p = path.join(tmp, 'x.webp'); fs.writeFileSync(p, vp8x);
  assert.deepStrictEqual(lib.imageSize(p), { width: 800, height: 600 });
  fs.writeFileSync(path.join(tmp, 'rac.png'), Buffer.from('không phải ảnh'));
  assert.strictEqual(lib.imageSize(path.join(tmp, 'rac.png')), null);
  assert.strictEqual(lib.imageSize(path.join(tmp, 'khong-co.png')), null);
});

test('thư mục ảo: tạo/đổi tên/xoá không đụng tới file thật; chống trùng, tên cấm, giới hạn', async () => {
  const filesBefore = fs.readdirSync(dir('the_one')).sort();
  assert.strictEqual((await post('/api/media-lib/folders', { action: 'create', brand: 'the_one', name: ' Khách Q3 ' })).status, 200);
  assert.strictEqual((await post('/api/media-lib/folders', { action: 'create', brand: 'the_one', name: 'khách q3' })).status, 400, 'trùng không phân biệt hoa thường');
  assert.strictEqual((await post('/api/media-lib/folders', { action: 'create', brand: 'the_one', name: 'a/b' })).status, 400);
  assert.strictEqual((await post('/api/media-lib/folders', { action: 'create', brand: 'the_one', name: '  ' })).status, 400);
  assert.strictEqual((await post('/api/media-lib/folders', { action: 'create', brand: 'khong-co', name: 'x' })).status, 404);
  assert.strictEqual((await post('/api/media-lib/folders', { action: 'xoa', brand: 'the_one' })).status, 400);
  await post('/api/media-lib/folders', { action: 'create', brand: 'the_one', name: 'Before-After' });
  let j = await (await get('/api/media-lib?brand=the_one')).json();
  assert.deepStrictEqual(j.folders.map((f) => [f.name, f.count]), [['Khách Q3', 0], ['Before-After', 0]]);
  // thư mục của thương hiệu này không hiện ở thương hiệu khác
  assert.deepStrictEqual((await (await get('/api/media-lib?brand=dark_hair')).json()).folders, []);
  // đổi tên giữ file bên trong
  await post('/api/media-lib/organize', { brand: 'the_one', names: ['khach-lan.jpg'], folder: 'Khách Q3' });
  await post('/api/media-lib/folders', { action: 'rename', brand: 'the_one', name: 'Khách Q3', to: 'Khách Quận 3' });
  j = await (await get('/api/media-lib?brand=the_one')).json();
  assert.strictEqual(j.files.find((f) => f.name === 'khach-lan.jpg').folder, 'Khách Quận 3');
  assert.strictEqual((await post('/api/media-lib/folders', { action: 'rename', brand: 'the_one', name: 'Khách Quận 3', to: 'before-after' })).status, 400);
  // xoá thư mục: file về chưa phân loại và vẫn còn trên đĩa
  await post('/api/media-lib/folders', { action: 'delete', brand: 'the_one', name: 'Khách Quận 3' });
  j = await (await get('/api/media-lib?brand=the_one')).json();
  assert.strictEqual(j.files.find((f) => f.name === 'khach-lan.jpg').folder, '');
  assert.deepStrictEqual(fs.readdirSync(dir('the_one')).sort(), filesBefore, 'không có file nào bị xoá/đổi tên');
  assert.strictEqual((await post('/api/media-lib/folders', { action: 'delete', brand: 'the_one', name: 'khong-co' })).status, 404);
  for (let i = 0; i < 40; i++) { try { lib.createFolder('mishang', 'f' + i); } catch { break; } }
  assert.strictEqual((await post('/api/media-lib/folders', { action: 'create', brand: 'mishang', name: 'thừa' })).status, 400, 'tối đa 40 thư mục');
});

test('thẻ và chuyển thư mục hàng loạt: chuẩn hoá, bớt thẻ, giới hạn, file/thư mục không có thì lỗi, không áp dụng dở dang', async () => {
  await post('/api/media-lib/organize', { brand: 'the_one', names: ['khach-lan.jpg', 'logo.png'], addTags: ['#Nhuộm Balayage', 'khách q3', 'nhuộm balayage'] });
  let j = await (await get('/api/media-lib?brand=the_one')).json();
  const tags = (n) => j.files.find((f) => f.name === n).tags;
  assert.deepStrictEqual(tags('khach-lan.jpg'), ['nhuộm-balayage', 'khách-q3']);
  assert.deepStrictEqual(j.tags.map((t) => [t.name, t.count]), [['nhuộm-balayage', 2], ['khách-q3', 2]]);
  await post('/api/media-lib/organize', { brand: 'the_one', names: ['logo.png'], removeTags: ['khách-q3'] });
  j = await (await get('/api/media-lib?brand=the_one')).json();
  assert.deepStrictEqual(tags('logo.png'), ['nhuộm-balayage']);
  // lỗi
  const org = (b) => post('/api/media-lib/organize', { brand: 'the_one', ...b });
  assert.strictEqual((await org({ names: [], addTags: ['x'] })).status, 400);
  assert.strictEqual((await org({ names: ['khong-co.jpg'], addTags: ['x'] })).status, 404);
  assert.strictEqual((await org({ names: ['logo.png'] })).status, 400, 'không có thay đổi');
  assert.strictEqual((await org({ names: ['logo.png'], folder: 'thu-muc-chua-co' })).status, 404);
  assert.strictEqual((await org({ names: Array.from({ length: 201 }, (_, i) => 'f' + i), addTags: ['x'] })).status, 400);
  const many = Array.from({ length: 11 }, (_, i) => 't' + i);
  assert.strictEqual((await org({ names: ['logo.png'], addTags: many })).status, 400, 'tối đa 10 thẻ/file');
  assert.deepStrictEqual(load().mediaInfo['the_one/logo.png'].tags, ['nhuộm-balayage'], 'lỗi giữa chừng không làm đổi dữ liệu file khác');
  assert.strictEqual((await post('/api/media-lib/organize', { brand: 'dark_hair', names: ['logo.png'], addTags: ['x'] })).status, 404, 'file của thương hiệu khác không thấy được');
});

test('lịch sử sử dụng: bài trong lịch + bài trong kế hoạch chờ duyệt, tách theo thương hiệu', async () => {
  const db = load();
  db.posts = [
    { id: 'p1', brand: 'the_one', channel: 'facebook_page', status: 'published', topic: 'Khách Lan', text: 'x', scheduledAt: '2026-10-01T03:00:00.000Z', media: [{ name: 'khach-lan.jpg', type: 'image' }] },
    { id: 'p2', brand: 'the_one', channel: 'tiktok', status: 'draft', topic: 'Nháp', text: 'x', scheduledAt: '2026-10-09T03:00:00.000Z', media: [{ name: 'khach-lan.jpg', type: 'image' }] },
    { id: 'p3', brand: 'dark_hair', channel: 'facebook_page', status: 'scheduled', topic: 'Khác', text: 'x', scheduledAt: '2026-10-05T03:00:00.000Z', media: [{ name: 'khach-lan.jpg', type: 'image' }] },
  ];
  db.plans = [{ id: 'pl1', brand: 'the_one', channel: 'facebook_page', items: [{ id: 'i1', topic: 'Kế hoạch', status: 'pending', at: '2026-10-20T03:00:00.000Z', media: [{ name: 'khach-lan.jpg' }] }, { id: 'i2', topic: 'Đã xử lý', status: 'scheduled', at: '2026-10-21T03:00:00.000Z', media: [{ name: 'khach-lan.jpg' }] }] }];
  const j = await (await get('/api/media-lib/usage?brand=the_one&name=khach-lan.jpg')).json();
  assert.deepStrictEqual(j.usage.map((u) => [u.kind, u.topic, u.status]), [['post', 'Nháp', 'draft'], ['post', 'Khách Lan', 'published'], ['plan', 'Kế hoạch', 'pending']]);
  assert.strictEqual((await get('/api/media-lib/usage?brand=the_one&name=khong-co.jpg')).status, 404);
  assert.strictEqual((await get('/api/media-lib/usage?brand=the_one&name=..%2Fdb.json')).status, 400);
});

test('toàn bộ thư viện: tổng, thư mục, ảnh có kích thước, chỉ file của thương hiệu đó', async () => {
  const j = await (await get('/api/media-lib?brand=the_one')).json();
  assert.deepStrictEqual(j.totals.files, 3);
  assert.deepStrictEqual([j.totals.images, j.totals.videos], [2, 1]);
  assert.ok(j.totals.bytes > 0);
  assert.deepStrictEqual(j.files.find((f) => f.name === 'logo.png').dims, { width: 512, height: 256 });
  assert.strictEqual(j.files.find((f) => f.name === 'reel.mp4').dims, null);
  assert.ok(j.files.every((f) => f.brand === 'the_one'));
  assert.strictEqual(j.limits.image, 30 * 1024 * 1024);
  const d = await (await get('/api/media-lib?brand=dark_hair')).json();
  assert.deepStrictEqual(d.files.map((f) => f.name), ['dh1.png']);
  assert.strictEqual((await get('/api/media-lib?brand=khong-co')).status, 404);
  assert.strictEqual(j.unassigned, 3);
});

test('mọi thao tác thư viện được ghi nhật ký kiểm toán, không lộ đường dẫn máy chủ', () => {
  const rows = audit.query({ kind: 'media' }).rows;
  assert.ok(rows.length >= 5);
  assert.ok(rows.every((e) => e.actor.name === 'Sếp'));
  assert.ok(rows.some((e) => /tạo thư mục/.test(e.action)) && rows.some((e) => /xoá thư mục/.test(e.action) && /không bị xoá/.test(e.action)) && rows.some((e) => /sắp xếp/.test(e.action)));
  assert.ok(!JSON.stringify(rows).includes(process.env.MEDIA_DIR));
});

test('cờ sắp xếp: không cho agent dùng / lưu trữ / tên hiển thị — trả về trong danh sách, tổng hợp đúng, agent bỏ qua, ẩn khi yêu cầu', async () => {
  const org = (b) => post('/api/media-lib/organize', { brand: 'the_one', ...b });
  assert.strictEqual((await org({ names: ['khach-lan.jpg'], excluded: true })).status, 200);
  assert.strictEqual((await org({ names: ['reel.mp4'], archived: true })).status, 200);
  assert.strictEqual((await org({ names: ['logo.png'], title: '  Logo   The One  chính thức ' + 'x'.repeat(100) })).status, 200);
  assert.strictEqual((await org({ names: ['logo.png', 'khach-lan.jpg'], title: 'hai file' })).status, 400, 'tên hiển thị chỉ 1 file');
  const j = await (await get('/api/media-lib?brand=the_one')).json();
  const by = (n) => j.files.find((f) => f.name === n);
  assert.strictEqual(by('khach-lan.jpg').excluded, true);
  assert.strictEqual(by('reel.mp4').archived, true);
  assert.strictEqual(by('logo.png').title.length, 80, 'tên hiển thị cắt 80 ký tự, gộp khoảng trắng');
  assert.ok(by('logo.png').title.startsWith('Logo The One chính thức'));
  assert.deepStrictEqual([j.totals.excluded, j.totals.archived], [1, 1]);
  assert.strictEqual(j.totals.unused, 1, 'chưa dùng không tính file bị loại/lưu trữ');
  assert.strictEqual(typeof j.totals.scheduled, 'number');
  assert.strictEqual(typeof j.totals.needConsent, 'number');
  // lần dùng gần nhất lấy từ bài trong lịch (test trước đã gắn khach-lan.jpg vào bài đã đăng và kế hoạch chờ duyệt)
  assert.ok(by('khach-lan.jpg').lastUse && ['published', 'plan'].includes(by('khach-lan.jpg').lastUse.status));
  // agent chỉ còn được tự lấy logo.png; reel không còn video cho agent
  assert.deepStrictEqual(media.assign('the_one', 'post', 2).map((s) => s[0].name), ['logo.png', 'logo.png']);
  assert.deepStrictEqual(media.assign('the_one', 'reel', 1), [[]]);
  assert.deepStrictEqual(media.list('the_one', { includeArchived: false }).map((f) => f.name).sort(), ['khach-lan.jpg', 'logo.png']);
  // gỡ cờ
  await org({ names: ['khach-lan.jpg', 'reel.mp4'], excluded: false, archived: false });
  await org({ names: ['logo.png'], title: '' });
  const k = await (await get('/api/media-lib?brand=the_one')).json();
  assert.ok(k.files.every((f) => !f.excluded && !f.archived && !f.title));
});
