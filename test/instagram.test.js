const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-ig-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
process.env.MEDIA_DIR = path.join(tmp, 'media');
process.env.META_ACCESS_TOKEN = 'MAINTOKEN';
process.env.PUBLIC_BASE_URL = 'https://agent.example.vn/';
process.env.IG_POLL_MS = '0';
process.env.IG_POLL_TRIES = '1';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.APP_PASSWORD;

// ---- Meta giả cho Instagram ----
const calls = [];
let videoStatus = 'FINISHED';
let igOf = { 200000001: '178400001', 200000002: '178400001', 300000001: null }; // 2 Page The One chung 1 IG
let n = 0;
const realFetch = global.fetch;
global.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.hostname === '127.0.0.1') return realFetch(url, init);
  const body = init.body ? Object.fromEntries(new URLSearchParams(init.body)) : null;
  const rec = { path: u.pathname.replace(/^\/v[\d.]+/, ''), method: init.method || 'GET', q: Object.fromEntries(u.searchParams), body };
  calls.push(rec);
  const reply = (o) => ({ status: 200, json: async () => o });
  let m;
  if ((m = rec.path.match(/^\/(\d+)$/)) && rec.method === 'GET') {
    if (rec.q.fields === 'access_token') return reply({ access_token: `PT_${m[1]}` });
    if (/instagram_business_account/.test(rec.q.fields)) return reply(igOf[m[1]] ? { instagram_business_account: { id: igOf[m[1]], username: 'theone.hairsalon' } } : {});
  }
  if (rec.method === 'POST' && /^\/\d+\/media$/.test(rec.path)) return reply({ id: `C${++n}` });
  if (rec.method === 'GET' && /^\/C\d+$/.test(rec.path)) return reply({ status_code: videoStatus });
  if (rec.method === 'POST' && /^\/\d+\/media_publish$/.test(rec.path)) return reply({ id: `IGM_${rec.body.creation_id}` });
  if (rec.method === 'GET' && /^\/IGM_/.test(rec.path)) return reply({ permalink: 'https://www.instagram.com/p/abc/' });
  return reply({ error: { code: 803, message: `chưa giả lập ${rec.method} ${rec.path}` } });
};
test.after(() => { global.fetch = realFetch; fs.rmSync(tmp, { recursive: true, force: true }); });

const planner = require('../src/planner');
const engine = require('../src/engine');
const social = require('../src/connectors/social');
const ig = require('../src/connectors/instagram');
const { load } = require('../src/db');
const { server } = require('../src/server');

