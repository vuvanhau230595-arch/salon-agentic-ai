// Kho tri thức của AI (trang "Bài học của AI"): bài học theo nhóm, đề xuất chờ duyệt, quy chuẩn thương hiệu, mẫu nội dung hiệu quả
// (từ kết quả quảng cáo thử), lỗi đã xảy ra (từ nhật ký kiểm toán), phản hồi của Sếp. Mọi nhận định dựa trên dữ liệu có thật.
// AI chỉ ĐỀ XUẤT bài học (luôn chờ duyệt); chỉ bài học Sếp bật mới được đưa vào lời nhắc AI.
const { load, save } = require('./db');
const lessons = require('./lessons');
const planner = require('./planner');
const audit = require('./audit');
const engine = require('./engine');

const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
const DAY = 864e5;
const vnd = (n) => Math.round(n || 0).toLocaleString('vi-VN') + 'đ';

const lessonView = (l, use) => ({
  id: l.id, text: l.text, scope: l.scope, source: l.source, status: l.status, category: l.category || lessons.defaultCategory(l.source), evidence: l.evidence || '',
  createdAt: l.createdAt, history: l.history || [], uses: use[l.id] || { count: 0, last: null },
});

// Chuẩn hoá lỗi để gộp các lỗi giống nhau (bỏ mã số dài)
const errKey = (t) => String(t || '').replace(/\d{5,}/g, '#').replace(/\(#\d+\)/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
function errorsSummary(now = Date.now()) {
  const rows = audit.query({ kind: 'error', from: new Date(now - 30 * DAY).toISOString() }).rows;
  const groups = new Map();
  for (const e of rows) {
    const k = errKey(e.action);
    const g = groups.get(k) || { key: k, text: e.action, count: 0, firstAt: e.at, lastAt: e.at, rule: e.rule };
    g.count++;
    if (e.at < g.firstAt) g.firstAt = e.at;
    if (e.at > g.lastAt) g.lastAt = e.at;
    groups.set(k, g);
  }
  const ls = load().lessons;
  return [...groups.values()].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt)).slice(0, 15)
    .map((g) => ({ ...g, text: g.text.slice(0, 300), saved: ls.some((l) => (l.evidence || '').includes(g.key.slice(0, 60))) }));
}

function effectivePatterns() {
  const db = load();
  const brands = planner.brands();
  const ls = db.lessons;
  return db.adTests.filter((t) => t.status === 'pass').sort((a, b) => (b.finishedAt || '').localeCompare(a.finishedAt || '')).slice(0, 12).map((t) => ({
    id: t.id, brand: t.brand, brandName: (brands[t.brand] || {}).name || t.brand, topic: t.topic, spend: t.spend || 0, msgs: t.msgs || 0,
    cpl: t.msgs ? Math.round(t.spend / t.msgs) : null, at: t.finishedAt, saved: ls.some((l) => (l.evidence || '').includes(t.id)),
  }));
}

function standards() {
  const db = load();
  return Object.values(planner.brands()).map((b) => {
    const fields = { tone: b.tone, avoid: b.avoid, hashtags: b.hashtags, tagline: b.tagline, services: b.services };
    return {
      id: b.id, name: b.name, ...fields, hotline: b.hotline, filled: Object.values(fields).filter(Boolean).length, total: Object.keys(fields).length,
      activeLessons: db.lessons.filter((l) => l.status === 'active' && l.scope === b.id).length,
    };
  });
}

function view(now = Date.now()) {
  const db = load();
  const use = db.lessonUse || {};
  const all = db.lessons.map((l) => lessonView(l, use));
  const byCat = {};
  for (const l of all) byCat[l.category] = (byCat[l.category] || 0) + 1;
  return {
    categories: lessons.CATEGORIES, hasAi: !!process.env.ANTHROPIC_API_KEY,
    lessons: all,
    counts: { total: all.length, pending: all.filter((l) => l.status === 'pending').length, active: all.filter((l) => l.status === 'active').length, disabled: all.filter((l) => l.status === 'disabled').length, byCategory: byCat },
    standards: standards(), effective: effectivePatterns(), errors: errorsSummary(now),
    feedback: db.feedback.slice(0, 30), feedbackTotal: db.feedback.length,
  };
}

// Xem trước ĐÚNG đoạn chữ AI nhận khi viết cho 1 thương hiệu (hồ sơ + bài học đang áp dụng). Không tính vào số lần dùng.
function preview(brandId) {
  const b = planner.brands()[brandId];
  if (!b) throw bad('Thương hiệu không tồn tại', 404);
  const db = load();
  const snap = JSON.stringify(db.lessonUse || {});
  try {
    const own = planner.brandContext(b);
    const shared = lessons.activeText();
    return { brand: b.id, name: b.name, text: [own, shared].filter(Boolean).join('\n\n'), activeLessons: db.lessons.filter((l) => l.status === 'active' && (l.scope === 'all' || l.scope === b.id)).length };
  } finally { db.lessonUse = JSON.parse(snap); }
}

// Duyệt / tắt / xoá nhiều bài học một lúc (kiểm tra từng bài, bài lỗi không chặn bài khác)
function bulk(ids, action) {
  if (!['activate', 'disable', 'delete'].includes(action)) throw bad('action phải là activate, disable hoặc delete');
  ids = [...new Set((Array.isArray(ids) ? ids : []).map(String))];
  if (!ids.length || ids.length > 100) throw bad('Chọn từ 1 đến 100 bài học');
  const out = [];
  for (const id of ids) {
    const l = load().lessons.find((x) => x.id === id);
    try {
      if (!l) throw new Error('Không tìm thấy bài học');
      const text = l.text;
      if (action === 'delete') lessons.remove(id);
      else lessons.update(id, { status: action === 'activate' ? 'active' : 'disabled' });
      engine.log('lesson', `Sếp ${{ activate: 'duyệt/bật', disable: 'tắt', delete: 'xoá' }[action]} bài học: "${text.slice(0, 80)}"`, { by: 'Sếp', field: 'status', after: action });
      out.push({ id, ok: true });
    } catch (e) { out.push({ id, ok: false, error: e.message }); }
  }
  save();
  return out;
}

async function handleApi(req, res, url, { readBody, send }) {
  const p = url.pathname;
  if (!p.startsWith('/api/knowledge')) return false;
  try {
    if (req.method === 'GET' && p === '/api/knowledge') return send(res, 200, view()), true;
    if (req.method === 'GET' && p === '/api/knowledge/preview') return send(res, 200, preview(url.searchParams.get('brand'))), true;
    if (req.method === 'POST' && p === '/api/knowledge/bulk') { const b = await readBody(req); return send(res, 200, { results: bulk(b.ids, b.action), ...view() }), true; }
  } catch (e) { send(res, e.status || 500, { error: e.message }); return true; }
  return false;
}

module.exports = { view, preview, bulk, errorsSummary, effectivePatterns, standards, handleApi, vnd };
