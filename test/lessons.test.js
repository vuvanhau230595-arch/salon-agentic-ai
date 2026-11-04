const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
process.env.DB_FILE = path.join(os.tmpdir(), `agent-ls-test-${process.pid}.json`);
require('node:fs').rmSync(process.env.DB_FILE, { force: true });
delete process.env.ANTHROPIC_API_KEY;

const { load } = require('../src/db');
const lessons = require('../src/lessons');
const planner = require('../src/planner');
const engine = require('../src/engine');

const month = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 7);
const mk = () => planner.create({ brand: 'the_one', channel: 'facebook_page', type: 'post', time: '19:00', days: [1, 3, 5], month });

test('bài học tay áp dụng ngay; bài máy đề xuất phải chờ xác nhận', () => {
  const a = lessons.add({ text: 'Không dùng quá 2 emoji', scope: 'all', source: 'manual' });
  const b = lessons.add({ text: 'Ưu tiên ảnh before/after', scope: 'the_one', source: 'auto' });
  assert.strictEqual(a.status, 'active');
  assert.strictEqual(b.status, 'pending');
  assert.throws(() => lessons.add({ text: 'Không dùng quá 2 emoji', scope: 'all' }), /đã có/);
  assert.throws(() => lessons.add({ text: '   ' }), /trống/);
});

test('chỉ bài học đang áp dụng mới vào lời nhắc AI, đúng phạm vi', () => {
  assert.match(lessons.activeText(), /Không dùng quá 2 emoji/);
  assert.doesNotMatch(lessons.activeText('the_one'), /before\/after/, 'bài chờ xác nhận chưa được dùng');
  const id = load().lessons.find((l) => l.scope === 'the_one').id;
  lessons.update(id, { status: 'active' });
  assert.match(planner.brandContext(planner.brands().the_one), /before\/after/);
  assert.doesNotMatch(planner.brandContext(planner.brands().dark_hair), /before\/after/, 'không rò sang thương hiệu khác');
  lessons.update(id, { status: 'disabled' });
  assert.doesNotMatch(planner.brandContext(planner.brands().the_one), /before\/after/);
  assert.throws(() => lessons.update(id, { status: 'hack' }), /không hợp lệ/);
});

test('sửa bài và bỏ chọn bài được ghi lại; đề xuất bài học từ số liệu thật', async () => {
  const db = load();
  db.feedback = [];
  const plan = await mk();
  const long = plan.items.slice(0, 3);
  for (const it of long) { const half = it.text.slice(0, Math.floor(it.text.length * 0.5)); planner.editItem(plan.id, it.id, { text: half }); }
  assert.strictEqual(db.feedback.filter((e) => e.type === 'edit').length, 3);
  // không đổi gì thì không ghi
  planner.editItem(plan.id, long[0].id, { text: long[0].text });
  assert.strictEqual(db.feedback.length, 3);

  planner.editItem(plan.id, plan.items[3].id, { selected: false });
  planner.approve(plan.id);
  assert.ok(db.feedback.some((e) => e.type === 'reject' && e.kind === 'plan_item'));

  const r = await lessons.suggest();
  assert.ok(r.added >= 1);
  assert.ok(db.lessons.some((l) => l.status === 'pending' && /rút ngắn/.test(l.text)));
  assert.strictEqual((await lessons.suggest()).added, 0, 'chạy lại không tạo trùng');
});

test('bỏ qua bài chờ duyệt ghi nhận phản hồi; chủ đề bị bỏ 2 lần thành đề xuất', async () => {
  const db = load();
  db.feedback = [];
  for (let i = 0; i < 2; i++) {
    const post = { id: `po${i}`, channel: 'facebook_page', brand: 'the_one', topic: 'Giảm giá sốc', text: 'x', scheduledAt: new Date().toISOString(), status: 'draft' };
    db.posts.push(post);
    db.approvals.push({ id: `ap${i}`, type: 'post_publish', key: post.id, status: 'pending', at: new Date().toISOString(), title: 't', detail: 'd', payload: { postId: post.id } });
    await engine.decide(`ap${i}`, false);
  }
  assert.strictEqual(db.feedback.length, 2);
  assert.ok(lessons.heuristics().some((h) => h.scope === 'the_one' && /Giảm giá sốc.*2 lần/.test(h.text)));
});

test('xóa bài học', () => {
  const id = load().lessons[0].id;
  lessons.remove(id);
  assert.ok(!load().lessons.some((l) => l.id === id));
  assert.throws(() => lessons.remove(id), /Không tìm thấy/);
});
