const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-replies-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
process.env.MEDIA_DIR = path.join(tmp, 'media');
delete process.env.ANTHROPIC_API_KEY;
delete process.env.META_ACCESS_TOKEN;
delete process.env.GEMINI_API_KEY;

const replies = require('../src/replies');
const { lint } = require('../src/compliance');
const planner = require('../src/planner');
const { server } = require('../src/server');

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const NOW = new Date('2026-10-14T00:00:00Z');
const brand = () => planner.brands().the_one;

test('giá khớp bảng giá website (ưu đãi 40%/45%/50%)', () => {
  const A = replies.SERVICES.comboA;
  assert.deepEqual(['S', 'M', 'L'].map((z) => replies.priceK(A, z, 1)), [480, 600, 780]);
  assert.equal(replies.priceK(A, 'S', 2), 440);
  assert.equal(replies.priceK(A, 'S', 3), 400);
  assert.deepEqual(['S', 'M', 'L'].map((z) => replies.priceK(replies.SERVICES.fashionA, z, 1)), [1560, 1800, 2100]);
  assert.deepEqual(['S', 'M', 'L'].map((z) => replies.priceK(replies.SERVICES.balayage, z, 1)), [2280, 2640, 3120]);
  // phục hồi luôn 20%, không đổi theo số người; Olaplex không có size S
  assert.deepEqual(['S', 'M', 'L'].map((z) => replies.priceK(replies.SERVICES.keratin, z, 3)), [480, 640, 800]);
  assert.equal(replies.priceK(replies.SERVICES.olaplex, 'S', 1), null);
  assert.equal(replies.priceK(replies.SERVICES.highlight, 'M', 1), 600);
  assert.equal(replies.priceK(replies.SERVICES.cut, 'M', 3), 250);
});

test('đổi sang CNY làm tròn 5/10 tệ', () => {
  assert.equal(replies.cnyOf(480, 3650), 130);
  assert.equal(replies.cnyOf(1560, 3650), 430);
  assert.equal(replies.cnyOf(null, 3650), null);
});

test('nhận diện ý định tiếng Trung, Anh, Việt', () => {
  const id = (m) => replies.detectIntent(m).id;
  assert.equal(id('染粉色头发多少钱？'), 'price');
  assert.equal(id('How much for balayage?'), 'price');
  assert.equal(id('Giá nhuộm tóc bao nhiêu'), 'price');
  assert.equal(id('我想预约明天'), 'booking');
  assert.equal(id('店在哪里'), 'address');
  assert.equal(id('有没有优惠'), 'discount');
  assert.equal(id('漂发会不会伤发'), 'damage');
  assert.equal(id('有保修吗'), 'warranty');
  assert.equal(id('可以加你微信吗'), 'contact');
  assert.equal(id('我要改期'), 'reschedule');
  assert.equal(id('可以刷卡吗'), 'payment');
  assert.equal(id('Can I pay by card or cash?'), 'payment');
  assert.equal(id('Thanh toán chuyển khoản được không'), 'payment');
  assert.equal(id('你好'), 'greeting');
  assert.equal(id('asdfgh'), 'unknown');
  // giá + WeChat: ưu tiên xử lý yêu cầu liên hệ ngoài nền tảng
  assert.equal(id('加微信报价'), 'contact');
});

test('nhận diện size, số người, dịch vụ', () => {
  assert.equal(replies.detectSize('我是长发'), 'L');
  assert.equal(replies.detectSize('tóc ngang vai'), 'M');
  assert.equal(replies.detectSize('short hair'), 'S');
  assert.equal(replies.detectSize('染发'), null);
  assert.equal(replies.detectPeople('我们两个人'), 2);
  assert.equal(replies.detectPeople('3 people'), 3);
  assert.equal(replies.detectPeople('一个人来'), 1);
  assert.equal(replies.detectService('想染粉色'), 'fashionA');
  assert.equal(replies.detectService('想染黑茶色'), 'comboA');
  assert.equal(replies.detectService('做 balayage'), 'balayage');
  assert.equal(replies.detectService('做角蛋白'), 'keratin');
  assert.equal(replies.detectService('hello'), null);
});

