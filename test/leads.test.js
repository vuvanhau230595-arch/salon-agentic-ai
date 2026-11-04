// Chất lượng tin nhắn: chấm hội thoại, thống kê theo thương hiệu, luật quảng cáo dùng số khách thật, trợ lý bỏ qua tin rác
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-leads-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
process.env.MEDIA_DIR = path.join(tmp, 'media');
delete process.env.APP_PASSWORD;
delete process.env.META_ACCESS_TOKEN;
delete process.env.ANTHROPIC_API_KEY;

const { server } = require('../src/server');
const { load } = require('../src/db');
const { ads, social } = require('../src/connectors');
const planner = require('../src/planner');
const engine = require('../src/engine');
const leads = require('../src/leads');
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const P = '100107638949140';
const msg = (from, text, extra = {}) => ({ id: 'm' + Math.random().toString(36).slice(2, 7), from, name: from === P ? 'The One' : 'Khách ' + from, text, at: new Date().toISOString(), media: 0, ...extra });
const conv = (id, messages, updatedAt = new Date().toISOString()) => ({ id, updatedAt, participants: [{ id: messages[0].from, name: 'Khách ' + messages[0].from }, { id: P, name: 'The One' }], messages });

test('chấm hội thoại: hỏi giá/dịch vụ/lịch/SĐT/ảnh = khách tiềm năng; link, chào bán, bot, chửi, lặp = rác; chỉ chào = chưa rõ', () => {
  const L = (texts, media = 0) => leads.classify({ messages: texts.map((t, i) => ({ from: 'u', text: t, media: i === 0 ? media : 0 })) }, P);
  assert.strictEqual(L(['cho em hỏi giá nhuộm tóc dài bao nhiêu ạ']).label, 'lead');
  assert.strictEqual(L(['bên mình ở quận mấy, chiều mai có trống không']).label, 'lead');
  assert.strictEqual(L(['Lan 0909123456']).label, 'lead');
  assert.strictEqual(L(['', 'tóc em vậy làm được không'], 1).label, 'lead');
  assert.strictEqual(L(['hello dear, I am interested in your product, contact me on whatsapp']).label, 'spam');
  assert.strictEqual(L(['Nhận chạy ads facebook giá rẻ, tăng like follow uy tín https://abc.xyz/x']).label, 'spam');
  assert.strictEqual(L(['Tuyển cộng tác viên việc nhẹ lương cao thu nhập 20tr']).label, 'spam');
  assert.strictEqual(L(['đừng tin mấy anh quảng cáo, lừa đảo']).label, 'spam');
  assert.strictEqual(L(['mua ngay', 'mua ngay', 'mua ngay']).label, 'spam');
  assert.strictEqual(L(['chào shop']).label, 'unknown');
  assert.strictEqual(L(['ok']).label, 'unknown');
  const r = L(['giá uốn bao nhiêu', 'tóc em ngang vai', 'cho em đặt lịch chiều mai nha 0987654321']);
  assert.strictEqual(r.label, 'lead'); assert.ok(r.reasons.includes('để lại SĐT') && r.reasons.includes('hỏi giá'));
  assert.deepStrictEqual(leads.classify({ messages: [] }, P).label, 'unknown');
});

