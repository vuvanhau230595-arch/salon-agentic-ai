const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-ttm-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
process.env.MEDIA_DIR = path.join(tmp, 'media');
process.env.APP_PASSWORD = 'mat-khau-test-ttm';
delete process.env.TIKTOK_CLIENT_KEY;
delete process.env.TIKTOK_CLIENT_SECRET;
delete process.env.PUBLIC_BASE_URL;
delete process.env.META_ACCESS_TOKEN;
delete process.env.ANTHROPIC_API_KEY;

let calls = 0;
const realFetch = global.fetch;
global.fetch = async (url, init) => { if (new URL(String(url)).hostname === '127.0.0.1') return realFetch(url, init); calls++; throw new Error('Không được gọi mạng ngoài ở chế độ gói đăng'); };
test.after(() => { global.fetch = realFetch; fs.rmSync(tmp, { recursive: true, force: true }); });

const social = require('../src/connectors/social');
const planner = require('../src/planner');
const engine = require('../src/engine');
const tm = require('../src/tiktok-manual');
const { load } = require('../src/db');
const { server } = require('../src/server');

const dir = path.join(tmp, 'media', 'dark_hair');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'balayage-doc.mp4'), Buffer.alloc(2048, 1));
const month = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 7);
const due = (extra = {}) => ({ id: 'tt' + Math.random().toString(36).slice(2, 6), channel: 'tiktok', brand: 'dark_hair', topic: 'Balayage', text: 'Móc câu tò mò 👀\nNhuộm balayage tại Dark Hair.\n\n#darkhair #balayage #nhuomtoc', media: [{ name: 'balayage-doc.mp4', type: 'video' }], requireMedia: true, scheduledAt: new Date(Date.now() - 1000).toISOString(), status: 'scheduled', ...extra });

test('mặc định TikTok là gói đăng thủ công: kênh không "live", dù đã có khóa ứng dụng', () => {
  assert.strictEqual(social.CHANNELS.tiktok.manual, true);
  assert.strictEqual(social.CHANNELS.tiktok.live(), false);
  process.env.TIKTOK_CLIENT_KEY = 'k'; process.env.TIKTOK_CLIENT_SECRET = 's'; process.env.PUBLIC_BASE_URL = 'https://x.vn';
  assert.strictEqual(social.CHANNELS.tiktok.live(), false, 'có khóa nhưng chưa chọn chế độ api thì vẫn thủ công');
  delete process.env.TIKTOK_CLIENT_KEY; delete process.env.TIKTOK_CLIENT_SECRET; delete process.env.PUBLIC_BASE_URL;
});

test('đến giờ: bài TikTok chuyển sang "chờ đăng tay", kể cả khi đang Chạy thử; không gọi mạng ngoài', async () => {
  const db = load();
  db.actions = [];
  db.settings.dryRun = true;
  db.posts = [due({ id: 'a' })];
  await engine.runAgent('content', 'manual');
  assert.strictEqual(db.posts[0].status, 'awaiting_manual');
  assert.ok(db.actions.some((a) => /Đến giờ đăng TikTok "Balayage"/.test(a.text)));
  assert.strictEqual(calls, 0);
});

test('gói đăng: chú thích + hashtag tách riêng, giờ Việt Nam, link tải video, các bước đúng chế độ', () => {
  planner.updateBrand('dark_hair', { channels: { tiktok: { on: true, handle: '@darkhair.vn' } } });
  const post = due({ id: 'b', scheduledAt: '2026-11-02T12:00:00.000Z' });
  const k = tm.buildPackage(post);
  assert.strictEqual(k.kind, 'tiktok');
  assert.strictEqual(k.handle, '@darkhair.vn');
  assert.strictEqual(k.scheduledVietnam, '2026-11-02 19:00');
  assert.deepStrictEqual(k.hashtags, ['#darkhair', '#balayage', '#nhuomtoc']);
  assert.ok(!k.body.includes('#darkhair'));
  assert.strictEqual(k.caption, post.text);
  assert.strictEqual(k.captionLength, post.text.length);
  assert.strictEqual(k.media[0].downloadUrl, '/api/media/file?brand=dark_hair&name=balayage-doc.mp4');
  assert.strictEqual(k.media[0].size, 2048);
  assert.ok(k.studioUrl.startsWith('https://www.tiktok.com/tiktokstudio'));
  assert.ok(k.steps.some((s) => /@darkhair\.vn/.test(s)) && k.steps.some((s) => /2026-11-02 19:00/.test(s)));
  assert.deepStrictEqual(k.checks.filter((c) => c.level === 'block'), []);
  assert.throws(() => tm.buildPackage({ ...post, channel: 'facebook_page' }), /Chỉ tạo gói đăng TikTok/);
});

