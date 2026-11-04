// Quảng cáo thử bài mới mỗi ngày, quản theo từng CƠ SỞ (mỗi cơ sở có tổng ngân sách ngày riêng).
// Quy trình: bài đã đăng lên Page → agent đề xuất chạy thử (mỗi bài 1 chiến dịch) → Sếp duyệt mới tạo + bật →
// đo theo TUẦN (chạy đủ `days` ngày rồi chấm một lần trên tổng cả kỳ): đạt thì giữ bài học, không đạt thì tắt.
// Mỗi tuần, nếu mọi quảng cáo thử vừa xong của 1 cơ sở đều đạt → đề xuất Sếp tăng ngân sách ngày của cơ sở đó.
// An toàn: mặc định TẮT (settings.adTest.on); tổng ngân sách đang cam kết của mỗi cơ sở không vượt mức ngày của cơ sở;
// chạy thử (dryRun) thì chỉ ghi nhật ký; không có trần tháng (Sếp đã bỏ).
const { load, uid } = require('./db');
const { ads, social } = require('./connectors');

const DAY = 864e5;
const VN = 7 * 3600e3; // ngày theo giờ Việt Nam
const dayKey = (t) => new Date(new Date(t).getTime() + VN).toISOString().slice(0, 10);
const vnd = (n) => Math.round(n).toLocaleString('vi-VN') + 'đ';

const engine = () => require('./engine');
const cfg = () => load().settings.adTest;
const units = () => cfg().units || [];
// Cơ sở đang bật quảng cáo (Sếp tắt ở trang Quảng cáo → không đề xuất, không tự chạy, không đo tuần; chiến dịch đang chạy vẫn được chấm khi hết kỳ)
const activeUnits = () => units().filter((u) => u.on !== false);
const unitById = (id) => units().find((u) => u.id === id);

// Cơ sở của 1 chiến dịch trong thương hiệu: khớp theo tên (ưu tiên cơ sở có mẫu tên), không khớp thì cơ sở "còn lại" (mẫu rỗng)
function unitOf(brandId, name) {
  const mine = units().filter((u) => u.brand === brandId);
  const hit = mine.find((u) => u.match && new RegExp(u.match, 'i').test(name || ''));
  return (hit || mine.find((u) => !u.match) || null);
}

// Ngưỡng giá/tin nhắn của thương hiệu: đạt khi ≤ scale, loại khi > stop (tính trên tổng cả kỳ chạy thử)
function limits(brandId) {
  const r = load().settings.rules;
  const o = (r.byBrand || {})[brandId] || {};
  const fail = (cfg().failByBrand || {})[brandId]; // ngưỡng loại riêng cho quảng cáo thử
  return { scale: o.scale || r.scaleUp.maxCostPerMsg, stop: fail || o.stop || r.highCpl.maxCostPerMsg };
}

const running = () => load().adTests.filter((t) => t.status === 'running');

// Cơ sở của 1 chiến dịch: quảng cáo thử/video do agent tạo → theo sổ adTests; còn lại → theo tên chiến dịch
function unitOfCampaign(c) {
  const t = load().adTests.find((x) => x.campaignId === c.id);
  if (t) return unitById(t.unitId) || null;
  const brand = engine().brandOf(c);
  return brand ? unitOf(brand, c.name) : null;
}

// Ngân sách ngày đang dùng của 1 cơ sở = TỔNG ngân sách ngày của MỌI chiến dịch đang bật thuộc cơ sở đó
// (chiến dịch cũ Sếp tự lên + quảng cáo thử/video do agent tạo), + đề xuất đang chờ duyệt nếu withPending.
// Mức tối đa ngày của cơ sở (dailyBudget) là trần cho tổng này — Sếp đặt: "tổng cả bài mới lẫn cũ không được vượt".
function committed(unitId, withPending = true) {
  const db = load();
  let sum = 0;
  const seen = new Set();
  for (const c of db.campaigns || []) {
    if (c.status !== 'ACTIVE' || c.stale) continue;
    const u = unitOfCampaign(c);
    if (!u || u.id !== unitId) continue;
    seen.add(c.id);
    const t = db.adTests.find((x) => x.campaignId === c.id);
    sum += Number(c.budgetTotal || c.budget || 0) || (t ? t.budget : 0);
  }
  // Quảng cáo thử vừa tạo, chưa kịp có trong danh sách chiến dịch (đọc lại ở lần quét sau)
  for (const t of running().filter((t) => t.unitId === unitId && !seen.has(t.campaignId))) sum += t.budget;
  const pend = withPending ? db.approvals.filter((a) => a.status === 'pending' && a.type === 'ad_test' && a.payload.unitId === unitId).reduce((s, a) => s + a.payload.budget, 0) : 0;
  // Bài "Lên bài & chạy QC" chưa đăng xong: tiền đã giữ chỗ cho cơ sở (đợt lên bài sau không được tính trùng chỗ trống)
  const plans = withPending ? db.posts.filter((p) => p.adPlan && p.adPlan.status === 'waiting' && p.adPlan.unitId === unitId && !['failed', 'rejected'].includes(p.status)).reduce((s, p) => s + p.adPlan.budget, 0) : 0;
  return sum + pend + plans;
}