test('quét hộp thư: lưu nhãn 7 ngày, thống kê theo thương hiệu, tỷ lệ khách thật, gắn số khách thật vào chiến dịch; trợ lý bỏ qua tin rác', async () => {
  const db = load();
  db.settings.dryRun = false;
  db.settings.leads = { on: true, useForAds: false };
  db.settings.assistant = { on: true, auto: true, brands: { the_one: true, dark_hair: false, mishang: false } };
  planner.updateBrand('the_one', { pageIds: P, adAccountId: '11111' });
  db.approvals.length = 0; db.actions.length = 0; db.inbox = {}; db.inboxConvs = {};
  const sent = [];
  social.sendMessage = async (pageId, psid, text) => { sent.push({ psid, text }); return { live: true }; };
  const old = new Date(Date.now() - 3 * 864e5).toISOString();
  social.fetchConversations = async () => [
    conv('c1', [msg('u1', 'giá nhuộm tóc dài bao nhiêu ạ')]),
    conv('c2', [msg('u2', 'Nhận chạy ads facebook giá rẻ https://abc.xyz')]),
    conv('c3', [msg('u3', 'chào shop')]),
    conv('c4', [msg('u4', 'tóc em ngang vai, uốn bao nhiêu'), msg(P, 'Dạ Size M 600k ạ'), msg('u4', 'cho em đặt lịch 0912345678')], old),
    conv('c5', [msg('u5', 'hello dear contact me whatsapp'), msg('u5', 'hello dear contact me whatsapp'), msg('u5', 'hello dear contact me whatsapp')], old),
    conv('c6', [msg('u6', 'bên mình có nối tóc không, ở quận 3 đúng không')], old),
  ];
  const run = await engine.runAgent('inbox', 'manual');
  assert.strictEqual(run.error, null);
  const st = leads.stats();
  assert.deepStrictEqual({ ...st.byBrand.the_one, ratio: undefined }, { lead: 3, unknown: 1, spam: 2, total: 6, ratio: undefined });
  assert.strictEqual(st.byBrand.the_one.ratio, 0.5);
  assert.strictEqual(st.recent.length, 6); assert.ok(st.lastScan);
  assert.strictEqual(db.inboxConvs.c2.label, 'spam'); assert.strictEqual(db.inboxConvs.c4.label, 'lead'); assert.strictEqual(db.inboxConvs.c4.replied, true);
  // trợ lý: trả lời khách hỏi giá (c1), bỏ qua rác (c2), c3 chưa rõ vẫn chào lại; c4-c6 cũ hơn 24h không đụng
  assert.deepStrictEqual(sent.map((s) => s.psid).sort(), ['u1', 'u3']);
  assert.strictEqual(db.inbox.c2.skipped, 'spam');
  assert.strictEqual(leads.ratio('the_one'), 0.5); assert.strictEqual(leads.ratio('dark_hair'), null);

  // gắn số khách thật vào chiến dịch theo tỷ lệ thương hiệu
  const camps = [{ id: 'k1', name: 'BT-TN-01', accountId: '11111', status: 'ACTIVE', d7: { spend: 1000000, msgs: 10 }, today: { spend: 100000, msgs: 2 }, month: { spend: 3000000, msgs: 30 } }];
  leads.applyToCampaigns(camps);
  assert.strictEqual(camps[0].d7.real, 5); assert.strictEqual(camps[0].today.real, 1); assert.strictEqual(camps[0].d7.ratio, 0.5);
  assert.strictEqual(engine.msgsFor(camps[0].d7), 10, 'chưa bật dùng số khách thật → số Facebook');
  db.settings.leads.useForAds = true;
  assert.strictEqual(engine.msgsFor(camps[0].d7), 5);
  // thương hiệu chưa đủ dữ liệu: không gắn, luật dùng số Facebook
  const dh = [{ id: 'k2', name: 'DH-TN-01', accountId: '11111', status: 'ACTIVE', d7: { spend: 1, msgs: 4 }, today: { spend: 0, msgs: 0 }, month: { spend: 0, msgs: 0 } }];
  planner.updateBrand('dark_hair', { adAccountId: '11111' });
  leads.applyToCampaigns(dh);
  assert.strictEqual(dh[0].d7.real, undefined); assert.strictEqual(engine.msgsFor(dh[0].d7), 4);

  // tắt chấm: không đọc hộp thư cho chấm, trợ lý vẫn trả lời tin 24h
  db.settings.leads = { on: false, useForAds: false };
  db.inboxConvs = {};
  let calls = 0;
  social.fetchConversations = async (pageId, since) => { calls++; assert.ok(Date.now() - since < 2 * 3600e3 + 24 * 3600e3, 'tắt chấm thì chỉ đọc 24 giờ'); return []; };
  await engine.runAgent('inbox', 'manual');
  assert.strictEqual(calls, 1);
  db.settings.dryRun = true;
});

test('cảnh báo dùng số khách thật khi Sếp bật: 10 tin Facebook nhưng khách thật 50% → giá/tin gấp đôi; agent vẫn không tắt quảng cáo cũ', async () => {
  const db = load();
  db.settings.dryRun = true;
  db.settings.leads = { on: true, useForAds: true };
  db.actions.length = 0;
  db.inboxConvs = {};
  const now = Date.now();
  for (let i = 0; i < 10; i++) db.inboxConvs['x' + i] = { pageId: P, brand: 'the_one', label: i < 5 ? 'lead' : 'spam', firstAt: new Date(now - 3600e3).toISOString(), lastAt: new Date(now).toISOString(), at: new Date(now).toISOString() };
  ads.list = async () => [{ id: 'k9', name: 'BT-TN-09', accountId: '11111', status: 'ACTIVE', budget: 0, objective: 'OUTCOME_ENGAGEMENT', today: { spend: 0, msgs: 0 }, d7: { spend: 1500000, msgs: 10 }, month: { spend: 0, msgs: 0 } }];
  await engine.runAgent('ads', 'manual');
  assert.strictEqual(db.actions.filter((a) => a.kind === 'pause').length, 0, 'không tắt quảng cáo cũ');
  const adsApi = require('../src/ads-api');
  assert.ok(adsApi.alerts(db.campaigns).some((a) => a.kind === 'cpl_high' && a.campaignId === 'k9'), '300k/khách thật (> 200k) → cảnh báo');
  db.settings.leads.useForAds = false;
  assert.ok(!adsApi.alerts(db.campaigns).some((a) => a.kind === 'cpl_high'), 'tắt "dùng số khách thật" thì theo số Facebook: 150k/tin đạt');
});

test('API: trạng thái có leadStats; đổi cài đặt leads qua /api/settings', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const st = await (await fetch(base + '/api/state')).json();
    assert.ok(st.leadStats && st.leadStats.byBrand.the_one && Array.isArray(st.leadStats.days) && st.leadStats.days.length === 7);
    assert.ok(st.leadStats.recent.every((r) => !('psid' in r)), 'không lộ ID người dùng Facebook ra giao diện');
    const r = await fetch(base + '/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ leads: { useForAds: true, on: true } }) });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(load().settings.leads, { on: true, useForAds: true });
    assert.ok(load().actions.some((a) => a.kind === 'settings' && a.text.includes('leads.useForAds')));
  } finally { server.close(); }
});