test('kiểm tra gói đăng: chặn khi thiếu video/file/ảnh/chú thích quá dài; nhắc nhãn AI', () => {
  const lvl = (post) => tm.buildPackage(post).checks.map((c) => `${c.level}:${c.msg.slice(0, 40)}`);
  assert.ok(lvl(due({ media: [] })).some((x) => x.startsWith('block:Bài chưa gắn video')));
  assert.ok(lvl(due({ media: [{ name: 'khong-co.mp4', type: 'video' }] })).some((x) => x.startsWith('block:Không thấy file')));
  assert.ok(lvl(due({ media: [{ name: 'anh.jpg', type: 'image' }] })).some((x) => x.startsWith('block:TikTok chỉ nhận video')));
  assert.ok(lvl(due({ text: 'x'.repeat(2201) })).some((x) => x.startsWith('block:Chú thích dài 2201')));
  const db = load();
  db.settings.tiktokAigc = true;
  assert.ok(lvl(due()).some((x) => x.startsWith('info:Video làm bằng AI')));
  db.settings.tiktokAigc = false;
});

test('đánh dấu: đã hẹn giờ → đã đăng (kèm link) → hoàn tác; chặn trạng thái sai, link độc hại, bài kênh khác', () => {
  const db = load();
  db.actions = [];
  db.posts = [due({ id: 'c', status: 'awaiting_manual' }), due({ id: 'd', status: 'draft' }), due({ id: 'e', channel: 'facebook_page' })];
  assert.strictEqual(tm.markPost('c', 'external_scheduled').status, 'external_scheduled');
  assert.throws(() => tm.markPost('c', 'published', 'javascript:alert(1)'), /http/);
  assert.strictEqual(db.posts.find((x) => x.id === 'c').status, 'external_scheduled', 'link sai thì trạng thái KHÔNG đổi');
  const p = tm.markPost('c', 'published', ' https://www.tiktok.com/@darkhair/video/123 ');
  assert.deepStrictEqual({ s: p.status, u: p.url, m: p.manual, l: p.live }, { s: 'published', u: 'https://www.tiktok.com/@darkhair/video/123', m: true, l: false });
  assert.ok(p.publishedAt);
  assert.throws(() => tm.markPost('c', 'published'), /đã đăng rồi/);
  assert.strictEqual(tm.markPost('c', 'reset').status, 'scheduled');
  assert.strictEqual(p.url, undefined);
  assert.throws(() => tm.markPost('d', 'published'), /chưa được duyệt/);
  assert.throws(() => tm.markPost('e', 'published'), /Chỉ dùng cho bài TikTok/);
  assert.throws(() => tm.markPost('khong-co', 'published'), /Không tìm thấy/);
  assert.throws(() => tm.markPost('c', 'xoa'), /không hợp lệ/);
  assert.ok(db.actions.some((a) => /TikTok "Balayage": đã hẹn giờ trên TikTok/.test(a.text)) && db.actions.some((a) => /ĐÃ ĐĂNG/.test(a.text)));
});

test('kế hoạch TikTok ở chế độ thủ công vẫn gắn đúng 1 video và có chú thích; duyệt xong đến giờ thì chờ đăng tay', async () => {
  const pl = await planner.create({ brand: 'dark_hair', channel: 'tiktok', type: 'post', time: '19:00', days: [1], month });
  assert.ok(pl.items.length > 0 && pl.items.every((i) => i.media.length === 1 && i.media[0].type === 'video' && i.text.length > 10));
  assert.ok(planner.approve(pl.id) > 0);
  const db = load();
  const post = db.posts.find((x) => x.planId === pl.id);
  assert.strictEqual(post.channel, 'tiktok');
  post.scheduledAt = new Date(Date.now() - 1000).toISOString();
  await engine.runAgent('content', 'manual');
  assert.strictEqual(post.status, 'awaiting_manual');
  assert.strictEqual(calls, 0);
});