fs.mkdirSync(path.join(process.env.MEDIA_DIR, 'the_one'), { recursive: true });
// Ảnh thật (cần ffmpeg): a.jpg 4:5, b.jpg vuông, c.png 3:4 có nền trong suốt; video giả là đủ (Meta tự xử lý)
const { execFileSync } = require('node:child_process');
const mdir = path.join(process.env.MEDIA_DIR, 'the_one');
const mkImg = (name, size, extra = []) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=red:s=${size}`, ...extra, '-frames:v', '1', path.join(mdir, name)]);
mkImg('a.jpg', '800x1000');
mkImg('b.jpg', '1000x1000');
mkImg('c.png', '600x800', ['-vf', 'format=rgba,colorchannelmixer=aa=0.5']);
fs.writeFileSync(path.join(mdir, 'v.mp4'), 'x'.repeat(10));
const probe = (f) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,pix_fmt', '-of', 'csv=p=0', f]).toString().trim();
const due = () => new Date(Date.now() - 1000).toISOString();
const post = (extra) => ({ id: 'p' + Math.random().toString(36).slice(2, 6), channel: 'instagram', brand: 'the_one', topic: 'Bài IG', text: 'Tóc mới #theone', media: [{ type: 'image', name: 'a.jpg' }], scheduledAt: due(), status: 'scheduled', ...extra });
const posts = () => calls.filter((c) => c.method === 'POST');

test.beforeEach(() => {
  const db = load();
  db.settings.dryRun = false;
  planner.updateBrand('the_one', { pageIds: ['200000001', '200000002'], channels: { instagram: { on: true } } });
  social.resetPageToken();
  calls.length = 0;
  videoStatus = 'FINISHED';
});

test('1 ảnh: tạo container bằng link có chữ ký rồi media_publish; 2 Page chung 1 IG chỉ đăng 1 lần', async () => {
  const db = load();
  db.posts = [post({ id: 'i1' })];
  await engine.runAgent('content', 'manual');
  const p = db.posts[0];
  assert.strictEqual(p.status, 'published', p.skipReason || p.error);
  assert.deepStrictEqual(Object.keys(p.results), ['ig_178400001']);
  assert.strictEqual(p.permalink, 'https://www.instagram.com/p/abc/');
  const [create, pub] = posts();
  assert.strictEqual(create.path, '/178400001/media');
  assert.strictEqual(create.body.caption, 'Tóc mới #theone');
  assert.strictEqual(create.body.access_token, 'PT_200000001', 'dùng Page token');
  assert.match(create.body.image_url, /^https:\/\/agent\.example\.vn\/pub\/media\/[\w-]+\.[\w-]+$/);
  assert.strictEqual(pub.path, '/178400001/media_publish');
  assert.strictEqual(posts().length, 2);
});

test('video → Reel; còn đang xử lý thì giữ container, lần sau đăng tiếp không tạo lại', async () => {
  const db = load();
  videoStatus = 'IN_PROGRESS';
  db.posts = [post({ id: 'v1', media: [{ type: 'video', name: 'v.mp4' }] })];
  await engine.runAgent('content', 'manual');
  const p = db.posts[0];
  assert.strictEqual(p.status, 'scheduled');
  assert.strictEqual(p.attempts, undefined, 'đang xử lý không tính là lỗi');
  assert.deepStrictEqual(Object.keys(p.igPending), ['ig_178400001']);
  assert.strictEqual(posts()[0].body.media_type, 'REELS');
  assert.ok(posts()[0].body.video_url.includes('/pub/media/'));

  videoStatus = 'FINISHED';
  calls.length = 0;
  await engine.runAgent('content', 'manual');
  assert.strictEqual(p.status, 'published');
  assert.strictEqual(p.igPending, undefined);
  assert.deepStrictEqual(posts().map((c) => c.path), ['/178400001/media_publish'], 'không tạo container mới');
});

test('nhiều ảnh → carousel; bài không có ảnh / IG chưa liên kết thì không đăng, báo rõ', async () => {
  const db = load();
  db.posts = [post({ id: 'k1', media: [{ type: 'image', name: 'a.jpg' }, { type: 'image', name: 'b.jpg' }] })];
  await engine.runAgent('content', 'manual');
  assert.strictEqual(db.posts[0].status, 'published');
  const creates = posts().filter((c) => c.path.endsWith('/media'));
  assert.deepStrictEqual(creates.map((c) => c.body.is_carousel_item || c.body.media_type), ['true', 'true', 'CAROUSEL']);
  assert.strictEqual(creates[2].body.children.split(',').length, 2);

  calls.length = 0;
  db.posts = [post({ id: 'k3', media: [] })];
  await engine.runAgent('content', 'manual');
  assert.match(db.posts[0].skipReason, /bắt buộc có ảnh hoặc video/);
  assert.strictEqual(posts().length, 0);

  planner.updateBrand('dark_hair', { pageIds: ['300000001'], channels: { instagram: { on: true } } });
  db.posts = [post({ id: 'k4', brand: 'dark_hair', media: [] })];
  await engine.runAgent('content', 'manual');
  assert.match(db.posts[0].skipReason, /liên kết tài khoản Instagram/);
});

test('link công khai: đúng chữ ký thì tải được file, sai/hết hạn thì 404; không lộ file khác', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const good = ig.signedUrl('the_one', 'a.jpg').replace(/^https:\/\/agent\.example\.vn/, base);
    const r = await fetch(good);
    assert.strictEqual(r.status, 200);
    assert.ok(Buffer.from(await r.arrayBuffer()).equals(fs.readFileSync(path.join(mdir, 'a.jpg'))));
    const [data, sig] = good.split('/pub/media/')[1].split('.');
    const forged = Buffer.from(JSON.stringify({ b: 'the_one', n: 'b.jpg', e: Date.now() + 1e6 })).toString('base64url');
    assert.strictEqual((await fetch(`${base}/pub/media/${forged}.${sig}`)).status, 404, 'đổi tên file mà giữ chữ ký cũ');
    assert.strictEqual((await fetch(`${base}/pub/media/${data}.AAAA`)).status, 404);
    const old = ig.signedUrl('the_one', 'a.jpg', Date.now() - 25 * 3600e3).split('/pub/media/')[1];
    assert.strictEqual((await fetch(`${base}/pub/media/${old}`)).status, 404, 'hết hạn sau 24 giờ');
  } finally { await new Promise((r) => server.close(r)); }
});

test('ảnh PNG 3:4 → tự đổi sang JPG chất lượng cao, khung 4:5 (cắt phía dưới nhiều hơn), file gốc giữ nguyên; JPG đúng khung dùng nguyên', async () => {
  const db = load();
  const before = fs.readFileSync(path.join(mdir, 'c.png'));
  db.posts = [post({ id: 'png1', media: [{ type: 'image', name: 'c.png' }] })];
  await engine.runAgent('content', 'manual');
  assert.strictEqual(db.posts[0].status, 'published', db.posts[0].skipReason || db.posts[0].error);
  const url = posts()[0].body.image_url;
  const link = ig.verifyLink(url.split('/pub/media/')[1]);
  assert.ok(link && link.cached && /^[0-9a-f]{16}\.jpg$/.test(link.name), 'link trỏ tới bản JPG đã đổi');
  const out = require('../src/igimage').resolveCached('the_one', link.name);
  assert.strictEqual(probe(out), '600,750,yuvj444p', 'khung 4:5, không thu nhỏ, đủ màu 4:4:4');
  assert.ok(fs.readFileSync(path.join(mdir, 'c.png')).equals(before), 'file gốc không đổi');

  // Link công khai mở được bản đã đổi; tên lạ không đi ra ngoài thư mục
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const r = await fetch(url.replace(/^https:\/\/agent\.example\.vn/, base));
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers.get('content-type'), 'image/jpeg');
    const evil = ig.signedUrl('the_one', '../secrets.json', Date.now(), true).split('/pub/media/')[1];
    assert.strictEqual((await fetch(`${base}/pub/media/${evil}`)).status, 404);
  } finally { await new Promise((r) => server.close(r)); }

  // JPG 4:5 sẵn: không đổi, dùng link file gốc
  calls.length = 0;
  db.posts = [post({ id: 'jpg1' })];
  await engine.runAgent('content', 'manual');
  assert.strictEqual(ig.verifyLink(posts()[0].body.image_url.split('/pub/media/')[1]).cached, false);
});

test('vùng cắt khung: 3:4 → 4:5 giữ phần trên; quá ngang → cắt 2 bên; trong khoảng thì không cắt', () => {
  const { cropFor } = require('../src/igimage');
  assert.deepStrictEqual(cropFor(1792, 2400), { w: 1792, h: 2240, x: 0, y: 40 });
  assert.deepStrictEqual(cropFor(4000, 1000), { w: 1910, h: 1000, x: 1045, y: 0 });
  assert.strictEqual(cropFor(1080, 1350), null);
  assert.strictEqual(cropFor(1080, 1080), null);
});
