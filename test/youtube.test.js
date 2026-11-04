const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-yt-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
process.env.MEDIA_DIR = path.join(tmp, 'media');
process.env.SECRETS_FILE = path.join(tmp, 'secrets.json');
process.env.PUBLIC_BASE_URL = 'https://agent.example.vn/';
process.env.APP_PASSWORD = 'mat-khau-test-youtube';
delete process.env.YOUTUBE_CLIENT_ID;
delete process.env.YOUTUBE_CLIENT_SECRET;
delete process.env.META_ACCESS_TOKEN;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;

const CID = '123456-abc.apps.googleusercontent.com';
const CSECRET = 'GOCSPX-test-secret-999';

// ---- Google giả lập ----
const calls = [];
const S = {};
const resetS = () => Object.assign(S, { initError: null, putStatuses: [], rangeAfter: null, channels: [{ id: 'UC_THEONE', snippet: { title: 'THE ONE HAIR SALON', customUrl: '@theonehairsalon' } }], refreshError: null, videoPrivacy: null });
resetS();
const realFetch = global.fetch;
const reply = (o, status = 200, headers = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => o, headers: { get: (k) => headers[String(k).toLowerCase()] ?? null } });
const gErr = (status, reason, extra = {}) => reply({ error: { code: status, message: `msg ${reason}`, errors: [{ reason, domain: 'youtube' }], ...extra } }, status);
global.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.hostname === '127.0.0.1') return realFetch(url, init); // máy chủ thử nội bộ
  const rec = { host: u.host, path: u.pathname, search: u.search, method: init.method || 'GET', headers: init.headers || {}, body: init.body };
  calls.push(rec);
  const form = () => Object.fromEntries(new URLSearchParams(String(init.body)));
  if (u.host === 'oauth2.googleapis.com') {
    if (u.pathname === '/revoke') return reply({});
    const f = form();
    if (f.client_id !== CID || f.client_secret !== CSECRET) return reply({ error: 'invalid_client', error_description: 'The OAuth client was not found.' }, 401);
    if (f.grant_type === 'authorization_code') {
      if (f.code === 'GOOD') return reply({ access_token: 'YA29-ACCESS-SECRET-1', expires_in: 3599, refresh_token: '1//REFRESH-SECRET-1', scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly', token_type: 'Bearer' });
      if (f.code === 'NOUPLOAD') return reply({ access_token: 'A2', expires_in: 3599, refresh_token: 'R2', scope: 'https://www.googleapis.com/auth/youtube.readonly' });
      if (f.code === 'NOREFRESH') return reply({ access_token: 'A3', expires_in: 3599, scope: 'https://www.googleapis.com/auth/youtube.upload' });
      return reply({ error: 'invalid_grant', error_description: 'Bad Request' }, 400);
    }
    if (f.grant_type === 'refresh_token') {
      if (S.refreshError) return reply({ error: S.refreshError, error_description: 'Token has been expired or revoked.' }, 400);
      return reply({ access_token: 'YA29-ACCESS-SECRET-2', expires_in: 3599, scope: 'x', token_type: 'Bearer' });
    }
  }
  if (u.host === 'www.googleapis.com') {
    if (u.pathname === '/youtube/v3/channels') return reply({ items: S.channels });
    if (u.pathname === '/upload/youtube/v3/videos') {
      if (S.initError) return S.initError();
      return reply({}, 200, { location: 'https://upload.youtube.test/session-1' });
    }
  }
  if (u.host === 'upload.youtube.test') {
    // Hỏi tiến độ: PUT rỗng + Content-Range bytes */size
    if (/^bytes \*\//.test(String(rec.headers['Content-Range'] || ''))) return reply({}, 308, S.rangeAfter == null ? {} : { range: `bytes=0-${S.rangeAfter}` });
    const st = S.putStatuses.length ? S.putStatuses.shift() : 200;
    if (st === 'neterr') throw new TypeError('fetch failed');
    if (st !== 200) return reply({}, st);
    const priv = S.videoPrivacy || 'public';
    return reply({ id: 'vid123', status: { uploadStatus: 'uploaded', privacyStatus: priv } });
  }
  return reply({ error: { code: 400, message: `chưa giả lập ${rec.method} ${u.host}${u.pathname}` } }, 400);
};
test.after(() => { global.fetch = realFetch; fs.rmSync(tmp, { recursive: true, force: true }); });

const secrets = require('../src/secrets');
const youtube = require('../src/connectors/youtube');
const social = require('../src/connectors/social');
const planner = require('../src/planner');
const engine = require('../src/engine');
const { load } = require('../src/db');
const { server } = require('../src/server');

const dir = path.join(tmp, 'media', 'the_one');
const mkFile = (name, bytes) => { fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, name); fs.writeFileSync(f, Buffer.alloc(bytes, 1)); return f; };
const reset = () => { calls.length = 0; resetS(); };
const initCall = () => calls.find((c) => c.path === '/upload/youtube/v3/videos');
const puts = () => calls.filter((c) => c.host === 'upload.youtube.test');

test('tiêu đề: dòng đầu chú thích, bỏ emoji + hashtag, thêm #Shorts khi còn chỗ, tối đa 100 ký tự', () => {
  assert.strictEqual(youtube.buildTitle('✨ Nhuộm nâu tây 🍂 cho nàng công sở #nhuomtoc #theone\nĐặt lịch: 0909'), 'Nhuộm nâu tây cho nàng công sở #Shorts');
  assert.strictEqual(youtube.buildTitle('#toc #salon\n\n💇‍♀️ Uốn sóng nước <đẹp> 👩🏻'), 'Uốn sóng nước đẹp #Shorts', 'dòng chỉ có hashtag/emoji thì lấy dòng có chữ kế tiếp; bỏ dấu < >');
  assert.strictEqual(youtube.buildTitle('', 'The One'), 'The One #Shorts');
  const exact92 = 'a'.repeat(92);
  assert.strictEqual(youtube.buildTitle(exact92), exact92 + ' #Shorts');
  assert.strictEqual(youtube.buildTitle(exact92 + 'b').length, 93, 'không đủ chỗ thì không thêm #Shorts');
  const long = youtube.buildTitle('Tóc '.repeat(40) + 'hết');
  assert.ok([...long].length <= 100 && !long.includes('#Shorts') && !long.endsWith(' '), long);
  for (const t of ['x'.repeat(300), '🍂'.repeat(200) + 'y'.repeat(150), 'Một dòng #a #b #c '.repeat(20)]) assert.ok([...youtube.buildTitle(t)].length <= 100);
});

test('mô tả ≤5000 byte (chữ Việt có dấu), thẻ lấy từ hashtag, không trùng, tổng ≤500 ký tự', () => {
  const d = youtube.buildDescription('Nhuộm tóc màu ổi chín '.repeat(400));
  assert.ok(Buffer.byteLength(d, 'utf8') <= 5000 && d.length > 1000);
  assert.strictEqual(youtube.buildDescription('a <b> c'), 'a b c');
  assert.deepStrictEqual(youtube.buildTags(null, 'x #nhuomtoc #NhuomToc #the_one'), ['nhuomtoc', 'the_one']);
  assert.deepStrictEqual(youtube.buildTags(['#salon', 'tóc đẹp'], '#bo_qua'), ['salon', 'tóc đẹp']);
  const many = youtube.buildTags(Array.from({ length: 200 }, (_, i) => `the${i}`), '');
  assert.ok(many.join(',').length <= 500 && many.length > 50);
});

test('khoá OAuth client: nhập qua web (kiểm tra dạng), .env được ưu tiên; redirect từ PUBLIC_BASE_URL; chưa có khoá thì chưa cấu hình', () => {
  assert.strictEqual(youtube.configured(), false);
  assert.strictEqual(youtube.redirectUri(), 'https://agent.example.vn/api/youtube/callback');
  assert.throws(() => youtube.setClient('sai', CSECRET), /Client ID/);
  assert.throws(() => youtube.setClient(CID, 'x'), /Client secret/);
  youtube.setClient(CID, CSECRET);
  assert.strictEqual(youtube.configured(), true);
  assert.strictEqual(youtube.keySource(), 'web');
  assert.ok(!fs.readFileSync(process.env.DB_FILE, 'utf8').includes(CSECRET), 'khoá không nằm trong db.json');
  process.env.YOUTUBE_CLIENT_ID = 'env-id.apps.googleusercontent.com';
  process.env.YOUTUBE_CLIENT_SECRET = 'GOCSPX-env';
  assert.strictEqual(youtube.keySource(), 'env');
  assert.strictEqual(youtube.clientId(), 'env-id.apps.googleusercontent.com');
  delete process.env.YOUTUBE_CLIENT_ID; delete process.env.YOUTUBE_CLIENT_SECRET;
  const old = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = 'http://agent.example.vn';
  assert.strictEqual(youtube.configured(), false, 'Google bắt buộc https (trừ localhost)');
  process.env.PUBLIC_BASE_URL = 'http://localhost:8787';
  assert.strictEqual(youtube.configured(), true);
  process.env.PUBLIC_BASE_URL = old;
});

test('liên kết đăng nhập Google: offline + consent, đủ 2 quyền, không lộ secret; state dùng 1 lần', () => {
  const st = youtube.newState('the_one');
  const u = new URL(youtube.authUrl(st));
  assert.strictEqual(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.strictEqual(u.searchParams.get('client_id'), CID);
  assert.strictEqual(u.searchParams.get('redirect_uri'), 'https://agent.example.vn/api/youtube/callback');
  assert.strictEqual(u.searchParams.get('access_type'), 'offline');
  assert.strictEqual(u.searchParams.get('prompt'), 'consent');
  assert.strictEqual(u.searchParams.get('response_type'), 'code');
  assert.deepStrictEqual(u.searchParams.get('scope').split(' ').sort(), ['https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/youtube.upload']);
  assert.ok(!youtube.authUrl(st).includes(CSECRET));
  assert.strictEqual(youtube.consumeState(st), 'the_one');
  assert.strictEqual(youtube.consumeState(st), null);
});

test('kết nối: đổi mã lấy refresh token, đọc kênh (channels?mine=true), lưu riêng; thiếu quyền / không có kênh / mã hỏng thì báo rõ', async () => {
  reset();
  await assert.rejects(youtube.connect('the_one', 'HONG'), (e) => e.code === 'invalid_grant' && /kết nối lại/.test(e.message) && /7 ngày/.test(e.message));
  await assert.rejects(youtube.connect('the_one', 'NOUPLOAD'), /youtube\.upload/);
  await assert.rejects(youtube.connect('the_one', 'NOREFRESH'), /refresh token/);
  S.channels = [];
  await assert.rejects(youtube.connect('the_one', 'GOOD'), /chưa có kênh YouTube/);
  S.channels = undefined; resetS();
  const r = await youtube.connect('the_one', 'GOOD');
  assert.deepStrictEqual({ c: r.connected, id: r.channelId, t: r.title }, { c: true, id: 'UC_THEONE', t: 'THE ONE HAIR SALON' });
  const tok = calls.find((c) => c.host === 'oauth2.googleapis.com' && /authorization_code/.test(String(c.body)) && /GOOD/.test(String(c.body)) && !/NO/.test(String(c.body)));
  assert.match(String(tok.body), /redirect_uri=https%3A%2F%2Fagent\.example\.vn%2Fapi%2Fyoutube%2Fcallback/);
  const ch = calls.find((c) => c.path === '/youtube/v3/channels');
  assert.match(ch.search, /mine=true/);
  assert.strictEqual(ch.headers.Authorization, 'Bearer YA29-ACCESS-SECRET-1');
  assert.ok(fs.readFileSync(secrets.file(), 'utf8').includes('REFRESH-SECRET-1'), 'refresh token trong kho bí mật');
  assert.ok(!fs.readFileSync(process.env.DB_FILE, 'utf8').includes('SECRET'), 'không nằm trong db.json');
  const visible = JSON.stringify([require('../src/youtube-routes').stateSlice(), youtube.summary('the_one')]);
  assert.ok(!/SECRET|YA29|GOCSPX/.test(visible), 'trạng thái gửi giao diện không có token/secret');
  await assert.rejects(youtube.connect('dark_hair', 'GOOD'), /thương hiệu khác/, '1 kênh không gắn 2 thương hiệu');
});

test('tải lên resumable: khởi tạo đúng thông tin rồi PUT cả file vào phiên; trả mã video + link Shorts', async () => {
  reset();
  const f = mkFile('a.mp4', 1234);
  const caption = '💇 Phục hồi tóc hư tổn chỉ 60 phút #phuchoitoc #theone\nĐặt lịch qua inbox nhé';
  const r = await youtube.publishVideo('the_one', f, { title: caption, description: caption, privacy: 'public' });
  assert.deepStrictEqual(r, { videoId: 'vid123', url: 'https://youtube.com/shorts/vid123', privacy: 'public' });
  const init = initCall();
  assert.strictEqual(init.method, 'POST');
  assert.match(init.search, /uploadType=resumable/);
  assert.match(init.search, /part=snippet,status/);
  assert.strictEqual(init.headers.Authorization, 'Bearer YA29-ACCESS-SECRET-1');
  assert.strictEqual(init.headers['X-Upload-Content-Length'], '1234');
  assert.strictEqual(init.headers['X-Upload-Content-Type'], 'video/mp4');
  const b = JSON.parse(init.body);
  assert.strictEqual(b.snippet.title, 'Phục hồi tóc hư tổn chỉ 60 phút #Shorts');
  assert.strictEqual(b.snippet.description, caption);
  assert.strictEqual(b.snippet.categoryId, '26');
  assert.deepStrictEqual(b.snippet.tags, ['phuchoitoc', 'theone']);
  assert.deepStrictEqual(b.status, { privacyStatus: 'public', selfDeclaredMadeForKids: false });
  const p = puts();
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].method, 'PUT');
  assert.strictEqual(p[0].headers['Content-Type'], 'video/mp4');
  assert.strictEqual(p[0].body.size, 1234);
});