test('máy chủ: gói đăng và đánh dấu qua API; cài đặt chế độ; trạng thái báo manual; kênh khác vẫn đi đường cũ', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = { authorization: 'Basic ' + Buffer.from('a:mat-khau-test-ttm').toString('base64') };
  const get = (u) => realFetch(base + u, { headers: auth });
  const post = (u, b) => realFetch(base + u, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(b) });
  try {
    const db = load();
    db.posts = [due({ id: 'srv1', status: 'awaiting_manual' }), { ...due({ id: 'srv2' }), channel: 'facebook_page' }];
    const st = await (await get('/api/state')).json();
    assert.strictEqual(st.tiktok.mode, 'manual');
    assert.strictEqual(st.channels.find((c) => c.id === 'tiktok').manual, true);

    const pk = await get('/api/posts/srv1/package');
    assert.strictEqual(pk.status, 200);
    const k = await pk.json();
    assert.strictEqual(k.kind, 'tiktok');
    assert.strictEqual(k.scheduledVietnam.length, 16);
    assert.strictEqual((await get('/api/posts/khong-co/package')).status, 404);
    assert.strictEqual((await get('/api/posts/srv2/package')).status, 400, 'bài Facebook không có gói đăng');

    const m1 = await post('/api/posts/srv1/manual', { action: 'published', url: 'https://www.tiktok.com/@x/video/1' });
    assert.strictEqual(m1.status, 200);
    assert.strictEqual(db.posts.find((x) => x.id === 'srv1').status, 'published');
    assert.strictEqual((await post('/api/posts/srv1/manual', { action: 'published' })).status, 400);
    assert.strictEqual((await post('/api/posts/srv1/manual', { action: 'reset' })).status, 200);

    assert.strictEqual((await post('/api/settings', { tiktokMode: 'hack' })).status, 400);
    const s2 = await (await post('/api/settings', { tiktokMode: 'api' })).json();
    assert.strictEqual(s2.tiktok.mode, 'api');
    assert.strictEqual(s2.channels.find((c) => c.id === 'tiktok').manual, false);
    await post('/api/settings', { tiktokMode: 'manual' });
  } finally { server.close(); }
});

test('nhiều nick: đọc danh sách nick; gói đăng có trạng thái từng nick; bài chỉ xong khi mọi nick xong', () => {
  planner.updateBrand('dark_hair', { channels: { tiktok: { on: true, handle: 'darkhair.vn, @darkhair.hcm\nhttps://www.tiktok.com/@darkhair.q3?lang=vi, @darkhair.vn' } } });
  assert.deepStrictEqual(tm.nicksOf('dark_hair'), ['@darkhair.vn', '@darkhair.hcm', '@darkhair.q3'], 'thêm @, bỏ link, bỏ trùng');
  const db = load();
  const p = due({ id: 'nick1', scheduledAt: new Date(Date.now() + 864e5).toISOString() });
  db.posts = [p];
  assert.deepStrictEqual(tm.buildPackage(p).nicks.map((n) => n.status), ['pending', 'pending', 'pending']);
  assert.throws(() => tm.markPost('nick1', 'external_scheduled'), /chọn nick/);
  assert.throws(() => tm.markPost('nick1', 'external_scheduled', '', '@la'), /không có trong danh sách/);
  tm.markPost('nick1', 'external_scheduled', '', '@darkhair.vn');
  tm.markPost('nick1', 'published', 'https://www.tiktok.com/@darkhair.hcm/video/1', '@darkhair.hcm');
  assert.strictEqual(p.status, 'scheduled', 'còn 1 nick chưa xong');
  tm.markPost('nick1', 'external_scheduled', '', '@darkhair.q3');
  assert.strictEqual(p.status, 'external_scheduled', 'mọi nick đã hẹn/đăng');
  assert.deepStrictEqual(tm.buildPackage(p).nicks.map((n) => n.status), ['external_scheduled', 'published', 'external_scheduled']);
  tm.markPost('nick1', 'reset', '', '@darkhair.q3');
  assert.strictEqual(p.status, 'scheduled', 'bỏ đánh dấu 1 nick thì bài chưa xong');
  for (const n of ['@darkhair.vn', '@darkhair.q3']) tm.markPost('nick1', 'published', '', n);
  assert.strictEqual(p.status, 'published');
});

