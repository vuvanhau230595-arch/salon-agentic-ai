// Ngữ cảnh người dùng của yêu cầu đang xử lý (AsyncLocalStorage): để nhật ký/duyệt ghi ĐÚNG tên người thao tác
// thay vì chữ "Sếp" cố định. Việc chạy nền (agent, lịch quét) không có người dùng.
const { AsyncLocalStorage } = require('node:async_hooks');

const als = new AsyncLocalStorage();
const runAs = (user, fn) => als.run({ user }, fn);
const currentUser = () => (als.getStore() || {}).user || null;
// Tên hiển thị người đang thao tác; không có ai thì trả về mặc định (thường là "Sếp")
const actorName = (fallback = 'Sếp') => { const u = currentUser(); return u && u.name ? u.name : fallback; };

module.exports = { runAs, currentUser, actorName };
