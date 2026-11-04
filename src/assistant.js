// Trợ lý ảo:
//  1) Tư vấn khách (Messenger của Page, widget chat trên website): giữ ngữ cảnh cả hội thoại, trả lời theo đúng quy trình
//     nhân viên (hỏi độ dài tóc → báo giá theo size kèm ưu đãi đặt lịch trước → hỏi số người → 2 chi nhánh → xin tên + SĐT).
//     Câu ĐƠN GIẢN (giá, địa chỉ, ưu đãi, bảo hành, thanh toán...) được gửi tự động; khách chốt lịch / gửi SĐT / câu lạ → chuyển người.
//     Mẫu câu lấy từ src/replies.js + replies-vi.js (rút từ hội thoại thật). Không bịa giá, không hứa kết quả.
//  2) Trợ lý cho Sếp trong app: hỏi số liệu bằng tiếng Việt thường, ra vài lệnh (quét ngay, tắt/bật chiến dịch, dừng khẩn cấp).
const replies = require('./replies');
const { load } = require('./db');

// Ý khách mà trợ lý được tự trả lời (câu mẫu cố định, không tốn tiền, không cam kết gì ngoài bảng giá)
const SIMPLE = new Set(['greeting', 'price', 'address', 'discount', 'warranty', 'payment', 'extension', 'language', 'thanks', 'walkin', 'reschedule', 'damage', 'contact']);
// Ý khách phải có người: gửi SĐT/chốt lịch (cần ghi đơn trong Pancake), câu chưa nhận ra
const HANDOFF_REASON = {
  confirm: 'khách gửi tên/SĐT để chốt lịch — nhân viên điền phiếu xác nhận và ghi đơn',
  unknown: 'chưa nhận ra khách hỏi gì',
  booking: 'khách muốn đặt lịch',
};

// Rút ngữ cảnh từ cả hội thoại: dịch vụ, độ dài tóc, số người, đã hỏi/đã báo gì
function conversationState(history) {
  const st = { service: null, size: null, people: null, peopleKnown: false, askedLength: false, quoted: false, sentBranches: false, phone: false };
  for (const h of history) {
    const t = String(h.text || '');
    if (h.from === 'customer') {
      const s = replies.detectService(t); if (s) st.service = s;
      const z = replies.detectSize(t); if (z) st.size = z;
      if (replies.peopleKnown(t)) { st.people = replies.detectPeople(t); st.peopleKnown = true; }
      if (/(?<!\d)0\d{9,10}(?!\d)|(?<!\d)\+?84\d{9,10}(?!\d)/.test(t)) st.phone = true;
    } else {
      if (/ngang cằm, qua vai hay qua ngực/.test(t)) st.askedLength = true;
      if (/Size [SML]/.test(t)) st.quoted = true;
      if (/2 chi nhánh/.test(t)) st.sentBranches = true;
    }
  }
  return st;
}

// history: [{ from: 'customer'|'salon', text, at }] cũ → mới. Trả về câu trả lời cho tin khách mới nhất.
function converse(history, opts = {}) {
  const hist = Array.isArray(history) ? history.filter((h) => h && typeof h.text === 'string') : [];
  const last = [...hist].reverse().find((h) => h.from === 'customer');
  if (!last) return null;
  const st = conversationState(hist);
  const lang = replies.detectLang(last.text) === 'zh' ? 'zh' : 'vi';
  const d = replies.draft(last.text, {
    lang, brand: opts.brand, now: opts.now, rate: opts.rate,
    service: st.service || undefined, size: st.size || undefined, people: st.peopleKnown ? st.people : undefined,
  });
  let intent = d.intent.id;
  // Khách chỉ trả lời số người ("2 người ạ") sau khi được hỏi → tiếp tục báo giá cho đúng số người
  if (intent === 'unknown' && st.peopleKnown && st.service && replies.peopleKnown(last.text)) {
    const d2 = replies.draft(`giá ${last.text}`, { lang, brand: opts.brand, now: opts.now, rate: opts.rate, service: st.service, size: st.size || undefined, people: st.people, intent: 'price' });
    Object.assign(d, d2); intent = 'price';
  }
  const text = lang === 'zh' ? d.zh : d.vi;
  let handoff = !SIMPLE.has(intent) || d.needsHuman;
  let reason = HANDOFF_REASON[intent] || (handoff ? 'câu ngoài mẫu' : '');
  if (lang === 'zh' && d.flags.some((f) => /chưa có bản tiếng Trung/.test(f))) { handoff = true; reason = 'khách nhắn tiếng Trung, mẫu chưa có'; }
  // Khách muốn đặt lịch: câu "xin tên + SĐT + chi nhánh" là câu mẫu an toàn → vẫn gửi, nhưng báo nhân viên vào chốt
  const notify = intent === 'booking';
  if (intent === 'booking') { handoff = false; reason = ''; }
  return { text, intent: d.intent, lang, auto: !handoff, handoff, notify, reason, state: st, flags: d.flags };
}

