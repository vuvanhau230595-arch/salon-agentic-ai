const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chcenter-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
process.env.MEDIA_DIR = path.join(tmp, 'media');
process.env.SECRETS_FILE = path.join(tmp, 'secrets.json');
delete process.env.APP_PASSWORD;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.META_ACCESS_TOKEN;
delete process.env.TIKTOK_CLIENT_KEY;
delete process.env.TIKTOK_CLIENT_SECRET;

const { load } = require('../src/db');
const planner = require('../src/planner');
const social = require('../src/connectors/social');
const secrets = require('../src/secrets');
const channels = require('../src/channels-api');
const { server } = require('../src/server');
const realFetch = global.fetch;
test.after(() => { global.fetch = realFetch; server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

let base;
const req = (method, p, body) => realFetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const SECRET = 'EAAB-SECRET-TOKEN-XYZ';

// Giả lập Graph API theo đường dẫn. pages: { [id]: { name, ig, posts: 'ok'|'err', tokenErr } }
let pages = {}, accounts = {}, perms = [], delayMs = 0;
function stubMeta() {
  global.fetch = async (u, o) => {
    const url = new URL(String(u));
    if (url.hostname !== 'graph.facebook.com') return realFetch(u, o);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const p = url.pathname.replace(/^\/v[\d.]+/, '');
    const ok = (j) => ({ json: async () => j, status: 200 });
    const err = (code, message) => ({ json: async () => ({ error: { code, message } }), status: 400 });
    if (p === '/me/permissions') return ok({ data: perms.map((x) => ({ permission: x, status: 'granted' })) });
    let m;
    if ((m = p.match(/^\/(\d+)\/posts$/))) return pages[m[1]] && pages[m[1]].posts === 'err' ? err(10, '(#10) thiếu pages_read_engagement') : ok({ data: [] });
    if ((m = p.match(/^\/act_(\d+)$/))) return accounts[m[1]] ? ok(accounts[m[1]]) : err(100, 'Unsupported get request');
    if ((m = p.match(/^\/(\d+)$/))) {
      const pg = pages[m[1]];
      if (!pg) return err(100, 'Object does not exist');
      if (url.searchParams.get('fields') === 'access_token') return pg.tokenErr ? err(200, '(#200) Page chưa gán cho người dùng hệ thống') : ok({ access_token: SECRET });
      return ok({ name: pg.name, ...(pg.ig ? { instagram_business_account: { id: pg.ig.id, username: pg.ig.username } } : {}) });
    }
    return err(100, 'Không giả lập: ' + p);
  };
}

test('khởi động server thử', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test('chưa kiểm tra: không được ghi "đã kết nối"; nền tảng chưa tích hợp ghi rõ lý do; TikTok/小红书 là gói đăng thủ công', async () => {
  planner.updateBrand('the_one', { pageIds: '100107638949140', adAccountId: '11111' });
  planner.updateBrand('dark_hair', { pageIds: '459628564196388' });
  const j = await (await req('GET', '/api/channels')).json();
  assert.strictEqual(j.tokenPresent, false);
  const meta = j.rows.filter((r) => ['facebook_page', 'ads'].includes(r.channel) && r.externalId);
  assert.ok(meta.length >= 3);
  assert.ok(meta.every((r) => r.status === 'unchecked' && r.statusText === 'Chưa kiểm tra'), 'chưa kiểm tra thì không tuyên bố kết nối');
  assert.strictEqual(j.summary.connected, 0);
  for (const brand of ['the_one', 'dark_hair', 'mishang']) {
    for (const ch of ['zalo_oa', 'threads']) {
      const r = j.rows.find((x) => x.brand === brand && x.channel === ch);
      assert.strictEqual(r.status, 'unsupported', `${brand}/${ch}`);
      assert.ok(r.note.length > 30);
    }
    // YouTube đã tích hợp: chưa có khoá OAuth thì "chưa kết nối" kèm hướng dẫn nhập khoá
    const yt = j.rows.find((x) => x.brand === brand && x.channel === 'youtube');
    assert.strictEqual(yt.status, 'not_connected', `${brand}/youtube`);
    assert.match(yt.note, /Client ID/);
    assert.strictEqual(j.rows.find((x) => x.brand === brand && x.channel === 'tiktok').status, 'manual');
    assert.strictEqual(j.rows.find((x) => x.brand === brand && x.channel === 'xiaohongshu').status, 'manual');
  }
  assert.strictEqual(j.rows.find((x) => x.brand === 'mishang' && x.channel === 'facebook_page').status, 'not_connected');
  assert.ok(!JSON.stringify(j).includes('access_token'));
});

test('kiểm tra thật (chỉ đọc): Page ok / Page lỗi / Page đọc một phần / Instagram liên kết / tài khoản quảng cáo; quyền token', async () => {
  process.env.META_ACCESS_TOKEN = 'tok';
  social.resetPageToken();
  pages = {
    100107638949140: { name: 'The One Hair Salon - Quận 3', ig: { id: '178414', username: 'theone.hairsalon' } },
    459628564196388: { name: 'Dark Hair Studio', tokenErr: true },
  };
  accounts = { 11111: { name: 'TK 105', account_status: 1, currency: 'VND' } };
  perms = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'ads_read'];
  stubMeta();
  await channels.verify();
  const j = channels.list();
  const byExt = (id, ch) => j.rows.find((r) => r.externalId === id && r.channel === ch);
  const ok = byExt('100107638949140', 'facebook_page');
  assert.strictEqual(ok.status, 'connected');
  assert.strictEqual(ok.name, 'The One Hair Salon - Quận 3');
  assert.ok(ok.lastCheckedAt);
  assert.deepStrictEqual(ok.permissions.map((p) => [p.name, p.granted]), [['pages_show_list', true], ['pages_read_engagement', true], ['pages_manage_posts', true], ['pages_manage_engagement', false]]);
  const dh = byExt('459628564196388', 'facebook_page');
  assert.strictEqual(dh.status, 'error');
  assert.match(dh.error, /chưa gán|Page access token|người dùng hệ thống/);
  const ig = byExt('178414', 'instagram');
  assert.strictEqual(ig.status, 'limited', 'IG đã liên kết nhưng chưa có PUBLIC_BASE_URL nên chưa đăng được');
  assert.strictEqual(ig.name, '@theone.hairsalon');
  assert.match(ig.statusText, /thiếu PUBLIC_BASE_URL/);
  const ads = byExt('11111', 'ads');
  assert.strictEqual(ads.status, 'connected');
  assert.deepStrictEqual(ads.permissions.map((p) => [p.name, p.granted]), [['ads_read', true], ['ads_management', false]]);
  assert.strictEqual(j.summary.error, 1);
  assert.ok(!JSON.stringify(j).includes(SECRET), 'không lộ token Page');
  assert.ok(!JSON.stringify(load().channelChecks).includes(SECRET));
  // đọc bài lỗi → kết nối một phần
  pages[100107638949140].posts = 'err'; social.resetPageToken();
  await channels.verify({ brand: 'the_one' });
  const j2 = channels.list();
  assert.strictEqual(j2.rows.find((r) => r.externalId === '100107638949140').status, 'limited');
  assert.match(j2.rows.find((r) => r.externalId === '100107638949140').note, /không đọc được bài viết/);
  // tài khoản quảng cáo sai tiền tệ → có lưu ý
  accounts[11111].currency = 'USD';
  await channels.verify({ brand: 'the_one' });
  const a2 = channels.list().rows.find((r) => r.channel === 'ads');
  assert.strictEqual(a2.status, 'limited');
  assert.match(a2.note, /USD/);
  assert.strictEqual((await req('POST', '/api/channels/check', { brand: 'khong-co' })).status, 404);
});

test('không chạy 2 lượt kiểm tra cùng lúc', async () => {
  social.resetPageToken();
  delayMs = 60;
  const first = channels.verify();
  await new Promise((r) => setTimeout(r, 20));
  const r = await req('POST', '/api/channels/check', {});
  assert.strictEqual(r.status, 409);
  await first;
  delayMs = 0;
  assert.strictEqual((await req('POST', '/api/channels/check', {})).status, 200);
});

test('thêm Page: kiểm tra thật trước khi thêm; Page lỗi không được thêm; chống trùng và Page thuộc thương hiệu khác', async () => {
  social.resetPageToken();
  const db = load();
  pages[555555555] = { name: 'Page mới OK' };
  pages[666666666] = { name: 'Page chưa gán', tokenErr: true };
  const add = (b, id) => req('POST', '/api/channels/facebook/add', { brand: b, pageId: id });
  assert.strictEqual((await add('mishang', 'abc')).status, 400);
  assert.strictEqual((await add('khong-co', '555555555')).status, 404);
  let r = await add('mishang', '666666666');
  assert.strictEqual(r.status, 400);
  assert.match((await r.json()).error, /Không thêm được Page/);
  assert.deepStrictEqual(planner.brands().mishang.pageIds, [], 'Page lỗi không được thêm');
  assert.ok(!db.channelChecks['mishang:facebook_page:666666666'], 'không để lại kết quả kiểm tra rác');
  r = await add('mishang', '555555555');
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await r.json()).added.name, 'Page mới OK');
  assert.deepStrictEqual(planner.brands().mishang.pageIds, ['555555555']);
  assert.ok(db.actions.some((a) => a.by === 'Sếp' && a.field === 'pageIds' && a.after === 1));
  assert.strictEqual((await add('mishang', '555555555')).status, 400); // đã có
  r = await add('dark_hair', '555555555');
  assert.strictEqual(r.status, 400);
  assert.match((await r.json()).error, /đang thuộc thương hiệu Mishang/);
  // Page chưa tồn tại / token thiếu
  assert.strictEqual((await add('mishang', '999999999')).status, 400);
  delete process.env.META_ACCESS_TOKEN;
  assert.strictEqual((await add('mishang', '555555555')).status, 400);
  process.env.META_ACCESS_TOKEN = 'tok';
});