function capProblem(unit, budget, withPending = true) {
  const used = committed(unit.id, withPending);
  if (unit.dailyBudget > 0 && used + budget > unit.dailyBudget) return `${unit.name}: vượt ngân sách ngày tối đa ${vnd(unit.dailyBudget)} (mọi chiến dịch đang chạy${withPending ? ' + đề xuất chờ' : ''} đã ${vnd(used)}/ngày, thêm ${vnd(budget)} là quá)`;
  return null;
}

// Bài Facebook đã đăng gần đây, còn chưa chạy thử, có mã bài viết dạng pageId_postId (bài video chưa hỗ trợ)
function candidates(brandId, now) {
  const db = load();
  const used = new Set([
    ...db.adTests.map((t) => t.postId),
    ...db.approvals.filter((a) => a.type === 'ad_test').map((a) => a.payload.postId), // kể cả bài Sếp đã bỏ qua: không đề xuất lại
  ]);
  const pageIds = require('./planner').brands()[brandId].pageIds;
  const out = [];
  for (const p of db.posts) {
    if (p.brand !== brandId || p.channel !== 'facebook_page' || p.status !== 'published' || used.has(p.id)) continue;
    if (!p.live || now - new Date(p.scheduledAt).getTime() > 1.5 * DAY) continue;
    const pageId = pageIds.find((id) => String((p.results || {})[id] || '').includes('_'));
    if (!pageId) continue;
    out.push({ p, pageId, objectStoryId: p.results[pageId] });
  }
  return out.sort((a, b) => new Date(b.p.scheduledAt) - new Date(a.p.scheduledAt));
}

function propose(now = Date.now()) {
  const db = load();
  const c = cfg();
  if (!c.on) return 0;
  const eng = engine();
  const brands = require('./planner').brands();
  const today = dayKey(now);
  let n = 0;
  for (const u of activeUnits()) {
    const b = brands[u.brand];
    if (!b || !b.adAccountId || !b.pageIds.length) continue;
    const madeToday = () => db.adTests.filter((t) => t.unitId === u.id && dayKey(t.createdAt) === today).length
      + db.approvals.filter((a) => a.type === 'ad_test' && a.status !== 'approved' && a.payload.unitId === u.id && dayKey(a.at) === today).length;
    while (madeToday() < c.perUnitPerDay) {
      const cand = candidates(u.brand, now)[0];
      if (!cand) break;
      const problem = capProblem(u, c.budget);
      if (problem) { if (!db.approvals.some((a) => a.type === 'ad_test' && a.payload.unitId === u.id && dayKey(a.at) === today)) eng.log('error', `Chưa đề xuất quảng cáo thử: ${problem}`); break; }
      const lim = limits(u.brand);
      db.approvals.unshift({
        id: uid('p'), type: 'ad_test', key: cand.p.id, status: 'pending', at: new Date(now).toISOString(),
        title: `Chạy thử bài "${cand.p.topic}" — ${u.name}`,
        detail: `${vnd(c.budget)}/ngày × ${c.days} ngày (tối đa ${vnd(c.budget * c.days)}), chấm một lần khi hết kỳ. Đạt nếu giá ≤ ${vnd(lim.scale)}/tin nhắn, loại nếu > ${vnd(lim.stop)}. Tạo ở trạng thái tạm dừng, chỉ bật khi Sếp duyệt.`,
        payload: { unitId: u.id, brand: u.brand, postId: cand.p.id, topic: cand.p.topic, pageId: cand.pageId, objectStoryId: cand.objectStoryId, accountId: b.adAccountId, budget: c.budget, days: c.days },
      });
      eng.log('propose', `Đề xuất chạy thử quảng cáo cho bài "${cand.p.topic}" (${u.name}), chờ Sếp duyệt`, { rule: 'adTestDaily' });
      n++;
    }
  }
  return n;
}

