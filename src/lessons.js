// Bài học của AI: agent ghi lại việc Sếp bỏ/sửa gì, rút thành bài học.
// Bài học do máy/AI đề xuất phải được Sếp xác nhận mới áp dụng. Bài học chỉ định hướng
// cách VIẾT (giọng văn, chủ đề); không bao giờ đổi luật quảng cáo hay ngân sách.
const { load, save, uid } = require('./db');

const MAX_TEXT = 300;
const MAX_INJECT = 12;

// Ghi 1 sự kiện phản hồi của Sếp (bỏ bài / sửa bài). Gọi trước save() của nơi gọi.
function record(ev) {
  const db = load();
  db.feedback.unshift({ id: uid('f'), at: new Date().toISOString(), ...ev });
  db.feedback.length = Math.min(db.feedback.length, 200);
}

function clean(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  if (!t) throw new Error('Nội dung bài học đang trống');
  return t;
}

// Nhóm bài học. rule = quy tắc quan trọng (đã duyệt). Bài do máy/AI đề xuất LUÔN chờ Sếp duyệt, không tự bật được.
const CATEGORIES = { brand: 'Quy chuẩn thương hiệu', content: 'Mẫu nội dung hiệu quả', ads: 'Kinh nghiệm quảng cáo', mistake: 'Lỗi đã xảy ra', feedback: 'Phản hồi của Sếp', rule: 'Quy tắc đã duyệt' };
const defaultCategory = (source) => (source === 'ads' ? 'ads' : source === 'manual' ? 'content' : 'feedback');
const MAX_HISTORY = 30;
const STATUSES = ['pending', 'active', 'disabled'];
const pushHistory = (l, by, what) => { (l.history = l.history || []).unshift({ at: new Date().toISOString(), by, what: String(what).slice(0, 200) }); l.history.length = Math.min(l.history.length, MAX_HISTORY); };
const cat = (c, source) => {
  if (c === undefined || c === null || c === '') return defaultCategory(source);
  if (!CATEGORIES[c]) throw new Error('Nhóm bài học không hợp lệ');
  return c;
};

function add({ text, scope = 'all', source = 'manual', status, category, evidence, by }) {
  const db = load();
  const t = clean(text);
  if (db.lessons.some((l) => l.text === t && l.scope === scope)) throw new Error('Bài học này đã có');
  // Chỉ Sếp (manual) mới được tạo bài học áp dụng ngay; nguồn khác (AI, số liệu quảng cáo, luật tự động) luôn là "chờ duyệt"
  const st = source === 'manual' ? (status || 'active') : 'pending';
  if (!STATUSES.includes(st)) throw new Error('Trạng thái không hợp lệ');
  const lesson = {
    id: uid('l'), text: t, scope, source, createdAt: new Date().toISOString(), status: st,
    category: cat(category, source), evidence: String(evidence || '').trim().slice(0, 300),
  };
  pushHistory(lesson, by || (source === 'manual' ? 'Sếp' : 'Hệ thống/AI'), source === 'manual' ? 'Tạo bài học (áp dụng ngay)' : 'Đề xuất bài học (chờ Sếp duyệt)');
  db.lessons.unshift(lesson);
  save();
  return lesson;
}

function update(id, patch, by = 'Sếp') {
  const l = load().lessons.find((x) => x.id === id);
  if (!l) throw new Error('Không tìm thấy bài học');
  const before = { status: l.status, text: l.text, category: l.category, scope: l.scope };
  const next = {};
  if (patch.status !== undefined) {
    if (!STATUSES.includes(patch.status)) throw new Error('Trạng thái không hợp lệ');
    next.status = patch.status;
  }
  if (patch.text !== undefined) next.text = clean(patch.text);
  if (patch.category !== undefined) next.category = cat(patch.category, l.source);
  if (patch.scope !== undefined) {
    if (patch.scope !== 'all' && !require('./planner').brands()[patch.scope]) throw new Error('Phạm vi không hợp lệ');
    next.scope = patch.scope;
  }
  if (patch.evidence !== undefined) next.evidence = String(patch.evidence).trim().slice(0, 300);
  // Không để 2 bài học trùng chữ trong cùng phạm vi
  const nt = next.text ?? l.text, ns = next.scope ?? l.scope;
  if ((next.text !== undefined || next.scope !== undefined) && load().lessons.some((x) => x.id !== l.id && x.text === nt && x.scope === ns)) throw new Error('Bài học này đã có');
  Object.assign(l, next);
  const label = { pending: 'chờ duyệt', active: 'đang áp dụng', disabled: 'đã tắt' };
  if (next.status && next.status !== before.status) pushHistory(l, by, before.status === 'pending' && next.status === 'active' ? 'Duyệt và áp dụng' : `Đổi trạng thái: ${label[before.status]} → ${label[next.status]}`);
  if (next.text !== undefined && next.text !== before.text) pushHistory(l, by, `Sửa nội dung: "${before.text.slice(0, 60)}" → "${next.text.slice(0, 60)}"`);
  if (next.category && next.category !== before.category) pushHistory(l, by, `Đổi nhóm: ${CATEGORIES[before.category] || '—'} → ${CATEGORIES[next.category]}`);
  if (next.scope && next.scope !== before.scope) pushHistory(l, by, `Đổi phạm vi: ${before.scope} → ${next.scope}`);
  save();
  return l;
}

function remove(id) {
  const db = load();
  const n = db.lessons.length;
  db.lessons = db.lessons.filter((x) => x.id !== id);
  if (db.lessons.length === n) throw new Error('Không tìm thấy bài học');
  save();
}

