const test = require('node:test');
const assert = require('node:assert');
const { lintText, avoidTerms } = require('../src/brandcheck');

test('tách cụm cần tránh từ "Điều không được nói"', () => {
  assert.deepStrictEqual(avoidTerms('không nêu giá; không hứa hẹn kết quả'), ['giá', 'hẹn kết quả']);
});
test('bài nhắc điều bị cấm, lời hứa, giá tự chế → cảnh báo', () => {
  const r = lintText('Cam kết 100% đẹp, giảm 30% hôm nay! #a', { avoid: 'không nhắc đối thủ ABC' });
  assert.ok(r.issues.some((i) => /tuyệt đối|Lời hứa/.test(i.msg)));
  assert.ok(r.issues.some((i) => /giá\/khuyến mãi/.test(i.msg)));
  assert.strictEqual(r.ok, false);
  assert.ok(lintText('Hơn đối thủ ABC nhé, nhắn tin đặt lịch #a', { avoid: 'không nhắc đối thủ ABC' }).issues.some((i) => /ABC/.test(i.msg)));
});
test('bài sạch: không cảnh báo mức warn; giá được phép khi Sếp đã nêu', () => {
  assert.strictEqual(lintText('Nhuộm đẹp tự nhiên, nhắn tin đặt lịch nhé #nhuom #theone', {}).ok, true);
  assert.strictEqual(lintText('Giảm 20% tháng này, inbox ngay #sale', {}, { priceAllowed: true }).ok, true);
});