// Sếp chỉ định chạy thử 1 bài Facebook đã đăng cho từng cơ sở, ngân sách/số ngày riêng (không phụ thuộc giới hạn "mỗi ngày N bài"
// hay bật/tắt đề xuất tự động). Chỉ tạo đề xuất chờ duyệt; duyệt mới tạo quảng cáo — qua đúng đường start() (trần ngày của cơ sở, mẫu đối tượng, nhật ký).
async function proposeManual({ postId, unitIds, budget, days } = {}, now = Date.now()) {
  const db = load();
  const p = db.posts.find((x) => x.id === postId);
  if (!p) throw new Error('Không tìm thấy bài');
  if (p.channel !== 'facebook_page' || p.status !== 'published' || !p.live) throw new Error(`Bài "${p.topic}" chưa đăng thật lên Facebook Page`);
  budget = Math.round(Number(budget));
  days = Math.round(Number(days));
  if (!(budget >= 20000 && budget <= 5000000)) throw new Error('Ngân sách ngày phải từ 20.000đ đến 5.000.000đ');
  if (!(days >= 1 && days <= 30)) throw new Error('Số ngày chạy phải từ 1 đến 30');
  const b = require('./planner').brands()[p.brand];
  if (!b || !b.adAccountId) throw new Error('Thương hiệu chưa có tài khoản quảng cáo');
  const ids = [...new Set((Array.isArray(unitIds) ? unitIds : []).map(String))];
  if (!ids.length) throw new Error('Chọn ít nhất 1 cơ sở');
  const list = ids.map((id) => {
    const u = unitById(id);
    if (!u || u.brand !== p.brand) throw new Error(`Cơ sở ${id} không thuộc thương hiệu của bài`);
    const dup = db.adTests.some((t) => t.postId === p.id && t.unitId === id && t.status === 'running')
      || db.approvals.some((a) => a.type === 'ad_test' && a.status === 'pending' && a.payload.postId === p.id && a.payload.unitId === id);
    if (dup) throw new Error(`Bài "${p.topic}" đã có quảng cáo thử (hoặc đề xuất chờ duyệt) ở ${u.name}`);
    return u;
  });
  // Page nào đã đăng được thì lấy mã bài của Page đó (bài video: tra từ mã video)
  let pageId = null, objectStoryId = null;
  for (const [pid, ext] of Object.entries(p.results || {})) {
    if (!ext || !b.pageIds.includes(pid)) continue;
    objectStoryId = await social.videoPostId(pid, ext);
    if (objectStoryId) { pageId = pid; break; }
  }
  if (!objectStoryId) throw new Error(`Facebook chưa có mã bài viết cho "${p.topic}" (video có thể đang xử lý) — thử lại sau vài phút`);
  const lim = limits(p.brand);
  const out = [];
  for (const u of list) {
    const problem = capProblem(u, budget);
    if (problem) throw new Error(problem + (out.length ? ` — đã tạo ${out.length} đề xuất trước đó` : ''));
    const id = uid('p');
    db.approvals.unshift({
      id, type: 'ad_test', key: p.id, status: 'pending', at: new Date(now).toISOString(),
      title: `Chạy thử bài "${p.topic}" — ${u.name}`,
      detail: `${vnd(budget)}/ngày × ${days} ngày (tối đa ${vnd(budget * days)}), Sếp chỉ định. Đạt nếu giá ≤ ${vnd(lim.scale)}/tin nhắn, loại nếu > ${vnd(lim.stop)}. Tạo ở trạng thái tạm dừng, chỉ bật khi duyệt.`,
      payload: { unitId: u.id, brand: p.brand, postId: p.id, topic: p.topic, pageId, objectStoryId, accountId: b.adAccountId, budget, days, source: 'manual' },
    });
    out.push(id);
  }
  engine().log('propose', `Đề xuất chạy thử bài "${p.topic}" cho ${list.map((u) => u.name).join(', ')} (${vnd(budget)}/ngày × ${days} ngày), chờ duyệt`);
  return out;
}

// Bài lên bằng "Lên bài & chạy QC" mang p.adPlan = { unitId, budget, days, status:'waiting' }. Mỗi lượt quét, bài nào đã đăng thật
// thì tạo quảng cáo thử cho đúng cơ sở rồi duyệt luôn (Sếp đã chọn chạy khi lên bài) — vẫn qua start(): trần ngày, mẫu đối tượng, nhật ký.
// Video vừa đăng Facebook chưa có mã bài → giữ chờ, lần quét sau thử lại (tối đa 1 ngày). Lỗi khác → ghi lỗi 1 lần, đề xuất (nếu đã tạo) để ở mục Duyệt.
async function runPlans(now = Date.now()) {
  const db = load();
  const eng = engine();
  let n = 0;
  for (const p of db.posts) {
    const plan = p.adPlan;
    if (!plan || plan.status !== 'waiting') continue;
    if (['failed', 'rejected'].includes(p.status)) { Object.assign(plan, { status: 'cancelled', error: p.status === 'rejected' ? 'Bài bị bỏ qua nên không chạy quảng cáo' : 'Bài đăng lỗi nên không chạy quảng cáo' }); continue; }
    if (p.status !== 'published') continue;
    const unit = unitById(plan.unitId);
    let ids = [];
    plan.status = 'creating'; // khỏi bị tính giữ chỗ 2 lần (kế hoạch + đề xuất) khi kiểm tra trần ngày
    try {
      ids = await proposeManual({ postId: p.id, unitIds: [plan.unitId], budget: plan.budget, days: plan.days }, now);
    } catch (e) {
      const waitingVideo = /chưa có mã bài viết/.test(e.message) && now - new Date(p.scheduledAt).getTime() < DAY;
      if (waitingVideo) { plan.status = 'waiting'; continue; }
      Object.assign(plan, { status: 'error', error: e.message, at: new Date(now).toISOString() });
      eng.log('error', `Chưa tạo được quảng cáo cho bài "${p.topic}" (${unit ? unit.name : plan.unitId}): ${e.message}`);
      continue;
    }
    plan.approvalId = ids[0];
    try {
      await eng.decide(ids[0], true, { by: 'Agent Quảng cáo (Lên bài & chạy QC)', note: `Sếp chọn chạy quảng cáo khi lên bài: ${vnd(plan.budget)}/ngày × ${plan.days} ngày` });
      const t = db.adTests.find((x) => x.postId === p.id && x.unitId === plan.unitId && x.status === 'running');
      Object.assign(plan, { status: 'running', campaignId: t ? t.campaignId : null, at: new Date(now).toISOString() });
      delete plan.error;
      n++;
    } catch (e) {
      Object.assign(plan, { status: 'error', error: e.message, at: new Date(now).toISOString() });
      eng.log('error', `Facebook chưa tạo quảng cáo cho bài "${p.topic}" (${unit ? unit.name : plan.unitId}): ${e.message} — đề xuất để ở mục Duyệt, sửa xong duyệt lại`);
    }
  }
  return n;
}

