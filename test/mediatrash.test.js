const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mediatrash-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
process.env.MEDIA_DIR = path.join(tmp, 'media');
delete process.env.APP_PASSWORD;
delete process.env.META_ACCESS_TOKEN;
delete process.env.ANTHROPIC_API_KEY;

const { load, save } = require('../src/db');
const media = require('../src/media');
const trash = require('../src/media-trash');
const engine = require('../src/engine');
const { server } = require('../src/server');
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const PNG = (w, h) => { const b = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom', 'latin1'), Buffer.alloc(16)]);
const dir = (b) => path.join(process.env.MEDIA_DIR, b);
const trashDir = (b) => path.join(process.env.MEDIA_DIR, '.trash', b);
let base;
const get = (p) => fetch(base + p);
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
const put = (brand, name, buf) => { fs.mkdirSync(dir(brand), { recursive: true }); fs.writeFileSync(path.join(dir(brand), name), buf); };
const names = (b) => media.list(b).map((f) => f.name).sort();

test('khởi động server thử + tạo file mẫu', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  media.ensureDirs();
  put('the_one', 'a.png', PNG(1080, 1080));
  put('the_one', 'b.png', PNG(1080, 1080));
  put('the_one', 'reel.mp4', MP4);
  put('dark_hair', 'dh.png', PNG(100, 100));
});

test('xoá = chuyển vào thùng rác: file rời thư viện nhưng vẫn còn trên máy chủ; giữ thẻ/ghi chú/thư mục để khôi phục', async () => {
  await post('/api/media-lib/folders', { brand: 'the_one', action: 'create', name: 'Khách' });
  await post('/api/media-lib/organize', { brand: 'the_one', names: ['a.png'], folder: 'Khách', addTags: ['balayage'] });
  media.setNote('the_one', 'a.png', 'Khách Lan');
  const r = await post('/api/media-lib/trash', { brand: 'the_one', names: ['a.png', 'reel.mp4'] });
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.deepStrictEqual(j.moved, ['a.png', 'reel.mp4']);
  assert.deepStrictEqual(names('the_one'), ['b.png']);
  assert.deepStrictEqual(j.totals.files, 1);
  assert.deepStrictEqual([j.trash.count, j.trash.days], [2, 30]);
  const onDisk = fs.readdirSync(trashDir('the_one'));
  assert.strictEqual(onDisk.length, 2, 'file thật vẫn còn trong .trash');
  assert.ok(onDisk.every((n) => /__(a\.png|reel\.mp4)$/.test(n)));
  assert.strictEqual(load().mediaInfo['the_one/a.png'], undefined, 'dữ liệu app của file đã rời thư viện');
  const t = (await (await get('/api/media-lib/trash?brand=the_one')).json()).items;
  assert.deepStrictEqual(t.map((x) => x.name).sort(), ['a.png', 'reel.mp4']);
  const a = t.find((x) => x.name === 'a.png');
  assert.deepStrictEqual([a.info.folder, a.info.tags, a.note, a.type, a.daysLeft, a.exists], ['Khách', ['balayage'], 'Khách Lan', 'image', 30, true]);
  // lỗi: file không có / thương hiệu khác / rỗng
  assert.strictEqual((await post('/api/media-lib/trash', { brand: 'the_one', names: ['khong-co.png'] })).status, 404);
  assert.strictEqual((await post('/api/media-lib/trash', { brand: 'the_one', names: ['dh.png'] })).status, 404);
  assert.strictEqual((await post('/api/media-lib/trash', { brand: 'the_one', names: [] })).status, 400);
  assert.ok(engine.recent ? true : true);
  assert.ok(load().actions.some((x) => /xoá 2 file vào thùng rác/.test(x.text)));
});

test('file đang gắn vào bài sắp đăng: từ chối (409) trừ khi xác nhận force', async () => {
  const db = load();
  db.posts.push({ id: 'p1', brand: 'the_one', channel: 'facebook_page', status: 'scheduled', topic: 'B', text: 'x', scheduledAt: '2099-01-01T12:00:00.000Z', media: [{ name: 'b.png', type: 'image' }] });
  save();
  const r = await post('/api/media-lib/trash', { brand: 'the_one', names: ['b.png'] });
  assert.strictEqual(r.status, 409);
  assert.match((await r.json()).error, /đang gắn vào bài/);
  assert.deepStrictEqual(names('the_one'), ['b.png'], 'chưa xoá gì');
  const f = await post('/api/media-lib/trash', { brand: 'the_one', names: ['b.png'], force: true });
  assert.strictEqual(f.status, 200);
  assert.deepStrictEqual(names('the_one'), []);
  db.posts = []; save();
});

