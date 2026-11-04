const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
process.env.DB_FILE = path.join(os.tmpdir(), `agent-br-test-${process.pid}.json`);
require('node:fs').rmSync(process.env.DB_FILE, { force: true });
delete process.env.ANTHROPIC_API_KEY;

const planner = require('../src/planner');

test('mặc định: 3 thương hiệu, đủ 5 kênh, chỉ Facebook Page bật (Mishang là trang cá nhân nên tắt)', () => {
  const b = planner.brands();
  assert.deepStrictEqual(Object.keys(b), ['the_one', 'dark_hair', 'mishang']);
  assert.deepStrictEqual(Object.keys(b.the_one.channels), planner.BRAND_CHANNELS);
  for (const brand of Object.values(b)) {
    for (const [ch, v] of Object.entries(brand.channels)) assert.strictEqual(v.on, ch === 'facebook_page' && brand.id !== 'mishang', `${brand.id}/${ch}`);
  }
});

test('cập nhật hồ sơ và kênh, giữ nguyên các trường khác', () => {
  planner.updateBrand('dark_hair', { hotline: ' 0900 111 222 ', avoid: 'không nêu giá' });
  planner.updateBrand('dark_hair', { channels: { instagram: { on: true, handle: '@darkhair' } } });
  planner.updateBrand('dark_hair', { channels: { instagram: { handle: '@darkhair.vn' } } });
  const b = planner.brands().dark_hair;
  assert.strictEqual(b.hotline, '0900 111 222');
  assert.strictEqual(b.name, 'Dark Hair');
  assert.deepStrictEqual(b.channels.instagram, { on: true, handle: '@darkhair.vn' });
  assert.strictEqual(b.channels.tiktok.on, false);
});

test('từ chối tên rỗng, thương hiệu lạ; bỏ qua kênh/trường không hợp lệ', () => {
  assert.throws(() => planner.updateBrand('the_one', { name: '  ' }), /không được để trống/);
  assert.throws(() => planner.updateBrand('khong_co', { name: 'x' }), /không tồn tại/);
  planner.updateBrand('the_one', { channels: { hack: { on: true } }, evil: 'x' });
  const b = planner.brands().the_one;
  assert.strictEqual(b.channels.hack, undefined);
  assert.strictEqual(b.evil, undefined);
});

test('ngữ cảnh AI có luật cấm; bài mẫu có hotline', async () => {
  planner.updateBrand('dark_hair', { tone: 'thân thiện', services: 'nhuộm, uốn' });
  const b = planner.brands().dark_hair;
  const ctx = planner.brandContext(b);
  assert.match(ctx, /TUYỆT ĐỐI KHÔNG nói\/hứa: không nêu giá/);
  assert.match(ctx, /Giọng văn: thân thiện/);
  require('../src/brand-facts').set('dark_hair', 'hotline', { value: '0900 111 222', verified: true }); // hotline chỉ vào bài khi đã xác nhận
  const month = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 7);
  const plan = await planner.create({ brand: 'dark_hair', channel: 'instagram', type: 'post', time: '19:00', days: [1], month });
  assert.ok(plan.items[0].text.includes('0900 111 222'));
});
