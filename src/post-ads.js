// "Lên bài & chạy QC" (Thư viện Media): chọn ảnh/video + cơ sở → mỗi file × mỗi cơ sở 1 bài Facebook trên đúng Page của cơ sở đó.
// AI viết chữ 1 lần cho mỗi file (các cơ sở dùng chung), bài mang adPlan → đăng xong agent tự tạo quảng cáo thử cho cơ sở
// (adtest.runPlans ở lượt quét). Kiểm tra trần ngân sách ngày của cơ sở NGAY khi lên bài để không tạo bài rồi mới báo thiếu tiền.
const { load, save, uid } = require('./db');
const planner = require('./planner');
const media = require('./media');

const MAX_FILES = 20;
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const vnd = (n) => Math.round(n).toLocaleString('vi-VN') + 'đ';
const engine = () => require('./engine');

// Mô tả file cho AI: Sếp gõ → ghi chú cho AI → Gemini đã xem → (có khoá Gemini) cho Gemini xem ngay → rỗng
async function describe(brand, f, typed) {
  if (typed) return typed;
  const db = load();
  const k = `${brand}/${f.name}`;
  const known = ((db.mediaNotes || {})[k]) || (((db.mediaMeta || {})[k] || {}).summary);
  if (known) return known;
  const vi = require('./video-intel');
  if (!vi.enabled()) return '';
  try { return (await vi.analyze(brand, f.name)).summary || ''; } catch { return ''; }
}

function units(brandId, unitIds) {
  const adtest = require('./adtest');
  const brand = planner.brands()[brandId];
  const ids = [...new Set((Array.isArray(unitIds) ? unitIds : []).map(String))];
  if (!ids.length) throw bad('Chọn ít nhất 1 cơ sở');
  return ids.map((id) => {
    const u = adtest.units().find((x) => x.id === id);
    if (!u || u.brand !== brandId) throw bad(`Cơ sở ${id} không thuộc ${brand.name}`);
    if (!u.pageId) throw bad(`${u.name} chưa gán Page — chọn Page cho cơ sở ở trang Quảng cáo (mục Cơ sở)`);
    if (!brand.pageIds.includes(u.pageId)) throw bad(`Page của ${u.name} không còn trong thương hiệu — chọn lại ở trang Quảng cáo`);
    return u;
  });
}

async function create(b, now = Date.now()) {
  const brand = planner.brands()[b.brand];
  if (!brand) throw bad('Chọn thương hiệu');
  if (!planner.channelEnabled(b.brand, 'facebook_page')) throw bad(`Kênh Facebook Page đang tắt cho ${brand.name}`);
  const us = units(b.brand, b.unitIds);
  const items = (Array.isArray(b.items) ? b.items : []).map((it) => ({ name: String((it && it.name) || ''), topic: String((it && it.topic) || '').replace(/\s+/g, ' ').trim().slice(0, 200) }));
  if (!items.length) throw bad('Chọn ít nhất 1 file');
  if (items.length > MAX_FILES) throw bad(`Tối đa ${MAX_FILES} file mỗi lần`);
  let files;
  try { files = items.map((it) => media.validateSet(b.brand, [it.name])[0]); } catch (e) { throw bad(e.message); }
  const runAds = b.runAds !== false;
  const budget = Math.round(Number(b.budget));
  const days = Math.round(Number(b.days));
  if (runAds) {
    if (!brand.adAccountId) throw bad(`${brand.name} chưa có tài khoản quảng cáo`);
    if (!(budget >= 20000 && budget <= 5000000)) throw bad('Ngân sách ngày mỗi quảng cáo phải từ 20.000đ đến 5.000.000đ');
    if (!(days >= 1 && days <= 30)) throw bad('Số ngày chạy phải từ 1 đến 30');
    const adtest = require('./adtest');
    for (const u of us) {
      const problem = adtest.capProblem(u, budget * items.length);
      if (problem) throw bad(`${problem}. Nâng mức tối đa ngày của cơ sở ở trang Quảng cáo, giảm ngân sách hoặc bớt file.`);
    }
  }
  const start = b.startAt ? new Date(b.startAt) : new Date(now + 15 * 60e3);
  if (Number.isNaN(start.getTime())) throw bad('Giờ đăng không hợp lệ');
  if (start.getTime() < now - 5 * 60e3) throw bad('Giờ đăng đã qua');
  const gap = Math.min(1440, Math.max(0, Math.round(Number(b.gapMinutes ?? 60))));

  const ce = require('./content-engine');
  const db = load();
  const made = [];
  for (const [i, it] of items.entries()) {
    const f = files[i];
    const at0 = new Date(start.getTime() + i * gap * 60e3);
    const desc = await describe(b.brand, f, it.topic);
    // Sếp gõ mô tả → lưu làm ghi chú cho AI của file (chỉ khi file chưa có ghi chú), lần sau khỏi gõ lại
    if (it.topic) { db.mediaNotes = db.mediaNotes || {}; const k = `${b.brand}/${f.name}`; if (!db.mediaNotes[k]) db.mediaNotes[k] = it.topic; }
    const slot = desc
      ? { at: at0, category: 'service', hint: desc, topic: desc.charAt(0).toUpperCase() + desc.slice(1, 160), service: '', promo: '' }
      : ce.strategy(b.brand, [at0], { now, hints: [''] })[0];
    const w = await ce.produce(brand, slot, { hint: desc });
    for (const [j, u] of us.entries()) {
      const post = {
        id: uid('post'), channel: 'facebook_page', brand: b.brand, topic: slot.topic, text: w.text,
        scheduledAt: new Date(at0.getTime() + j * 2 * 60e3).toISOString(), status: 'draft', media: [f], pageIds: [u.pageId],
        category: w.topicCategory, qc: w.qc, ...(w.mode === 'ai' ? { aiText: w.text } : {}),
        ...(runAds ? { adPlan: { unitId: u.id, budget, days, status: 'waiting' } } : {}),
      };
      db.posts.unshift(post);
      const apId = uid('p');
      db.approvals.unshift({
        id: apId, type: 'post_publish', key: post.id, status: 'pending', at: new Date(now).toISOString(),
        title: `Bài Facebook Page · ${u.name}: ${slot.topic}`,
        detail: `${w.text}${runAds ? `\n\n— Đăng xong tự chạy quảng cáo thử ${vnd(budget)}/ngày × ${days} ngày cho ${u.name}.` : ''}`,
        payload: { postId: post.id },
      });
      made.push({ postId: post.id, approvalId: apId, unit: u.name, file: f.name, at: post.scheduledAt, qc: w.qc && w.qc.score });
    }
  }
  engine().log('propose', `Lên bài${runAds ? ' & chạy QC' : ''}: ${items.length} file × ${us.length} cơ sở (${us.map((u) => u.name).join(', ')}) = ${made.length} bài${runAds ? `, đăng xong mỗi bài chạy thử ${vnd(budget)}/ngày × ${days} ngày` : ''}`);
  save();
  const errors = [];
  if (b.approveNow === true) {
    for (const m of made) {
      try { await engine().decide(m.approvalId, true, { note: 'Duyệt luôn khi Lên bài & chạy QC' }); }
      catch (e) { errors.push(`${m.file} · ${m.unit}: ${e.message}`); }
    }
  }
  return { posts: made, errors };
}

module.exports = { create, MAX_FILES };
