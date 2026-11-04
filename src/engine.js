// Bộ luật kiểm soát của Sếp. Agent KHÔNG BAO GIỜ tắt quảng cáo cũ đang chạy (Sếp tự tắt); agent chỉ lên quảng cáo MỚI
// (quảng cáo thử từ bài đăng) và chỉ được tắt chính quảng cáo thử nó đã tạo. Mọi việc TĂNG tiền hoặc đăng bài/trả lời
// đều đi vào hàng chờ duyệt.
const { load, save, uid } = require('./db');
const { ads, social } = require('./connectors');
const ai = require('./ai');

const vnd = (n) => Math.round(n).toLocaleString('vi-VN') + 'đ';

// "Chạy thử an toàn" (simulate): trong lúc chạy, MỌI thao tác ra ngoài (tắt chiến dịch, đăng bài, đổi ngân sách...) bị coi là chạy thử,
// kể cả khi cài đặt đang là chạy thật. Chỉ nghiêng về phía an toàn: nếu có thao tác khác chen vào lúc đó cũng thành chạy thử.
let forcedDry = 0;
const isDry = () => !!load().settings.dryRun || forcedDry > 0;

function log(kind, text, extra = {}) {
  const db = load();
  // Ghi nhật ký bền TRƯỚC khi đưa vào danh sách tạm: lần đầu tạo file audit sẽ nhập db.actions cũ, không được lẫn dòng đang ghi
  require('./audit').record(kind, text, extra);
  db.actions.unshift({ id: uid('a'), at: new Date().toISOString(), kind, text, ...extra });
  db.actions.length = Math.min(db.actions.length, 300);
}

const hasPending = (type, key) =>
  load().approvals.some((a) => a.status === 'pending' && a.type === type && a.key === key);

// Chiến dịch do agent tự tạo (quảng cáo thử từ bài mới) — chỉ những chiến dịch này agent mới được tắt
const ownCampaign = (id) => (load().adTests || []).some((t) => t.campaignId === id);

async function stop(c, reason, rule) {
  const dry = isDry();
  if (c.status === 'PAUSED') return false;
  if (!ownCampaign(c.id)) return false; // quảng cáo cũ Sếp đang chạy: agent không được tắt
  if (!dry) {
    // Không tắt được (thường do token chưa có quyền ghi trên tài khoản quảng cáo): báo rõ chiến dịch + lý do
    // rồi đi tiếp, không để cả lượt chạy của agent đổ vỡ và tự tạm dừng agent.
    try { await ads.pause(c.id); }
    catch (e) { log('error', `Không tắt được ${c.name} (${reason}): ${e.message}`, { rule, campaignId: c.id }); return false; }
  }
  log('pause', `Tắt ${c.name} — ${reason}`, { dry, rule, campaignId: c.id });
  return true;
}

// Agent Quảng cáo: cảnh báo + đề xuất tăng ngân sách + quảng cáo thử bài mới (không tắt quảng cáo cũ)
// Đọc chiến dịch của mọi tài khoản quảng cáo đã gán cho thương hiệu. 1 tài khoản lỗi không làm hỏng
// các tài khoản khác; chiến dịch của tài khoản lỗi giữ bản cũ để hiển thị (đánh dấu stale) và KHÔNG
// được đem ra áp luật (tránh tắt nhầm dựa trên số liệu cũ).
async function collectCampaigns() {
  const db = load();
  if (ads.mode !== 'live') return { fresh: await ads.list(), stale: [] };
  const accounts = [...new Set(Object.values(require('./planner').brands()).map((b) => b.adAccountId).filter(Boolean))];
  if (!accounts.length) throw new Error('Chưa gán tài khoản quảng cáo cho thương hiệu nào — nhập ID ở trang Thương hiệu & Kênh');
  const fresh = [];
  const failed = new Set();
  const errors = [];
  for (const acc of accounts) {
    try { fresh.push(...(await ads.list(acc))); }
    catch (e) { failed.add(acc); errors.push(`${acc}: ${e.message}`); }
  }
  if (failed.size === accounts.length) throw new Error(errors[0]);
  for (const e of errors) log('error', `Không đọc được tài khoản quảng cáo ${e}`);
  const stale = db.campaigns.filter((c) => failed.has(c.accountId)).map((c) => ({ ...c, stale: true }));
  return { fresh, stale };
}

// Thương hiệu của chiến dịch: tài khoản chỉ gán cho 1 thương hiệu thì lấy luôn; tài khoản dùng chung (The One + Dark Hair
// cùng tài khoản 105) thì theo tiền tố tên: "DH-" = Dark Hair, còn lại = thương hiệu kia.
// planner.brands() dựng lại cả 3 thương hiệu mỗi lần gọi, còn brandOf chạy cho hàng trăm chiến dịch liền nhau → nhớ tạm
// { id, adAccountId }, tự làm mới khi tài khoản quảng cáo của thương hiệu đổi.
let brandAccMemo = { sig: null, list: [] };
function brandAccounts() {
  const sig = JSON.stringify(Object.entries(load().settings.brands || {}).map(([id, b]) => [id, (b || {}).adAccountId || '']));
  if (sig !== brandAccMemo.sig) brandAccMemo = { sig, list: Object.values(require('./planner').brands()).map((b) => ({ id: b.id, adAccountId: b.adAccountId })) };
  return brandAccMemo.list;
}
function brandOf(c) {
  const brands = brandAccounts().filter((b) => c.accountId && b.adAccountId === c.accountId);
  if (brands.length <= 1) return brands[0] ? brands[0].id : null;
  const dh = brands.find((b) => b.id === 'dark_hair');
  if (dh && /^dh[-s]/i.test(c.name)) return dh.id;
  const other = brands.find((b) => b.id !== 'dark_hair');
  return (other || brands[0]).id;
}

