// Mẫu trả lời tiếng Việt theo giọng nhân viên The One, rút từ hội thoại thật trên Pancake (Messenger).
// Quy trình nhân viên đang làm: hỏi độ dài tóc → báo giá theo size kèm ưu đãi "áp dụng khi đặt lịch trước" →
// nhắc quà tặng kèm → hỏi số người (ưu đãi nhóm) → gửi 2 chi nhánh + bản đồ → xin Tên + SĐT + chi nhánh →
// gửi phiếu xác nhận lịch → nhắc lịch ngày hẹn. Câu kết: mời khách nhắn thêm nếu còn băn khoăn.
// Không lưu thông tin khách; chỉ dùng cách nói.
const MAPS = {
  q3: 'https://maps.app.goo.gl/nvSuvoLUVNvaVTug6',
  bt: 'https://maps.app.goo.gl/MJjkoJtkdBPPL9Cg8',
};
const HOTLINE = '0398 638 656';
const CLOSE = 'Chị còn băn khoăn gì cứ nhắn em nhé, em tư vấn kỹ để mình hoàn toàn yên tâm trước khi làm ạ ❤️✨';
const BRANCHES = `Bên em có 2 chi nhánh cho chị ghé nè 📍\n• Quận 3: 436/29 Cách Mạng Tháng 8\n${MAPS.q3}\n• Bình Thạnh: 69/5 Nguyễn Gia Trí\n${MAPS.bt}\n\nChị thấy ghé cơ sở nào tiện hơn nhắn em giữ chỗ ưu tiên cho mình nha ❤️`;
const ASK_LENGTH = 'Tóc hiện tại của chị đang dài ngang cằm, qua vai hay qua ngực rồi ạ? Để bên em báo chi phí chính xác nhất cho chị tham khảo nhé ạ';
const GROUP = '🎁 Bên em có ưu đãi riêng khi chị đi làm tóc cùng bạn:\n1 người giảm 40%\n2 người giảm 45%\nTừ 3 người giảm 50%\n(áp dụng từ giá gốc)';
const GIFT = 'Bên em tặng kèm chị cắt thiết kế + 3 lần hấp collagen và kèm bảo hành (30–90 ngày, nhuộm có tẩy được +1 lần phủ màu miễn phí) ạ';
const SIZE_NAME = { S: 'S', M: 'M', L: 'L' };

const k = (n) => n.toLocaleString('vi-VN') + 'k';