// Cơ sở có thể nhận 1 video: khớp mẫu tên/địa chỉ trong nội dung; không khớp cơ sở nào thì cơ sở không có mẫu; không có nữa thì mọi cơ sở của thương hiệu
function unitsFor(brandId, text) {
  const mine = units().filter((u) => u.brand === brandId);
  const hits = mine.filter((u) => u.match && new RegExp(u.match, 'i').test(text || ''));
  if (hits.length) return hits;
  const blank = mine.filter((u) => !u.match);
  return blank.length ? blank : mine;
}

// Quy tắc "bài đang lên view tự nhiên": mỗi cơ sở mỗi ngày đề xuất 1 video/Reel có nhiều lượt xem tự nhiên nhất mà chưa từng chạy quảng cáo.
// Chỉ đề xuất (chờ Sếp duyệt); tạo quảng cáo dùng lại đường chạy thử (start) nên cùng giới hạn ngân sách ngày của cơ sở.
async function proposeBoost(now = Date.now()) {
  const db = load();
  const c = cfg();
  const bc = c.boost || {};
  if (!c.on || bc.on === false) return 0;
  const eng = engine();
  const brands = require('./planner').brands();
  const today = dayKey(now);
  expireBoost(now);
  const used = new Set([...db.adTests.map((t) => t.postId), ...db.approvals.filter((a) => a.type === 'ad_test').map((a) => a.payload.postId)]);
  const taken = new Set();
  let n = 0;
  const byBrand = {};
  db.channelSync = db.channelSync || {};
  // Lỗi cùng nguyên nhân chỉ ghi nhật ký 1 lần (agent quét mỗi 30 phút, không lặp 48 dòng/ngày); hết lỗi rồi lỗi lại thì ghi lại
  const once = (key, text) => {
    const s = (db.channelSync[key] = db.channelSync[key] || {});
    if (s.error !== text) eng.log('error', text);
    s.error = text;
    s.at = new Date(now).toISOString();
  };
  const clear = (key) => { if (db.channelSync[key]) delete db.channelSync[key].error; };
  for (const u of activeUnits()) {
    const b = brands[u.brand];
    if (!b || !b.adAccountId || !b.pageIds.length) continue;
    const doneToday = db.adTests.some((t) => t.unitId === u.id && t.source === 'organic' && dayKey(t.createdAt) === today)
      || db.approvals.some((a) => a.type === 'ad_test' && a.payload.unitId === u.id && a.payload.source === 'organic' && dayKey(a.at) === today);
    if (doneToday) continue;
    if (!byBrand[u.brand]) {
      try {
        const adv = new Set(await ads.promotedStories(b.adAccountId));
        const vids = [];
        for (const pageId of b.pageIds) {
          // Chỉ lấy video của Page đã cấp quyền "Tạo quảng cáo" cho người dùng hệ thống (Page của doanh nghiệp khác chưa cấp thì bỏ qua, ghi 1 lần)
          const pp = await advertiseProblem(pageId);
          if (pp) { once(`pageads:${pageId}`, `Bỏ qua video của Page ${pageId} (${b.name}) khi chọn quảng cáo: ${pp}`); continue; }
          clear(`pageads:${pageId}`);
          vids.push(...await social.organicVideos(pageId, bc.maxAgeDays || 14));
        }
        byBrand[u.brand] = vids.filter((v) => !adv.has(v.postId) && !used.has(v.postId) && v.views >= (bc.minViews || 0));
        clear(`boost:${u.brand}`);
      } catch (e) { once(`boost:${u.brand}`, `Chưa quét được video nhiều view của ${b.name}: ${e.message}`); byBrand[u.brand] = []; }
    }
    const cand = byBrand[u.brand].filter((v) => !taken.has(v.postId) && unitsFor(u.brand, v.text).some((x) => x.id === u.id)).sort((x, y) => y.views - x.views)[0];
    if (!cand) continue;
    const problem = capProblem(u, c.budget);
    if (problem) { once(`boostcap:${u.id}`, `Chưa đề xuất quảng cáo video nhiều view: ${problem}`); continue; }
    clear(`boostcap:${u.id}`);
    taken.add(cand.postId);
    const topic = (cand.text.split('\n')[0] || 'Video').replace(/\s+/g, ' ').slice(0, 60);
    const lim = limits(u.brand);
    const apId = uid('p');
    db.approvals.unshift({
      id: apId, type: 'ad_test', key: cand.postId, status: 'pending', at: new Date(now).toISOString(),
      title: `Chạy quảng cáo video đang lên view "${topic}" — ${u.name}`,
      detail: `Video có ${cand.views.toLocaleString('vi-VN')} lượt xem tự nhiên, chưa chạy quảng cáo. ${vnd(c.budget)}/ngày × ${c.days} ngày (tối đa ${vnd(c.budget * c.days)}), chấm một lần khi hết kỳ. Đạt nếu giá ≤ ${vnd(lim.scale)}/tin nhắn, loại nếu > ${vnd(lim.stop)}. Đề xuất tự hết hạn sau ${bc.expireDays || 3} ngày nếu không duyệt.`,
      payload: { unitId: u.id, brand: u.brand, postId: cand.postId, topic, pageId: cand.pageId, objectStoryId: cand.postId, accountId: b.adAccountId, budget: c.budget, days: c.days, source: 'organic', views: cand.views, auto: !!bc.auto },
    });
    eng.log('propose', `Đề xuất chạy quảng cáo cho video đang lên view (${cand.views} lượt xem) "${topic}" — ${u.name}${bc.auto ? ', agent tự chạy' : ', chờ Sếp duyệt'}`, { rule: 'adBoostOrganic' });
    n++;
    // Chế độ tự chạy (Sếp bật ở trang Quảng cáo): agent tự duyệt ngay — vẫn qua đúng đường duyệt (hạn mức ngày của cơ sở, chạy thử, nhật ký).
    // Facebook từ chối thì đề xuất giữ ở mục Duyệt để Sếp xem lý do; lỗi cùng nguyên nhân chỉ ghi 1 lần.
    if (bc.auto) {
      try { await eng.decide(apId, true, { by: 'Agent Quảng cáo (tự chạy)', note: `Tự chạy theo luật video đang lên view: ${cand.views} lượt xem tự nhiên` }); clear(`boostauto:${u.id}`); }
      catch (e) { once(`boostauto:${u.id}`, `Chưa tự chạy được quảng cáo video "${topic}" (${u.name}): ${e.message} — đề xuất giữ ở mục Duyệt`); }
    }
  }
  return n;
}