// Chiến dịch lượt truy cập / hiển thị / video không đo bằng tin nhắn → luật theo tin nhắn không áp dụng
const NON_MSG = /TRAFFIC|AWARENESS|REACH|LINK_CLICKS|VIDEO_VIEWS|BRAND/i;
const isMsgCampaign = (c) => !NON_MSG.test(c.objective || '');

// Ngưỡng giá/tin nhắn theo thương hiệu (nếu có ghi đè), mặc định lấy ở luật chung
// Số tin nhắn dùng cho luật: số thô của Facebook, hoặc số khách thật ước tính (w.real) khi Sếp bật "dùng số khách thật"
const usingReal = () => !!((load().settings.leads || {}).useForAds);
const msgsFor = (w) => (!w ? 0 : usingReal() && w.real !== undefined ? w.real : (w.msgs || 0));

function thresholds(c) {
  const r = load().settings.rules;
  const o = ((r.byBrand || {})[brandOf(c)]) || {};
  return { stop: o.stop || r.highCpl.maxCostPerMsg, scale: o.scale || r.scaleUp.maxCostPerMsg };
}

// Đồng bộ chỉ-đọc: kéo chiến dịch mới nhất, KHÔNG áp luật tắt/tăng (dùng cho nút "Đồng bộ Meta")
async function syncCampaigns() {
  const db = load();
  const { fresh, stale } = await collectCampaigns();
  require('./leads').applyToCampaigns(fresh);
  db.campaigns = [...fresh, ...stale];
  db.lastSync = new Date().toISOString();
  return db.campaigns.length;
}

async function runAds() {
  const db = load();
  const r = db.settings.rules;
  const { fresh: campaigns, stale } = await collectCampaigns();
  require('./leads').applyToCampaigns(campaigns); // gắn số khách thật ước tính (c.d7.real) theo tỷ lệ chất lượng tin nhắn của thương hiệu
  db.campaigns = [...campaigns, ...stale]; // bản chụp mới nhất để hiển thị
  let changed = 0;

  // KHÔNG tự tắt quảng cáo cũ (giá cao / không ra tin nhắn / chạm trần tháng): chỉ hiện cảnh báo ở trang Quảng cáo để Sếp tự quyết.
  const monthSpend = campaigns.reduce((s, c) => s + c.month.spend, 0);
  const cap = db.settings.monthlyCap;
  if (r.monthCap.on && cap > 0 && monthSpend >= cap) {
    const key = new Date().toISOString().slice(0, 10);
    if (db.capNoteDay !== key) { db.capNoteDay = key; log('system', `Tổng chi tháng ${vnd(monthSpend)} đã chạm trần ${vnd(cap)} — agent KHÔNG tắt quảng cáo cũ, Sếp xem và tự quyết`, { rule: 'monthCap' }); }
  }

  // Đề xuất tăng ngân sách → chờ Sếp duyệt (agent không tự tăng). Ngân sách đặt ở chiến dịch (CBO)
  // hoặc ở từng nhóm quảng cáo (phần lớn tài khoản thật) — nhóm nào có ngân sách thì đề xuất cho nhóm đó.
  if (r.scaleUp.on) {
    for (const c of campaigns) {
      if (c.status !== 'ACTIVE' || !isMsgCampaign(c)) continue;
      const spend = c.d7.spend, msgs = msgsFor(c.d7);
      const cpl = msgs ? spend / msgs : Infinity;
      const limit = thresholds(c).scale;
      if (msgs < r.scaleUp.minMsgs7d || cpl > limit) continue;
      let targets = c.budget ? [{ id: c.id, name: c.name, budget: c.budget, adset: false }] : [];
      if (!c.budget && typeof ads.activeAdsets === 'function') {
        try { targets = (await ads.activeAdsets(c.id)).map((x) => ({ ...x, adset: true })); }
        catch (e) { log('error', `Không đọc được nhóm quảng cáo của ${c.name}: ${e.message}`); }
      }
      for (const t of targets) {
        if (hasPending('budget_increase', t.id)) continue;
        const to = Math.min(Math.round(t.budget * (1 + r.scaleUp.pct / 100)), r.scaleUp.maxDaily);
        if (to <= t.budget) continue;
        db.approvals.unshift({
          id: uid('p'), type: 'budget_increase', key: t.id, status: 'pending', at: new Date().toISOString(),
          title: t.adset ? `${c.name} › ${t.name}` : c.name,
          detail: `7 ngày: ${msgs} tin nhắn, giá ${vnd(cpl)} ≤ ${vnd(limit)}. Đề xuất ${vnd(t.budget)} → ${vnd(to)}/ngày`,
          payload: { campaignId: c.id, ...(t.adset ? { adsetId: t.id } : {}), from: t.budget, to },
        });
        log('propose', `Đề xuất tăng ngân sách ${t.adset ? t.name : c.name}: ${vnd(t.budget)} → ${vnd(to)}/ngày, chờ Sếp duyệt`, { rule: 'scaleUp' });
        changed++;
      }
    }
  }

  changed += await require('./adtest').run(campaigns);
  return changed;
}

