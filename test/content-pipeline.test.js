const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
process.env.DB_FILE = path.join(os.tmpdir(), `agent-cp-test-${process.pid}.json`);
require('node:fs').rmSync(process.env.DB_FILE, { force: true });
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.META_ACCESS_TOKEN;
delete process.env.APP_PASSWORD;

const { load } = require('../src/db');
const ai = require('../src/ai');
const planner = require('../src/planner');
const facts = require('../src/brand-facts');
const ce = require('../src/content-engine');
const flow = require('../src/content-flow');
const learning = require('../src/learning');
const engine = require('../src/engine');
const { server } = require('../src/server');

const brand = (id) => planner.brands()[id];
const HOUR = 3600e3;
const futureMonth = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 7);
const ymd = (d) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });

test('dữ liệu động: chưa xác nhận thì không dùng; sửa là mất xác nhận; có phiên bản; ưu đãi bắt buộc có ngày hết hạn', () => {
  planner.updateBrand('the_one', { hotline: '0909 123 456' });
  assert.strictEqual(facts.current('the_one').hotline, '', 'hotline cũ trong hồ sơ chỉ là bản chưa xác nhận');
  const f1 = facts.set('the_one', 'hotline', { verified: true });
  assert.strictEqual(f1.status, 'verified');
  assert.strictEqual(facts.current('the_one').hotline, '0909 123 456');
  const f2 = facts.set('the_one', 'hotline', { value: '0909 999 888' });
  assert.strictEqual(f2.status, 'unverified', 'đổi nội dung thì phải xác nhận lại');
  assert.strictEqual(facts.current('the_one').hotline, '');
  assert.ok(f2.version > f1.version && f2.history.length >= 2);
  assert.throws(() => facts.set('the_one', 'hotline', { value: 'abc' }), /Hotline chỉ gồm số/);
  assert.throws(() => facts.set('the_one', 'promotions', { value: 'Giảm 10% nhuộm', verified: true }), /ngày hết hiệu lực/);
  assert.throws(() => facts.set('the_one', 'bookingLink', { value: 'abc' }), /http/);
  facts.set('the_one', 'hotline', { value: '0909 123 456', verified: true });
});

test('dữ liệu động: ưu đãi hết hạn / chưa tới ngày không được coi là hiện hành; không trộn thương hiệu', () => {
  const today = ymd(new Date());
  const past = ymd(new Date(Date.now() - 5 * 864e5));
  facts.set('the_one', 'promotions', { value: 'Giảm 10% nhuộm khi đặt lịch trước', validFrom: past, validTo: ymd(new Date(Date.now() + 5 * 864e5)), verified: true });
  assert.strictEqual(facts.current('the_one').promos.length, 1);
  assert.strictEqual(facts.current('dark_hair').promos.length, 0, 'ưu đãi The One không lọt sang Dark Hair');
  assert.strictEqual(facts.stateOf({ value: 'x', status: 'verified', validTo: past }), 'expired');
  assert.strictEqual(facts.stateOf({ value: 'x', status: 'verified', validFrom: ymd(new Date(Date.now() + 864e5)) }), 'upcoming');
  assert.ok(today);
  facts.set('the_one', 'promotions', { value: '', validFrom: '', validTo: '' });
});

test('strategy: không 2 ngày liền cùng nhóm, không chủ đề lặp, không bịa ưu đãi khi chưa có dữ liệu', () => {
  const dates = Array.from({ length: 21 }, (_, i) => new Date(Date.now() + (i + 1) * 864e5));
  const slots = ce.strategy('dark_hair', dates);
  for (let i = 1; i < slots.length; i++) assert.notStrictEqual(slots[i].category, slots[i - 1].category);
  assert.strictEqual(slots.filter((s) => s.category === 'promo').length, 0, 'chưa có ưu đãi xác nhận → không có bài ưu đãi');
  const topics = slots.map((s) => s.topic.toLowerCase());
  assert.strictEqual(new Set(topics).size, topics.length, 'không lặp chủ đề');
  facts.set('dark_hair', 'promotions', { value: 'Tặng 1 lần hấp dầu khi nhuộm', validFrom: ymd(new Date()), validTo: ymd(new Date(Date.now() + 30 * 864e5)), verified: true });
  const withPromo = ce.strategy('dark_hair', dates);
  assert.ok(withPromo.some((s) => s.category === 'promo' && /hấp dầu/.test(s.topic)));
  facts.set('dark_hair', 'promotions', { value: '', validFrom: '', validTo: '' });
});

