const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tt-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
process.env.MEDIA_DIR = path.join(tmp, 'media');
process.env.TIKTOK_CLIENT_KEY = 'ck_test_123';
process.env.TIKTOK_CLIENT_SECRET = 'cs_test_456';
process.env.PUBLIC_BASE_URL = 'https://agent.example.vn/';
process.env.APP_PASSWORD = 'mat-khau-test-tiktok';
delete process.env.META_ACCESS_TOKEN;
delete process.env.ANTHROPIC_API_KEY;

// ---- TikTok giả lập ----
const calls = [];
const S = { options: ['SELF_ONLY'], initError: null, putStatuses: [], statuses: ['PUBLISH_COMPLETE'], statusIdx: 0, failReason: null };
const realFetch = global.fetch;
const reply = (o, status = 200) => ({ status, ok: status < 400, json: async () => o });
global.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.hostname === '127.0.0.1') return realFetch(url, init); // máy chủ thử nội bộ
  const rec = { host: u.host, path: u.pathname, method: init.method || 'GET', headers: init.headers || {}, body: init.body };
  calls.push(rec);
  const json = () => (typeof init.body === 'string' ? JSON.parse(init.body) : null);
  const form = () => Object.fromEntries(new URLSearchParams(String(init.body)));
  if (u.host === 'open.tiktokapis.com') {
    if (u.pathname === '/v2/oauth/token/') {
      const f = form();
      if (f.grant_type === 'authorization_code') {
        if (f.code === 'GOOD') return reply({ access_token: 'ACCESS-SECRET-111', expires_in: 86400, refresh_token: 'REFRESH-SECRET-1', refresh_expires_in: 31536000, open_id: 'OPEN1', scope: 'user.info.basic,video.publish', token_type: 'Bearer' });
        if (f.code === 'GOOD2') return reply({ access_token: 'ACCESS-SECRET-333', expires_in: 86400, refresh_token: 'REFRESH-SECRET-3', refresh_expires_in: 31536000, open_id: 'OPEN3', scope: 'user.info.basic,video.publish', token_type: 'Bearer' });
        if (f.code === 'NOSCOPE') return reply({ access_token: 'A2', expires_in: 86400, refresh_token: 'R2', refresh_expires_in: 31536000, open_id: 'OPEN2', scope: 'user.info.basic' });
        return reply({ error: 'invalid_grant', error_description: 'Authorization code is expired' }, 400);
      }
      if (f.grant_type === 'refresh_token') {
        if (f.refresh_token === 'BADREFRESH') return reply({ error: 'invalid_grant', error_description: 'refresh token revoked' }, 400);
        return reply({ access_token: 'ACCESS-SECRET-222', expires_in: 86400, refresh_token: 'REFRESH-SECRET-ROTATED', refresh_expires_in: 31536000, open_id: 'OPEN1', scope: 'user.info.basic,video.publish' });
      }
    }
    if (u.pathname === '/v2/oauth/revoke/') return reply({});
    if (u.pathname === '/v2/post/publish/creator_info/query/') {
      return reply({ data: { creator_username: 'darkhair', creator_nickname: 'Dark Hair', privacy_level_options: S.options, comment_disabled: false, duet_disabled: true, stitch_disabled: true, max_video_post_duration_sec: 600 }, error: { code: 'ok' } });
    }
    if (u.pathname === '/v2/post/publish/video/init/') {
      if (S.initError) return reply({ error: { code: S.initError, message: 'x' } }, 403);
      if (S.failToken && JSON.stringify(init.headers).includes(S.failToken)) return reply({ error: { code: 'rate_limit_exceeded', message: 'x' } }, 429);
      return reply({ data: { publish_id: 'pub-1', upload_url: 'https://upload.tiktok.test/u1' }, error: { code: 'ok' } });
    }
    if (u.pathname === '/v2/post/publish/status/fetch/') {
      const st = S.statuses[Math.min(S.statusIdx++, S.statuses.length - 1)];
      return reply({ data: { status: st, fail_reason: st === 'FAILED' ? S.failReason : undefined }, error: { code: 'ok' } });
    }
  }
  if (u.host === 'upload.tiktok.test') return { status: S.putStatuses.shift() ?? 201, ok: true, json: async () => ({}) };
  return reply({ error: { code: 'invalid_param', message: `chưa giả lập ${rec.method} ${u.host}${u.pathname}` } }, 400);
};
const parse = (c) => JSON.parse(c.body);
test.after(() => { global.fetch = realFetch; fs.rmSync(tmp, { recursive: true, force: true }); });

