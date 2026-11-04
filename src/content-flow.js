// Luồng bài đăng Facebook từng bài: chấm lại, viết lại, chặn duyệt khi thiếu dữ liệu / vi phạm cứng, kiểm tra trước khi đăng.
const { load, save } = require('./db');
const ce = require('./content-engine');
const planner = require('./planner');

const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
// Lỗi KHÔNG được duyệt/đăng nếu chưa sửa: bịa giá/ưu đãi, hotline lạ, nhầm thương hiệu/địa chỉ, bịa đánh giá khách
const HARD = new Set(['offer', 'hotline', 'brand_mix', 'address', 'fake_review']);

const brandOf = (p) => planner.brands()[p.brand];

function qcOf(p, { now, atPostTime = true } = {}) {
  const brand = brandOf(p);
  if (!brand) return null;
  const when = now || (atPostTime ? new Date(p.scheduledAt || Date.now()).getTime() : Date.now());
  return ce.review(p.text, { brand, category: p.category || 'custom', now: when, selfText: p.text });
}

const problemsOf = (qc) => [...qc.needsInfo.map((x) => `Thiếu dữ liệu: ${x}`), ...qc.issues.filter((i) => HARD.has(i.code) && i.level === 'block').map((i) => i.msg)];

// Ném lỗi nếu bài chưa được phép duyệt. Kênh 小红书 có bộ kiểm tra riêng nên bỏ qua.
function assertApprovable(p) {
  if (!p || p.channel === 'xiaohongshu' || !p.brand) return;
  const qc = qcOf(p);
  if (!qc) return;
  const probs = problemsOf(qc);
  if (probs.length) throw bad(`Bài chưa duyệt được (điểm ${qc.score}/100): ${probs.join('; ')}. Sửa bài rồi bấm "Kiểm tra lại".`);
}

// Trước khi đăng thật: dữ liệu đã đổi (ưu đãi hết hạn, hotline bị gỡ xác nhận...) thì giữ bài lại
function publishGuard(p, now = Date.now()) {
  if (!p.brand || p.channel === 'xiaohongshu') return null;
  const brand = brandOf(p);
  if (!brand) return null;
  const qc = ce.review(p.text, { brand, category: p.category || 'custom', now, selfText: p.text });
  const probs = problemsOf(qc);
  return probs.length ? `Kiểm tra lại trước khi đăng không đạt: ${probs.join('; ')}` : null;
}

function find(id) {
  const p = load().posts.find((x) => x.id === String(id));
  if (!p) throw bad('Không tìm thấy bài', 404);
  return p;
}

function recheck(id) {
  const p = find(id);
  p.qc = qcOf(p);
  save();
  return p.qc;
}

// Yêu cầu AI viết lại (kèm lời nhắn của Sếp). Dùng lại luồng sửa bài để mục duyệt luôn khớp nội dung.
async function rewrite(id, instruction = '') {
  const p = find(id);
  const brand = brandOf(p);
  if (!brand) throw bad('Bài chưa gắn thương hiệu');
  const slot = { at: new Date(p.scheduledAt), category: p.category || 'custom', topic: p.topic };
  const r = await ce.produce(brand, slot, { instruction: String(instruction || '').slice(0, 500), selfText: p.text });
  if (r.mode !== 'ai') throw bad('Chưa viết lại được vì AI chưa sẵn sàng (thiếu khoá hoặc đã tắt AI) — kiểm tra ở Cài đặt');
  require('./lessons').record({ type: 'rewrite', kind: 'post', brand: p.brand, topic: p.topic, ...(instruction ? { note: String(instruction).slice(0, 300) } : {}) });
  const cal = require('./calendar-api');
  const view = cal.edit(id, { text: r.text });
  const post = find(id);
  post.qc = { ...r.qc, rewrittenAt: new Date().toISOString() };
  post.rewrites = (post.rewrites || 0) + 1;
  save();
  return { post: view, qc: post.qc };
}

module.exports = { qcOf, assertApprovable, publishGuard, recheck, rewrite, problemsOf, HARD };