// c: { name, people, peopleKnown, size, service, svc, price(size) → nghìn đồng | null, pct, promo }
const V = {
  greeting: () => `Dạ chào chị ạ 🥰 Bên em là The One Hair Salon ❤️\nChị đang quan tâm dịch vụ nào (cắt / nhuộm / uốn / duỗi / phục hồi / nối tóc) để em tư vấn ạ?\nChị gửi giúp em ảnh tóc hiện tại và mẫu chị thích nha ✨`,
  price: (c) => {
    if (!c.svc) return `Dạ chị quan tâm dịch vụ nào để em báo giá chuẩn cho chị ạ (cắt / nhuộm / uốn / duỗi / phục hồi / nối tóc)? 💖\n${ASK_LENGTH}`;
    if (c.svc.group === 0 && c.service === 'cut') return `Dạ cắt thiết kế riêng bên em trọn gói chỉ 250k ❤️\nĐã bao gồm Gội + Cắt thiết kế theo gương mặt + Tạo kiểu xinh, kiểu tóc bên em sau khi cắt xong chị về nhà chăm dễ lắm ạ\nChị chọn được mẫu cắt mình thích chưa ạ`;
    if (!c.size) return ASK_LENGTH;
    const p = c.price;
    if (p == null) return `Dạ dịch vụ này bên em chưa có giá cho size ${SIZE_NAME[c.size]}, chị gửi ảnh tóc giúp em để stylist tư vấn phương án phù hợp nhé ạ 💕`;
    const promo = c.svc.group !== 0 && c.promo ? `đang ưu đãi giảm ${c.pct}% chỉ còn ${k(p)} áp dụng khi đặt lịch trước ạ ❤️` : `${k(p)} ạ ❤️`;
    const lines = [`Dạ ${c.svc.vi} Size ${SIZE_NAME[c.size]} ${promo}`, 'Chi phí bên em báo chuẩn không phát sinh thêm chị yên tâm tham khảo nhé ạ'];
    if (c.svc.group === 'main') lines.push(GIFT); // quà tặng kèm vẫn còn sau tháng 10 (Sếp xác nhận)
    if (c.svc.group === 'main' && c.promo && !c.peopleKnown) lines.push(GROUP, 'Chị đi mấy người ạ để em tư vấn và báo giá chính xác khi áp dụng ưu đãi cho chị tham khảo nha 💖');
    else lines.push(CLOSE);
    return lines.join('\n');
  },
  discount: () => `Tháng 10 này tiệm em đang có ưu đãi dành cho khách hàng đặt lịch trước, chị xem qua nha ạ\n\nDịch vụ Uốn / Duỗi / Nhuộm / Balayage / Highlight giảm 40%\nKhi chị đi 2 người giảm 45% | Từ 3 người giảm tới 50%\nPhục hồi & Nối tóc giảm 20% | Dịch vụ lẻ khác giảm 10% ạ\n\n${GIFT} ❤️`,
  booking: () => `Dạ được ạ ❤️ Chị cho em xin Tên + SĐT + chi nhánh chị ghé để em đặt lịch giữ chỗ cho mình nha\n\n${BRANCHES}`,
  address: () => BRANCHES,
  confirm: () => 'Salon The One xác nhận lịch hẹn ❤️\n\n👤 Tên: [tên khách]\n📞 SĐT: [số điện thoại]\n💇‍♀️ Dịch vụ: [dịch vụ]\n⏰ Thời gian: [giờ/ngày]\n📍 Chi nhánh: [Quận 3 / Bình Thạnh]\n\nDạ em cảm ơn chị nhiều ạ, em đã giữ lịch cho mình rồi nha\nNếu có đổi gì chị nhắn em trước nhé. Hẹn gặp chị tại salon ạ 🥰',
  reminder: () => 'Dạ em nhắc lịch hẹn làm tóc hôm nay của chị tại The One nha ❤️\nNếu có thay đổi giờ ghé, chị nhắn em liền để em hỗ trợ nhé 🥰✨',
  reschedule: () => 'Dạ được ạ, chị cho em xin giờ mới em dời lịch giúp chị nha ❤️\nChị đến sớm hay trễ một chút cứ nhắn em để bên em sắp xếp ạ 🥰',
  walkin: () => 'Dạ ưu đãi bên em áp dụng khi đặt lịch trước ạ ❤️\nChị đặt trước để được chỗ ưu tiên và giá ưu đãi nha. Chị dự định khi nào ghé để em giữ lịch cho mình ạ?',
  warranty: () => 'Dạ bên em có bảo hành ạ ❤️\n• Duỗi 90 ngày · Uốn 60 ngày · Nhuộm không tẩy 60 ngày\n• Nhuộm có tẩy 30 ngày + tặng 1 lần phủ màu miễn phí\nĐiều kiện cụ thể stylist sẽ nói rõ khi chị ghé ạ.',
  damage: () => 'Dạ tóc chị gần đây có tẩy hay làm hóa chất nhiều chưa ạ, để em tư vấn phương pháp phù hợp với chất tóc của mình nhé 💕\nNếu tóc đã từng tẩy thì phần ngọn gặp thuốc uốn rất dễ bị mủn và cháy, nên salon sẽ tư vấn phương án khác để đảm bảo chất tóc cho mình ạ.',
  payment: () => 'Dạ bên em nhận tiền mặt, quẹt thẻ (có visa) và chuyển khoản đều được ạ ❤️',
  extension: () => 'Em gửi chị ưu đãi tóc nối Lông Vũ (đen tự nhiên) bên em:\nĐộ dài 50cm: 35k/tép\nĐộ dài 60cm: 45k/tép\n(Giá tóc chưa gồm công nối và khi chị đặt lịch trước sẽ được giảm thêm 20% trên tổng hóa đơn luôn đó ạ) ❤️\n\nChị tính nối độ dài khoảng bao nhiêu ạ, để em tư vấn số lượng tép tóc phù hợp và báo giá chính xác cho chị tham khảo nhé ❤️',
  contact: () => `Dạ chị cần gọi trực tiếp thì hotline bên em ${HOTLINE} ạ ❤️ Hoặc chị nhắn ngay ở đây em hỗ trợ liền nhé 🥰`,
  thanks: () => 'Dạ em cảm ơn chị đã quan tâm bên em ❤️ Khi nào cần tư vấn hay làm tóc chị cứ nhắn em nhé. Hẹn sớm gặp chị ạ 🥰✨',
  language: () => 'Dạ chị cứ nhắn tiếng Việt hoặc gửi ảnh mẫu chị thích, em và stylist sẽ tư vấn kỹ cho mình ạ ❤️',
  unknown: () => V.greeting(),
};

const NOTES = {
  price: 'Giá theo ưu đãi tháng 10 (áp dụng khi đặt lịch trước). Quà tặng kèm (cắt thiết kế + 3 lần hấp collagen + bảo hành) vẫn còn sau tháng 10, Sếp đã xác nhận.',
  walkin: 'Khách ghé ngang không đặt trước: nhân viên vẫn giữ nguyên "ưu đãi áp dụng khi đặt lịch trước", không tự giảm.',
  confirm: 'Điền Tên / SĐT / dịch vụ / giờ / chi nhánh khách vừa gửi. Agent không lưu thông tin khách.',
  reminder: 'Gửi vào sáng ngày khách có lịch.',
  damage: 'Với tóc đã tẩy muốn uốn: nhân viên từ chối uốn để bảo vệ tóc và đề nghị nhuộm; không tự hứa kết quả.',
  contact: 'Hotline chỉ gửi trong Messenger/Zalo khách chủ động hỏi.',
};

module.exports = { V, NOTES, MAPS, HOTLINE, CLOSE, BRANCHES };