const secrets = require('../src/secrets');
const tiktok = require('../src/connectors/tiktok');
const planner = require('../src/planner');
const engine = require('../src/engine');
const media = require('../src/media');
const { load } = require('../src/db');
const { server } = require('../src/server');

const dir = path.join(tmp, 'media', 'dark_hair');
const mkVideo = (name, bytes) => { fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, name); fs.writeFileSync(f, Buffer.alloc(bytes, 1)); return f; };
const reset = () => { calls.length = 0; S.options = ['SELF_ONLY']; S.initError = null; S.putStatuses = []; S.statuses = ['PUBLISH_COMPLETE']; S.statusIdx = 0; S.failToken = null; };

test('cấu hình: cần khóa ứng dụng và địa chỉ https; redirect bỏ dấu / thừa', () => {
  assert.strictEqual(tiktok.configured(), true);
  assert.strictEqual(tiktok.redirectUri(), 'https://agent.example.vn/auth/tiktok/callback');
  const old = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = 'http://agent.example.vn';
  assert.strictEqual(tiktok.configured(), false, 'http không đủ — TikTok bắt buộc https');
  process.env.PUBLIC_BASE_URL = old;
});

test('liên kết đăng nhập: đúng tham số; mã state dùng 1 lần và hết hạn sau 10 phút', () => {
  const st = tiktok.newState('dark_hair');
  const u = new URL(tiktok.authUrl(st));
  assert.strictEqual(u.origin + u.pathname, 'https://www.tiktok.com/v2/auth/authorize/');
  assert.strictEqual(u.searchParams.get('client_key'), 'ck_test_123');
  assert.strictEqual(u.searchParams.get('scope'), 'user.info.basic,video.publish');
  assert.strictEqual(u.searchParams.get('response_type'), 'code');
  assert.strictEqual(u.searchParams.get('redirect_uri'), 'https://agent.example.vn/auth/tiktok/callback');
  assert.strictEqual(u.searchParams.get('state'), st);
  assert.ok(!tiktok.authUrl(st).includes('cs_test_456'), 'không lộ client_secret');
  assert.strictEqual(tiktok.consumeState(st), 'dark_hair');
  assert.strictEqual(tiktok.consumeState(st), null, 'dùng lại thì không còn');
  const old = tiktok.newState('the_one');
  secrets.load().tiktok.states[old].exp = Date.now() - 1;
  assert.strictEqual(tiktok.consumeState(old), null, 'hết hạn');
  assert.strictEqual(tiktok.consumeState('khong-co'), null);
});

test('chia khúc tải lên đúng luật TikTok: ≤64MB 1 khúc; lớn hơn khúc 32MB, khúc cuối nhận phần dư; ≤4GB', () => {
  const MB = 1048576;
  assert.deepStrictEqual(tiktok.planChunks(3 * MB), { chunkSize: 3 * MB, total: 1 });
  assert.deepStrictEqual(tiktok.planChunks(64 * MB), { chunkSize: 64 * MB, total: 1 });
  assert.deepStrictEqual(tiktok.planChunks(70 * MB), { chunkSize: 32 * MB, total: 2 });
  for (const size of [64 * MB + 1, 100 * MB, 1000 * MB + 12345, 4 * 1024 * MB]) {
    const { chunkSize, total } = tiktok.planChunks(size);
    const last = size - (total - 1) * chunkSize;
    assert.ok(chunkSize >= 5 * MB && chunkSize <= 64 * MB, `khúc thường ${size}`);
    assert.ok(last >= chunkSize && last <= 128 * MB, `khúc cuối ${size}`);
    assert.ok(total >= 1 && total <= 1000);
  }
  assert.throws(() => tiktok.planChunks(4 * 1024 * MB + 1), /4GB/);
  assert.throws(() => tiktok.planChunks(0), /rỗng/);
});