// Agent Nội dung: lái tự động soạn kế hoạch + đăng các bài đến giờ
async function runContent() {
  const made = await require('./planner').autopilot();
  let plans = 0;
  try { plans = require('./monthplan').propose(); } catch (err) { log('error', `Không dựng được kế hoạch tháng: ${err.message}`); }
  let learned = 0;
  try { learned = require('./learning').run(); } catch (err) { log('error', `Learning Agent lỗi: ${err.message}`); }
  const published = await publishDuePosts();
  // Bài lên bằng "Lên bài & chạy QC": đăng xong thì tạo quảng cáo thử cho đúng cơ sở
  let adPlans = 0;
  try { adPlans = await require('./adtest').runPlans(); } catch (err) { log('error', `Tạo quảng cáo cho bài vừa đăng lỗi: ${err.message}`); }
  return made + plans + learned + published + adPlans;
}

// Các agent: id → { tên, mô tả, hàm chạy }
const AGENTS = {
  ads: { name: 'Agent Quảng cáo', desc: 'Theo dõi chiến dịch Facebook, cảnh báo chiến dịch xấu (không tự tắt quảng cáo cũ), lên quảng cáo thử cho bài mới, đề xuất tăng ngân sách.', run: runAds },
  content: { name: 'Agent Nội dung', desc: 'Lái tự động soạn kế hoạch tháng và đăng các bài đã duyệt đúng giờ.', run: runContent },
  comments: { name: 'Agent Bình luận', desc: 'Soạn câu trả lời cho bình luận mới của khách, chờ Sếp duyệt.', run: draftCommentReplies },
  reporting: { name: 'Agent Báo cáo', desc: 'Tổng hợp báo cáo tuần từ dữ liệu có thật (chỉ đọc, không thao tác ra ngoài).', run: (trigger) => require('./reports').runAgent(trigger) },
  drive_sync: { name: 'Agent Google Drive', desc: 'Kéo ảnh/video MỚI từ thư mục Google Drive của từng thương hiệu về Thư viện Media (chỉ đọc Drive, không xoá gì, tối đa 20 file/thương hiệu mỗi lượt).', run: (trigger) => require('./drive').runAgent(trigger) },
  inbox: { name: 'Trợ lý nhắn tin', desc: 'Đọc Messenger của Page, tự trả lời câu đơn giản (giá, địa chỉ, ưu đãi...) theo mẫu của salon; khách chốt lịch hay câu lạ thì chuyển nhân viên.', run: () => runInbox() },
};