test('QC: nhầm thương hiệu/địa chỉ, hotline lạ, giá bịa, đánh giá bịa, mở bài kiểu tin nhắn → chấm thấp, lỗi cứng', () => {
  const dh = brand('dark_hair');
  const good = 'Mái tóc nhuộm lên màu đẹp phụ thuộc rất nhiều vào nền tóc hiện tại của bạn. Stylist sẽ xem tóc rồi tư vấn tone phù hợp.\n\nNhắn tin cho salon để đặt lịch nhé.\n\n#darkhair #nhuomtoc #tocdep';
  const ok = ce.review(good, { brand: dh, category: 'service' });
  assert.strictEqual(ok.status, 'ok');
  assert.ok(ok.score >= 85);

  const mix = ce.review(good + '\n📍 436/29 Đỗ Thị Lời, Quận 3', { brand: dh, category: 'service' });
  assert.ok(mix.issues.some((i) => i.code === 'brand_mix' || i.code === 'address'), 'địa chỉ The One trong bài Dark Hair');
  const name = ce.review('Đến The One Hair Salon để nhuộm tóc nhé, nhắn tin đặt lịch. #a #b #c', { brand: dh, category: 'service' });
  assert.ok(name.issues.some((i) => i.code === 'brand_mix'));

  const phone = ce.review(good + '\nGọi 0988 111 222 để đặt lịch', { brand: dh, category: 'service' });
  assert.ok(phone.issues.some((i) => i.code === 'hotline' && i.level === 'block'));

  const price = ce.review('Nhuộm chỉ 299k, giảm 30% hôm nay. Nhắn tin đặt lịch nhé #a #b #c', { brand: dh, category: 'service' });
  assert.ok(price.issues.some((i) => i.code === 'offer'));
  assert.ok(price.score < 85);

  const fake = ce.review('Khách hàng chia sẻ: "Tóc mình đẹp hơn mong đợi, cảm ơn salon rất nhiều". Nhắn tin đặt lịch nhé #a #b #c', { brand: dh, category: 'service' });
  assert.ok(fake.issues.some((i) => i.code === 'fake_review'));

  const voice = ce.review('Dạ chị yêu ơi, bên em có nhuộm đẹp lắm. Nhắn tin đặt lịch nhé #a #b #c', { brand: dh, category: 'service' });
  assert.ok(voice.issues.some((i) => i.code === 'voice'));
  const promise = ce.review('Cam kết 100% không hư tóc, tốt nhất Sài Gòn. Nhắn tin đặt lịch #a #b #c', { brand: dh, category: 'service' });
  assert.ok(promise.issues.some((i) => i.code === 'promise'));
});

test('QC: hotline đã xác nhận được dùng; bài ưu đãi khi chưa có ưu đãi → cần bổ sung, không bịa', () => {
  const to = brand('the_one');
  const withPhone = ce.review('Nhắn tin đặt lịch nhé.\n☎ Hotline: 0909 123 456 #a #b #c', { brand: to, category: 'service' });
  assert.ok(!withPhone.issues.some((i) => i.code === 'hotline'));
  const promo = ce.review('Ưu đãi tháng này đang chờ bạn. Nhắn tin đặt lịch nhé #a #b #c', { brand: to, category: 'promo' });
  assert.strictEqual(promo.status, 'needs_info');
  assert.ok(promo.needsInfo.length);
  assert.ok(promo.issues.some((i) => i.code === 'offer'), 'nhắc "ưu đãi" mà chưa có dữ liệu xác nhận');
});

test('QC: trùng bài cũ bị phạt', () => {
  const db = load();
  const text = 'Mái tóc nhuộm lên màu đẹp phụ thuộc rất nhiều vào nền tóc hiện tại của bạn nên stylist luôn xem tóc trước khi tư vấn tone phù hợp cho từng người. Nhắn tin đặt lịch nhé #a #b #c';
  db.posts.unshift({ id: 'old1', brand: 'dark_hair', channel: 'facebook_page', topic: 'cũ', text, status: 'scheduled', scheduledAt: new Date(Date.now() + 864e5).toISOString() });
  const r = ce.review(text, { brand: brand('dark_hair'), category: 'service' });
  assert.ok(r.issues.some((i) => i.code === 'duplicate' && i.level === 'block'));
  db.posts = db.posts.filter((p) => p.id !== 'old1');
});