test('kết nối: đổi mã lấy token, lưu riêng 1 thương hiệu, không lộ token ở bất kỳ trạng thái nào', async () => {
  reset();
  await assert.rejects(tiktok.connect('dark_hair', 'EXPIRED'), /đăng nhập thất bại/);
  await assert.rejects(tiktok.connect('dark_hair', 'NOSCOPE'), /chưa cấp quyền đăng video/);
  assert.strictEqual(tiktok.connected('dark_hair'), false);
  const acc = await tiktok.connect('dark_hair', 'GOOD');
  assert.deepStrictEqual({ connected: acc.connected, name: acc.name, username: acc.username }, { connected: true, name: 'Dark Hair', username: 'darkhair' });
  const tok = calls.find((c) => c.path === '/v2/oauth/token/');
  assert.match(String(tok.body), /redirect_uri=https%3A%2F%2Fagent\.example\.vn%2Fauth%2Ftiktok%2Fcallback/);
  const raw = fs.readFileSync(secrets.file(), 'utf8');
  assert.ok(raw.includes('ACCESS-SECRET-111') && raw.includes('REFRESH-SECRET-1'), 'token nằm trong kho bí mật');
  assert.ok(!fs.readFileSync(process.env.DB_FILE, 'utf8').includes('ACCESS-SECRET'), 'không nằm trong db.json (được sao lưu/xuất)');
  const routes = require('../src/tiktok-routes');
  const visible = JSON.stringify([routes.stateSlice(), tiktok.summary('dark_hair')]);
  assert.ok(!/SECRET|ACCESS-|REFRESH-/.test(visible), 'trạng thái gửi giao diện không có token');
  assert.strictEqual(routes.stateSlice().accounts.dark_hair.username, 'darkhair');
});

test('làm mới token khi sắp hết hạn; lưu refresh_token mới; thu hồi/lỗi thì yêu cầu kết nối lại', async () => {
  reset();
  assert.strictEqual(await tiktok.freshToken('dark_hair'), 'ACCESS-SECRET-111', 'còn hạn thì giữ nguyên, không gọi TikTok');
  assert.strictEqual(calls.length, 0);
  const acc = Object.values(secrets.load().tiktok.accounts.dark_hair)[0];
  acc.accessExpiresAt = Date.now() + 60e3; // còn < 5 phút
  assert.strictEqual(await tiktok.freshToken('dark_hair'), 'ACCESS-SECRET-222');
  assert.strictEqual(acc.refreshToken, 'REFRESH-SECRET-ROTATED', 'lưu refresh_token mới');
  assert.ok(acc.accessExpiresAt > Date.now() + 80000e3 / 1000);
  acc.accessExpiresAt = Date.now() - 1;
  acc.refreshToken = 'BADREFRESH';
  await assert.rejects(tiktok.freshToken('dark_hair'), /hết hạn hoặc bị thu hồi/);
  assert.strictEqual(acc.needsReauth, true);
  assert.strictEqual(tiktok.summary('dark_hair').needsReauth, true);
  acc.refreshToken = 'REFRESH-SECRET-ROTATED'; acc.accessExpiresAt = Date.now() + 86400e3; delete acc.needsReauth;
  acc.refreshExpiresAt = Date.now() - 1;
  acc.accessExpiresAt = Date.now() - 1;
  await assert.rejects(tiktok.freshToken('dark_hair'), /hết hạn/, 'refresh_token cũng hết hạn');
  acc.refreshExpiresAt = Date.now() + 86400e3; acc.accessExpiresAt = Date.now() + 86400e3; delete acc.needsReauth; acc.accessToken = 'ACCESS-SECRET-111';
  await assert.rejects(tiktok.freshToken('khong_co'), /hết hạn hoặc bị thu hồi/);
});