// Trợ lý nhắn tin: mỗi lần quét đọc các cuộc trò chuyện Messenger có tin mới (24 giờ gần nhất) của Page từng thương hiệu được bật.
// Tin khách mới nhất chưa ai trả lời → trợ lý soạn: câu đơn giản thì gửi luôn (nếu auto bật), còn lại tạo mục "Duyệt" cho nhân viên.
// Mỗi tin khách chỉ xử lý 1 lần (db.inbox). Lỗi đọc hộp thư cùng nguyên nhân chỉ ghi 1 lần.
async function runInbox() {
  const db = load();
  const st = db.settings.assistant || {};
  const lq = db.settings.leads || {};
  const scoring = lq.on !== false; // chấm chất lượng tin nhắn (khách tiềm năng / chưa rõ / rác) cho mọi Page đang bật kênh Facebook
  if (!st.on && !scoring) return 0;
  const planner = require('./planner');
  const assistant = require('./assistant');
  const leads = require('./leads');
  db.inbox = db.inbox || {};
  db.channelSync = db.channelSync || {};
  const now = Date.now();
  const since = now - 24 * 3600e3;
  let n = 0;
  for (const b of Object.values(planner.brands())) {
    if (!planner.channelEnabled(b.id, 'facebook_page')) continue;
    const replying = !!st.on && !!(st.brands || {})[b.id];
    if (!replying && !scoring) continue;
    for (const pageId of b.pageIds) {
      const sync = (db.channelSync[`inbox:${pageId}`] = db.channelSync[`inbox:${pageId}`] || {});
      let convs;
      try { convs = await social.fetchConversations(pageId, scoring ? now - 7 * 864e5 : since); delete sync.error; sync.at = new Date().toISOString(); }
      catch (e) {
        if (sync.error !== e.message) log('error', `Trợ lý nhắn tin: không đọc được hộp thư Page ${pageId} (${b.name}): ${e.message}`, { rule: 'assistant', brand: b.id });
        sync.error = e.message;
        continue;
      }
      if (scoring) { n += leads.record(convs, pageId, b.id, now); db.leadScanAt = new Date(now).toISOString(); }
      if (!replying) continue;
      for (const c of convs) {
        const msgs = c.messages || [];
        if (!msgs.length || new Date(c.updatedAt || 0).getTime() < since) continue;
        const lastMsg = msgs[msgs.length - 1];
        if (scoring && leads.labelOf(c.id) === 'spam') { db.inbox[c.id] = { lastMsgId: lastMsg.id, at: new Date().toISOString(), pageId, brand: b.id, skipped: 'spam' }; continue; } // tin rác: không trả lời
        if (!lastMsg.from || lastMsg.from === pageId) continue; // salon (người hoặc trợ lý) đã trả lời sau cùng
        if ((db.inbox[c.id] || {}).lastMsgId === lastMsg.id) continue; // đã xử lý tin này
        if (!lastMsg.text.trim()) { db.inbox[c.id] = { lastMsgId: lastMsg.id, at: new Date().toISOString(), pageId, brand: b.id, skipped: 'no-text' }; continue; } // ảnh/sticker: để nhân viên
        const history = msgs.map((m) => ({ from: m.from === pageId ? 'salon' : 'customer', text: m.text, at: m.at }));
        const r = assistant.converse(history, { brand: b });
        if (!r) continue;
        const who = lastMsg.name || (c.participants.find((p) => p.id !== pageId) || {}).name || 'Khách';
        db.inbox[c.id] = { lastMsgId: lastMsg.id, at: new Date().toISOString(), pageId, brand: b.id, intent: r.intent.id, auto: r.auto };
        const dry = isDry();
        const queue = (reason) => {
          db.approvals.unshift({
            id: uid('p'), type: 'message_reply', key: `${c.id}:${lastMsg.id}`, status: 'pending', at: new Date().toISOString(),
            title: `${who} (Messenger · ${b.name}): "${lastMsg.text.slice(0, 90)}"`,
            detail: `${reason}. Trợ lý soạn sẵn (sửa được trước khi gửi):\n${r.text}`,
            payload: { brand: b.id, pageId, psid: lastMsg.from, convId: c.id, text: r.text, original: lastMsg.text, author: who, reason, intent: r.intent.label },
          });
          log('propose', `Trợ lý soạn trả lời cho ${who} (${b.name}) — ${reason}, chờ nhân viên`, { rule: 'assistant', brand: b.id });
        };
        if (r.auto && st.auto !== false) {
          try {
            if (!dry) await social.sendMessage(pageId, lastMsg.from, r.text);
            log('reply', `Trợ lý trả lời ${who} (${b.name}, ${r.intent.label})${dry ? ' — chạy thử, chưa gửi thật' : ''}`, { dry, rule: 'assistant', brand: b.id });
            if (r.notify) log('system', `Khách ${who} (${b.name}) muốn đặt lịch — nhân viên vào Messenger chốt lịch và ghi đơn`, { rule: 'assistant', brand: b.id });
          } catch (e) {
            log('error', `Trợ lý không gửi được tin cho ${who} (${b.name}): ${e.message}`, { rule: 'assistant', brand: b.id });
            queue('Facebook không cho trợ lý gửi (xem lỗi trong Nhật ký)');
          }
        } else queue(r.reason || 'câu cần người trả lời');
        n++;
      }
    }
  }
  return n;
}

// Agent đang chạy (để giao diện hiện "đang chạy"); trạng thái trong bộ nhớ, mất khi khởi động lại
const running = new Map();
const runningAgents = () => Object.fromEntries([...running].map(([id, at]) => [id, at]));

// Bật/tắt agent; bật lại thì xoá dấu "tự tạm dừng do lỗi"
function setAgentOn(id, on) {
  const a = load().settings.agents[id];
  a.on = !!on;
  if (on) delete a.autoPaused;
}

// Agent lỗi liên tiếp N lần (không tính lần chạy thử an toàn) thì tự TẮT agent đó và báo — tránh lỗi lặp, tránh gọi API liên tục.
// Sếp bật lại ở Agent & Tác vụ sau khi xử lý nguyên nhân.
function autoPauseOnErrors(id) {
  const db = load();
  const ap = db.settings.autoPause || {};
  if (!ap.on || !db.settings.agents[id] || !db.settings.agents[id].on) return;
  const recent = db.runs.filter((r) => r.agent === id && r.trigger !== 'simulation').slice(0, ap.after);
  if (recent.length >= ap.after && recent.every((r) => r.error)) {
    db.settings.agents[id].on = false;
    db.settings.agents[id].autoPaused = new Date().toISOString();
    log('error', `Tự tạm dừng ${AGENTS[id].name} sau ${ap.after} lần lỗi liên tiếp (lỗi gần nhất: ${recent[0].error}). Xử lý nguyên nhân rồi bật lại ở Agent & Tác vụ.`, { rule: 'autoPause', agent: id });
  }
}

// Chạy 1 agent, ghi lịch sử tác vụ (kể cả lỗi) — 1 agent lỗi không làm các agent khác dừng
async function runAgent(id, trigger) {
  const db = load();
  const t0 = Date.now();
  const run = { id: uid('r'), agent: id, trigger, at: new Date(t0).toISOString(), ms: 0, changed: 0, error: null };
  running.set(id, run.at);
  try { run.changed = await require('./usage').withAgent(id, () => AGENTS[id].run(trigger)); }
  catch (e) { run.error = e.message; log('error', `${AGENTS[id].name} lỗi: ${e.message}`); }
  finally { running.delete(id); }
  run.ms = Date.now() - t0;
  db.runs.unshift(run);
  db.runs.length = Math.min(db.runs.length, 300);
  autoPauseOnErrors(id);
  db.lastScan = new Date().toISOString();
  save();
  return run;
}