// Người dùng hệ thống thiếu quyền "Tạo quảng cáo" (ADVERTISE) trên Page → câu báo; đủ quyền hoặc không kiểm tra được → rỗng.
// Chỉ để NHẮC: danh sách quyền Meta trả về theo token có thể chưa cập nhật sau khi cấp quyền (đã gặp thật ngày 15/10/2026), nên không dùng để chặn.
async function advertiseProblem(pageId) {
  let tasks;
  try { tasks = await social.pageTasks(pageId); } catch { return ''; } // không đọc được danh sách Page thì không chặn, để Facebook trả lời khi tạo
  if (tasks === null && !social.isLive('facebook_page', pageId)) return '';
  return social.pageTaskProblem(tasks, ['ADVERTISE']);
}

// Video "đang lên view" chỉ có giá trị vài ngày: đề xuất chờ quá hạn thì tự đóng (không tính là Sếp từ chối, bài vẫn có thể được đề xuất lại khi lên view tiếp)
function expireBoost(now = Date.now()) {
  const db = load();
  const days = (cfg().boost || {}).expireDays || 3;
  const old = db.approvals.filter((a) => a.status === 'pending' && a.type === 'ad_test' && a.payload.source === 'organic' && now - new Date(a.at).getTime() > days * DAY);
  for (const a of old) {
    a.status = 'rejected';
    a.decidedAt = new Date(now).toISOString();
    a.decidedBy = 'Hệ thống';
    a.note = `Hết hạn: quá ${days} ngày chưa duyệt, video không còn "đang lên view". Agent sẽ đề xuất video mới hơn.`;
    a.expired = true;
  }
  if (old.length) engine().log('system', `Đóng ${old.length} đề xuất quảng cáo video quá ${days} ngày chưa duyệt (${old.map((a) => `"${a.payload.topic}"`).join(', ')})`, { rule: 'adBoostOrganic' });
  return old.length;
}

// Tóm tắt đối tượng nhắm của 1 nhóm quảng cáo để hiển thị
function describe(t) {
  const g = t.genders && t.genders.length ? (t.genders.join() === '2' ? 'Nữ' : t.genders.join() === '1' ? 'Nam' : 'Nam+Nữ') : 'Nam+Nữ';
  const geo = t.geo_locations || {};
  const places = [...(geo.cities || []).map((c) => c.name), ...(geo.custom_locations || []).map((c) => (c.name || 'điểm tùy chọn') + (c.radius ? ` (bán kính ${c.radius}${c.distance_unit || ''})` : '')), ...(geo.regions || []).map((r) => r.name), ...(geo.countries || [])];
  const interests = [...(t.flexible_spec || []).flatMap((f) => (f.interests || []).map((i) => i.name)), ...(t.interests || []).map((i) => i.name)];
  return { age: `${t.age_min || 18}-${t.age_max || 65}`, gender: g, places: places.slice(0, 4), interests: [...new Set(interests)].slice(0, 6) };
}