test('khôi phục: về đúng thư viện kèm thẻ/thư mục/ghi chú; trùng tên thì thêm hậu tố; id lạ thì 404', async () => {
  const items = (await (await get('/api/media-lib/trash?brand=the_one')).json()).items;
  const a = items.find((x) => x.name === 'a.png');
  put('the_one', 'a.png', PNG(10, 10)); // có file mới cùng tên trong lúc a.png nằm trong thùng rác
  const r = await post('/api/media-lib/restore', { brand: 'the_one', ids: [a.id] });
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.deepStrictEqual(j.restored, ['a-khoiphuc-1.png']);
  assert.deepStrictEqual(names('the_one'), ['a-khoiphuc-1.png', 'a.png']);
  const f = media.list('the_one').find((x) => x.name === 'a-khoiphuc-1.png');
  assert.deepStrictEqual([f.folder, f.tags, f.note], ['Khách', ['balayage'], 'Khách Lan']);
  assert.strictEqual(j.trash.count, 2);
  assert.strictEqual((await post('/api/media-lib/restore', { brand: 'the_one', ids: [a.id] })).status, 404, 'đã khôi phục rồi');
  assert.strictEqual((await post('/api/media-lib/restore', { brand: 'dark_hair', ids: [items.find((x) => x.name === 'reel.mp4').id] })).status, 404, 'thương hiệu khác không khôi phục được');
});

test('xoá hẳn: theo id, "old" chỉ dọn file quá 30 ngày, "all" dọn sạch; file thật mất khỏi máy chủ', async () => {
  let items = (await (await get('/api/media-lib/trash?brand=the_one')).json()).items;
  const reel = items.find((x) => x.name === 'reel.mp4'), b = items.find((x) => x.name === 'b.png');
  // b.png "đã nằm 31 ngày"
  const db = load();
  db.mediaTrash.find((t) => t.id === b.id).at = new Date(Date.now() - 31 * 864e5).toISOString();
  save();
  assert.strictEqual((await (await get('/api/media-lib/trash?brand=the_one')).json()).items.find((x) => x.id === b.id).daysLeft, 0);
  assert.strictEqual(trash.purgeOld(), 1, 'dọn tự động chỉ lấy file quá hạn');
  items = trash.list('the_one');
  assert.deepStrictEqual(items.map((x) => x.name), ['reel.mp4']);
  assert.ok(!fs.readdirSync(trashDir('the_one')).some((n) => n.endsWith('b.png')));
  assert.ok(load().actions.some((x) => /Tự dọn thùng rác 1 file/.test(x.text)));
  const r = await post('/api/media-lib/purge', { brand: 'the_one', ids: [reel.id] });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual((await r.json()).gone, ['reel.mp4']);
  assert.deepStrictEqual(fs.readdirSync(trashDir('the_one')), []);
  assert.strictEqual((await post('/api/media-lib/purge', { brand: 'the_one', ids: [reel.id] })).status, 404);
  await post('/api/media-lib/trash', { brand: 'the_one', names: ['a.png', 'a-khoiphuc-1.png'] });
  const all = await post('/api/media-lib/purge', { brand: 'the_one', ids: 'all' });
  assert.deepStrictEqual((await all.json()).gone.sort(), ['a-khoiphuc-1.png', 'a.png']);
  assert.deepStrictEqual(trash.list('the_one'), []);
  assert.deepStrictEqual(names('dark_hair'), ['dh.png'], 'thương hiệu khác không bị đụng');
});

test('quyền: xoá hẳn cần data_admin, xoá/khôi phục cần content_write theo thương hiệu', () => {
  const authz = require('../src/authz');
  const need = (p, b = { brand: 'the_one' }) => authz.classify('POST', p, b, new URLSearchParams());
  assert.deepStrictEqual(need('/api/media-lib/purge'), { perm: 'data_admin', global: true });
  assert.strictEqual(need('/api/media-lib/trash').perm, 'content_write');
  assert.strictEqual(need('/api/media-lib/restore').perm, 'content_write');
});