// Đoạn chữ đưa vào lời nhắc AI: chỉ bài học đang áp dụng, của chung + của thương hiệu đó
function activeText(brandId, onlyBrand = false) {
  const items = load().lessons
    .filter((l) => l.status === 'active' && (onlyBrand ? l.scope === brandId : l.scope === 'all' || l.scope === brandId))
    .slice(0, MAX_INJECT);
  if (!items.length) return '';
  // Ghi nhận bài học nào được đưa vào lời nhắc AI và bao nhiêu lần (để Sếp biết bài học nào đang thật sự được dùng)
  const dbu = load();
  dbu.lessonUse = dbu.lessonUse || {};
  for (const l of items) { const u = (dbu.lessonUse[l.id] = dbu.lessonUse[l.id] || { count: 0, last: null }); u.count++; u.last = new Date().toISOString(); }
  return 'Bài học Sếp đã xác nhận (hãy tuân theo):\n' + items.map((l) => `- ${l.text}`).join('\n');
}

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// Đề xuất theo số liệu thật, không cần AI
function heuristics() {
  const db = load();
  const out = [];
  const fb = db.feedback;

  // 1) chủ đề bị bỏ từ 2 lần trở lên
  const rej = new Map();
  for (const e of fb.filter((x) => x.type === 'reject' && x.topic)) {
    const k = `${e.brand || 'all'}|${norm(e.topic)}`;
    const cur = rej.get(k) || { n: 0, topic: e.topic, brand: e.brand || 'all' };
    cur.n++;
    rej.set(k, cur);
  }
  for (const r of rej.values()) {
    if (r.n >= 2) out.push({ scope: r.brand, text: `Sếp đã bỏ qua chủ đề "${r.topic}" ${r.n} lần — hạn chế đề xuất lại, hoặc đổi cách tiếp cận.` });
  }

  // 2) Sếp hay rút ngắn / kéo dài bài
  const edits = fb.filter((x) => x.type === 'edit' && x.before && x.after);
  if (edits.length >= 3) {
    const ratio = edits.reduce((s, e) => s + e.after.length / Math.max(1, e.before.length), 0) / edits.length;
    if (ratio <= 0.8) out.push({ scope: 'all', text: `Sếp thường rút ngắn bài AI soạn (khoảng ${Math.round((1 - ratio) * 100)}%) — viết ngắn gọn hơn.` });
    else if (ratio >= 1.25) out.push({ scope: 'all', text: `Sếp thường bổ sung thêm vào bài AI soạn (khoảng ${Math.round((ratio - 1) * 100)}%) — viết đầy đủ, chi tiết hơn.` });
  }

  // 3) chiến dịch bị tắt thật nhiều lần
  const paused = new Map();
  for (const a of db.actions.filter((x) => x.kind === 'pause' && !x.dry && x.campaignId)) {
    const name = (a.text.match(/^Tắt (.+?) — /) || [])[1] || a.campaignId;
    paused.set(name, (paused.get(name) || 0) + 1);
  }
  for (const [name, n] of paused) {
    if (n >= 2) out.push({ scope: 'all', text: `Chiến dịch "${name}" đã bị tự tắt ${n} lần — xem lại nội dung, tệp đối tượng trước khi chạy lại.` });
  }
  return out;
}

async function aiSuggestions() {
  const db = load();
  const ai = require('./ai');
  const events = db.feedback.slice(0, 40).map((e) => ({
    loai: e.type === 'edit' ? 'sửa bài' : 'bỏ qua', kenh: e.kind, thuong_hieu: e.brand, chu_de: e.topic,
    truoc: e.before ? e.before.slice(0, 200) : undefined, sau: e.after ? e.after.slice(0, 200) : undefined,
  }));
  const existing = db.lessons.map((l) => l.text);
  const raw = await ai.raw(
    `Dưới đây là phản hồi của Sếp với nội dung AI soạn (bỏ qua / sửa bài): ${JSON.stringify(events)}\n` +
    `Bài học đã có (đừng lặp): ${JSON.stringify(existing)}\n` +
    'Rút tối đa 5 bài học NGẮN, cụ thể, có thể làm theo khi viết nội dung lần sau (giọng văn, độ dài, chủ đề nên/không nên). ' +
    'Chỉ dựa vào dữ liệu trên, không bịa. Chỉ trả về JSON thuần: mảng chuỗi.', 800);
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
    return arr.filter((s) => typeof s === 'string' && s.trim()).slice(0, 5).map((s) => ({ scope: 'all', text: s, ai: true }));
  } catch { return null; }
}

// Rút bài học mới → trạng thái "chờ xác nhận". Trả về số bài mới.
async function suggest() {
  const db = load();
  if (!db.feedback.length && !db.actions.some((a) => a.kind === 'pause' && !a.dry)) return { added: 0, reason: 'Chưa có phản hồi nào để học' };
  let items = null;
  let usedAi = false;
  try { items = await aiSuggestions(); usedAi = !!items; } catch (e) { items = null; }
  if (!items) items = heuristics();
  let added = 0;
  for (const it of items) {
    try { add({ text: it.text, scope: it.scope, source: it.ai ? 'ai' : 'auto' }); added++; } catch { /* trùng thì bỏ qua */ }
  }
  return { added, usedAi };
}

module.exports = { record, add, update, remove, activeText, suggest, heuristics, CATEGORIES, defaultCategory };