// Học đối tượng từ tài khoản quảng cáo thật: mỗi thương hiệu giữ 6 nhóm quảng cáo có giá/tin nhắn tốt nhất
// (đủ dữ liệu: ≥ 1.000.000đ và ≥ 15 tin nhắn trong 30 ngày). Lưu ở db.audiences, làm mới tối đa 12 giờ/lần.
async function learn(now = Date.now(), force = false) {
  const db = load();
  if (typeof ads.audiences !== 'function' || ads.mode !== 'live') return 0;
  if (!force && db.audiencesAt && now - new Date(db.audiencesAt).getTime() < 12 * 3600e3) return 0;
  const eng = engine();
  const accounts = [...new Set(Object.values(require('./planner').brands()).map((b) => b.adAccountId).filter(Boolean))];
  const byBrand = {};
  for (const acc of accounts) {
    let list;
    try { list = await ads.audiences(acc); } catch (e) { eng.log('error', `Không học được đối tượng của tài khoản ${acc}: ${e.message}`); continue; }
    for (const a of list) {
      if (a.spend < 1000000 || a.msgs < 15) continue;
      const brand = eng.brandOf({ accountId: String(acc), name: a.campaign });
      if (!brand) continue;
      (byBrand[brand] = byBrand[brand] || []).push({ adsetId: a.adsetId, campaign: a.campaign, spend: a.spend, msgs: a.msgs, cpl: Math.round(a.spend / a.msgs), destination: a.destination, ...describe(a.targeting), targeting: a.targeting });
    }
  }
  for (const k of Object.keys(byBrand)) byBrand[k] = byBrand[k].sort((x, y) => x.cpl - y.cpl).slice(0, 6);
  db.audiences = byBrand;
  db.audiencesAt = new Date(now).toISOString();
  return Object.keys(byBrand).length;
}

