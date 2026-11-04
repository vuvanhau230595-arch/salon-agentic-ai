// Learning Agent: lưu bài AI viết, bài Sếp sửa và bài cuối cùng được duyệt → kho ví dụ + gợi ý phong cách.
// Không tự đổi thông tin kinh doanh chính thức, không fine-tune mô hình. Gợi ý bài học luôn ở trạng thái "chờ Sếp duyệt".
const { load, save, uid } = require('./db');
const lessons = require('./lessons');

const MAX_PER_BRAND = 60;
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const words = (s) => norm(s).split(' ').filter((w) => w.length >= 3);

// Gọi khi 1 bài được duyệt: aiText = bản AI viết ban đầu, finalText = bản cuối Sếp duyệt
function capture({ brand, topic, category, aiText, finalText, qcScore }) {
  if (!brand || !finalText) return null;
  const db = load();
  db.approvedExamples = db.approvedExamples || [];
  if (db.approvedExamples.some((e) => e.brand === brand && e.finalText === finalText)) return null;
  const ex = { id: uid('ex'), at: new Date().toISOString(), brand, topic: String(topic || '').slice(0, 160), category: category || '', aiText: aiText || '', finalText, edited: !!aiText && aiText !== finalText, qcScore: qcScore ?? null };
  db.approvedExamples.unshift(ex);
  // mỗi thương hiệu giữ tối đa MAX_PER_BRAND ví dụ, ưu tiên bài có chỉnh sửa
  const mine = db.approvedExamples.filter((e) => e.brand === brand);
  if (mine.length > MAX_PER_BRAND) {
    const drop = new Set(mine.slice(MAX_PER_BRAND).map((e) => e.id));
    db.approvedExamples = db.approvedExamples.filter((e) => !drop.has(e.id));
  }
  return ex;
}

// Khác biệt giữa bản AI và bản Sếp sửa: từ bị bỏ / từ được thêm, đếm theo số bài
function diffStats(brand) {
  const edited = (load().approvedExamples || []).filter((e) => e.brand === brand && e.edited);
  const removed = new Map(), added = new Map();
  for (const e of edited) {
    const a = new Set(words(e.aiText)), f = new Set(words(e.finalText));
    for (const w of a) if (!f.has(w)) removed.set(w, (removed.get(w) || 0) + 1);
    for (const w of f) if (!a.has(w)) added.set(w, (added.get(w) || 0) + 1);
  }
  const top = (m) => [...m.entries()].filter(([, n]) => n >= 3).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([word, count]) => ({ word, count }));
  return { editedCount: edited.length, removed: top(removed), added: top(added) };
}

// Đề xuất bài học (chờ duyệt) khi Sếp lặp lại cùng 1 chỉnh sửa ≥ 3 bài. Trả về số đề xuất mới.
function run() {
  let n = 0;
  for (const b of Object.keys(require('./planner').brands())) {
    const st = diffStats(b);
    for (const r of st.removed) {
      try { lessons.add({ text: `Chủ salon thường xóa từ "${r.word}" khỏi bài AI viết (${r.count} bài) — hạn chế dùng.`, scope: b, source: 'ai', evidence: `learning:${b}:-${r.word}` }); n++; } catch { /* đã có */ }
    }
  }
  if (n) save();
  return n;
}

function summary(brand) {
  const ex = (load().approvedExamples || []).filter((e) => !brand || e.brand === brand);
  return { total: ex.length, edited: ex.filter((e) => e.edited).length, ...(brand ? { diff: diffStats(brand) } : {}), recent: ex.slice(0, 8).map((e) => ({ id: e.id, at: e.at, brand: e.brand, topic: e.topic, edited: e.edited, qcScore: e.qcScore })) };
}

module.exports = { capture, run, summary, diffStats };
