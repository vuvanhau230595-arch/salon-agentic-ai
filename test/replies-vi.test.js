const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-replies-vi-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
process.env.MEDIA_DIR = path.join(tmp, 'media');
delete process.env.ANTHROPIC_API_KEY;
delete process.env.META_ACCESS_TOKEN;
delete process.env.GEMINI_API_KEY;

const replies = require('../src/replies');
const planner = require('../src/planner');
const { server } = require('../src/server');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const NOW = new Date('2026-10-14T00:00:00Z');
const d = (m, o = {}) => replies.draft(m, { brand: planner.brands().the_one, now: NOW, ...o });

test('nhận diện ngôn ngữ: Trung / Việt', () => {
  assert.equal(replies.detectLang('染发多少钱'), 'zh');
  assert.equal(replies.detectLang('Cho em hỏi giá nhuộm ombre ạ'), 'vi');
  assert.equal(replies.detectLang('tóc dài qua ngực nha'), 'vi');
});

test('khách hỏi giá nhưng chưa nói độ dài tóc: hỏi độ dài trước, không báo giá', () => {
  const r = d('Hi admin, cho mình xin giá nhuộm đuôi ombre');
  assert.equal(r.lang, 'vi');
  assert.equal(r.intent.id, 'price');
  assert.ok(r.vi.includes('dài ngang cằm, qua vai hay qua ngực'));
  assert.ok(!/\d\.\d{3}k/.test(r.vi));
});

test('báo giá size L ombre đúng 3.120k, nêu "đặt lịch trước", quà tặng, hỏi số người', () => {
  const r = d('Cho em hỏi giá ombre, tóc em dài qua ngực');
  assert.equal(r.size, 'L');
  assert.ok(r.vi.includes('Size L') && r.vi.includes('giảm 40%') && r.vi.includes('3.120k') && r.vi.includes('đặt lịch trước'));
  assert.ok(r.vi.includes('3 lần hấp collagen') && r.vi.includes('Chị đi mấy người'));
});

test('nói rõ số người thì tính ưu đãi nhóm và không hỏi lại', () => {
  const r = d('giá ombre tóc dài qua ngực, đi 3 người');
  assert.equal(r.people, 3);
  assert.ok(r.vi.includes('giảm 50%') && r.vi.includes('2.600k'), r.vi);
  assert.ok(!r.vi.includes('Chị đi mấy người'));
});

test('giá cắt thiết kế 250k trọn gói; khách chỉ trả lời độ dài thì vào luồng giá', () => {
  assert.ok(d('cho em xin giá cắt tóc').vi.includes('250k'));
  assert.equal(d('tóc dài qua ngực nha').intent.id, 'price');
});

test('đặt lịch: xin Tên + SĐT + chi nhánh, gửi 2 chi nhánh + bản đồ', () => {
  const r = d('mình muốn đặt lịch cắt tóc');
  assert.equal(r.intent.id, 'booking');
  assert.ok(r.vi.includes('Tên + SĐT + chi nhánh') && r.vi.includes('436/29 Cách Mạng Tháng 8') && r.vi.includes('69/5 Nguyễn Gia Trí'));
  assert.ok(r.vi.includes('maps.app.goo.gl'));
});

test('khách gửi SĐT: ra phiếu xác nhận lịch, không tự điền thông tin khách', () => {
  const r = d('Thanh 0787747338, chi nhánh bình thạnh');
  assert.equal(r.intent.id, 'confirm');
  assert.ok(r.vi.includes('xác nhận lịch hẹn') && r.vi.includes('[số điện thoại]'));
  assert.ok(!r.vi.includes('0787747338'));
});

test('ghé ngang không đặt trước: giữ ưu đãi chỉ khi đặt trước', () => {
  const r = d('Nếu ghé ngang k đăng ký trước vẫn áp dụng CT này đúng k ạ');
  assert.equal(r.intent.id, 'walkin');
  assert.ok(r.vi.includes('đặt lịch trước'));
});

test('tóc đã tẩy muốn uốn: lo mủn/cháy, tư vấn phương án khác', () => {
  const r = d('tóc em light hơn 1 năm rồi uốn được không bị cháy không');
  assert.equal(r.intent.id, 'damage');
  assert.ok(r.vi.includes('mủn và cháy'));
});

test('thanh toán, nối tóc, nhóm ưu đãi, nhắc lịch, đổi lịch', () => {
  assert.ok(d('Bên e có thanh toán bằng thẻ visa ko?').vi.includes('có visa'));
  assert.ok(d('tư vấn nối tóc 55cm').vi.includes('35k/tép') && d('tư vấn nối tóc 55cm').vi.includes('45k/tép'));
  assert.ok(d('tháng này có ưu đãi gì không').vi.includes('2 người giảm 45%'));
  assert.ok(d('', { intent: 'reminder', lang: 'vi' }).vi.includes('nhắc lịch hẹn'));
  assert.ok(d('cho chị đổi lịch xuống 3h chiều được không em').vi.includes('dời lịch'));
});

test('địa chỉ tiếng Việt không có địa chỉ cũ Lê Văn Sỹ', () => {
  for (const { id } of replies.listIntents()) {
    const r = d('', { intent: id, lang: 'vi' });
    assert.ok(r.vi && !r.vi.includes('Lê Văn Sỹ'), id);
  }
});

test('hết ưu đãi thì cảnh báo; chọn ngôn ngữ thủ công; mẫu chỉ có tiếng Việt khi chọn tiếng Trung', () => {
  const late = replies.draft('giá ombre tóc dài', { now: new Date('2026-11-05T00:00:00Z') });
  assert.ok(late.flags[0].includes('hết hạn'));
  assert.equal(d('染发多少钱', { lang: 'vi' }).lang, 'vi');
  const zhConfirm = d('', { intent: 'confirm', lang: 'zh' });
  assert.equal(zhConfirm.needsHuman, true);
});

test('API soạn trả lời tiếng Việt', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const r = await fetch(base + '/api/replies/draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'giá uốn tóc size M', brand: 'the_one' }) });
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.lang, 'vi');
    assert.ok(j.vi.includes('600k'));
  } finally { await new Promise((r) => server.close(r)); }
});