// Sếp duyệt → tạo quảng cáo thật (chạy thử thì chỉ ghi nhật ký)
async function start(a, dry, now = Date.now()) {
  const db = load();
  const pl = a.payload;
  const eng = engine();
  const unit = unitById(pl.unitId);
  if (dry) { eng.log('approve', `Sếp duyệt chạy thử quảng cáo "${pl.topic}" — đang CHẠY THỬ nên chưa tạo gì trên Facebook`, { dry }); return; }
  if (!unit) throw new Error('Cơ sở của quảng cáo thử này không còn trong cài đặt');
  const problem = capProblem(unit, pl.budget, false);
  if (problem) throw new Error(`Không tạo quảng cáo thử: ${problem}`);
  await learn(now);
  // Ưu tiên đối tượng tốt nhất của chính cơ sở này, không có thì lấy tốt nhất của thương hiệu
  const pool = (db.audiences || {})[pl.brand] || [];
  const learned = pool.find((x) => (unitOf(pl.brand, x.campaign) || {}).id === unit.id) || pool[0];
  const best = learned ? null : db.campaigns
    .filter((c) => c.status === 'ACTIVE' && c.accountId === pl.accountId && engine().isMsgCampaign(c) && engine().brandOf(c) === pl.brand && c.d7.msgs >= 5)
    .sort((x, y) => x.d7.spend / x.d7.msgs - y.d7.spend / y.d7.msgs)[0];
  let tpl, source;
  if (learned) { tpl = { targeting: learned.targeting }; source = `${learned.campaign} (${vnd(learned.cpl)}/tin)`; }
  else {
    if (!best) throw new Error('Chưa có chiến dịch tin nhắn nào đủ dữ liệu của thương hiệu này để lấy mẫu nhắm đối tượng');
    tpl = await ads.adsetTemplate(best.id);
    if (!tpl) throw new Error(`Không đọc được nhóm quảng cáo mẫu của "${best.name}"`);
    source = best.name;
  }
  const name = `TEST-${unit.id}-${dayKey(now).replace(/-/g, '')}-${String(pl.topic).slice(0, 30)}`;
  // Không chặn trước theo danh sách quyền của token (Meta có thể trả danh sách cũ dù quyền đã cấp) — để Facebook quyết định;
  // Facebook từ chối vì quyền thì ghép thêm hướng dẫn cấp quyền "Tạo quảng cáo" vào câu lỗi.
  let r;
  try { r = await ads.createTest({ accountId: pl.accountId, name, pageId: pl.pageId, objectStoryId: pl.objectStoryId, budget: pl.budget, days: pl.days, targeting: tpl.targeting }); }
  catch (e) {
    if (/quyền đối với Trang|quyền|permission|\(#10\)|\(#200\)/i.test(e.message)) {
      const perm = (await advertiseProblem(pl.pageId)) || `kiểm tra Page ${pl.pageId} đã cấp quyền "Tạo quảng cáo" cho người dùng hệ thống của app chưa (Cài đặt doanh nghiệp → Tài khoản → Trang)`;
      throw new Error(`${e.message} — ${perm}. Cấp quyền xong rồi duyệt lại.`);
    }
    throw e;
  }
  db.adTests.unshift({
    id: uid('t'), unitId: unit.id, brand: pl.brand, postId: pl.postId, topic: pl.topic, accountId: pl.accountId, name,
    campaignId: r.campaignId, adsetId: r.adsetId, adId: r.adId, budget: pl.budget, days: pl.days,
    createdAt: new Date(now).toISOString(), endsAt: new Date(now + pl.days * DAY).toISOString(), status: 'running', template: source, source: pl.source || 'new', views: pl.views,
  });
  db.adTests.length = Math.min(db.adTests.length, 300);
  eng.log('approve', `Sếp duyệt: đã tạo và bật quảng cáo thử "${pl.topic}" cho ${unit.name} (${vnd(pl.budget)}/ngày × ${pl.days} ngày, mẫu đối tượng: ${source})`);
}

// Quảng cáo thử đã hết kỳ → chấm một lần trên tổng cả kỳ. Đạt: ghi bài học. Còn lại: tắt (nếu còn chạy).
async function evaluate(campaigns, now = Date.now()) {
  const eng = engine();
  let n = 0;
  for (const t of running()) {
    if (new Date(t.endsAt).getTime() > now) continue;
    const c = campaigns.find((x) => x.id === t.campaignId);
    if (!c) {
      if (now - new Date(t.endsAt).getTime() > 3 * DAY) { t.status = 'lost'; eng.log('error', `Quảng cáo thử "${t.topic}" không còn thấy trên Facebook — đánh dấu đã mất`); n++; }
      continue;
    }
    const spend = c.d7.spend, msgs = eng.msgsFor(c.d7);
    const lim = limits(t.brand);
    const cpl = msgs ? spend / msgs : null;
    let verdict = 'neutral';
    if (cpl !== null && cpl <= lim.scale) verdict = 'pass';
    else if (spend >= t.budget * t.days * 0.5 && (cpl === null || cpl > lim.stop)) verdict = 'fail';
    const summary = `tiêu ${vnd(spend)}, ${msgs} tin nhắn${cpl !== null ? `, ${vnd(cpl)}/tin` : ''}`;
    if (c.status === 'ACTIVE') await eng.stop(c, `hết kỳ chạy thử (${summary})`, 'adTest');
    Object.assign(t, { status: verdict, spend, msgs, finishedAt: new Date(now).toISOString() });
    const word = { pass: 'ĐẠT', fail: 'KHÔNG ĐẠT', neutral: 'chưa rõ' }[verdict];
    eng.log('system', `Quảng cáo thử "${t.topic}": ${word} — ${summary}`);
    if (verdict !== 'neutral') {
      try {
        require('./lessons').add({
          scope: t.brand, source: 'ads',
          text: verdict === 'pass'
            ? `Bài "${t.topic}" chạy thử quảng cáo đạt (${summary}) — làm thêm nội dung cùng kiểu.`
            : `Bài "${t.topic}" chạy thử quảng cáo không đạt (${summary}) — tránh kiểu nội dung này.`,
        });
      } catch { /* bài học trùng: bỏ qua */ }
    }
    n++;
  }
  return n;
}

// Chấm sớm sau `checkDays` ngày (Sếp đặt 2): chưa ra tin nhắn nào, hoặc giá/tin đã vượt ngưỡng loại → TẮT LUÔN và báo;
// có tin nhắn → báo số liệu, chạy tiếp tới hết kỳ. Chưa tiêu tiền (thường đang chờ Facebook duyệt) → báo, kiểm tra lại ngày sau.
async function checkpoint(campaigns, now = Date.now()) {
  const eng = engine();
  const days = cfg().checkDays || 2;
  let n = 0;
  for (const t of running()) {
    if (t.checkedAt) continue;
    const age = now - new Date(t.createdAt).getTime();
    if (age < days * DAY || new Date(t.endsAt).getTime() <= now) continue;
    const c = campaigns.find((x) => x.id === t.campaignId);
    if (!c) continue;
    const spend = c.d7.spend, msgs = eng.msgsFor(c.d7);
    const lim = limits(t.brand);
    const cpl = msgs ? spend / msgs : null;
    const summary = `sau ${days} ngày: tiêu ${vnd(spend)}, ${msgs} tin nhắn${cpl !== null ? `, ${vnd(cpl)}/tin` : ''}${eng.usingReal() && c.d7.real !== undefined ? ` (khách thật ước tính, Facebook báo ${c.d7.msgs})` : ''}`;
    if (spend < t.budget * 0.2) {
      const key = dayKey(now);
      if (t.checkNoteDay !== key) { t.checkNoteDay = key; eng.log('system', `Quảng cáo thử "${t.topic}" (${unitName(t)}) ${summary} — gần như chưa tiêu tiền (có thể Facebook chưa duyệt xong), chưa chấm, kiểm tra lại ngày mai`); }
      continue;
    }
    t.checkedAt = new Date(now).toISOString();
    if (msgs === 0 || cpl > lim.stop) {
      if (c.status === 'ACTIVE') await eng.stop(c, `${msgs === 0 ? 'không ra tin nhắn' : `giá ${vnd(cpl)}/tin vượt ngưỡng loại ${vnd(lim.stop)}`} ${summary}`, 'adTestEarly');
      Object.assign(t, { status: 'fail', early: true, spend, msgs, finishedAt: t.checkedAt });
      eng.log('system', `Quảng cáo thử "${t.topic}" (${unitName(t)}): KHÔNG ĐẠT, tắt sớm — ${summary}`);
      try { require('./lessons').add({ scope: t.brand, source: 'ads', text: `Bài "${t.topic}" chạy thử ${days} ngày không ra kết quả (${summary}) — tránh kiểu nội dung này.` }); } catch { /* bài học trùng */ }
    } else {
      Object.assign(t, { spend, msgs });
      eng.log('system', `Quảng cáo thử "${t.topic}" (${unitName(t)}): đang ra kết quả — ${summary}${cpl <= lim.scale ? ' (đạt ngưỡng tốt)' : ''}, chạy tiếp tới hết kỳ`);
    }
    n++;
  }
  return n;
}
const unitName = (t) => (unitById(t.unitId) || {}).name || t.unitId;

// Mỗi tuần 1 lần cho từng cơ sở: nếu mọi quảng cáo thử vừa xong đều ĐẠT → đề xuất tăng ngân sách ngày (chờ Sếp duyệt).
// Có bài không đạt hoặc chưa rõ thì không đề xuất tăng.
function review(now = Date.now()) {
  const db = load();
  const eng = engine();
  const c = cfg();
  db.adReviews = db.adReviews || {};
  let n = 0;
  for (const u of activeUnits()) {
    const last = db.adReviews[u.id] ? new Date(db.adReviews[u.id]).getTime() : null;
    const done = db.adTests.filter((t) => t.unitId === u.id && ['pass', 'fail', 'neutral'].includes(t.status) && (!last || new Date(t.finishedAt).getTime() > last));
    if (!done.length) continue;
    if (last && now - last < 7 * DAY) continue; // đo theo tuần
    db.adReviews[u.id] = new Date(now).toISOString();
    const bad = done.filter((t) => t.status !== 'pass');
    if (bad.length) { eng.log('system', `Đo tuần ${u.name}: ${done.length - bad.length}/${done.length} quảng cáo thử đạt — chưa đề xuất tăng ngân sách`); continue; }
    if (db.approvals.some((a) => a.status === 'pending' && a.type === 'unit_budget' && a.payload.unitId === u.id)) continue;
    const to = Math.round((u.dailyBudget * (1 + c.raisePct / 100)) / 10000) * 10000;
    db.approvals.unshift({
      id: uid('p'), type: 'unit_budget', key: u.id, status: 'pending', at: new Date(now).toISOString(),
      title: `Tăng ngân sách ngày ${u.name}`,
      detail: `Tuần qua cả ${done.length} quảng cáo thử đều đạt. Đề xuất ${vnd(u.dailyBudget)} → ${vnd(to)}/ngày (+${c.raisePct}%).`,
      payload: { unitId: u.id, from: u.dailyBudget, to },
    });
    eng.log('propose', `Đề xuất tăng ngân sách ngày ${u.name}: ${vnd(u.dailyBudget)} → ${vnd(to)}, chờ Sếp duyệt`);
    n++;
  }
  return n;
}

// Sếp duyệt tăng ngân sách ngày của cơ sở
function applyUnitBudget(a) {
  const u = unitById(a.payload.unitId);
  if (!u) throw new Error('Cơ sở không còn trong cài đặt');
  u.dailyBudget = a.payload.to;
  engine().log('approve', `Sếp duyệt tăng ngân sách ngày ${u.name}: ${vnd(a.payload.from)} → ${vnd(a.payload.to)}`);
}

async function run(campaigns, now = Date.now()) {
  try { await learn(now); } catch (e) { engine().log('error', `Không học được đối tượng: ${e.message}`); }
  let n = await evaluate(campaigns, now);
  try { n += await checkpoint(campaigns, now); } catch (e) { engine().log('error', `Chấm sớm quảng cáo thử lỗi: ${e.message}`); }
  n += review(now);
  n += propose(now);
  try { n += await proposeBoost(now); } catch (e) { engine().log('error', `Quét video nhiều view lỗi: ${e.message}`); }
  return n;
}

module.exports = { runPlans, proposeManual, proposeBoost, expireBoost, advertiseProblem, activeUnits, unitsFor, unitOfCampaign, checkpoint, run, start, learn, describe, propose, evaluate, review, applyUnitBudget, capProblem, committed, limits, unitOf, units };