test('đăng video 1 khúc: gửi đúng thông tin; chế độ riêng tư; cờ duet/stitch theo tài khoản; chú thích ≤2200', async () => {
  reset();
  const f = mkVideo('a.mp4', 1234);
  const r = await tiktok.publishVideo('dark_hair', f, 'x'.repeat(3000), { privacy: 'PUBLIC_TO_EVERYONE', aigc: true, pollMs: 1 });
  assert.deepStrictEqual({ id: r.publishId, status: r.status, privacy: r.privacy }, { id: 'pub-1', status: 'PUBLISH_COMPLETE', privacy: 'SELF_ONLY' }, 'xin công khai nhưng tài khoản chỉ cho riêng tư → hạ về SELF_ONLY');
  const init = calls.find((c) => c.path === '/v2/post/publish/video/init/');
  const b = parse(init);
  assert.strictEqual(init.headers.Authorization, 'Bearer ACCESS-SECRET-111');
  assert.strictEqual(b.post_info.title.length, 2200);
  assert.deepStrictEqual({ p: b.post_info.privacy_level, c: b.post_info.disable_comment, d: b.post_info.disable_duet, s: b.post_info.disable_stitch, ai: b.post_info.is_aigc }, { p: 'SELF_ONLY', c: false, d: true, s: true, ai: true });
  assert.deepStrictEqual(b.source_info, { source: 'FILE_UPLOAD', video_size: 1234, chunk_size: 1234, total_chunk_count: 1 });
  const put = calls.find((c) => c.method === 'PUT');
  assert.strictEqual(put.headers['Content-Range'], 'bytes 0-1233/1234');
  assert.strictEqual(put.headers['Content-Type'], 'video/mp4');
});

test('chọn chế độ hiển thị: dùng đúng nếu được phép; không có SELF_ONLY thì lấy lựa chọn đầu; không có lựa chọn nào thì báo lỗi', async () => {
  const f = mkVideo('b.mp4', 500);
  reset(); S.options = ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'];
  assert.strictEqual((await tiktok.publishVideo('dark_hair', f, 't', { privacy: 'PUBLIC_TO_EVERYONE', pollMs: 1 })).privacy, 'PUBLIC_TO_EVERYONE');
  reset(); S.options = ['FOLLOWER_OF_CREATOR'];
  assert.strictEqual((await tiktok.publishVideo('dark_hair', f, 't', { privacy: 'SELF_ONLY', pollMs: 1 })).privacy, 'FOLLOWER_OF_CREATOR');
  reset(); S.options = [];
  await assert.rejects(tiktok.publishVideo('dark_hair', f, 't', { pollMs: 1 }), /không khớp/);
});

test('video > 64MB: nhiều khúc, Content-Range đúng, khúc giữa 206, khúc cuối 201', async () => {
  reset(); S.putStatuses = [206, 201];
  const size = 70 * 1048576;
  const f = mkVideo('lon.mp4', 0); fs.truncateSync(f, size);
  await tiktok.publishVideo('dark_hair', f, 'lớn', { pollMs: 1 });
  const puts = calls.filter((c) => c.method === 'PUT');
  assert.deepStrictEqual(puts.map((c) => c.headers['Content-Range']), [`bytes 0-33554431/${size}`, `bytes 33554432-${size - 1}/${size}`]);
  const b = parse(calls.find((c) => c.path === '/v2/post/publish/video/init/'));
  assert.deepStrictEqual([b.source_info.chunk_size, b.source_info.total_chunk_count], [33554432, 2]);
});