test('produce: AI viết lỗi → QC đưa phản hồi → viết lại; tối đa 3 lần; AI lỗi thì dùng mẫu và nói rõ', async () => {
  const orig = ai.ask;
  const calls = [];
  try {
    ai.ask = async (sys, user) => {
      calls.push(user);
      if (calls.length === 1) return JSON.stringify({ versions: [{ text: 'Nhuộm chỉ 199k, giảm 50% hôm nay!! Nhắn tin đặt lịch nhé #a #b #c' }] });
      return JSON.stringify({ versions: [{ text: 'Chọn tone màu hợp với nền tóc là bước quan trọng nhất trước khi nhuộm. Stylist sẽ tư vấn kỹ cho bạn.\n\nNhắn tin để đặt lịch nhé.\n\n#nhuomtoc #darkhair #tocdep' }] });
    };
    const slot = { at: new Date(Date.now() + 864e5), category: 'service', topic: 'Giới thiệu dịch vụ nhuộm', service: 'nhuộm tóc' };
    const r = await ce.produce(brand('dark_hair'), slot, {});
    assert.strictEqual(calls.length, 2, 'viết lần đầu + 1 lần viết lại');
    assert.match(calls[1], /BẢN TRƯỚC/);
    assert.match(calls[1], /giá\/ưu đãi/);
    assert.strictEqual(r.qc.attempts, 1);
    assert.strictEqual(r.qc.status, 'ok');
    assert.doesNotMatch(r.text, /199k/);
    assert.match(r.text, /104 Cống Quỳnh/, 'địa chỉ do hệ thống chèn từ dữ liệu thương hiệu');
    assert.doesNotMatch(r.text, /Đỗ Thị Lời/);

    // luôn viết sai → dừng sau đúng 3 lần viết lại, trạng thái cần sửa
    calls.length = 0;
    ai.ask = async (s, u) => { calls.push(u); return JSON.stringify({ versions: [{ text: 'Cam kết 100% giảm 50% chỉ 99k! Nhắn tin đặt lịch #a #b #c' }] }); };
    const bad = await ce.produce(brand('dark_hair'), slot, {});
    assert.strictEqual(calls.length, 1 + ce.MAX_REWRITES);
    assert.notStrictEqual(bad.qc.status, 'ok');

    // AI lỗi → dùng mẫu, nói rõ lý do, không ném lỗi
    ai.ask = async () => { throw new Error('hết hạn mức'); };
    const tpl = await ce.produce(brand('dark_hair'), slot, {});
    assert.strictEqual(tpl.mode, 'template');
    assert.ok(tpl.qc.issues.some((i) => i.code === 'template' && /hết hạn mức/.test(i.msg)));
  } finally { ai.ask = orig; }
});

test('kế hoạch tháng: có điểm QC + nhóm chủ đề; không tạo trùng ngày; duyệt bị chặn khi bài vi phạm cứng', async () => {
  const plan = await planner.create({ brand: 'dark_hair', channel: 'facebook_page', type: 'post', time: '09:00', days: [1, 2, 3, 4, 5, 6, 7], month: futureMonth });
  assert.ok(plan.items.length >= 28);
  assert.ok(plan.items.every((i) => i.qc && typeof i.qc.score === 'number' && i.category));
  const days = plan.items.map((i) => ymd(new Date(i.at)));
  assert.strictEqual(new Set(days).size, days.length, 'mỗi ngày 1 bài');
  assert.ok(plan.items.every((i) => /104 Cống Quỳnh/.test(i.text) && !/Đỗ Thị Lời/.test(i.text)), 'Dark Hair không lẫn địa chỉ The One');
  await assert.rejects(() => planner.create({ brand: 'dark_hair', channel: 'facebook_page', type: 'post', time: '09:00', days: [1, 2, 3], month: futureMonth }), /trùng ngày/);

  // bịa hotline vào 1 bài → không duyệt được
  planner.editItem(plan.id, plan.items[0].id, { text: plan.items[0].text + '\nGọi ngay 0977 000 111' });
  assert.ok(plan.items[0].qc.issues.some((i) => i.code === 'hotline'), 'sửa xong được chấm lại ngay');
  assert.throws(() => planner.approve(plan.id), /chưa duyệt được/);
  planner.editItem(plan.id, plan.items[0].id, { selected: false });
  const n = planner.approve(plan.id);
  assert.strictEqual(n, plan.items.length - 1);
  const p = load().posts.find((x) => x.planId === plan.id);
  assert.ok(p.category && p.qc && p.aiText === undefined, 'bài mẫu (không AI) không có bản AI viết');
});

