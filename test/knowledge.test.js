const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-kb-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
process.env.MEDIA_DIR = path.join(tmp, 'media');
delete process.env.APP_PASSWORD;
delete process.env.META_ACCESS_TOKEN;
delete process.env.ANTHROPIC_API_KEY;

const { load } = require('../src/db');
const lessons = require('../src/lessons');
const planner = require('../src/planner');
const engine = require('../src/engine');
const audit = require('../src/audit');
const kb = require('../src/knowledge-api');
const { server } = require('../src/server');
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

let base;
const get = (p) => fetch(base + p);
const send = (method, p, body) => fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });

test('khởi động server thử', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test('AI/số liệu quảng cáo/luật tự động KHÔNG bao giờ tạo được bài học đang áp dụng, kể cả cố truyền status; chỉ Sếp mới được', () => {
  for (const source of ['ai', 'ads', 'auto']) {
    const l = lessons.add({ text: `Đề xuất từ ${source}`, source, status: 'active' });
    assert.strictEqual(l.status, 'pending', source);
  }
  const m = lessons.add({ text: 'Của Sếp', source: 'manual' });
  assert.strictEqual(m.status, 'active');
  assert.strictEqual(lessons.add({ text: 'Sếp nhưng để tắt', source: 'manual', status: 'disabled' }).status, 'disabled');
  assert.throws(() => lessons.add({ text: 'x', source: 'manual', status: 'hack' }), /không hợp lệ/);
  // lời nhắc AI không chứa bài chờ duyệt
  assert.doesNotMatch(lessons.activeText(), /Đề xuất từ ai/);
  assert.match(lessons.activeText(), /Của Sếp/);
});

test('nhóm bài học: mặc định theo nguồn, kiểm tra hợp lệ, lưu bằng chứng; lịch sử thay đổi', () => {
  const db = load();
  const byText = (t) => db.lessons.find((l) => l.text === t);
  assert.strictEqual(byText('Đề xuất từ ads').category, 'ads');
  assert.strictEqual(byText('Đề xuất từ ai').category, 'feedback');
  assert.strictEqual(byText('Của Sếp').category, 'content');
  assert.throws(() => lessons.add({ text: 'Sai nhóm', category: 'khong-co' }), /Nhóm bài học không hợp lệ/);
  const r = lessons.add({ text: 'Luôn mời nhắn tin đặt lịch', category: 'rule', evidence: '  Sếp yêu cầu  ' });
  assert.strictEqual(r.category, 'rule');
  assert.strictEqual(r.evidence, 'Sếp yêu cầu');
  // duyệt đề xuất → lịch sử ghi "Duyệt và áp dụng"
  const p = byText('Đề xuất từ ai');
  lessons.update(p.id, { status: 'active' });
  assert.strictEqual(p.history[0].what, 'Duyệt và áp dụng');
  assert.strictEqual(p.history[0].by, 'Sếp');
  assert.strictEqual(p.history.at(-1).what, 'Đề xuất bài học (chờ Sếp duyệt)');
  lessons.update(p.id, { status: 'disabled', category: 'mistake', text: 'Đề xuất từ ai (đã sửa)' });
  assert.deepStrictEqual(p.history.slice(0, 3).map((h) => h.what.split(':')[0]), ['Đổi nhóm', 'Sửa nội dung', 'Đổi trạng thái']);
  assert.throws(() => lessons.update(p.id, { category: 'x' }), /Nhóm/);
  assert.throws(() => lessons.update(p.id, { scope: 'khong-co' }), /Phạm vi/);
  assert.throws(() => lessons.update(p.id, { text: 'Của Sếp', scope: 'all' }), /đã có/);
  lessons.update(p.id, { scope: 'the_one' });
  assert.strictEqual(p.scope, 'the_one');
});

test('đếm số lần bài học được đưa vào lời nhắc AI; xem trước lời nhắc không tính vào số lần', () => {
  const db = load();
  const one = lessons.add({ text: 'Chỉ cho The One: ảnh before/after', scope: 'the_one', source: 'manual' });
  const shared = db.lessons.find((l) => l.text === 'Của Sếp');
  db.lessonUse = {};
  lessons.activeText();
  lessons.activeText();
  assert.strictEqual(db.lessonUse[shared.id].count, 2);
  assert.strictEqual(db.lessonUse[one.id], undefined, 'bài của thương hiệu khác chưa được dùng');
  planner.brandContext(planner.brands().the_one);
  assert.strictEqual(db.lessonUse[one.id].count, 1);
  const before = JSON.stringify(db.lessonUse);
  const pv = kb.preview('the_one');
  assert.strictEqual(JSON.stringify(db.lessonUse), before, 'xem trước không làm tăng bộ đếm');
  assert.match(pv.text, /Chỉ cho The One: ảnh before\/after/);
  assert.match(pv.text, /Của Sếp/);
  assert.doesNotMatch(pv.text, /Đề xuất từ ads/, 'bài chờ duyệt không có trong lời nhắc');
  assert.doesNotMatch(pv.text, /đã sửa/, 'bài đã tắt không có trong lời nhắc');
  const dh = kb.preview('dark_hair');
  assert.doesNotMatch(dh.text, /before\/after/, 'không rò bài học sang thương hiệu khác');
  assert.throws(() => kb.preview('khong-co'), /không tồn tại/);
});

test('xem trước lời nhắc gồm quy chuẩn thương hiệu: giọng văn, điều cấm, hashtag, khẩu hiệu', () => {
  planner.updateBrand('dark_hair', { services: '', tone: 'Chuyên nghiệp', avoid: 'không nêu giá', hashtags: '#darkhair', tagline: 'Giá minh bạch' });
  const t = kb.preview('dark_hair').text;
  assert.match(t, /Giọng văn: Chuyên nghiệp/);
  assert.match(t, /TUYỆT ĐỐI KHÔNG nói\/hứa: không nêu giá/);
  assert.match(t, /Hashtag ưu tiên của thương hiệu: #darkhair/);
  assert.match(t, /Khẩu hiệu thương hiệu: Giá minh bạch/);
  const s = kb.standards().find((x) => x.id === 'dark_hair');
  assert.deepStrictEqual([s.filled, s.total], [4, 5]); // thiếu dịch vụ
  assert.strictEqual(kb.standards().find((x) => x.id === 'mishang').filled, 0);
});

test('mẫu nội dung hiệu quả: chỉ bài thử quảng cáo ĐẠT, mới nhất trước, đánh dấu đã lưu thành bài học', () => {
  const db = load();
  db.adTests = [
    { id: 't1', brand: 'the_one', topic: 'Nhuộm nâu', status: 'pass', spend: 600000, msgs: 8, finishedAt: '2026-10-10T00:00:00Z' },
    { id: 't2', brand: 'dark_hair', topic: 'Uốn', status: 'fail', spend: 500000, msgs: 0, finishedAt: '2026-10-11T00:00:00Z' },
    { id: 't3', brand: 'mishang', topic: 'Nối mi', status: 'pass', spend: 300000, msgs: 10, finishedAt: '2026-10-12T00:00:00Z' },
    { id: 't4', brand: 'mishang', topic: 'Đang chạy', status: 'running' },
  ];
  lessons.add({ text: 'Nhuộm nâu hiệu quả', evidence: 'Quảng cáo thử t1: 75.000đ/tin' });
  const e = kb.effectivePatterns();
  assert.deepStrictEqual(e.map((x) => [x.id, x.cpl, x.saved]), [['t3', 30000, false], ['t1', 75000, true]]);
  assert.strictEqual(e[0].brandName, 'Mishang Beauty');
});

test('lỗi đã xảy ra: gộp lỗi giống nhau (bỏ mã số), đếm, xếp theo số lần, nhận biết đã ghi thành bài học', () => {
  const db = load();
  db.actions = [];
  for (let i = 0; i < 4; i++) engine.log('error', `Không đọc được bình luận của The One (Page 11190768792444${i}): Token thiếu quyền X`);
  engine.log('error', 'Agent Quảng cáo lỗi: Chưa gán tài khoản quảng cáo');
  engine.log('system', 'không phải lỗi');
  const errs = kb.errorsSummary();
  assert.strictEqual(errs[0].count, 4);
  assert.match(errs[0].key, /Không đọc được bình luận của The One \(Page #\)/);
  assert.strictEqual(errs[1].count, 1);
  assert.ok(errs.every((x) => x.lastAt && x.firstAt));
  assert.strictEqual(errs[0].saved, false);
  lessons.add({ text: 'Cần quyền pages_read_user_content để đọc bình luận', category: 'mistake', evidence: `Lỗi lặp 4 lần: ${errs[0].key.slice(0, 60)}` });
  assert.strictEqual(kb.errorsSummary()[0].saved, true);
  // lỗi cũ hơn 30 ngày không tính
  const old = audit.normalize('error', 'Lỗi rất cũ', {}, Date.now() - 40 * 864e5);
  fs.appendFileSync(audit.file(), JSON.stringify(old) + '\n');
  assert.ok(!kb.errorsSummary().some((x) => /Lỗi rất cũ/.test(x.text)));
});

test('/api/knowledge: tổng hợp đủ phần, đếm theo trạng thái và nhóm, có phản hồi của Sếp', async () => {
  const db = load();
  db.feedback = [{ id: 'f1', at: new Date().toISOString(), type: 'reject', kind: 'post_publish', brand: 'the_one', topic: 'Chủ đề X' }];
  const j = await (await get('/api/knowledge')).json();
  assert.ok(j.categories.rule && j.categories.mistake);
  assert.strictEqual(j.counts.total, j.lessons.length);
  assert.strictEqual(j.counts.pending + j.counts.active + j.counts.disabled, j.counts.total);
  assert.ok(Object.values(j.counts.byCategory).reduce((a, b) => a + b, 0) === j.counts.total);
  assert.ok(j.lessons.every((l) => l.category && Array.isArray(l.history) && l.uses));
  assert.strictEqual(j.standards.length, 3);
  assert.strictEqual(j.feedbackTotal, 1);
  assert.strictEqual(j.hasAi, false);
  const pv = await (await get('/api/knowledge/preview?brand=the_one')).json();
  assert.ok(pv.text.length > 10);
  assert.strictEqual((await get('/api/knowledge/preview?brand=khong-co')).status, 404);
});

test('duyệt/tắt/xoá hàng loạt: từng bài xử lý riêng, ghi nhật ký; lỗi một bài không chặn bài khác', async () => {
  const db = load();
  const a = lessons.add({ text: 'Chờ duyệt A', source: 'ai' }), b = lessons.add({ text: 'Chờ duyệt B', source: 'ads' });
  db.actions = [];
  let r = await (await send('POST', '/api/knowledge/bulk', { ids: [a.id, 'khong-co', b.id], action: 'activate' })).json();
  assert.deepStrictEqual(r.results.map((x) => x.ok), [true, false, true]);
  assert.strictEqual(a.status, 'active');
  assert.strictEqual(a.history[0].what, 'Duyệt và áp dụng');
  assert.ok(audit.query({ kind: 'lesson' }).rows.some((e) => /duyệt\/bật bài học: "Chờ duyệt A"/.test(e.action) && e.actor.name === 'Sếp'));
  r = await (await send('POST', '/api/knowledge/bulk', { ids: [a.id], action: 'disable' })).json();
  assert.strictEqual(a.status, 'disabled');
  r = await (await send('POST', '/api/knowledge/bulk', { ids: [a.id, b.id], action: 'delete' })).json();
  assert.ok(!load().lessons.some((l) => l.id === a.id || l.id === b.id));
  assert.ok(r.counts && r.lessons);
  assert.strictEqual((await send('POST', '/api/knowledge/bulk', { ids: [], action: 'delete' })).status, 400);
  assert.strictEqual((await send('POST', '/api/knowledge/bulk', { ids: ['x'], action: 'khac' })).status, 400);
  assert.strictEqual((await send('POST', '/api/knowledge/bulk', { ids: Array.from({ length: 101 }, (_, i) => 'x' + i), action: 'delete' })).status, 400);
});

test('thêm/sửa/xoá qua API: nhận nhóm + bằng chứng, từ chối sai; nhật ký ghi trước → sau', async () => {
  let r = await send('POST', '/api/lessons', { text: 'Bài học qua API', scope: 'the_one', category: 'ads', evidence: 'Dữ liệu 7 ngày' });
  assert.strictEqual(r.status, 200);
  const l = load().lessons.find((x) => x.text === 'Bài học qua API');
  assert.deepStrictEqual([l.category, l.evidence, l.status, l.scope], ['ads', 'Dữ liệu 7 ngày', 'active', 'the_one']);
  assert.strictEqual((await send('POST', '/api/lessons', { text: 'Sai nhóm', category: 'zzz' })).status, 400);
  assert.strictEqual((await send('POST', '/api/lessons', { text: 'Bài học qua API', scope: 'the_one' })).status, 400, 'trùng');
  r = await send('PUT', `/api/lessons/${l.id}`, { status: 'disabled', category: 'rule' });
  assert.strictEqual(r.status, 200);
  const logs = audit.query({ kind: 'lesson' }).rows;
  assert.ok(logs.some((e) => e.field === 'status' && e.before === 'active' && e.after === 'disabled'));
  assert.ok(logs.some((e) => e.field === 'category' && e.before === 'ads' && e.after === 'rule'));
  assert.strictEqual((await send('PUT', `/api/lessons/${l.id}`, { status: 'hack' })).status, 400);
  assert.strictEqual((await send('PUT', '/api/lessons/khong-co', { status: 'active' })).status, 400);
  r = await fetch(`${base}/api/lessons/${l.id}`, { method: 'DELETE' });
  assert.strictEqual(r.status, 200);
  assert.ok(audit.query({ kind: 'lesson' }).rows.some((e) => /xoá bài học AI: "Bài học qua API"/.test(e.action)));
});