test('gỡ Page: chỉ Page thuộc thương hiệu; ghi nhật ký; xoá kết quả kiểm tra cũ', async () => {
  const rm = (b, id) => req('POST', '/api/channels/facebook/remove', { brand: b, pageId: id });
  assert.strictEqual((await rm('mishang', '123456789')).status, 404);
  assert.strictEqual((await rm('khong-co', '555555555')).status, 404);
  const db = load();
  assert.ok(db.channelChecks['mishang:facebook_page:555555555']);
  const r = await rm('mishang', '555555555');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(planner.brands().mishang.pageIds, []);
  assert.ok(!db.channelChecks['mishang:facebook_page:555555555']);
  assert.ok(db.actions.some((a) => a.by === 'Sếp' && a.field === 'pageIds' && a.after === 0));
});

test('TikTok đã đăng nhập: có nút ngắt kết nối, chưa kiểm tra thì không tuyên bố kết nối; không lộ token', async () => {
  secrets.reset();
  secrets.load().tiktok.accounts.dark_hair = { oid: { username: 'darkhair.vn', openId: 'oid', accessToken: 'TT-SECRET', refreshToken: 'TT-REFRESH' } };
  const j = channels.list();
  const r = j.rows.find((x) => x.brand === 'dark_hair' && x.channel === 'tiktok');
  assert.strictEqual(r.name, '@darkhair.vn');
  assert.strictEqual(r.status, 'unchecked');
  assert.ok(r.actions.includes('disconnect'));
  assert.ok(!JSON.stringify(j).includes('TT-SECRET') && !JSON.stringify(j).includes('TT-REFRESH'));
  secrets.load().tiktok.accounts = {};
  secrets.reset();
});

test('lần dùng gần nhất của Page: lấy mới nhất giữa bài đã đăng lên Page đó và lần đọc bình luận', async () => {
  const db = load();
  planner.updateBrand('the_one', { pageIds: '100107638949140' });
  db.posts = [{ id: 'q1', brand: 'the_one', channel: 'facebook_page', status: 'published', scheduledAt: '2026-10-10T03:00:00.000Z', text: 'x', results: { 100107638949140: '1_2' } }];
  db.channelSync = { 100107638949140: { commentsAt: '2026-10-12T05:00:00.000Z' } };
  let r = channels.list().rows.find((x) => x.externalId === '100107638949140' && x.channel === 'facebook_page');
  assert.strictEqual(r.lastUsedAt, '2026-10-12T05:00:00.000Z');
  db.channelSync = {};
  r = channels.list().rows.find((x) => x.externalId === '100107638949140' && x.channel === 'facebook_page');
  assert.strictEqual(r.lastUsedAt, '2026-10-10T03:00:00.000Z');
});