// Chạy thử an toàn 1 agent: không thao tác nào ra ngoài (Facebook/đăng bài/ngân sách) dù đang ở chế độ chạy thật.
// Trả về lần chạy + các dòng nhật ký phát sinh trong lúc chạy (để Sếp xem agent SẼ làm gì).
async function simulate(id) {
  if (!AGENTS[id]) throw new Error('Không có agent này');
  const db = load();
  const before = new Set(db.actions.map((a) => a.id));
  forcedDry++;
  let run;
  try { run = await runAgent(id, 'simulation'); }
  finally { forcedDry--; }
  const actions = load().actions.filter((a) => !before.has(a.id));
  return { run, actions };
}

async function scan(trigger = 'manual') {
  const db = load();
  if (db.settings.paused) return { skipped: 'paused' };
  try { require('./media-trash').purgeOld(); } catch { /* thùng rác: không ảnh hưởng lượt quét */ }
  let changed = 0;
  for (const id of Object.keys(AGENTS)) {
    if (!db.settings.agents[id].on) continue;
    changed += (await runAgent(id, trigger)).changed;
  }
  return { changed };
}

// Kéo bình luận mới từ Page thật (nếu đã nối) rồi soạn trả lời cho các bình luận chưa xử lý
async function ingestComments() {
  const db = load();
  const planner = require('./planner');
  const known = new Set(db.comments.map((c) => c.id));
  let added = 0;
  const seenPages = new Set();
  for (const b of Object.values(planner.brands())) {
    if (!planner.channelEnabled(b.id, 'facebook_page')) continue;
    for (const pageId of b.pageIds) {
      if (seenPages.has(pageId)) continue;
      seenPages.add(pageId);
      let list;
      db.channelSync = db.channelSync || {};
      const sync = (db.channelSync[pageId] = db.channelSync[pageId] || {});
      try { list = await social.fetchComments(pageId); sync.commentsAt = new Date().toISOString(); delete sync.commentsError; }
      catch (e) {
        // Lỗi cùng một nguyên nhân chỉ ghi 1 lần (không lặp mỗi lần quét); hết lỗi rồi lại lỗi thì ghi lại
        if (sync.commentsError !== e.message) log('error', `Không đọc được bình luận của ${b.name} (Page ${pageId}): ${e.message}`);
        sync.commentsError = e.message;
        continue;
      }
      for (const c of list) {
        if (known.has(c.id)) continue;
        db.comments.push({ ...c, brand: b.id, status: 'new' });
        known.add(c.id);
        added++;
      }
    }
  }
  if (added) log('system', `Nhận ${added} bình luận mới từ Facebook Page`);
  return added;
}

async function draftCommentReplies() {
  const db = load();
  let n = 0;
  await ingestComments();
  for (const cm of db.comments) {
    if (cm.status !== 'new') continue;
    const text = await ai.draftReply(cm.text);
    cm.status = 'drafted';
    db.approvals.unshift({
      id: uid('p'), type: 'comment_reply', key: cm.id, status: 'pending', at: new Date().toISOString(),
      title: `${cm.author} (${social.CHANNELS[cm.channel].label}${cm.brand ? ' · ' + require('./planner').brands()[cm.brand].name : ''}): "${cm.text}"`,
      detail: text, payload: { commentId: cm.id, text },
    });
    log('propose', `Soạn trả lời bình luận của ${cm.author}, chờ Sếp duyệt`, { rule: 'comments' });
    n++;
  }
  return n;
}