test('lỗi tải lên và xử lý: liên kết hết hạn, TikTok báo hỏng, đang xử lý lâu', async () => {
  const f = mkVideo('c.mp4', 800);
  reset(); S.putStatuses = [403];
  await assert.rejects(tiktok.publishVideo('dark_hair', f, 't', { pollMs: 1 }), /liên kết tải lên đã hết hạn/);
  reset(); S.statuses = ['PROCESSING_UPLOAD', 'FAILED']; S.failReason = 'duration_check_failed';
  await assert.rejects(tiktok.publishVideo('dark_hair', f, 't', { pollMs: 1 }), /thất bại \(duration_check_failed\)/);
  reset(); S.statuses = ['PROCESSING_UPLOAD', 'PROCESSING_UPLOAD', 'PUBLISH_COMPLETE'];
  assert.strictEqual((await tiktok.publishVideo('dark_hair', f, 't', { pollMs: 1 })).status, 'PUBLISH_COMPLETE', 'chờ tới khi xong');
  reset(); S.statuses = ['PROCESSING_UPLOAD'];
  const r = await tiktok.publishVideo('dark_hair', f, 't', { pollMs: 1, pollTries: 3 });
  assert.strictEqual(r.status, 'PROCESSING_UPLOAD', 'hết số lần chờ thì trả về "đang xử lý", không treo');
});

test('lỗi TikTok thành câu tiếng Việt; ứng dụng chưa audit được giải thích rõ', async () => {
  const f = mkVideo('d.mp4', 300);
  reset(); S.initError = 'unaudited_client_can_only_post_to_private_accounts';
  await assert.rejects(tiktok.publishVideo('dark_hair', f, 't', { pollMs: 1 }), (e) => /chưa qua kiểm duyệt/.test(e.message) && /riêng tư/i.test(e.message) && e.fatal === true);
  reset(); S.initError = 'spam_risk_too_many_posts';
  await assert.rejects(tiktok.publishVideo('dark_hair', f, 't', { pollMs: 1 }), /giới hạn số bài đăng/);
  reset(); S.initError = 'rate_limit_exceeded';
  await assert.rejects(tiktok.publishVideo('dark_hair', f, 't', { pollMs: 1 }), /giới hạn số lần gọi/);
});

test('agent đăng TikTok: chạy thử không đăng; chưa nối/không phải video thì giữ lịch và báo; đủ điều kiện thì đăng', async () => {
  const db = load();
  const social = require('../src/connectors/social');
  assert.strictEqual(social.CHANNELS.tiktok.live(), false, 'mặc định là gói đăng thủ công, chưa đăng bằng API');
  assert.strictEqual(social.CHANNELS.tiktok.manual, true);
  db.settings.tiktokMode = 'api';
  assert.strictEqual(social.CHANNELS.tiktok.live(), true);
  assert.strictEqual(social.CHANNELS.tiktok.manual, false);
  planner.updateBrand('dark_hair', { channels: { tiktok: { on: true } } });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'reel.mp4'), Buffer.alloc(900, 2));
  fs.writeFileSync(path.join(dir, 'anh.jpg'), Buffer.alloc(100, 3));
  const mk = (id, extra) => ({ id, channel: 'tiktok', brand: 'dark_hair', topic: 'T' + id, text: 'Chú thích', media: [{ name: 'reel.mp4', type: 'video' }], requireMedia: true, scheduledAt: new Date(Date.now() - 1000).toISOString(), status: 'scheduled', ...extra });
  reset();
  db.actions = [];
  db.settings.dryRun = true;
  db.posts = [mk('a')];
  await engine.runAgent('content', 'manual');
  assert.strictEqual(db.posts[0].status, 'scheduled', 'chạy thử không đăng');
  assert.strictEqual(calls.filter((c) => c.path.includes('video/init')).length, 0);

  db.settings.dryRun = false;
  db.posts = [mk('b', { media: [{ name: 'anh.jpg', type: 'image' }] }), mk('c', { brand: 'the_one' })];
  planner.updateBrand('the_one', { channels: { tiktok: { on: true } } });
  await engine.runAgent('content', 'manual');
  assert.match(db.posts[0].skipReason, /cần đúng 1 video/);
  assert.match(db.posts[1].skipReason, /chưa kết nối TikTok/);
  assert.deepStrictEqual(db.posts.map((p) => p.status), ['scheduled', 'scheduled']);

  reset();
  db.posts = [mk('d')];
  await engine.runAgent('content', 'manual');
  assert.strictEqual(db.posts[0].status, 'published');
  assert.strictEqual(db.posts[0].results.tt_OPEN1, 'pub-1');
  assert.ok(db.actions.some((a) => /Đã đăng bài "Td" lên TikTok \(.*chế độ SELF_ONLY\)/.test(a.text)), db.actions.map((a) => a.text).join(' | '));
});