test('hẹn giờ đăng: publishAt bắt buộc riêng tư; giờ đã qua thì báo lỗi; YouTube khoá riêng tư thì trả đúng chế độ thật', async () => {
  reset();
  const f = mkFile('b.mp4', 300);
  const at = new Date(Date.now() + 864e5).toISOString();
  const r = await youtube.publishVideo('the_one', f, { title: 'Hẹn giờ', description: 'x', privacy: 'public', publishAt: at });
  const b = JSON.parse(initCall().body);
  assert.deepStrictEqual(b.status, { privacyStatus: 'private', selfDeclaredMadeForKids: false, publishAt: at });
  assert.strictEqual(r.publishAt, at);
  reset();
  await assert.rejects(youtube.publishVideo('the_one', f, { title: 'x', publishAt: '2020-01-01T00:00:00Z' }), /Giờ hẹn đăng YouTube/);
  assert.strictEqual(calls.length, 0, 'không gọi Google khi giờ hẹn sai');
  reset(); S.videoPrivacy = 'private';
  assert.strictEqual((await youtube.publishVideo('the_one', f, { title: 'x', privacy: 'public' })).privacy, 'private', 'dự án chưa audit: YouTube trả về riêng tư');
});

test('đứt giữa chừng: hỏi phần đã nhận (308 + Range) rồi gửi tiếp đúng phần còn thiếu; hết lượt thử thì báo lỗi', async () => {
  reset();
  const f = mkFile('c.mp4', 1000);
  S.putStatuses = [503, 200];
  S.rangeAfter = 399;
  const r = await youtube.publishVideo('the_one', f, { title: 'x', retryMs: 1 });
  assert.strictEqual(r.videoId, 'vid123');
  const p = puts();
  assert.strictEqual(p.length, 3, 'PUT cả file → hỏi tiến độ → PUT phần còn lại');
  assert.strictEqual(p[1].headers['Content-Range'], 'bytes */1000');
  assert.strictEqual(p[2].headers['Content-Range'], 'bytes 400-999/1000');
  assert.strictEqual(p[2].body.size, 600);
  reset();
  S.putStatuses = ['neterr', 200];
  assert.strictEqual((await youtube.publishVideo('the_one', f, { title: 'x', retryMs: 1 })).videoId, 'vid123', 'lỗi mạng: chưa nhận byte nào thì gửi lại từ đầu');
  assert.strictEqual(puts()[2].headers['Content-Range'], undefined);
  reset();
  S.putStatuses = [503, 503, 503];
  await assert.rejects(youtube.publishVideo('the_one', f, { title: 'x', retryMs: 1, retries: 2 }), /gián đoạn/);
  reset();
  S.putStatuses = [400];
  await assert.rejects(youtube.publishVideo('the_one', f, { title: 'x', retryMs: 1 }), /YouTube/);
  assert.strictEqual(puts().length, 1, 'lỗi 4xx không gửi lại');
});