async function publishDuePosts() {
  const db = load();
  const now = Date.now();
  let n = 0;
  for (const p of db.posts) {
    if (p.status !== 'scheduled' || new Date(p.scheduledAt).getTime() > now) continue;
    // Kênh không có API (小红书): không tự đăng. Đến giờ mà chưa được đánh dấu đã hẹn/đã đăng thì nhắc 1 lần.
    if (social.CHANNELS[p.channel].manual) {
      p.status = 'awaiting_manual';
      log('publish', `Đến giờ đăng ${social.CHANNELS[p.channel].label} "${p.topic}" — mở gói đăng ở Lịch đăng để đăng rồi đánh dấu lại`);
      continue;
    }
    if (isDry()) continue; // chạy thử: không đăng thật
    // Máy/server tắt làm bài quá giờ: theo cấu hình lịch — trễ quá ngưỡng thì đánh dấu "bỏ lỡ" chờ Sếp hẹn lại, không đăng bất ngờ
    const sch = db.settings.scheduling || {};
    const lateMs = now - new Date(p.scheduledAt).getTime();
    if ((sch.missed === 'skip' && lateMs > 90 * 60e3) || (sch.missed !== 'late' && sch.missed !== 'skip' && lateMs > (sch.lateHours || 6) * 3600e3)) {
      p.status = 'missed';
      log('error', `Bài "${p.topic}" bị bỏ lỡ (quá giờ hẹn ${Math.round(lateMs / 3600e3)} giờ, hệ thống không chạy kịp) — hẹn lại giờ ở Lịch đăng nếu vẫn muốn đăng`);
      continue;
    }
    if (!require('./planner').channelEnabled(p.brand, p.channel)) {
      // kênh đã bị tắt sau khi duyệt: giữ nguyên lịch, không đăng, báo 1 lần
      if (!p.skipReason) {
        p.skipReason = 'Kênh đang tắt cho thương hiệu này';
        log('error', `Bài "${p.topic}" chưa đăng: kênh ${social.CHANNELS[p.channel].label} đang tắt cho thương hiệu — bật lại ở Thương hiệu & Kênh`);
      }
      continue;
    }
    // Facebook thật: đăng lên TẤT CẢ Page của thương hiệu; chưa có Page ID thì không biết đăng đâu
    // Bài chọn riêng Page (p.pageIds) thì chỉ đăng lên các Page đó, miễn còn thuộc thương hiệu
    const brandPages = p.brand ? require('./planner').brands()[p.brand].pageIds : [];
    const picked = Array.isArray(p.pageIds) && p.pageIds.length;
    const pageIds = picked ? brandPages.filter((id) => p.pageIds.includes(id)) : brandPages;
    const live = p.channel === 'facebook_page' && social.CHANNELS.facebook_page.live();
    let files = [];
    let problem = null;
    if (live) {
      if (!p.brand) problem = 'Bài chưa gắn thương hiệu nên không biết đăng lên Page nào';
      else if (picked && !pageIds.length) problem = 'Page đã chọn cho bài không còn thuộc thương hiệu — sửa bài hoặc thêm lại Page';
      else if (!pageIds.length) problem = 'Thương hiệu chưa có Page ID — nhập ở Thương hiệu & Kênh';
    }
    // TikTok thật: cần thương hiệu đã đăng nhập TikTok (mỗi thương hiệu 1 tài khoản)
    const ttLive = p.channel === 'tiktok' && social.CHANNELS.tiktok.live();
    if (ttLive) {
      if (!p.brand) problem = 'Bài TikTok chưa gắn thương hiệu nên không biết đăng lên tài khoản nào';
      else if (!require('./connectors/tiktok').connected(p.brand)) problem = 'Thương hiệu chưa kết nối TikTok — bấm "Kết nối TikTok" ở Thương hiệu & Kênh';
    }
    // YouTube thật: cần khoá OAuth client và thương hiệu đã nối kênh (mỗi thương hiệu 1 kênh)
    const ytLive = p.channel === 'youtube' && social.CHANNELS.youtube.live();
    if (ytLive && !problem) {
      if (!p.brand) problem = 'Bài YouTube chưa gắn thương hiệu nên không biết đăng lên kênh nào';
      else if (!require('./connectors/youtube').connected(p.brand)) problem = 'Thương hiệu chưa kết nối kênh YouTube — bấm "Kết nối YouTube" ở trang Kênh';
    }
    // Kiểm tra lại dữ liệu ngay trước khi đăng (ưu đãi hết hạn, hotline bị gỡ xác nhận...): không đạt thì giữ bài lại
    if (!problem) problem = require('./content-flow').publishGuard(p, now);
    // Instagram thật: đăng lên tài khoản IG liên kết với từng Page của thương hiệu (bỏ trùng nếu 2 Page chung 1 IG)
    const igLive = p.channel === 'instagram' && social.CHANNELS.instagram.live();
    const igTargets = [];
    if (igLive && !problem) {
      if (!p.brand) problem = 'Bài Instagram chưa gắn thương hiệu nên không biết đăng lên tài khoản nào';
      else if (!pageIds.length) problem = 'Thương hiệu chưa có Page ID — Instagram đăng qua tài khoản liên kết với Page';
      else {
        const errs = [];
        for (const pageId of pageIds) {
          try {
            const ig = await social.igAccount(pageId);
            if (ig && !igTargets.some((t) => t.igId === ig.id)) igTargets.push({ key: `ig_${ig.id}`, pageId, igId: ig.id, username: ig.username });
          } catch (e) { errs.push(e.message); }
        }
        if (!igTargets.length) problem = errs[0] || 'Chưa Page nào của thương hiệu liên kết tài khoản Instagram Business/Creator';
      }
    }
    // Lấy file ảnh/video từ thư viện; thiếu file thì giữ lịch, không đăng, báo 1 lần
    try { files = (p.media || []).map((m) => ({ type: m.type, name: m.name, path: require('./media').resolve(p.brand, m.name) })); }
    catch (e) { problem = problem || e.message; } // giữ nguyên nhân gốc (chưa nối kênh/thiếu Page ID) nếu đã có
    if (!problem && p.requireMedia && !files.length) problem = 'Bài Reel/video chưa có video — gắn video ở Kế hoạch tháng';
    if (!problem && ttLive && (files.length !== 1 || files[0].type !== 'video')) problem = 'Bài TikTok cần đúng 1 video';
    if (!problem && ytLive && (files.length !== 1 || files[0].type !== 'video')) problem = 'Bài YouTube cần đúng 1 video';
    if (!problem && igLive) problem = require('./connectors/instagram').problemOf(p.text, files) || null;
    if (problem) {
      if (p.skipReason !== problem) {
        p.skipReason = problem;
        log('error', `Bài "${p.topic}" chưa đăng: ${problem}`);
      }
      continue;
    }
    delete p.skipReason;
    // Mỗi Page đăng riêng và được ghi lại kết quả: Page lỗi thì lần sau chỉ thử lại Page đó,
    // các Page đã đăng xong không bị đăng trùng. Thử tối đa 3 lần rồi đánh dấu lỗi.
    // Instagram: mỗi tài khoản IG là 1 đích (khoá ig_<id>); video còn đang xử lý thì giữ container để lần quét sau đăng tiếp.
    // TikTok: đăng lên TẤT CẢ tài khoản TikTok của thương hiệu (khoá tt_<openId>), nick lỗi thì lần sau chỉ thử lại nick đó.
    // Bài gắn nick (mỗi nick video riêng): chỉ đăng lên đúng tài khoản có @username đó
    const ttTargets = ttLive ? require('./connectors/tiktok').accounts(p.brand).filter((a) => !p.tiktokNick || '@' + a.username === p.tiktokNick).map((a) => ({ key: `tt_${a.openId}`, openId: a.openId, username: a.username })) : [];
    if (ttLive && p.tiktokNick && !ttTargets.length) {
      const why = `Nick ${p.tiktokNick} chưa được kết nối TikTok (trang Kênh → Kết nối TikTok)`;
      if (p.skipReason !== why) { p.skipReason = why; log('error', `Bài "${p.topic}" chưa đăng: ${why}`); }
      continue;
    }
    // YouTube: 1 đích là kênh của thương hiệu (khoá yt_<channelId>)
    const ytCh = ytLive ? require('./connectors/youtube').summary(p.brand) : null;
    const ytTargets = ytCh ? [{ key: `yt_${ytCh.channelId}`, ytId: ytCh.channelId, username: ytCh.title }] : [];
    const targets = igLive ? igTargets : ttLive ? ttTargets : ytLive ? ytTargets : (live ? pageIds : ['']).map((pageId) => ({ key: pageId, pageId })); // chế độ mẫu / kênh khác: đăng giả 1 lần
    p.results = p.results || {};
    let failed = 0;
    let deferred = 0; // lỗi "thử lại sau" (hết hạn mức YouTube...): giữ lịch, không tính vào 3 lần thử
    let waiting = 0;
    let lastErr = '';
    for (const t of targets) {
      const pageId = t.pageId;
      if (p.results[t.key] !== undefined) continue;
      const where0 = t.ytId ? `kênh YouTube "${t.username || t.ytId}"` : t.igId || t.openId ? `@${t.username || t.igId || t.openId}` : `Page ${pageId || '—'}`;
      try {
        const pending = (p.igPending || {})[t.key];
        const r = await social.publish(p.channel, p.text, files, { pageId, igId: t.igId, openId: t.openId, pending, brand: p.brand });
        if (r.pending) {
          p.igPending = { ...(p.igPending || {}), [t.key]: r.pending };
          waiting++;
          if (!pending) log('publish', `Instagram đang xử lý video bài "${p.topic}" (${where0}) — sẽ đăng tiếp ở lần quét sau`);
          continue;
        }
        if (p.igPending) { delete p.igPending[t.key]; if (!Object.keys(p.igPending).length) delete p.igPending; }
        // Đăng thật mà không trả mã bài đăng = chưa xác nhận được: không coi là đã đăng
        if (r.live && !r.externalId) throw new Error(`${social.CHANNELS[p.channel].label} không trả mã bài đăng — chưa xác nhận được bài đã lên`);
        (p.attemptLog = p.attemptLog || []).unshift({ at: new Date().toISOString(), pageId, ...(t.igId ? { igId: t.igId } : {}), ...(t.openId ? { openId: t.openId } : {}), ok: true, externalId: r.externalId || null });
        p.results[t.key] = r.externalId || null;
        if (t.igId && r.note) p.permalink = r.note;
        p.live = r.live;
        const where = r.live ? (t.igId ? ` (${where0})` : t.openId || t.ytId ? ` (${where0}${r.note ? ', ' + r.note : ''})` : pageId ? ` (Page ${pageId})` : r.note ? ` (${r.note})` : '') : ' (chế độ mẫu)';
        log('publish', `Đã đăng bài "${p.topic}" lên ${social.CHANNELS[p.channel].label}${where}`);
      } catch (e) {
        failed++;
        if (e.retryLater) deferred++;
        lastErr = e.message;
        if (p.igPending) delete p.igPending[t.key]; // container lỗi: lần sau tạo lại từ đầu
        (p.attemptLog = p.attemptLog || []).unshift({ at: new Date().toISOString(), pageId, ...(t.igId ? { igId: t.igId } : {}), ...(t.openId ? { openId: t.openId } : {}), ok: false, error: String(e.message).slice(0, 200) });
        log('error', `Đăng bài "${p.topic}" lên ${where0} thất bại: ${e.message}`);
      }
    }
    if (p.attemptLog) p.attemptLog.length = Math.min(p.attemptLog.length, 20);
    if (waiting && !failed) continue; // video Instagram chưa xử lý xong: chưa xong nhưng không tính là lỗi
    if (!failed) {
      p.status = 'published';
      p.externalId = Object.values(p.results).find(Boolean) || null;
      delete p.error;
      n++;
    } else {
      p.error = lastErr;
      if (failed > deferred) p.attempts = (p.attempts || 0) + 1;
      if (p.attempts >= 3) p.status = 'failed';
    }
  }
  return n;
}

