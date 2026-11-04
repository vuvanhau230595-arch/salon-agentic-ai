// Trợ lý ảo: tư vấn khách theo quy trình nhân viên, Messenger tự gửi câu đơn giản, widget website công khai, trợ lý cho Sếp
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-assistant-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
process.env.MEDIA_DIR = path.join(tmp, 'media');
process.env.APP_PASSWORD = 'mat-khau-dung';
delete process.env.META_ACCESS_TOKEN;
delete process.env.ANTHROPIC_API_KEY;

const { server } = require('../src/server');
const { load } = require('../src/db');
const { social } = require('../src/connectors');
const planner = require('../src/planner');
const engine = require('../src/engine');
const assistant = require('../src/assistant');
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const basic = 'Basic ' + Buffer.from('admin:mat-khau-dung').toString('base64');
let base;
const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const brand = () => planner.brands().the_one;
const c = (text) => ({ from: 'customer', text });
const s = (text) => ({ from: 'salon', text });

test('khởi động server thử', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test('tư vấn theo quy trình: chào → hỏi giá thì hỏi độ dài trước → báo giá theo size → hỏi số người → đặt lịch xin tên + SĐT → có SĐT thì chuyển người', () => {
  const b = brand();
  const r1 = assistant.converse([c('xin chào')], { brand: b });
  assert.strictEqual(r1.intent.id, 'greeting'); assert.ok(r1.auto && !r1.handoff);

  const h = [c('cho em hỏi giá nhuộm với')];
  const r2 = assistant.converse(h, { brand: b });
  assert.strictEqual(r2.intent.id, 'price');
  assert.ok(/ngang cằm, qua vai hay qua ngực/.test(r2.text), 'chưa biết độ dài thì hỏi độ dài, chưa báo giá');
  assert.ok(r2.auto);

  h.push(s(r2.text), c('tóc em qua vai ạ'));
  const r3 = assistant.converse(h, { brand: b });
  assert.strictEqual(r3.intent.id, 'price');
  assert.ok(/Size M/.test(r3.text) && /600k/.test(r3.text), r3.text); // Combo A size M giảm 40% = 600k
  assert.ok(/đi mấy người/.test(r3.text), 'hỏi số người để áp ưu đãi nhóm');
  assert.strictEqual(r3.state.service, 'comboA'); assert.strictEqual(r3.state.size, 'M');

  h.push(s(r3.text), c('2 người ạ'));
  const r4 = assistant.converse(h, { brand: b });
  assert.strictEqual(r4.intent.id, 'price');
  assert.ok(/550k/.test(r4.text) && /45%/.test(r4.text), r4.text); // 2 người giảm 45%: 1.000k → 550k
  assert.ok(!/đi mấy người/.test(r4.text), 'đã biết số người thì không hỏi lại');

  h.push(s(r4.text), c('vậy cho em đặt lịch chiều mai'));
  const r5 = assistant.converse(h, { brand: b });
  assert.strictEqual(r5.intent.id, 'booking');
  assert.ok(/Tên \+ SĐT/.test(r5.text) && /2 chi nhánh/.test(r5.text));
  assert.ok(r5.auto && r5.notify, 'câu xin tên + SĐT là câu mẫu an toàn: gửi luôn nhưng báo nhân viên chốt');

  h.push(s(r5.text), c('Lan 0909123456, Quận 3 nha'));
  const r6 = assistant.converse(h, { brand: b });
  assert.strictEqual(r6.intent.id, 'confirm');
  assert.ok(r6.handoff && !r6.auto); assert.ok(/SĐT/.test(r6.reason));

  const r7 = assistant.converse([c('hôm nay trời đẹp ghê')], { brand: b });
  assert.ok(r7.handoff && /chưa nhận ra/.test(r7.reason));
  const r8 = assistant.converse([c('shop ơi bên mình ở đâu')], { brand: b });
  assert.strictEqual(r8.intent.id, 'address'); assert.ok(r8.auto && /Quận 3/.test(r8.text));
  const r9 = assistant.converse([c('你好，染发多少钱？')], { brand: b });
  assert.strictEqual(r9.lang, 'zh'); assert.strictEqual(r9.intent.id, 'price'); assert.ok(r9.auto);
  assert.strictEqual(assistant.converse([s('Dạ chào chị')], { brand: b }), null);
});

test('Messenger: tin khách chưa ai trả lời → câu đơn giản gửi luôn, khách gửi SĐT → chờ nhân viên, salon đã trả lời → bỏ qua, mỗi tin xử lý 1 lần, lỗi hộp thư ghi 1 lần', async () => {
  const db = load();
  db.settings.dryRun = false;
  db.settings.assistant = { on: true, auto: true, brands: { the_one: true, dark_hair: false, mishang: false } };
  planner.updateBrand('the_one', { pageIds: '100107638949140' });
  db.approvals.length = 0; db.actions.length = 0; db.inbox = {};
  const P = '100107638949140';
  const sent = [];
  social.sendMessage = async (pageId, psid, text) => { sent.push({ pageId, psid, text }); return { live: true }; };
  social.fetchConversations = async () => [
    { id: 't_a', updatedAt: new Date().toISOString(), participants: [{ id: 'u1', name: 'Mai' }, { id: P, name: 'The One' }], messages: [{ id: 'm1', from: 'u1', name: 'Mai', text: 'giá uốn tóc dài bao nhiêu ạ', at: new Date().toISOString() }] },
    { id: 't_b', updatedAt: new Date().toISOString(), participants: [{ id: 'u2', name: 'Hoa' }], messages: [{ id: 'm2', from: 'u2', name: 'Hoa', text: 'Hoa 0912345678 Bình Thạnh nha', at: new Date().toISOString() }] },
    { id: 't_c', updatedAt: new Date().toISOString(), participants: [{ id: 'u3', name: 'Thu' }], messages: [{ id: 'm3', from: 'u3', name: 'Thu', text: 'giá nhuộm?', at: new Date().toISOString() }, { id: 'm4', from: P, name: 'The One', text: 'Dạ tóc chị dài tới đâu ạ', at: new Date().toISOString() }] },
    { id: 't_d', updatedAt: new Date().toISOString(), participants: [{ id: 'u4', name: 'Sticker' }], messages: [{ id: 'm5', from: 'u4', name: 'Sticker', text: '', at: new Date().toISOString() }] },
  ];
  const run = await engine.runAgent('inbox', 'manual');
  assert.strictEqual(run.error, null);
  assert.strictEqual(sent.length, 1, 'chỉ câu đơn giản (giá) được gửi');
  assert.strictEqual(sent[0].psid, 'u1'); assert.ok(/Size L/.test(sent[0].text) && /780k/.test(sent[0].text), sent[0].text); // uốn tóc dài: Combo A size L = 780k
  const ap = db.approvals.filter((a) => a.type === 'message_reply');
  assert.strictEqual(ap.length, 1); assert.strictEqual(ap[0].payload.psid, 'u2'); assert.ok(/SĐT/.test(ap[0].payload.reason));
  assert.ok(db.actions.some((a) => a.kind === 'reply' && a.text.includes('Mai')));
  assert.deepStrictEqual(Object.keys(db.inbox).sort(), ['t_a', 't_b', 't_d']);

  // quét lại: không gửi lại, không tạo thêm
  await engine.runAgent('inbox', 'manual');
  assert.strictEqual(sent.length, 1); assert.strictEqual(db.approvals.filter((a) => a.type === 'message_reply').length, 1);

  // duyệt câu chờ: gửi đúng nội dung (nhân viên có thể sửa)
  await engine.decide(ap[0].id, true, { text: 'Dạ em đã giữ lịch cho chị Hoa ở Bình Thạnh rồi nha ❤️' });
  assert.strictEqual(sent.length, 2); assert.strictEqual(sent[1].psid, 'u2'); assert.ok(/chị Hoa/.test(sent[1].text));
  assert.strictEqual(ap[0].status, 'approved');

  // Facebook không cho gửi → chuyển sang chờ nhân viên, không làm agent chết
  social.sendMessage = async () => { throw new Error('(#10) pages_messaging'); };
  social.fetchConversations = async () => [{ id: 't_e', updatedAt: new Date().toISOString(), participants: [{ id: 'u5', name: 'Ngọc' }], messages: [{ id: 'm6', from: 'u5', name: 'Ngọc', text: 'bên mình ở đâu', at: new Date().toISOString() }] }];
  const run2 = await engine.runAgent('inbox', 'manual');
  assert.strictEqual(run2.error, null);
  assert.ok(db.approvals.some((a) => a.type === 'message_reply' && a.payload.psid === 'u5' && /không cho/.test(a.payload.reason)));

  // lỗi đọc hộp thư cùng nguyên nhân chỉ ghi 1 lần
  social.fetchConversations = async () => { throw new Error('Token thiếu quyền cần thiết (pages_messaging)'); };
  await engine.runAgent('inbox', 'manual'); await engine.runAgent('inbox', 'manual');
  assert.strictEqual(db.actions.filter((a) => a.kind === 'error' && a.text.includes('không đọc được hộp thư')).length, 1);

  // tắt trợ lý: không làm gì
  db.settings.assistant.on = false;
  social.fetchConversations = async () => { throw new Error('không được gọi'); };
  assert.strictEqual((await engine.runAgent('inbox', 'manual')).error, null);
  db.settings.dryRun = true;
});

test('widget website: chat không cần đăng nhập, chỉ web của salon được nhúng (CORS), để lại SĐT thành mục Duyệt, chặn SĐT sai và trùng', async () => {
  const db = load();
  db.approvals.length = 0; db.leads.length = 0;
  const w = await fetch(base + '/widget/chat.js');
  assert.strictEqual(w.status, 200); assert.ok((await w.text()).includes('/api/assistant/chat'));

  const r1 = await post('/api/assistant/chat', { brand: 'the_one', history: [{ from: 'customer', text: 'giá cắt tóc bao nhiêu' }] });
  assert.strictEqual(r1.status, 200);
  const j1 = await r1.json();
  assert.ok(/250k/.test(j1.text), j1.text); assert.strictEqual(j1.handoff, false);

  const r2 = await post('/api/assistant/chat', { history: [{ from: 'customer', text: 'hi' }] }, { origin: 'https://theonehairsalon.vn' });
  assert.strictEqual(r2.status, 200); assert.strictEqual(r2.headers.get('access-control-allow-origin'), 'https://theonehairsalon.vn');
  const r3 = await post('/api/assistant/chat', { history: [{ from: 'customer', text: 'hi' }] }, { origin: 'https://ke-xau.com' });
  assert.strictEqual(r3.status, 403);
  const pre = await fetch(base + '/api/assistant/chat', { method: 'OPTIONS', headers: { origin: 'https://www.theonehairsalon.vn' } });
  assert.strictEqual(pre.status, 204); assert.strictEqual(pre.headers.get('access-control-allow-origin'), 'https://www.theonehairsalon.vn');

  const bad = await post('/api/assistant/lead', { brand: 'the_one', name: 'A', phone: '123' });
  assert.strictEqual(bad.status, 400);
  const ok = await post('/api/assistant/lead', { brand: 'the_one', name: 'Linh', phone: '0987 654 321', note: 'uốn tóc chiều mai', history: [{ from: 'customer', text: 'giá uốn' }] });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(db.leads.length, 1); assert.strictEqual(db.leads[0].phone, '0987654321');
  const lead = db.approvals.find((a) => a.type === 'lead');
  assert.ok(lead && /Linh/.test(lead.title) && /0987654321/.test(lead.detail) && /uốn tóc chiều mai/.test(lead.detail));
  const dup = await (await post('/api/assistant/lead', { brand: 'the_one', name: 'Linh', phone: '0987654321' })).json();
  assert.strictEqual(dup.dup, true); assert.strictEqual(db.leads.length, 1);
  await engine.decide(lead.id, true);
  assert.strictEqual(lead.status, 'approved');
  // không lộ gì khác khi chưa đăng nhập
  assert.strictEqual((await fetch(base + '/api/state')).status, 401);
});

test('trợ lý cho Sếp: hỏi số liệu, lệnh có kiểm tra quyền; đường API cần đăng nhập', async () => {
  const db = load();
  db.campaigns = [
    { id: 'c1', name: 'BT-TN-02 (Bình thạnh)', accountId: '11111', status: 'ACTIVE', budget: 300000, budgetTotal: 300000, today: { spend: 150000, msgs: 2 }, d7: { spend: 900000, msgs: 10 }, month: { spend: 2000000, msgs: 20 } },
    { id: 'c2', name: 'DH-TN-04 (quận 1)', accountId: '11111', status: 'ACTIVE', budget: 0, budgetTotal: 400000, today: { spend: 200000, msgs: 1 }, d7: { spend: 1200000, msgs: 9 }, month: { spend: 3000000, msgs: 25 } },
  ];
  planner.updateBrand('the_one', { adAccountId: '11111' }); planner.updateBrand('dark_hair', { adAccountId: '11111' });
  assert.strictEqual((await post('/api/assistant/boss', { question: 'hôm nay tiêu bao nhiêu' })).status, 401);
  const ask = async (q) => (await (await post('/api/assistant/boss', { question: q }, { authorization: basic })).json());
  const a1 = await ask('hôm nay tiêu bao nhiêu');
  assert.ok(/350\.000đ/.test(a1.text) && /Bình Thạnh/.test(a1.text) && /Quận 1/.test(a1.text), a1.text);
  const a2 = await ask('7 ngày tiêu bao nhiêu');
  assert.ok(/2\.100\.000đ/.test(a2.text), a2.text);
  db.approvals.length = 0;
  db.approvals.push({ id: 'x1', type: 'ad_test', status: 'pending', at: new Date().toISOString(), payload: { unitId: 'to_bt', brand: 'the_one', budget: 1 } });
  const a3 = await ask('có gì chờ duyệt không');
  assert.ok(/1 mục/.test(a3.text) && /quảng cáo thử/.test(a3.text), a3.text);
  const a4 = await ask('tắt chiến dịch không tồn tại');
  assert.ok(/Không thấy/.test(a4.text));
  const a5 = await ask('tắt chiến dịch bt-tn-02');
  assert.ok(/Đã tắt/.test(a5.text) && /chạy thử/.test(a5.text), a5.text);
  assert.strictEqual(db.campaigns[0].status, 'PAUSED');
  const a6 = await ask('bật chiến dịch bt-tn-02');
  assert.strictEqual(db.campaigns[0].status, 'ACTIVE'); assert.ok(/Đã bật/.test(a6.text));
  const a7 = await ask('agent đang chạy không');
  assert.ok(/Agent Quảng cáo/.test(a7.text) && /Trợ lý nhắn tin/.test(a7.text));
  const a8 = await ask('xyz abc');
  assert.ok(/chưa hiểu/.test(a8.text));
  // Người chỉ xem: hỏi được, ra lệnh thì bị chặn
  const users = require('../src/users');
  users.create({ name: 'Xem', username: 'xem', role: 'viewer', brands: [], password: 'chi-doc-thoi-2026' });
  const v = 'Basic ' + Buffer.from('xem:chi-doc-thoi-2026').toString('base64');
  const r = await post('/api/assistant/boss', { question: 'tắt chiến dịch bt-tn-02' }, { authorization: v });
  assert.strictEqual(r.status, 400); assert.ok(/không có quyền/.test((await r.json()).error));
  const r2 = await post('/api/assistant/boss', { question: 'hôm nay tiêu bao nhiêu' }, { authorization: v });
  assert.strictEqual(r2.status, 200);
  // Thử trợ lý tư vấn trong app
  const t = await (await post('/api/assistant/test', { brand: 'the_one', history: [{ from: 'customer', text: 'bên em có bảo hành không' }] }, { authorization: basic })).json();
  assert.ok(/90 ngày/.test(t.text) && t.auto === true);
});

test('widget: giới hạn số lần gọi theo IP', async () => {
  let blocked = 0;
  for (let i = 0; i < 40; i++) { const r = await post('/api/assistant/chat', { history: [{ from: 'customer', text: 'hi' }] }); if (r.status === 429) blocked++; }
  assert.ok(blocked > 0, 'phải có lượt bị chặn 429 sau 30 lượt/phút');
});