test('duyệt bài lẻ: thiếu dữ liệu ưu đãi hoặc hotline bịa thì chặn; sửa rồi duyệt được và được ghi vào kho ví dụ', async () => {
  const db = load();
  const mk = (text, extra = {}) => {
    const post = { id: `px${Math.random().toString(36).slice(2, 7)}`, brand: 'the_one', channel: 'facebook_page', topic: 't', text, status: 'draft', scheduledAt: new Date(Date.now() + 864e5).toISOString(), ...extra };
    db.posts.unshift(post);
    const a = { id: `ap${post.id}`, type: 'post_publish', key: post.id, status: 'pending', at: new Date().toISOString(), title: 't', detail: text, payload: { postId: post.id } };
    db.approvals.unshift(a);
    return { post, a };
  };
  const promo = mk('Ưu đãi lớn tháng này, nhắn tin đặt lịch nhé #a #b #c', { category: 'promo' });
  await assert.rejects(() => engine.decide(promo.a.id, true), /Thiếu dữ liệu/);
  const phone = mk('Nhắn tin hoặc gọi 0901 222 333 để đặt lịch #a #b #c');
  await assert.rejects(() => engine.decide(phone.a.id, true), /khác hotline|chưa được xác nhận/);

  const okp = mk('Chọn tone màu hợp nền tóc là bước quan trọng khi nhuộm. Nhắn tin để stylist tư vấn và đặt lịch nhé.\n#nhuomtoc #theone #tocdep', { aiText: 'Bản AI viết ban đầu khác với bản cuối, Sếp đã sửa lại câu chữ cho tự nhiên hơn.', category: 'knowledge' });
  await engine.decide(okp.a.id, true);
  assert.strictEqual(okp.post.status, 'scheduled');
  const ex = load().approvedExamples.find((e) => e.finalText === okp.post.text);
  assert.ok(ex && ex.edited === true, 'bài Sếp sửa được lưu làm ví dụ');
});

test('learning: đề xuất bài học (chờ duyệt) khi Sếp lặp lại cùng chỉnh sửa; không tự áp dụng', () => {
  const db = load();
  db.approvedExamples = [];
  for (let i = 0; i < 3; i++) learning.capture({ brand: 'the_one', topic: 't' + i, aiText: `Bài ${i} dùng chữ hoàn hảo trong nội dung quảng bá dịch vụ`, finalText: `Bài ${i} trong nội dung quảng bá dịch vụ` });
  const st = learning.diffStats('the_one');
  assert.ok(st.removed.some((r) => r.word === 'hoàn' || r.word === 'hảo'));
  assert.ok(learning.run() >= 1);
  const l = db.lessons.find((x) => /hoàn|hảo/.test(x.text));
  assert.ok(l && l.status === 'pending' && l.scope === 'the_one');
  assert.strictEqual(learning.run(), 0, 'chạy lại không đề xuất trùng');
});

test('đăng: bài quá giờ bị bỏ lỡ (không đăng bất ngờ); kiểm tra lại trước khi đăng giữ bài có ưu đãi hết hạn; chạy thử không đăng', async () => {
  const db = load();
  db.settings.dryRun = false;
  db.settings.paused = false;
  const base = { brand: 'the_one', channel: 'facebook_page', topic: 'x', status: 'scheduled' };
  const late = { id: 'late1', ...base, text: 'Nhắn tin đặt lịch nhé #a #b #c', scheduledAt: new Date(Date.now() - 10 * HOUR).toISOString() };
  const stale = { id: 'stale1', ...base, text: 'Ưu đãi giảm 30% đến hết tuần, nhắn tin đặt lịch #a #b #c', scheduledAt: new Date(Date.now() - 60e3).toISOString() };
  db.posts.unshift(late, stale);
  try { await engine.runAgent('content', 'manual'); } catch { /* không có Page: lỗi cấu hình là bình thường */ }
  assert.strictEqual(late.status, 'missed');
  assert.strictEqual(stale.status, 'scheduled', 'không đăng');
  assert.match(stale.skipReason || '', /Kiểm tra lại trước khi đăng/);
  // hẹn lại bài bỏ lỡ
  const cal = require('../src/calendar-api');
  cal.reschedule('late1', new Date(Date.now() + 2 * HOUR).toISOString());
  assert.strictEqual(late.status, 'scheduled');
  db.settings.dryRun = true;
});