test('soạn trả lời giá: đúng số, có bản tiếng Việt, qua kiểm tra tuân thủ', () => {
  const r = replies.draft('你好，染粉色头发多少钱？我是长发', { brand: brand(), now: NOW });
  assert.equal(r.intent.id, 'price');
  assert.equal(r.size, 'L');
  assert.equal(r.service, 'fashionA');
  assert.ok(r.zh.includes('¥580') && r.zh.includes('2,100,000'), r.zh);
  assert.ok(r.vi.includes('2.100.000đ'), r.vi);
  assert.ok(r.promoActive);
  assert.equal(r.flags.filter((f) => f.startsWith('Kiểm tra tuân thủ')).length, 0);
});

test('chưa biết size: liệt kê cả 3 size và nhắc hỏi thêm', () => {
  const r = replies.draft('染发多少钱', { brand: brand(), now: NOW });
  assert.ok(r.zh.includes('短发') && r.zh.includes('及肩') && r.zh.includes('长发'));
  assert.ok(r.flags.some((f) => f.includes('độ dài tóc')));
});

test('đi nhóm tính giá ưu đãi cao hơn', () => {
  const one = replies.draft('染发多少钱 短发', { brand: brand(), now: NOW });
  const two = replies.draft('染发多少钱 短发 两个人', { brand: brand(), now: NOW });
  assert.ok(one.zh.includes('¥130'));
  assert.ok(two.zh.includes('¥120'), two.zh);
  assert.ok(two.zh.includes('2人'));
});

test('địa chỉ trong mẫu là địa chỉ mới (Đỗ Thị Lời), không phải Lê Văn Sỹ', () => {
  const r = replies.draft('店在哪', { brand: brand(), now: NOW });
  assert.ok(r.zh.includes('Đỗ Thị Lời') && !r.zh.includes('Lê Văn Sỹ'));
  assert.ok(r.vi.includes('436/29'));
});

test('mẫu liên hệ không chứa số điện thoại / WeChat và mọi mẫu qua kiểm tra tuân thủ', () => {
  for (const { id } of replies.listIntents()) {
    const r = replies.draft('', { intent: id, brand: brand(), now: NOW });
    assert.ok(r.zh && r.vi, id);
    const l = lint({ title: '回复', body: r.zh });
    const bad = l.issues.filter((i) => ['contact', 'extreme', 'promise', 'compare', 'medical', 'fake_voice'].includes(i.code));
    assert.deepEqual(bad.map((i) => i.msg), [], id + ': ' + r.zh);
  }
  const c = replies.draft('加微信', { brand: brand(), now: NOW });
  assert.ok(!/\d{9,}/.test(c.zh));
});

test('hết hạn ưu đãi thì cảnh báo; tin lạ thì cần người xem', () => {
  const late = replies.draft('染发多少钱', { brand: brand(), now: new Date('2026-11-05T00:00:00Z') });
  assert.equal(late.promoActive, false);
  assert.ok(late.flags[0].includes('hết hạn'));
  const unk = replies.draft('zzz qqq', { brand: brand(), now: NOW });
  assert.equal(unk.needsHuman, true);
});

test('bảng giá theo số người', () => {
  const t = replies.priceTable(3650, 3);
  const a = t.find((x) => x.key === 'comboA');
  assert.equal(a.discountPct, 50);
  assert.equal(a.sizes[0].vnd, 400000);
  assert.equal(t.find((x) => x.key === 'keratin').discountPct, 20);
});

test('API: info và draft, lỗi khi thiếu nội dung', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body) => { const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json() }; };
  try {
    const info = await call('GET', '/api/replies/info?rate=3700&people=2');
    assert.equal(info.status, 200);
    assert.equal(info.json.rate, 3700);
    assert.ok(info.json.intents.length >= 10 && info.json.prices.length >= 10);
    const d = await call('POST', '/api/replies/draft', { message: '长发染发多少钱 两个人', brand: 'the_one', rate: 3650 });
    assert.equal(d.status, 200);
    assert.equal(d.json.intent.id, 'price');
    assert.equal(d.json.people, 2);
    assert.ok(d.json.zh.includes('¥'));
    const bad = await call('POST', '/api/replies/draft', { message: '  ' });
    assert.equal(bad.status, 400);
  } finally { await new Promise((r) => server.close(r)); }
});