test('lỗi YouTube thành câu tiếng Việt: hết hạn mức (~1600/10000, ~6 video), giới hạn kênh, chưa bật API, token bị thu hồi', async () => {
  const f = mkFile('d.mp4', 200);
  reset(); S.initError = () => gErr(403, 'quotaExceeded');
  await assert.rejects(youtube.publishVideo('the_one', f, { title: 'x' }), (e) => /1\.600/.test(e.message) && /10\.000/.test(e.message) && /6 video/.test(e.message) && e.retryLater === true && !e.fatal);
  reset(); S.initError = () => gErr(400, 'uploadLimitExceeded');
  await assert.rejects(youtube.publishVideo('the_one', f, { title: 'x' }), (e) => /giới hạn số video/.test(e.message) && e.retryLater === true);
  reset(); S.initError = () => reply({ error: { code: 403, message: 'YouTube Data API v3 has not been used in project 1', errors: [{ reason: 'accessNotConfigured' }], status: 'PERMISSION_DENIED' } }, 403);
  await assert.rejects(youtube.publishVideo('the_one', f, { title: 'x' }), (e) => /YouTube Data API v3/.test(e.message) && /Enable/.test(e.message) && e.fatal === true);
  reset(); S.initError = () => reply({ error: { code: 403, message: 'disabled', status: 'PERMISSION_DENIED', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED' }] } }, 403);
  await assert.rejects(youtube.publishVideo('the_one', f, { title: 'x' }), /YouTube Data API v3/);
  reset(); S.initError = () => reply({}, 500);
  await assert.rejects(youtube.publishVideo('the_one', f, { title: 'x' }), /HTTP 500/);

  // access token hết hạn → làm mới; refresh bị thu hồi → cần kết nối lại
  reset();
  const c = secrets.load().youtube.channels.the_one;
  c.accessExpiresAt = Date.now() + 60e3;
  assert.strictEqual(await youtube.freshToken('the_one'), 'YA29-ACCESS-SECRET-2');
  assert.strictEqual(c.refreshToken, '1//REFRESH-SECRET-1', 'Google không đổi refresh token');
  c.accessExpiresAt = Date.now() - 1; S.refreshError = 'invalid_grant';
  await assert.rejects(youtube.publishVideo('the_one', f, { title: 'x' }), (e) => e.code === 'invalid_grant' && /Kết nối YouTube/.test(e.message) && e.fatal);
  assert.strictEqual(youtube.summary('the_one').needsReauth, true);
  assert.ok(!initCall(), 'không tải lên khi chưa có token');
  S.refreshError = null;
  assert.strictEqual(await youtube.freshToken('the_one'), 'YA29-ACCESS-SECRET-2');
  assert.strictEqual(youtube.summary('the_one').needsReauth, false);
});

test('social.publish kênh youtube: đúng 1 video; chế độ hiển thị lấy từ cài đặt (mặc định công khai); thương hiệu chưa nối thì không gọi API', async () => {
  const db = load();
  assert.strictEqual(db.settings.youtubePrivacy, 'public');
  assert.strictEqual(social.CHANNELS.youtube.label, 'YouTube');
  assert.strictEqual(social.CHANNELS.youtube.live(), true);
  assert.strictEqual(social.CHANNELS.youtube.live('the_one'), true);
  assert.strictEqual(social.CHANNELS.youtube.live('dark_hair'), false, 'dark_hair chưa nối kênh');
  const v = { type: 'video', name: 'e.mp4', path: mkFile('e.mp4', 400) };
  const img = { type: 'image', name: 'e.jpg', path: mkFile('e.jpg', 50) };
  reset();
  await assert.rejects(social.publish('youtube', 'x', [v, v], { brand: 'the_one' }), /đúng 1 video/);
  await assert.rejects(social.publish('youtube', 'x', [img], { brand: 'the_one' }), /đúng 1 video/);
  await assert.rejects(social.publish('youtube', 'x', [], { brand: 'the_one' }), /đúng 1 video/);
  assert.strictEqual(calls.length, 0);
  let r = await social.publish('youtube', '🌸 Tóc xoăn Hàn Quốc #uontoc\nInbox ngay', [v], { brand: 'the_one' });
  assert.deepStrictEqual({ live: r.live, id: r.externalId }, { live: true, id: 'vid123' });
  assert.match(r.note, /youtube\.com\/shorts\/vid123/);
  let b = JSON.parse(initCall().body);
  assert.strictEqual(b.snippet.title, 'Tóc xoăn Hàn Quốc #Shorts');
  assert.strictEqual(b.status.privacyStatus, 'public');
  db.settings.youtubePrivacy = 'unlisted';
  reset();
  r = await social.publish('youtube', 'Bài 2', [v], { brand: 'the_one' });
  b = JSON.parse(initCall().body);
  assert.strictEqual(b.status.privacyStatus, 'unlisted');
  db.settings.youtubePrivacy = 'public';
  reset();
  r = await social.publish('youtube', 'x', [v], { brand: 'dark_hair' });
  assert.deepStrictEqual(r, { live: false, externalId: null });
  assert.strictEqual(calls.length, 0);
});

test('agent đăng YouTube: chưa nối kênh thì giữ lịch và báo; đăng xong ghi kết quả yt_<kênh>; hết hạn mức thì giữ lịch, không tính lần thử', async () => {
  const db = load();
  db.settings.dryRun = false;
  planner.updateBrand('the_one', { channels: { youtube: { on: true } } });
  planner.updateBrand('dark_hair', { channels: { youtube: { on: true } } });
  mkFile('reel.mp4', 900);
  fs.mkdirSync(path.join(tmp, 'media', 'dark_hair'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'media', 'dark_hair', 'reel.mp4'), Buffer.alloc(900, 2));
  const mk = (id, extra) => ({ id, channel: 'youtube', brand: 'the_one', topic: 'Y' + id, text: 'Chú thích YouTube', media: [{ name: 'reel.mp4', type: 'video' }], requireMedia: true, scheduledAt: new Date(Date.now() - 1000).toISOString(), status: 'scheduled', ...extra });
  reset();
  db.actions = [];
  db.posts = [mk('a'), mk('b', { brand: 'dark_hair' })];
  await engine.runAgent('content', 'manual');
  assert.strictEqual(db.posts[0].status, 'published');
  assert.deepStrictEqual(db.posts[0].results, { yt_UC_THEONE: 'vid123' });
  assert.ok(db.actions.some((a) => /Đã đăng bài "Ya" lên YouTube \(kênh YouTube "THE ONE HAIR SALON", https:\/\/youtube\.com\/shorts\/vid123/.test(a.text)), db.actions.map((a) => a.text).join(' | '));
  assert.strictEqual(db.posts[1].status, 'scheduled');
  assert.match(db.posts[1].skipReason, /chưa kết nối kênh YouTube/);

  reset(); S.initError = () => gErr(403, 'quotaExceeded');
  db.posts = [mk('c')];
  await engine.runAgent('content', 'manual');
  await engine.runAgent('content', 'manual');
  await engine.runAgent('content', 'manual');
  assert.strictEqual(db.posts[0].status, 'scheduled', 'hết hạn mức không làm bài thành "lỗi"');
  assert.ok(!db.posts[0].attempts);
  assert.match(db.posts[0].error, /hạn mức/);
  S.initError = null;
  await engine.runAgent('content', 'manual');
  assert.strictEqual(db.posts[0].status, 'published');

  reset();
  const rows = require('../src/channels-api').list().rows.filter((r) => r.channel === 'youtube');
  const one = rows.find((r) => r.brand === 'the_one');
  assert.deepStrictEqual({ name: one.name, ext: one.externalId, st: one.status }, { name: 'THE ONE HAIR SALON', ext: 'UC_THEONE', st: 'unchecked' });
  assert.ok(one.actions.includes('disconnect') && one.actions.includes('connect'));
  assert.match(one.note, /riêng tư/);
  assert.strictEqual(rows.find((r) => r.brand === 'dark_hair').status, 'not_connected');
  await require('../src/channels-api').verify({ brand: 'the_one' });
  assert.strictEqual(require('../src/channels-api').list().rows.find((r) => r.channel === 'youtube' && r.brand === 'the_one').status, 'connected');
  assert.ok(!JSON.stringify(require('../src/channels-api').list()).includes('SECRET'));
});

test('máy chủ: kết nối cần đăng nhập app + quyền; state chống giả mạo; nhập khoá, trạng thái, ngắt kết nối không lộ bí mật', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = { authorization: 'Basic ' + Buffer.from('a:mat-khau-test-youtube').toString('base64') };
  const get = (p, h = {}) => realFetch(base + p, { headers: h, redirect: 'manual' });
  const post = (u, b) => realFetch(base + u, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(b) });
  try {
    assert.strictEqual((await get('/api/youtube/start?brand=the_one')).status, 401, 'chưa đăng nhập app');
    assert.strictEqual((await get('/api/youtube/start?brand=khong_co', auth)).status, 400);
    const start = await get('/api/youtube/start?brand=the_one', auth);
    assert.strictEqual(start.status, 302);
    const loc = new URL(start.headers.get('location'));
    assert.strictEqual(loc.host, 'accounts.google.com');
    const state = loc.searchParams.get('state');
    assert.strictEqual((await get('/api/youtube/callback?code=GOOD&state=gia-mao', auth)).status, 400, 'state sai bị từ chối');
    assert.strictEqual((await get('/api/youtube/callback?error=access_denied', auth)).status, 400);
    reset();
    const ok = await get(`/api/youtube/callback?code=GOOD&state=${state}`, auth);
    assert.strictEqual(ok.status, 302);
    assert.strictEqual(ok.headers.get('location'), '/#kenh');
    assert.strictEqual((await get(`/api/youtube/callback?code=GOOD&state=${state}`, auth)).status, 400, 'state chỉ dùng 1 lần');

    const st = await (await get('/api/state', auth)).text();
    assert.ok(!/SECRET|YA29|GOCSPX/.test(st), 'API trạng thái không lộ token/khoá');
    const yt = JSON.parse(st).youtube;
    assert.deepStrictEqual({ c: yt.configured, k: yt.keySource, r: yt.redirectUri, t: yt.channels.the_one.title }, { c: true, k: 'web', r: 'https://agent.example.vn/api/youtube/callback', t: 'THE ONE HAIR SALON' });
    assert.ok(!/SECRET|GOCSPX/.test(await (await get('/api/youtube/status', auth)).text()));
    assert.ok(!/SECRET|GOCSPX/.test(await (await get('/api/export', auth)).text()), 'bản xuất dữ liệu không chứa khoá/token');

    assert.strictEqual((await post('/api/settings', { youtubePrivacy: 'HACK' })).status, 400);
    assert.strictEqual((await (await post('/api/settings', { youtubePrivacy: 'unlisted' })).json()).settings.youtubePrivacy, 'unlisted');
    assert.strictEqual((await post('/api/youtube/keys', { clientId: 'sai', clientSecret: 'x' })).status, 400);
    const k = await post('/api/youtube/keys', { clientId: CID, clientSecret: CSECRET });
    assert.strictEqual(k.status, 200);
    assert.ok(!(await k.text()).includes(CSECRET));
    assert.ok(!load().actions.some((a) => JSON.stringify(a).includes(CSECRET)), 'nhật ký không ghi khoá');

    reset();
    const dis = await (await post('/api/youtube/disconnect', { brand: 'the_one' })).json();
    assert.strictEqual(dis.youtube.channels.the_one.connected, false);
    assert.ok(calls.some((c) => c.path === '/revoke'), 'thu hồi quyền ở Google');
    assert.ok(!fs.readFileSync(secrets.file(), 'utf8').includes('REFRESH-SECRET'), 'không còn token trong kho');
    assert.strictEqual((await post('/api/youtube/disconnect', { brand: 'khong_co' })).status, 400);
    assert.strictEqual((await (await post('/api/youtube/keys', { remove: true })).json()).youtube.keySet, false);
  } finally { server.close(); }
});

test('phân quyền: kết nối/ngắt kênh cần quyền sửa thương hiệu, nhập khoá chỉ chủ', () => {
  const authz = require('../src/authz');
  const mgr = { role: 'manager', name: 'QL' };
  const ed = { role: 'editor', name: 'BT' };
  assert.strictEqual(authz.check(mgr, 'POST', '/api/youtube/connect', { brand: 'the_one' }), null);
  assert.strictEqual(authz.check(mgr, 'POST', '/api/youtube/disconnect', { brand: 'the_one' }), null);
  assert.strictEqual(authz.check(ed, 'POST', '/api/youtube/connect', { brand: 'the_one' }).status, 403);
  assert.strictEqual(authz.check(mgr, 'POST', '/api/youtube/keys', {}).status, 403);
  assert.strictEqual(authz.check({ role: 'owner', name: 'Chủ' }, 'POST', '/api/youtube/keys', {}), null);
  assert.strictEqual(authz.check({ role: 'manager', name: 'QL', brands: ['dark_hair'] }, 'POST', '/api/youtube/connect', { brand: 'the_one' }).status, 403);
});
