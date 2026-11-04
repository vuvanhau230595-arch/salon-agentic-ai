// Claude viết nháp / phân tích. Không có ANTHROPIC_API_KEY thì dùng mẫu câu có sẵn.
// Không có khóa Claude thì dùng Gemini (GEMINI_API_KEY) để viết; có cả hai thì ưu tiên Claude.
async function askGemini(system, user, maxTokens) {
  const model = process.env.GEMINI_TEXT_MODEL || 'gemini-flash-latest';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: [system, require('./lessons').activeText()].filter(Boolean).join('\n\n') }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      // Gemini tính cả token "suy nghĩ" vào giới hạn: để dư chỗ, nếu không bài bị cắt cụt giữa chừng
      generationConfig: { maxOutputTokens: maxTokens * 4 + 2048, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  const j = await res.json();
  if (j.error) throw new Error('Gemini API: ' + (res.status === 429 ? 'hết hạn mức, thử lại sau — ' : '') + j.error.message);
  const text = ((((j.candidates || [])[0] || {}).content || {}).parts || []).map((x) => x.text || '').join('').trim();
  if (j.usageMetadata) require('./usage').record({ input_tokens: j.usageMetadata.promptTokenCount || 0, output_tokens: j.usageMetadata.candidatesTokenCount || 0 }, model);
  return text || null;
}

async function ask(system, user, maxTokens = 600) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key && !process.env.GEMINI_API_KEY) return null;
  const cfg = require('./db').load().settings.ai || {};
  if (cfg.enabled === false) return null; // Sếp tắt AI ở Cài đặt: dùng mẫu câu có sẵn
  if (!key) return askGemini(system, user, maxTokens);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || cfg.model || 'claude-sonnet-5-5',
      max_tokens: maxTokens,
      system: [system, require('./lessons').activeText()].filter(Boolean).join('\n\n'),
      messages: [{ role: 'user', content: user }],
    }),
  });
  const j = await res.json();
  if (j.error) throw new Error('Claude API: ' + j.error.message);
  require('./usage').record(j.usage, j.model || process.env.ANTHROPIC_MODEL || cfg.model || 'claude-sonnet-5-5');
  return (j.content || []).map((b) => b.text || '').join('').trim();
}

const BRAND = 'Bạn là trợ lý marketing của hệ thống salon tóc & nối mi The One · Dark Hair · Mishang (TP.HCM). Viết tiếng Việt có dấu, thân thiện, ngắn gọn, không hứa hẹn quá đà, không bịa giá hoặc khuyến mãi.';

// Giọng/bài học của thương hiệu thường viết cho TRẢ LỜI TIN NHẮN (em–chị, "Dạ", hỏi từng câu): không được đem nguyên sang bài đăng công khai
const POST_STYLE = `ĐÂY LÀ BÀI ĐĂNG CÔNG KHAI trên trang của salon, KHÔNG phải tin nhắn trả lời khách. Các quy định về xưng hô "em – chị", mở đầu "Dạ", gọi khách "chị yêu", hỏi khách từng câu... là của TIN NHẮN, KHÔNG áp dụng cho bài đăng. Viết như một bài fanpage chuyên nghiệp: nói với người đọc chung (bạn/nàng/các bạn), thay mặt "salon"/tên thương hiệu; mở bằng 1 câu hook về nhu cầu hoặc kết quả; 2–3 câu nêu lợi ích, dịch vụ liên quan; kết bằng lời mời nhắn tin đặt lịch; không mở đầu bằng "Dạ", không "chị ơi/chị yêu". Vẫn giữ các điều KHÔNG được nói/hứa và quy tắc về giá, khuyến mãi.`;
async function draftPost(channel, topic, extra = '') {
  const t = await ask(BRAND + '\n\n' + POST_STYLE, `Viết 1 bài đăng ${channel} về: ${topic}. Tối đa 90 từ, có 1 lời kêu gọi nhắn tin đặt lịch, thêm 3 hashtag.${extra ? '\n' + extra : ''}`);
  return t || `✨ ${topic}\n\nNhắn tin ngay để được tư vấn và đặt lịch nhé!\n#salon #lamdep #theone`;
}

async function draftReply(comment) {
  const t = await ask(BRAND, `Khách bình luận: "${comment}". Viết 1 câu trả lời dưới 40 từ, mời khách nhắn tin để được tư vấn chi tiết.`, 200);
  return t || 'Dạ cảm ơn bạn quan tâm ạ! Bạn nhắn tin cho salon để được tư vấn chi tiết và đặt lịch nhé 💕';
}

async function analyze(campaigns, log) {
  const data = JSON.stringify(campaigns.map(({ name, status, budget, today, d7, month }) => ({ name, status, budget, today, d7, month })));
  const t = await ask(
    BRAND + ' Bạn phân tích quảng cáo Facebook cho salon, đơn vị VNĐ, mục tiêu là tin nhắn.',
    `Dữ liệu chiến dịch: ${data}\nHành động gần đây: ${JSON.stringify(log.slice(0, 5).map((a) => a.text))}\nNhận xét ngắn (tối đa 5 gạch đầu dòng): chiến dịch nào tốt/xấu, nên làm gì tiếp. Chỉ đề xuất, không tự quyết.`,
    700,
  );
  if (t) return t;
  const lines = campaigns.map((c) => {
    const cpl = c.d7.msgs ? Math.round(c.d7.spend / c.d7.msgs) : null;
    return `- ${c.name}: hôm nay ${c.today.spend.toLocaleString('vi-VN')}đ / ${c.today.msgs} tin; 7 ngày ${cpl ? cpl.toLocaleString('vi-VN') + 'đ/tin' : 'chưa có dữ liệu'}.`;
  });
  return lines.join('\n') + '\n\n(Chưa có ANTHROPIC_API_KEY nên đây là tóm tắt số liệu, chưa phải phân tích của AI.)';
}

const raw = (user, maxTokens) => ask(BRAND, user, maxTokens);

module.exports = { draftPost, draftReply, analyze, raw, ask, POST_STYLE };
