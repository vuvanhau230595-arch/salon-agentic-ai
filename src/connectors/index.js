const mock = require('./ads-mock');
const meta = require('./ads-meta');
// Có token Meta = chế độ thật; tài khoản quảng cáo/Trang lấy theo từng thương hiệu
const live = !!process.env.META_ACCESS_TOKEN;
module.exports = { ads: live ? meta : mock, social: require('./social') };
