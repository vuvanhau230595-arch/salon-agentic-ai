const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-acc-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
process.env.MEDIA_DIR = path.join(tmp, 'media');
process.env.SECRETS_FILE = path.join(tmp, 'secrets.json');
process.env.BACKUP_DIR = path.join(tmp, 'backup');
process.env.APP_PASSWORD = 'mat-khau-chung-123';
delete process.env.META_ACCESS_TOKEN;
delete process.env.ANTHROPIC_API_KEY;

const { load } = require('../src/db');
const users = require('../src/users');
const secrets = require('../src/secrets');
const audit = require('../src/audit');
const ads = require('../src/ads-api');
const { ads: adsConn } = require('../src/connectors');
const { server } = require('../src/server');
const realFetch = global.fetch;
test.after(() => { global.fetch = realFetch; server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

let base;
const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
const SHARED = basic('admin', 'mat-khau-chung-123');
const as = (auth) => (method, p, body, headers = {}) => fetch(base + p, { method, headers: { authorization: auth, 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
const owner = as(SHARED);
const PW = { viewer: 'Xem-chi-2026-ab', editor: 'Soan-bai-2026-ab', manager: 'Van-hanh-2026-ab', scoped: 'Rieng-dh-2026-ab', boss: 'Chu-lon-2026-ab' };
const login = (u) => as(basic(u, PW[u]));

test('khởi động server thử', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test('tài khoản: kiểm tra tên đăng nhập, mật khẩu, vai trò, thương hiệu; mã băm scrypt chỉ nằm ở secrets, không lộ ra ngoài', () => {
  const ok = { name: 'Lan', username: 'Lan.NV', role: 'viewer', password: 'Matkhau-2026-x' };
  for (const [patch, re] of [
    [{ username: 'ab' }, /3–30 ký tự/], [{ username: 'Có Dấu' }, /3–30 ký tự/], [{ password: 'ngan1' }, /10 ký tự/], [{ password: 'chitoanchucai' }, /cả chữ và số/],
    [{ password: 'lan.nv-123456' }, /không được chứa tên đăng nhập/], [{ role: 'god' }, /Vai trò/], [{ name: '  ' }, /Tên hiển thị/], [{ brands: ['khong-co'] }, /không tồn tại/],
  ]) assert.throws(() => users.create({ ...ok, ...patch }), re, JSON.stringify(patch));
  const u = users.create(ok);
  assert.strictEqual(u.username, 'lan.nv');
  assert.ok(!('hash' in u) && !JSON.stringify(users.list()).includes('scrypt'));
  assert.match(secrets.load().users[0].hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.ok(!fs.readFileSync(process.env.DB_FILE, 'utf8').includes('scrypt'), 'db.json không chứa mã băm');
  assert.throws(() => users.create({ ...ok, username: 'LAN.nv' }), /đã có/);
  assert.ok(users.authenticate('Lan.NV', 'Matkhau-2026-x'));
  assert.strictEqual(users.authenticate('lan.nv', 'sai-mat-khau-1'), null);
  assert.strictEqual(users.authenticate('khong-co', 'Matkhau-2026-x'), null);
  assert.ok(secrets.load().users[0].lastLoginAt);
  users.update(u.id, { disabled: true });
  assert.strictEqual(users.authenticate('lan.nv', 'Matkhau-2026-x'), null, 'tài khoản bị khoá không đăng nhập được');
  users.remove(u.id);
  assert.strictEqual(users.list().length, 0);
});

test('đăng nhập: mật khẩu chung = chủ; tên trùng tài khoản riêng thì CHỈ mật khẩu riêng đúng; sai thì bị từ chối', async () => {
  assert.strictEqual((await owner('GET', '/api/me')).status, 200);
  const me = await (await owner('GET', '/api/me')).json();
  assert.deepStrictEqual([me.user.role, me.user.shared], ['owner', true]);
  assert.strictEqual((await as(basic('bat-ky-ten', 'mat-khau-chung-123'))('GET', '/api/me')).status, 200);
  assert.strictEqual((await as(basic('admin', 'sai-roi'))('GET', '/api/me', undefined, { 'x-forwarded-for': '203.0.113.50' })).status, 401);
  // tạo tài khoản qua API
  for (const [u, role, brands] of [['viewer', 'viewer', []], ['editor', 'editor', []], ['manager', 'manager', []], ['scoped', 'manager', ['dark_hair']], ['boss', 'owner', []]]) {
    const r = await owner('POST', '/api/users', { name: `Người ${u}`, username: u, role, brands, password: PW[u] });
    assert.strictEqual(r.status, 200, u + ' ' + (await r.clone().text()));
  }
  assert.strictEqual((await login('manager')('GET', '/api/me')).status, 200);
  // mật khẩu chung KHÔNG vào được bằng tên của tài khoản riêng
  assert.strictEqual((await as(basic('manager', 'mat-khau-chung-123'))('GET', '/api/me', undefined, { 'x-forwarded-for': '203.0.113.51' })).status, 401);
  const m = await (await login('manager')('GET', '/api/me')).json();
  assert.deepStrictEqual([m.user.name, m.user.role, m.user.roleLabel, m.user.shared], ['Người manager', 'manager', 'Quản lý', false]);
});

test('ma trận quyền: Chỉ xem / Biên tập / Quản lý / Chủ — ghi bị chặn đúng chỗ, đọc nhạy cảm bị chặn', async () => {
  const db = load();
  adsConn.setStatus = async () => {};
  db.campaigns = [{ id: 'c1', name: 'BT-1', status: 'ACTIVE', budget: 300000, accountId: '1', today: { spend: 0, msgs: 0 }, d7: { spend: 0, msgs: 0 }, month: { spend: 0, msgs: 0 } }];
  const post = { brand: 'the_one', channel: 'facebook_page', topic: 'Nhuộm nâu', text: 'Nội dung thử' };
  const v = login('viewer'), e = login('editor'), mg = login('manager');
  // Chỉ xem
  assert.strictEqual((await v('GET', '/api/state')).status, 200);
  assert.strictEqual((await v('POST', '/api/posts', post)).status, 403);
  assert.strictEqual((await v('POST', '/api/settings', { scanMinutes: 20 })).status, 403);
  assert.strictEqual((await v('POST', '/api/scan')).status, 403);
  assert.strictEqual((await v('GET', '/api/users')).status, 403);
  assert.strictEqual((await v('GET', '/api/export')).status, 403);
  assert.strictEqual((await v('GET', '/api/backups')).status, 403);
  // Biên tập
  let r = await e('POST', '/api/posts', post);
  assert.strictEqual(r.status, 200);
  const pend = load().approvals.find((a) => a.type === 'post_publish' && a.status === 'pending');
  assert.ok(pend);
  assert.strictEqual((await e('POST', `/api/approvals/${pend.id}/approve`)).status, 403, 'biên tập không được duyệt');
  assert.strictEqual((await e('POST', '/api/ads/campaigns/c1/status', { status: 'PAUSED' })).status, 403);
  assert.strictEqual((await e('POST', '/api/settings', { paused: true })).status, 403);
  assert.strictEqual((await e('POST', '/api/lessons', { text: 'Bài học của biên tập', scope: 'all' })).status, 200);
  assert.strictEqual((await e('POST', '/api/brands', { id: 'the_one', hotline: '1' })).status, 403);
  // Quản lý
  assert.strictEqual((await mg('POST', `/api/approvals/${pend.id}/approve`)).status, 200);
  assert.strictEqual((await mg('POST', '/api/ads/campaigns/c1/status', { status: 'PAUSED' })).status, 200);
  assert.strictEqual((await mg('POST', '/api/brands', { id: 'the_one', hotline: '0398 638 656' })).status, 200);
  assert.strictEqual((await mg('POST', '/api/settings', { paused: true })).status, 200, 'quản lý được dừng khẩn cấp');
  assert.strictEqual((await mg('POST', '/api/settings', { paused: false })).status, 200);
  assert.strictEqual((await mg('POST', '/api/settings', { paused: false, dryRun: false })).status, 403, 'đổi chạy thử/thật là việc của chủ');
  assert.strictEqual((await mg('POST', '/api/settings', { adTest: { budget: 100000 } })).status, 200, 'chỉnh quảng cáo thử thuộc quyền quảng cáo');
  assert.strictEqual((await mg('PUT', '/api/automations/ads_highcpl', { enabled: false })).status, 403);
  assert.strictEqual((await mg('GET', '/api/users')).status, 403);
  assert.strictEqual((await mg('POST', '/api/users', { name: 'x', username: 'xxx', role: 'viewer', password: 'Abcdefghij-123' })).status, 403);
  assert.strictEqual((await mg('POST', '/api/backups')).status, 403);
  // Mặc định từ chối: đường ghi chưa liệt kê chỉ chủ qua cổng
  assert.strictEqual((await mg('POST', '/api/chua-co-duong-nay', {})).status, 403);
  assert.strictEqual((await owner('POST', '/api/chua-co-duong-nay', {})).status, 404, 'chủ qua cổng, rồi 404 vì không có route');
  // Chủ riêng
  assert.strictEqual((await login('boss')('GET', '/api/users')).status, 200);
});

test('giới hạn theo thương hiệu: chỉ ghi được trong phạm vi; việc toàn hệ thống và đối tượng không xác định bị chặn; duyệt hàng loạt tất-cả-hoặc-không', async () => {
  const db = load();
  const sc = login('scoped');
  const mk = (brand, topic) => ({ brand, channel: 'facebook_page', topic, text: 'x' });
  assert.strictEqual((await sc('POST', '/api/posts', mk('the_one', 'Của The One'))).status, 403);
  assert.strictEqual((await sc('POST', '/api/posts', mk('dark_hair', 'Của Dark Hair'))).status, 200);
  assert.strictEqual((await sc('POST', '/api/posts', { channel: 'facebook_page', topic: 'Không có brand', text: 'x' })).status, 403);
  assert.strictEqual((await owner('POST', '/api/posts', mk('the_one', 'Bài The One chờ duyệt'))).status, 200);
  const apps = db.approvals.filter((a) => a.type === 'post_publish' && a.status === 'pending');
  const one = apps.find((a) => /The One chờ duyệt/.test(a.title)), dh = apps.find((a) => /Của Dark Hair/.test(a.title));
  assert.strictEqual((await sc('POST', `/api/approvals/${one.id}/approve`)).status, 403);
  const bulk = await sc('POST', '/api/approvals/bulk', { action: 'approve', ids: [dh.id, one.id] });
  assert.strictEqual(bulk.status, 403);
  assert.strictEqual(db.approvals.find((a) => a.id === dh.id).status, 'pending', 'hàng loạt lẫn thương hiệu khác: KHÔNG xử lý mục nào');
  assert.strictEqual((await sc('POST', `/api/approvals/${dh.id}/reject`)).status, 200);
  assert.strictEqual((await sc('POST', '/api/scan')).status, 403, 'quét là việc toàn hệ thống');
  assert.strictEqual((await sc('POST', '/api/brands', { id: 'the_one', hotline: '9' })).status, 403);
  assert.strictEqual((await sc('POST', '/api/brands', { id: 'dark_hair', hotline: '0981 215 140' })).status, 200);
  assert.strictEqual((await sc('POST', '/api/lessons', { text: 'Bài học chung', scope: 'all' })).status, 403);
  assert.strictEqual((await sc('POST', '/api/lessons', { text: 'Bài học riêng Dark Hair', scope: 'dark_hair' })).status, 200);
  assert.strictEqual((await sc('PUT', '/api/month-plan/2026-10/the_one', { notes: 'x' })).status, 403);
  assert.strictEqual((await sc('PUT', '/api/month-plan/2026-10/dark_hair', { notes: 'ghi chú' })).status, 200);
  assert.strictEqual((await sc('POST', '/api/ads/campaigns/c1/status', { status: 'ACTIVE' })).status, 403, 'chiến dịch không thuộc Dark Hair');
  assert.strictEqual((await sc('POST', '/api/settings', { paused: true })).status, 403, 'giới hạn thương hiệu không được dừng khẩn cấp toàn hệ thống');
});

test('nhật ký ghi ĐÚNG tên người thao tác; thao tác bị từ chối quyền cũng được ghi', async () => {
  const rows = audit.query({}).rows;
  const byName = (name) => rows.filter((e) => e.actor.name === name);
  assert.ok(byName('Người editor').some((e) => /Soạn bài/.test(e.action) || e.kind === 'propose' || e.kind === 'lesson'));
  assert.ok(byName('Người manager').some((e) => e.kind === 'approve' || e.kind === 'ads_change'));
  assert.ok(byName('Chủ hệ thống (mật khẩu chung)').length >= 1);
  assert.ok(!byName('Sếp').some((e) => /Người (editor|manager)/.test(e.action)), 'không còn ghi chữ Sếp cứng khi có người cụ thể');
  const app = load().approvals.find((a) => a.status === 'approved' && a.decidedBy);
  assert.strictEqual(app.decidedBy, 'Người manager');
  const denied = rows.filter((e) => e.rule === 'authz');
  assert.ok(denied.length >= 5);
  assert.ok(denied.some((e) => e.actor.name === 'Người viewer' && /403|Từ chối quyền/.test(e.action)));
});

test('quản lý tài khoản: không tự khoá/tự xoá/tự hạ quyền; chủ cuối cùng được bảo vệ; đặt lại mật khẩu; đổi mật khẩu của mình cần mật khẩu cũ', async () => {
  const boss = login('boss');
  const list = await (await boss('GET', '/api/users')).json();
  const id = (u) => list.users.find((x) => x.username === u).id;
  assert.strictEqual((await boss('PUT', `/api/users/${id('boss')}`, { disabled: true })).status, 400);
  assert.strictEqual((await boss('PUT', `/api/users/${id('boss')}`, { role: 'viewer' })).status, 400);
  assert.strictEqual((await boss('DELETE', `/api/users/${id('boss')}`)).status, 400);
  assert.strictEqual((await boss('PUT', `/api/users/${id('viewer')}`, { role: 'khac' })).status, 400);
  assert.strictEqual((await boss('PUT', `/api/users/${id('viewer')}`, {})).status, 400);
  assert.strictEqual((await boss('PUT', '/api/users/khong-co', { name: 'a' })).status, 404);
  // đổi vai trò + phạm vi
  let r = await boss('PUT', `/api/users/${id('viewer')}`, { role: 'editor', brands: ['mishang'] });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(secrets.load().users.find((u) => u.username === 'viewer').brands, ['mishang']);
  await boss('PUT', `/api/users/${id('viewer')}`, { role: 'viewer', brands: [] });
  // đặt lại mật khẩu: kiểm tra độ mạnh; đăng nhập bằng mật khẩu mới, mật khẩu cũ hết hiệu lực
  assert.strictEqual((await boss('POST', `/api/users/${id('viewer')}/password`, { password: 'yeu' })).status, 400);
  assert.strictEqual((await boss('POST', `/api/users/${id('viewer')}/password`, { password: 'Xem-moi-2027-ab' })).status, 200);
  assert.strictEqual((await as(basic('viewer', PW.viewer))('GET', '/api/me', undefined, { 'x-forwarded-for': '203.0.113.60' })).status, 401);
  assert.strictEqual((await as(basic('viewer', 'Xem-moi-2027-ab'))('GET', '/api/me')).status, 200);
  // tự đổi mật khẩu
  const self = as(basic('viewer', 'Xem-moi-2027-ab'));
  assert.strictEqual((await self('POST', '/api/me/password', { oldPassword: 'sai', newPassword: 'Xem-lan-3-2028-ab' })).status, 400);
  assert.strictEqual((await self('POST', '/api/me/password', { oldPassword: 'Xem-moi-2027-ab', newPassword: 'ngan' })).status, 400);
  assert.strictEqual((await self('POST', '/api/me/password', { oldPassword: 'Xem-moi-2027-ab', newPassword: 'Xem-lan-3-2028-ab' })).status, 200);
  PW.viewer = 'Xem-lan-3-2028-ab';
  // mật khẩu chung không đổi qua web
  const sh = await owner('POST', '/api/me/password', { oldPassword: 'a', newPassword: 'Bbbbbbbbbbbb-1' });
  assert.strictEqual(sh.status, 400);
  assert.match((await sh.json()).error, /\.env/);
  assert.ok(!JSON.stringify(audit.query({}).rows).match(/Xem-|Chu-lon|Chu-hai|Van-hanh|mat-khau-chung/), 'mật khẩu không bao giờ vào nhật ký');
});

test('tắt đăng nhập mật khẩu chung: phải đăng nhập bằng chủ riêng; sau đó mật khẩu chung bị từ chối; chủ cuối cùng không xoá/hạ quyền được', async () => {
  const boss = login('boss');
  try {
    // đang dùng mật khẩu chung → không được tắt (tránh tự khoá)
    let r = await owner('POST', '/api/security', { sharedPasswordLogin: false });
    assert.strictEqual(r.status, 400);
    assert.match((await r.json()).error, /tài khoản chủ RIÊNG/);
    assert.strictEqual((await boss('POST', '/api/security', { sharedPasswordLogin: 'x' })).status, 400);
    r = await boss('POST', '/api/security', { sharedPasswordLogin: false });
    assert.strictEqual(r.status, 200);
    assert.strictEqual((await as(SHARED)('GET', '/api/me', undefined, { 'x-forwarded-for': '203.0.113.70' })).status, 401, 'mật khẩu chung hết hiệu lực');
    assert.strictEqual((await boss('GET', '/api/me')).status, 200);
    // Chủ cuối cùng được bảo vệ khi mật khẩu chung đã tắt
    const bossId = users.list().find((u) => u.username === 'boss').id;
    assert.strictEqual((await boss('GET', '/api/users').then((x) => x.json())).activeOwners, 1);
    for (const patch of [{ role: 'manager' }, { disabled: true }]) assert.throws(() => users.update(bossId, patch), /tài khoản chủ cuối cùng/, JSON.stringify(patch));
    assert.throws(() => users.remove(bossId), /tài khoản chủ cuối cùng/);
    // Có chủ thứ hai thì mới đổi được chủ kia
    assert.strictEqual((await boss('POST', '/api/users', { name: 'Chủ hai', username: 'boss2', role: 'owner', password: 'Chu-hai-2026-ab' })).status, 200);
    const boss2 = as(basic('boss2', 'Chu-hai-2026-ab'));
    assert.strictEqual((await boss2('PUT', `/api/users/${bossId}`, { disabled: true })).status, 200);
    assert.strictEqual((await boss2('PUT', `/api/users/${bossId}`, { disabled: false })).status, 200);
    const boss2Id = users.list().find((u) => u.username === 'boss2').id;
    assert.strictEqual((await boss('DELETE', `/api/users/${boss2Id}`)).status, 200);
    assert.strictEqual(users.activeOwners().length, 1, 'chỉ còn 1 chủ → lại được bảo vệ');
  } finally {
    // luôn bật lại mật khẩu chung để các phần sau không bị khoá
    await boss('POST', '/api/security', { sharedPasswordLogin: true });
    load().settings.security.sharedPasswordLogin = true;
  }
  assert.strictEqual((await owner('GET', '/api/me')).status, 200);
});

test('khoá tạm sau 5 lần sai (theo IP) áp dụng cả cho tài khoản riêng', async () => {
  const ip = { 'x-forwarded-for': '198.51.100.9' };
  for (let i = 0; i < 5; i++) assert.ok([401, 429].includes((await as(basic('manager', 'sai-' + i))('GET', '/api/me', undefined, ip)).status));
  const locked = await as(basic('manager', PW.manager))('GET', '/api/me', undefined, ip);
  assert.strictEqual(locked.status, 429, 'đã khoá, kể cả khi gõ đúng');
  assert.strictEqual((await login('manager')('GET', '/api/me', undefined, { 'x-forwarded-for': '198.51.100.10' })).status, 200, 'IP khác không bị ảnh hưởng');
});

test('tuỳ chọn: ngưỡng cảnh báo / nhóm thông báo / AI được kiểm tra đầu vào, ghi nhật ký trước-sau; cảnh báo dùng ngưỡng mới', async () => {
  const bad = [{ alerts: { spikeRatio: 0.5 } }, { alerts: { spikeRatio: 99 } }, { alerts: { spikeMinSpend: -1 } }, { alerts: { cplSpikeMinMsgs: 0 } }, { alerts: { cplSpikeMinMsgs: 2.5 } },
    { notify: { errors: 'yes' } }, { ai: { enabled: 'x' } }, { ai: { model: 'có dấu cách!' } }, {}, { ai: {} }];
  for (const b of bad) assert.strictEqual((await owner('POST', '/api/prefs', b)).status, 400, JSON.stringify(b));
  assert.strictEqual((await login('manager')('POST', '/api/prefs', { notify: { alerts: false } })).status, 403);
  const r = await owner('POST', '/api/prefs', { alerts: { spikeRatio: 3, spikeMinSpend: 500000 }, notify: { errors: false }, ai: { enabled: false, model: 'claude-test-1' } });
  assert.strictEqual(r.status, 200);
  const s = load().settings;
  assert.deepStrictEqual([s.alerts.spikeRatio, s.alerts.spikeMinSpend, s.notify.errors, s.ai.enabled, s.ai.model], [3, 500000, false, false, 'claude-test-1']);
  const logs = audit.query({ kind: 'settings' }).rows;
  assert.ok(logs.some((e) => e.field === 'alerts.spikeRatio' && e.before === '1.5' && e.after === '3'));
  assert.strictEqual((await owner('POST', '/api/prefs', { ai: { enabled: false } })).status, 400, 'không đổi gì thì báo');
  // cảnh báo chi tiêu vọt dùng ngưỡng mới: hôm nay 1tr vs 200k/ngày = 5 lần → vượt 3 lần
  const camp = { id: 'a3', name: 'DH-vot', status: 'ACTIVE', objective: 'OUTCOME_ENGAGEMENT', accountId: '1', brand: 'dark_hair', today: { spend: 1000000, msgs: 10 }, d7: { spend: 2200000, msgs: 30 }, month: { spend: 0, msgs: 0 } };
  assert.ok(ads.alerts([camp]).some((a) => a.kind === 'spend_spike'));
  s.alerts.spikeRatio = 6;
  assert.ok(!ads.alerts([camp]).some((a) => a.kind === 'spend_spike'), 'ngưỡng 6 lần: 5 lần chưa báo');
  s.alerts.spikeRatio = 1.5; s.alerts.spikeMinSpend = 200000;
});

test('AI: tắt ở Cài đặt thì không gọi Claude; model chọn ở Cài đặt được dùng (biến môi trường ưu tiên hơn)', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  const ai = require('../src/ai');
  let body;
  global.fetch = async (u, o) => (String(u).includes('anthropic.com') ? (body = JSON.parse(o.body), { json: async () => ({ content: [{ text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 }, model: 'x' }) }) : realFetch(u, o));
  const s = load().settings;
  s.ai = { enabled: false, model: 'claude-test-1' };
  assert.strictEqual(await ai.ask('s', 'u'), null);
  assert.strictEqual(body, undefined, 'tắt AI thì không gọi ra ngoài');
  s.ai.enabled = true;
  assert.strictEqual(await ai.ask('s', 'u'), 'ok');
  assert.strictEqual(body.model, 'claude-test-1');
  process.env.ANTHROPIC_MODEL = 'claude-moi-truong';
  await ai.ask('s', 'u');
  assert.strictEqual(body.model, 'claude-moi-truong');
  delete process.env.ANTHROPIC_MODEL;
  global.fetch = realFetch; delete process.env.ANTHROPIC_API_KEY;
});

test('sao lưu: tạo (dữ liệu + nhật ký), liệt kê, tải về; tên file bị kiểm tra chặt chống đi ra ngoài thư mục', async () => {
  const r = await owner('POST', '/api/backups');
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.match(j.name, /^db-\d{8}-\d{6}\.json$/);
  assert.ok(j.audit && fs.existsSync(path.join(process.env.BACKUP_DIR, j.audit)));
  const list = await (await owner('GET', '/api/backups')).json();
  assert.ok(list.backups.some((b) => b.name === j.name && b.kind === 'data') && list.backups.some((b) => b.name === j.audit && b.kind === 'audit'));
  const dl = await owner('GET', `/api/backups/${j.name}/download`);
  assert.strictEqual(dl.status, 200);
  assert.match(dl.headers.get('content-disposition'), /attachment/);
  assert.ok(JSON.parse(await dl.text()).settings);
  for (const bad of ['..%2Fdb.json', 'khac.txt', 'db-.json', 'db-a.json', 'db-%2e%2e%2fsecrets.json']) assert.ok([400, 404].includes((await owner('GET', `/api/backups/${bad}/download`)).status), bad);
  assert.strictEqual((await owner('GET', '/api/backups/db-20000101-000000.json/download')).status, 404);
});

test('khôi phục: cần gõ KHOI PHUC, kiểm tra cấu trúc, tự sao lưu trước, thay đúng dữ liệu, giữ nguyên tài khoản; tham chiếu dữ liệu cũ vẫn hợp lệ', async () => {
  const db = load();
  const ref = db; // một nơi nào đó đang giữ tham chiếu
  const marker = (await (await owner('POST', '/api/backups')).json()).name;
  await owner('POST', '/api/posts', { brand: 'the_one', channel: 'facebook_page', topic: 'Bài tạo SAU khi sao lưu', text: 'x' });
  assert.ok(db.posts.some((p) => p.topic === 'Bài tạo SAU khi sao lưu'));
  const usersBefore = users.list().length;
  assert.strictEqual((await owner('POST', `/api/backups/${marker}/restore`, {})).status, 400);
  assert.strictEqual((await owner('POST', `/api/backups/${marker}/restore`, { confirm: 'khoi phuc' })).status, 400);
  assert.strictEqual((await login('manager')('POST', `/api/backups/${marker}/restore`, { confirm: 'KHOI PHUC' })).status, 403);
  assert.strictEqual((await owner('POST', '/api/backups/audit-20260101-000000.jsonl/restore', { confirm: 'KHOI PHUC' })).status, 400, 'không khôi phục từ file nhật ký');
  // file sai cấu trúc
  fs.writeFileSync(path.join(process.env.BACKUP_DIR, 'db-hong-0001.json'), '{"x":1}');
  fs.writeFileSync(path.join(process.env.BACKUP_DIR, 'db-rac-0002.json'), 'không phải json');
  assert.strictEqual((await owner('POST', '/api/backups/db-hong-0001.json/restore', { confirm: 'KHOI PHUC' })).status, 400);
  assert.strictEqual((await owner('POST', '/api/backups/db-rac-0002.json/restore', { confirm: 'KHOI PHUC' })).status, 400);
  assert.ok(db.posts.some((p) => p.topic === 'Bài tạo SAU khi sao lưu'), 'khôi phục lỗi không làm mất dữ liệu hiện tại');
  // khôi phục thật
  const r = await owner('POST', `/api/backups/${marker}/restore`, { confirm: 'KHOI PHUC' });
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.match(j.safetyBackup, /^db-truoc-khoi-phuc-/);
  assert.ok(fs.existsSync(path.join(process.env.BACKUP_DIR, j.safetyBackup)));
  assert.ok(!load().posts.some((p) => p.topic === 'Bài tạo SAU khi sao lưu'), 'dữ liệu về đúng thời điểm sao lưu');
  assert.strictEqual(load(), ref, 'cùng một đối tượng dữ liệu (tham chiếu cũ vẫn hợp lệ)');
  assert.strictEqual(users.list().length, usersBefore, 'tài khoản người dùng không bị khôi phục đè (nằm ở file bí mật riêng)');
  assert.ok(audit.query({ kind: 'data' }).rows.some((e) => /KHÔI PHỤC dữ liệu từ/.test(e.action)));
  // quay lại được bằng bản sao lưu an toàn
  const back = await owner('POST', `/api/backups/${j.safetyBackup}/restore`, { confirm: 'KHOI PHUC' });
  assert.strictEqual(back.status, 200);
  assert.ok(load().posts.some((p) => p.topic === 'Bài tạo SAU khi sao lưu'), 'khôi phục từ bản sao lưu an toàn đưa dữ liệu trước đó trở lại');
});

test('yêu cầu ghi có JSON hỏng: không sập server, trả lỗi', async () => {
  const r = await fetch(base + '/api/posts', { method: 'POST', headers: { authorization: SHARED, 'content-type': 'application/json' }, body: '{khong phai json' });
  assert.ok(r.status >= 400);
  assert.strictEqual((await owner('GET', '/api/me')).status, 200);
});