test('lên lịch 10 ngày tới: gom theo nick, bỏ bài nick đó đã hẹn, bỏ bài quá 10 ngày, có bài quá giờ', () => {
  const db = load();
  const day = 864e5;
  db.posts = [
    due({ id: 'b1', scheduledAt: new Date(Date.now() + 2 * day).toISOString() }),
    due({ id: 'b2', scheduledAt: new Date(Date.now() - 3600e3).toISOString(), status: 'awaiting_manual' }),
    due({ id: 'b3', scheduledAt: new Date(Date.now() + 15 * day).toISOString() }),
    due({ id: 'b4', scheduledAt: new Date(Date.now() + 3 * day).toISOString(), status: 'draft' }),
  ];
  tm.markPost('b1', 'external_scheduled', '', '@darkhair.vn');
  const r = tm.batch('dark_hair');
  const by = Object.fromEntries(r.groups.map((g) => [g.nick, g.items.map((i) => i.postId)]));
  assert.deepStrictEqual(by, { '@darkhair.vn': ['b2'], '@darkhair.hcm': ['b2', 'b1'], '@darkhair.q3': ['b2', 'b1'] });
  assert.strictEqual(r.groups[1].items[0].overdue, true);
  assert.match(r.groups[1].items[1].media[0].downloadUrl, /^\/api\/media\/file\?brand=dark_hair&name=balayage-doc\.mp4$/);
  assert.strictEqual(r.total, 5);
  planner.updateBrand('dark_hair', { channels: { tiktok: { handle: '' } } });
  assert.deepStrictEqual(tm.batch('dark_hair').groups.map((g) => [g.nick, g.items.length]), [['', 2]], 'chưa ghi nick: 1 nhóm chung');
});

test('mỗi nick video riêng: kế hoạch chia bài cho từng nick, video không trùng, thiếu video thì để trống chứ không lặp', async () => {
  const db = load();
  db.posts = []; db.plans = [];
  planner.updateBrand('dark_hair', { channels: { tiktok: { on: true, handle: '@dh.one, @dh.two' } } });
  for (const n of ['v1.mp4', 'v2.mp4', 'v3.mp4']) fs.writeFileSync(path.join(dir, n), Buffer.alloc(100, 7));
  const pl = await planner.create({ brand: 'dark_hair', channel: 'tiktok', type: 'post', time: '19:00', days: [1], month });
  const byDay = {};
  for (const it of pl.items) (byDay[it.at] = byDay[it.at] || []).push(it.nick);
  assert.ok(Object.values(byDay).every((n) => n.length === 2 && n.includes('@dh.one') && n.includes('@dh.two')), 'mỗi ngày mỗi nick 1 bài');
  const vids = pl.items.flatMap((it) => it.media.map((m) => m.name));
  assert.strictEqual(new Set(vids).size, vids.length, 'không video nào dùng 2 lần');
  assert.ok(pl.items.some((it) => !it.media.length), 'hết video mới thì để trống');
  assert.ok(db.actions.some((a) => /thiếu \d+ video mới/.test(a.text)));
  // Gắn video tay cho các bài trống rồi bỏ chọn bớt để duyệt được
  pl.items.forEach((it) => { if (!it.media.length) it.selected = false; });
  assert.ok(planner.approve(pl.id) > 0);
  const posts = db.posts.filter((p) => p.planId === pl.id);
  assert.ok(posts.every((p) => ['@dh.one', '@dh.two'].includes(p.tiktokNick)));

  // Gói đăng / đánh dấu / lên lịch chỉ theo nick của bài
  const p = posts[0];
  assert.deepStrictEqual(tm.buildPackage(p).nicks.map((n) => n.nick), [p.tiktokNick]);
  const other = p.tiktokNick === '@dh.one' ? '@dh.two' : '@dh.one';
  assert.throws(() => tm.markPost(p.id, 'external_scheduled', '', other), /dành cho nick/);
  tm.markPost(p.id, 'external_scheduled');
  assert.strictEqual(p.status, 'external_scheduled', 'bài 1 nick: xong khi nick đó xong');
  p.scheduledAt = new Date(Date.now() + 864e5).toISOString();
  const b = tm.batch('dark_hair', Date.now() - 365 * 864e5 * 0);
  for (const g of b.groups) assert.ok(g.items.every((i) => { const q = db.posts.find((x) => x.id === i.postId); return !q.tiktokNick || q.tiktokNick === g.nick; }), 'nhóm nick chỉ chứa bài của nick đó');

  // Kế hoạch thứ 2 không lấy lại video đã dùng
  const pl2 = await planner.create({ brand: 'dark_hair', channel: 'tiktok', type: 'post', time: '20:00', days: [3], month });
  const used = new Set(vids);
  assert.ok(pl2.items.every((it) => it.media.every((m) => !used.has(m.name))));
});