test('API: dữ liệu động, trạng thái 8 agent, thống kê (không bịa chỉ số Facebook), viết lại bài', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body) => { const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json() }; };
  const orig = ai.ask;
  try {
    const g = await call('GET', '/api/brands/the_one/facts');
    assert.strictEqual(g.status, 200);
    assert.ok(g.json.facts.find((f) => f.key === 'hotline'));
    const put = await call('PUT', '/api/brands/dark_hair/facts/hotline', { value: '0912 345 678', verified: true });
    assert.strictEqual(put.status, 200);
    assert.strictEqual(put.json.facts.find((f) => f.key === 'hotline').state, 'current');
    assert.strictEqual((await call('PUT', '/api/brands/dark_hair/facts/khac', { value: 'x' })).status, 400);
    assert.strictEqual((await call('PUT', '/api/brands/nope/facts/hotline', { value: '0912 345 678' })).status, 404);

    const pl = await call('GET', '/api/content/pipeline');
    assert.strictEqual(pl.status, 200);
    assert.deepStrictEqual(pl.json.agents.map((a) => a.id), ['brand_knowledge', 'strategy', 'copywriter', 'qc', 'learning', 'scheduling', 'publishing', 'analytics']);
    const pub = pl.json.agents.find((a) => a.id === 'publishing');
    assert.match(pub.headline, /CHẠY THỬ/);
    assert.ok(!JSON.stringify(pl.json).includes('EAA'), 'không lộ token');
    assert.strictEqual(pl.json.agents.find((a) => a.id === 'copywriter').status, 'warn', 'chưa có khoá AI thì cảnh báo, không giả vờ');

    const an = await call('GET', `/api/content/analytics?month=${futureMonth}`);
    assert.strictEqual(an.status, 200);
    assert.ok(an.json.total.total > 0);
    assert.strictEqual(an.json.metrics.available, false);

    // viết lại bài trong kế hoạch + bài lẻ
    const post = load().posts.find((p) => p.planId && p.brand === 'dark_hair');
    ai.ask = async () => JSON.stringify({ versions: [{ text: 'Nhuộm tóc đẹp bắt đầu từ việc hiểu nền tóc của bạn. Stylist sẽ tư vấn tone phù hợp.\n\nNhắn tin để đặt lịch nhé.\n\n#nhuomtoc #darkhair #tocdep' }] });
    const rw = await call('POST', `/api/posts/${post.id}/rewrite`, { instruction: 'ngắn hơn' });
    assert.strictEqual(rw.status, 200);
    assert.match(load().posts.find((p) => p.id === post.id).text, /hiểu nền tóc/);
    assert.ok(rw.json.qc.score >= 85);
    const qc = await call('POST', `/api/posts/${post.id}/qc`);
    assert.strictEqual(qc.status, 200);
    assert.strictEqual((await call('POST', '/api/posts/khong-co/qc')).status, 404);
    ai.ask = orig;
    assert.strictEqual((await call('POST', `/api/posts/${post.id}/rewrite`, {})).status, 400, 'chưa có AI thì báo rõ, không giả vờ viết lại');

    // bài lẻ qua hộp "Soạn bài mới": có điểm QC
    const np = await call('POST', '/api/posts', { brand: 'dark_hair', channel: 'facebook_page', topic: 'Nhuộm balayage', scheduledAt: new Date(Date.now() + 3 * 864e5).toISOString() });
    assert.strictEqual(np.status, 200);
    const created = np.json.posts[0];
    assert.ok(created.qc && created.qc.score >= 0);
    // tích "Duyệt luôn" mà bài thiếu dữ liệu ưu đãi → bị chặn, nói rõ lý do
    const bad = await call('POST', '/api/posts', { brand: 'dark_hair', channel: 'facebook_page', topic: 'Ưu đãi nhuộm tháng này', approveNow: true, scheduledAt: new Date(Date.now() + 4 * 864e5).toISOString() });
    assert.strictEqual(bad.status, 400);
    assert.match(bad.json.error, /Thiếu dữ liệu|chưa duyệt được/);
  } finally { ai.ask = orig; server.close(); }
});