test('kế hoạch TikTok chỉ lấy video; không duyệt được khi thiếu video; mỗi bài đúng 1 video', async () => {
  const month = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 7);
  const mkPlan = () => planner.create({ brand: 'dark_hair', channel: 'tiktok', type: 'post', time: '19:00', days: [1], month });
  fs.writeFileSync(path.join(dir, 'mot-video.mp4'), Buffer.alloc(50, 4));
  const pl = await mkPlan();
  assert.ok(pl.items.every((i) => i.media.length === 1 && i.media[0].type === 'video'), 'chỉ video, dù thư viện có cả ảnh');
  assert.throws(() => planner.editItem(pl.id, pl.items[0].id, { media: ['anh.jpg'] }), /đúng 1 video/);
  assert.throws(() => planner.editItem(pl.id, pl.items[0].id, { media: ['reel.mp4', 'mot-video.mp4'] }), /không trộn|đúng 1 video/);
  planner.editItem(pl.id, pl.items[0].id, { media: [] });
  assert.throws(() => planner.approve(pl.id), /TikTok chưa có video/);
  planner.editItem(pl.id, pl.items[0].id, { media: ['reel.mp4'] });
  assert.ok(planner.approve(pl.id) > 0);
  assert.ok(load().posts.find((p) => p.planId === pl.id).requireMedia);
});

test('ngắt kết nối: thu hồi ở TikTok và xóa token khỏi máy chủ', async () => {
  reset();
  assert.strictEqual(await tiktok.disconnect('dark_hair'), true);
  const rev = calls.find((c) => c.path === '/v2/oauth/revoke/');
  assert.ok(rev && /token=/.test(String(rev.body)));
  assert.strictEqual(tiktok.connected('dark_hair'), false);
  assert.ok(!fs.readFileSync(secrets.file(), 'utf8').includes('SECRET'), 'không còn token trong kho');
  assert.strictEqual(await tiktok.disconnect('dark_hair'), false);
});

test('kiểm tra kết nối TikTok: báo địa chỉ callback, chế độ riêng tư, lỗi token', async () => {
  reset();
  await tiktok.connect('dark_hair', 'GOOD');
  const out = await tiktok.checks({ dark_hair: 'Dark Hair' });
  assert.ok(out.find((c) => /địa chỉ nhận đăng nhập/.test(c.name)).detail.includes('https://agent.example.vn/auth/tiktok/callback'));
  const row = out.find((c) => /Dark Hair — TikTok/.test(c.name));
  assert.ok(row.ok && row.warn && /@darkhair/.test(row.detail) && /riêng tư/.test(row.detail));
  S.options = ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'];
  assert.strictEqual((await tiktok.checks({ dark_hair: 'Dark Hair' })).find((c) => /Dark Hair — TikTok/.test(c.name)).warn, false);
  assert.ok(!JSON.stringify(out).includes('SECRET'));
});