// ---------- Trợ lý cho Sếp ----------
const vnd = (n) => Math.round(n || 0).toLocaleString('vi-VN') + 'đ';
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');

function unitSpend(db, field) {
  const adtest = require('./adtest');
  const out = {};
  for (const u of adtest.units()) out[u.id] = { name: u.name, spend: 0, msgs: 0, on: u.on !== false };
  const other = { name: 'Chưa gán cơ sở', spend: 0, msgs: 0 };
  for (const c of db.campaigns || []) {
    if (c.status !== 'ACTIVE' && !(c[field] && c[field].spend)) continue;
    const u = adtest.unitOfCampaign(c);
    const t = u ? out[u.id] : other;
    if (!t || !c[field]) continue;
    t.spend += c[field].spend || 0; t.msgs += c[field].msgs || 0;
  }
  if (other.spend) out.other = other;
  return out;
}
const spendLines = (m) => Object.values(m).filter((x) => x.spend || x.on !== false).map((x) => `• ${x.name}: ${vnd(x.spend)} · ${x.msgs} tin${x.msgs ? ` · ${vnd(x.spend / x.msgs)}/tin` : ''}`).join('\n');

// Trả lời câu hỏi/lệnh của Sếp. user: người đang đăng nhập (để kiểm tra quyền khi ra lệnh). Trả { text, did? }
async function boss(question, user) {
  const q = norm(question);
  const db = load();
  const engine = require('./engine');
  const authz = require('./authz');
  const need = (perm) => { if (!authz.can(user, perm)) throw new Error(`Anh/chị không có quyền này (cần: ${authz.PERMS[perm]})`); };
  if (!q.trim()) return { text: 'Anh hỏi em gì cũng được: "hôm nay tiêu bao nhiêu", "có gì chờ duyệt", "quảng cáo thử ra sao", "bài nào sắp đăng", "quét ngay", "tắt chiến dịch <tên>", "dừng khẩn cấp".' };

  // ----- lệnh -----
  if (/dung khan cap|dung het|stop all/.test(q)) {
    need('emergency'); db.settings.paused = true; engine.log('system', 'DỪNG KHẨN CẤP — agent ngừng mọi hành động (lệnh từ trợ lý)', { by: user.name }); require('./db').save();
    return { text: 'Đã DỪNG KHẨN CẤP: agent không làm gì nữa cho tới khi anh bật lại (nút góc phải hoặc nhắn "bật lại agent").', did: 'paused' };
  }
  if (/bat lai agent|bat lai|chay lai agent/.test(q)) {
    need('emergency'); db.settings.paused = false; engine.log('system', 'Đã bật lại agent (lệnh từ trợ lý)', { by: user.name }); require('./db').save();
    return { text: 'Đã bật lại agent.', did: 'resumed' };
  }
  if (/quet ngay|quet lai|chay quet|scan/.test(q)) {
    need('agents_run');
    const r = await engine.scan('manual');
    return { text: r.skipped ? 'Đang dừng khẩn cấp nên không quét.' : `Đã quét xong, ${r.changed} thay đổi/đề xuất mới. Xem Nhật ký để biết chi tiết.`, did: 'scan' };
  }
  const m = q.match(/^(tat|bat|pause|dung|resume) (chien dich |campaign )?(.+)$/);
  if (m && !/quang cao thu|video/.test(q)) {
    need('ads_write');
    const name = m[3].trim();
    const found = (db.campaigns || []).filter((c) => norm(c.name).includes(name));
    if (!found.length) return { text: `Không thấy chiến dịch nào có tên chứa "${m[3].trim()}".` };
    if (found.length > 1) return { text: `Có ${found.length} chiến dịch khớp, anh nói rõ hơn:\n${found.slice(0, 8).map((c) => `• ${c.name} (${c.status})`).join('\n')}` };
    const c = found[0];
    const on = /^(bat|resume)/.test(m[1]);
    const { ads } = require('./connectors');
    const dry = engine.isDry();
    if (!dry) await ads.setStatus(c.id, on ? 'ACTIVE' : 'PAUSED');
    c.status = on ? 'ACTIVE' : 'PAUSED';
    engine.log('ads_change', `${user.name} ${on ? 'BẬT' : 'TẮT'} chiến dịch ${c.name} qua trợ lý${dry ? ' (chạy thử — chưa đổi trên Facebook)' : ''}`, { by: user.name, campaignId: c.id, dry });
    require('./db').save();
    return { text: `Đã ${on ? 'bật' : 'tắt'} ${c.name}${dry ? ' (đang chạy thử nên chưa đổi thật trên Facebook)' : ''}.`, did: on ? 'resume' : 'pause' };
  }

  // ----- hỏi số liệu -----
  const pending = db.approvals.filter((a) => a.status === 'pending');
  if (/cho duyet|can duyet|duyet gi|de xuat/.test(q)) {
    if (!pending.length) return { text: 'Không có gì chờ duyệt.' };
    const by = {}; for (const a of pending) by[a.type] = (by[a.type] || 0) + 1;
    const label = { ad_test: 'quảng cáo thử/video', budget_increase: 'tăng ngân sách', comment_reply: 'trả lời bình luận', post_publish: 'bài đăng', message_reply: 'tin nhắn khách', lead: 'khách để lại SĐT', unit_budget: 'ngân sách cơ sở', month_plan: 'kế hoạch tháng' };
    return { text: `Đang chờ duyệt ${pending.length} mục:\n${Object.entries(by).map(([k, v]) => `• ${v} ${label[k] || k}`).join('\n')}\nVào mục Duyệt & Phê duyệt để xem.` };
  }
  if (/tin rac|rac|khach tiem nang|khach that|chat luong tin|tin that/.test(q)) {
    const st = require('./leads').stats();
    const brands = require('./planner').brands();
    const lines = Object.entries(st.byBrand).map(([b, x]) => `• ${(brands[b] || {}).name || b}: ${x.total} hội thoại → ${x.lead} khách tiềm năng · ${x.unknown} chưa rõ · ${x.spam} rác${x.ratio !== null ? ` (khách thật ${Math.round(x.ratio * 100)}%)` : ''}`);
    return { text: lines.length ? `7 ngày qua:\n${lines.join('\n')}\n${st.useForAds ? 'Luật quảng cáo đang dùng số khách thật ước tính.' : 'Luật quảng cáo đang dùng số Facebook báo (bật "dùng số khách thật" ở trang Quảng cáo nếu muốn).'}` : `Chưa chấm được hội thoại nào${st.lastScan ? '' : ' — token cần quyền Nhắn tin (pages_messaging) để đọc hộp thư'}.` };
  }
  if (/quang cao thu|bai thu|video dang chay|test/.test(q)) {
    const run = (db.adTests || []).filter((t) => t.status === 'running');
    const done = (db.adTests || []).filter((t) => ['pass', 'fail', 'neutral'].includes(t.status)).slice(0, 5);
    const unit = (t) => ((db.settings.adTest.units || []).find((u) => u.id === t.unitId) || {}).name || t.unitId;
    const line = (t) => `• ${t.topic.slice(0, 40)} (${unit(t)}): ${t.msgs !== undefined ? `${vnd(t.spend)} · ${t.msgs} tin` : 'chưa có số'}${t.status !== 'running' ? ` → ${({ pass: 'ĐẠT', fail: 'KHÔNG ĐẠT', neutral: 'chưa rõ' })[t.status]}` : ''}`;
    return { text: `${run.length} quảng cáo thử đang chạy${run.length ? ':\n' + run.map(line).join('\n') : '.'}${done.length ? `\nĐã chấm gần đây:\n${done.map(line).join('\n')}` : ''}` };
  }
  if (/hom nay|today/.test(q) && /tieu|chi|tien|spend|bao nhieu/.test(q)) {
    const m2 = unitSpend(db, 'today');
    const total = Object.values(m2).reduce((s, x) => s + x.spend, 0);
    return { text: `Hôm nay (tới giờ) tiêu ${vnd(total)}:\n${spendLines(m2)}` };
  }
  if (/(7 ngay|tuan|week)/.test(q) && /tieu|chi|tien|spend|bao nhieu|tin/.test(q)) {
    const m2 = unitSpend(db, 'd7');
    const total = Object.values(m2).reduce((s, x) => s + x.spend, 0);
    return { text: `7 ngày qua tiêu ${vnd(total)}:\n${spendLines(m2)}` };
  }
  if (/thang nay|month/.test(q) && /tieu|chi|tien|spend|bao nhieu/.test(q)) {
    const m2 = unitSpend(db, 'month');
    const total = Object.values(m2).reduce((s, x) => s + x.spend, 0);
    return { text: `Tháng này tiêu ${vnd(total)}:\n${spendLines(m2)}` };
  }
  if (/bai (nao )?(sap|se) dang|lich dang|bai dang/.test(q)) {
    const next = (db.posts || []).filter((p) => p.status === 'scheduled').sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)).slice(0, 5);
    const plans = (db.plans || []).filter((p) => p.status === 'pending');
    return { text: `${next.length ? `Sắp đăng:\n${next.map((p) => `• ${new Date(p.scheduledAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })} · ${p.brand} · ${(p.topic || '').slice(0, 40)}`).join('\n')}` : 'Chưa có bài nào đã lên lịch.'}${plans.length ? `\n${plans.length} kế hoạch đang chờ duyệt ở trang Kế hoạch tháng (${plans.map((p) => `${p.brand}: ${p.items.filter((i) => i.status === 'pending').length} bài`).join(', ')}).` : ''}` };
  }
  if (/agent|tro ly|dang chay khong|hoat dong/.test(q)) {
    const ag = db.settings.agents;
    const names = engine.AGENTS;
    return { text: `${db.settings.paused ? '⚠ Đang DỪNG KHẨN CẤP.\n' : ''}${db.settings.dryRun ? 'Chế độ: chạy thử.\n' : 'Chế độ: chạy thật.\n'}${Object.keys(names).map((id) => `• ${names[id].name}: ${ag[id] && ag[id].on ? 'bật' : 'tắt'}${ag[id] && ag[id].autoPaused ? ' (tự tạm dừng do lỗi)' : ''}`).join('\n')}\nLần quét gần nhất: ${db.lastScan ? new Date(db.lastScan).toLocaleString('vi-VN') : 'chưa'}.` };
  }
  if (/loi|error|co van de/.test(q)) {
    const errs = (db.actions || []).filter((a) => a.kind === 'error').slice(0, 5);
    return { text: errs.length ? `Lỗi gần đây:\n${errs.map((a) => `• ${new Date(a.at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })} ${a.text.slice(0, 120)}`).join('\n')}` : 'Không có lỗi gần đây.' };
  }

  // ----- câu tự do: hỏi AI nếu có khóa, kèm số liệu tóm tắt -----
  const ai = require('./ai');
  const summary = {
    today: unitSpend(db, 'today'), d7: unitSpend(db, 'd7'), pending: pending.length,
    adTests: (db.adTests || []).filter((t) => t.status === 'running').map((t) => ({ topic: t.topic, unit: t.unitId, spend: t.spend, msgs: t.msgs })),
    agents: db.settings.agents, dryRun: db.settings.dryRun, paused: db.settings.paused,
  };
  let t = null;
  try { t = await ai.ask('Bạn là trợ lý vận hành marketing của chủ salon. Trả lời ngắn gọn bằng tiếng Việt, chỉ dựa vào số liệu được cho, không bịa. Đơn vị VNĐ.', `Số liệu hiện tại: ${JSON.stringify(summary)}\nCâu hỏi của chủ: ${question}`, 500); } catch (e) { t = null; }
  if (t) return { text: t };
  return { text: 'Em chưa hiểu câu này. Anh thử: "hôm nay tiêu bao nhiêu", "7 ngày tiêu bao nhiêu", "có gì chờ duyệt", "quảng cáo thử ra sao", "bài nào sắp đăng", "agent đang chạy không", "lỗi gần đây", "quét ngay", "tắt chiến dịch <tên>", "dừng khẩn cấp".' };
}

module.exports = { converse, conversationState, boss, SIMPLE };