// meta: { note, by } — ghi lại ai quyết định, lúc nào, kèm ghi chú (hiện ở lịch sử duyệt)
async function decide(id, approve, meta = {}) {
  const db = load();
  const a = db.approvals.find((x) => x.id === id);
  if (!a || a.status !== 'pending') throw new Error('Mục này không còn chờ duyệt');
  const dry = isDry();

  const stamp = () => { a.decidedAt = new Date().toISOString(); a.decidedBy = String(meta.by || require('./auth-ctx').actorName('Sếp')).slice(0, 60); a.note = String(meta.note || '').trim().slice(0, 500); a.dry = dry; };
  if (!approve) {
    a.status = 'rejected';
    stamp();
    if (a.type === 'post_publish') {
      const p = db.posts.find((x) => x.id === a.payload.postId);
      if (p) p.status = 'rejected';
    }
    const post = a.type === 'post_publish' ? db.posts.find((x) => x.id === a.payload.postId) : null;
    require('./lessons').record({ type: 'reject', kind: a.type, brand: post && post.brand, topic: post ? post.topic : a.title, ...(a.note ? { note: a.note } : {}) });
    log('reject', `Sếp bỏ qua: ${a.title}`);
    save();
    return a;
  }

  if (a.type === 'budget_increase') {
    if (!dry) await ads.setBudget(a.payload.adsetId || a.payload.campaignId, a.payload.to);
    log('approve', `Sếp duyệt tăng ngân sách ${a.title}: ${vnd(a.payload.from)} → ${vnd(a.payload.to)}/ngày`, { dry });
  } else if (a.type === 'month_plan') {
    require('./monthplan').applyProposal(a);
  } else if (a.type === 'unit_budget') {
    require('./adtest').applyUnitBudget(a);
  } else if (a.type === 'ad_test') {
    await require('./adtest').start(a, dry);
  } else if (a.type === 'post_publish') {
    const p = db.posts.find((x) => x.id === a.payload.postId);
    const xhs = require('./xhs');
    if (p && xhs.isXhs(p.channel)) xhs.assertApprovable([{ label: `"${p.title || p.topic}"`, result: xhs.lintPost(p) }]);
    if (p) require('./content-flow').assertApprovable(p); // thiếu dữ liệu / bịa giá-hotline / nhầm thương hiệu thì không duyệt được
    if (p) {
      p.status = 'scheduled';
      require('./learning').capture({ brand: p.brand, topic: p.topic, category: p.category, aiText: p.aiText, finalText: p.text, qcScore: p.qc && p.qc.score });
    }
    log('approve', `Sếp duyệt bài đăng ${social.CHANNELS[p.channel].label}, lên lịch ${p.scheduledAt}`);
  } else if (a.type === 'message_reply') {
    // Nhân viên duyệt câu trợ lý soạn cho khách nhắn Messenger → gửi (chạy thử thì chỉ ghi nhật ký)
    const pl = a.payload;
    const text = String(meta.text || pl.text || '').trim();
    if (!text) throw new Error('Nội dung trả lời đang trống');
    if (!dry) await social.sendMessage(pl.pageId, pl.psid, text);
    a.payload.text = text;
    log('reply', `${require('./auth-ctx').actorName('Sếp')} duyệt gửi tin cho ${pl.author} (Messenger)${dry ? ' — chạy thử, chưa gửi' : ''}`, { dry, rule: 'assistant', brand: pl.brand });
  } else if (a.type === 'lead') {
    log('system', `Đã liên hệ khách ${a.payload.name} (${a.payload.phone ? 'có SĐT' : 'không SĐT'}) từ widget website`, { brand: a.payload.brand });
  } else if (a.type === 'comment_reply') {
    const cm = db.comments.find((x) => x.id === a.payload.commentId);
    if (!dry) await social.reply(cm.channel, cm.id, a.payload.text, { pageId: cm.pageId });
    cm.status = 'replied';
    log('approve', `Sếp duyệt trả lời bình luận của ${cm.author}`, { dry });
  }
  a.status = 'approved';
  stamp();
  save();
  return a;
}

// Khi chuyển từ chế độ mẫu sang kết nối thật: xóa dữ liệu mẫu để không ai lỡ duyệt/gửi
// một đề xuất của chiến dịch giả lên tài khoản thật.
function cleanupDemo() {
  const db = load();
  if (!db.demo) return false;
  db.campaigns = [];
  db.approvals = db.approvals.filter((a) => !(a.type === 'budget_increase' || String(a.key).startsWith('demo_')));
  db.comments = db.comments.filter((c) => !String(c.id).startsWith('demo_'));
  db.actions = [];
  db.runs = [];
  db.demo = false;
  db.seeded = false;
  log('system', 'Đã nối Meta thật: dọn dữ liệu mẫu (chiến dịch, đề xuất và bình luận giả)');
  save();
  return true;
}

module.exports = { cleanupDemo, scan, runAgent, AGENTS, decide, log, vnd, syncCampaigns, simulate, isDry, setAgentOn, runningAgents, stop, brandOf, thresholds, isMsgCampaign, msgsFor, usingReal };