test('máy chủ: /privacy và /terms công khai; đăng nhập TikTok cần đăng nhập app; state chống giả mạo', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = { authorization: 'Basic ' + Buffer.from('a:mat-khau-test-tiktok').toString('base64') };
  const get = (p, h = {}) => realFetch(base + p, { headers: h, redirect: 'manual' });
  try {
    for (const p of ['/privacy', '/terms']) {
      const r = await get(p);
      assert.strictEqual(r.status, 200, p);
      assert.match(r.headers.get('content-type'), /text\/html/);
      assert.match(await r.text(), /Privacy Policy|Terms of Service/);
    }
    assert.strictEqual((await get('/auth/tiktok/start?brand=dark_hair')).status, 401, 'chưa đăng nhập app');
    assert.strictEqual((await get('/auth/tiktok/start?brand=khong_co', auth)).status, 400);
    const start = await get('/auth/tiktok/start?brand=dark_hair', auth);
    assert.strictEqual(start.status, 302);
    const loc = new URL(start.headers.get('location'));
    assert.strictEqual(loc.host, 'www.tiktok.com');
    const state = loc.searchParams.get('state');
    assert.strictEqual((await get('/auth/tiktok/callback?code=GOOD&state=gia-mao', auth)).status, 400, 'state sai bị từ chối');
    assert.strictEqual((await get(`/auth/tiktok/callback?error=access_denied&error_description=Nguoi+dung+tu+choi&state=${state}`, auth)).status, 400);
    const ok = await get(`/auth/tiktok/callback?code=GOOD&state=${state}`, auth);
    assert.strictEqual(ok.status, 302);
    assert.strictEqual(ok.headers.get('location'), '/#thuonghieu');
    assert.strictEqual((await get(`/auth/tiktok/callback?code=GOOD&state=${state}`, auth)).status, 400, 'state chỉ dùng 1 lần');

    const st = await (await get('/api/state', auth)).text();
    assert.ok(!/ACCESS-SECRET|REFRESH-SECRET|cs_test_456/.test(st), 'API trạng thái không lộ token/khóa');
    assert.strictEqual(JSON.parse(st).tiktok.accounts.dark_hair.connected, true);
    const exp = await (await get('/api/export', auth)).text();
    assert.ok(!/ACCESS-SECRET|REFRESH-SECRET/.test(exp), 'bản sao lưu không chứa token');

    const post = (u, b) => realFetch(base + u, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(b) });
    assert.strictEqual((await post('/api/settings', { tiktokPrivacy: 'HACK' })).status, 400);
    assert.strictEqual((await (await post('/api/settings', { tiktokPrivacy: 'PUBLIC_TO_EVERYONE', tiktokAigc: true })).json()).settings.tiktokPrivacy, 'PUBLIC_TO_EVERYONE');
    const dis = await (await post('/api/tiktok/disconnect', { brand: 'dark_hair' })).json();
    assert.strictEqual(dis.tiktok.accounts.dark_hair.connected, false);
    assert.strictEqual((await post('/api/tiktok/disconnect', { brand: 'khong_co' })).status, 400);
  } finally { server.close(); }
});

test('nhiều tài khoản TikTok/thương hiệu: đăng lên tất cả, nick lỗi chỉ thử lại nick đó; 1 nick không gắn 2 thương hiệu; ngắt từng nick', async () => {
  reset();
  const db = load();
  db.settings.tiktokMode = 'api';
  db.settings.dryRun = false;
  planner.updateBrand('dark_hair', { channels: { tiktok: { on: true } } });
  await tiktok.connect('dark_hair', 'GOOD');
  await tiktok.connect('dark_hair', 'GOOD2');
  await tiktok.connect('dark_hair', 'GOOD'); // đăng nhập lại cùng nick: không thêm dòng mới
  assert.deepStrictEqual(tiktok.accounts('dark_hair').map((a) => a.openId), ['OPEN1', 'OPEN3'], 'nick chính trước');
  assert.strictEqual(tiktok.summary('dark_hair').accounts.length, 2);
  await assert.rejects(tiktok.connect('the_one', 'GOOD2'), /thương hiệu khác/);

  fs.writeFileSync(path.join(dir, 'reel.mp4'), Buffer.alloc(900, 2));
  const mk = (id) => ({ id, channel: 'tiktok', brand: 'dark_hair', topic: 'T' + id, text: 'Chú thích', media: [{ name: 'reel.mp4', type: 'video' }], requireMedia: true, scheduledAt: new Date(Date.now() - 1000).toISOString(), status: 'scheduled' });
  S.failToken = 'ACCESS-SECRET-333';
  db.posts = [mk('m')];
  await engine.runAgent('content', 'manual');
  const p = db.posts[0];
  assert.strictEqual(p.status, 'scheduled', 'còn 1 nick chưa đăng được');
  assert.deepStrictEqual(Object.keys(p.results), ['tt_OPEN1']);
  S.failToken = null;
  calls.length = 0;
  await engine.runAgent('content', 'manual');
  assert.strictEqual(p.status, 'published');
  assert.deepStrictEqual(Object.keys(p.results).sort(), ['tt_OPEN1', 'tt_OPEN3']);
  const inits = calls.filter((c) => c.path.includes('video/init'));
  assert.strictEqual(inits.length, 1, 'nick đã đăng không đăng lại');
  assert.ok(JSON.stringify(inits[0].headers).includes('ACCESS-SECRET-333'));

  const rows = require('../src/channels-api').list().rows.filter((r) => r.brand === 'dark_hair' && r.channel === 'tiktok');
  assert.deepStrictEqual(rows.map((r) => r.externalId), ['OPEN1', 'OPEN3']);
  assert.ok(rows[0].actions.includes('connect') && !rows[1].actions.includes('connect'), 'nút thêm nick ở dòng đầu');

  assert.strictEqual(await tiktok.disconnect('dark_hair', 'OPEN3'), true);
  assert.deepStrictEqual(tiktok.accounts('dark_hair').map((a) => a.openId), ['OPEN1']);
  await tiktok.disconnect('dark_hair');
  assert.strictEqual(tiktok.connected('dark_hair'), false);
});

test('dữ liệu cũ (1 tài khoản/thương hiệu) tự chuyển sang dạng nhiều tài khoản', () => {
  const f = secrets.file();
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  raw.tiktok.accounts = { dark_hair: { openId: 'OLD1', accessToken: 'ACCESS-SECRET-OLD', refreshToken: 'R', accessExpiresAt: Date.now() + 864e5, refreshExpiresAt: Date.now() + 864e5, username: 'cu', connectedAt: '2026-01-01T00:00:00Z' } };
  fs.writeFileSync(f, JSON.stringify(raw));
  secrets.reset();
  assert.deepStrictEqual(tiktok.accounts('dark_hair').map((a) => [a.openId, a.username]), [['OLD1', 'cu']]);
  assert.strictEqual(tiktok.summary('dark_hair').username, 'cu');
});

test('chế độ API + mỗi nick video riêng: bài gắn nick chỉ đăng lên đúng tài khoản đó; nick chưa kết nối thì giữ lịch và báo', async () => {
  reset();
  const db = load();
  db.settings.tiktokMode = 'api';
  db.settings.dryRun = false;
  planner.updateBrand('dark_hair', { channels: { tiktok: { on: true } } });
  await tiktok.disconnect('dark_hair'); // bỏ tài khoản còn lại từ test trước
  await tiktok.connect('dark_hair', 'GOOD');
  await tiktok.connect('dark_hair', 'GOOD2');
  const accs = secrets.load().tiktok.accounts.dark_hair;
  accs.OPEN1.username = 'dh.one'; accs.OPEN3.username = 'dh.two';
  assert.deepStrictEqual(require('../src/tiktok-manual').nicksOf('dark_hair'), ['@dh.one', '@dh.two'], 'nick = tài khoản đã kết nối');
  fs.writeFileSync(path.join(dir, 'reel.mp4'), Buffer.alloc(900, 2));
  const mk = (id, nick) => ({ id, channel: 'tiktok', brand: 'dark_hair', topic: 'T' + id, text: 'x', media: [{ name: 'reel.mp4', type: 'video' }], requireMedia: true, scheduledAt: new Date(Date.now() - 1000).toISOString(), status: 'scheduled', tiktokNick: nick });
  db.posts = [mk('n2', '@dh.two'), mk('n9', '@dh.chuaco')];
  calls.length = 0;
  await engine.runAgent('content', 'manual');
  assert.strictEqual(db.posts[0].status, 'published');
  assert.deepStrictEqual(Object.keys(db.posts[0].results), ['tt_OPEN3']);
  const inits = calls.filter((c) => c.path.includes('video/init'));
  assert.strictEqual(inits.length, 1);
  assert.ok(JSON.stringify(inits[0].headers).includes('ACCESS-SECRET-333'));
  assert.strictEqual(db.posts[1].status, 'scheduled');
  assert.match(db.posts[1].skipReason, /@dh\.chuaco chưa được kết nối/);
  await tiktok.disconnect('dark_hair');
});
