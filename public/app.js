const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const vnd = (n) => Math.round(n || 0).toLocaleString('vi-VN') + 'đ';
const when = (t) => (t ? new Date(t).toLocaleString('vi-VN') : 'chưa');
let S = null;
let aiText = '';

const PAGES = [
  ['', 'Tổng quan'], ['duyet', 'Duyệt & Phê duyệt'], ['kehoach', 'Kế hoạch tháng'], ['lich', 'Lịch đăng'],
  ['laitudong', 'Lái tự động'], ['agent', 'Agent & Tác vụ'], ['ads', 'Quảng cáo'], ['kenh', 'Kênh'], ['nhatky', 'Nhật ký'], ['thuonghieu', 'Thương hiệu & Kênh'], ['media', 'Thư viện Media'], ['traloi', 'Trả lời nhanh'], ['baihoc', 'Bài học của AI'], ['caidat', 'Cài đặt'],
];

async function call(method, url, body) {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { location.replace('/login?next=' + encodeURIComponent(location.pathname + location.hash)); throw new Error('Cần đăng nhập'); } // hết phiên → trang đăng nhập
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Lỗi');
  return j;
}
function toast(m) { if (String(m).includes('\n')) { alert(m); return; } const t = $('#toast'); t.textContent = m; t.style.display = 'block'; setTimeout(() => (t.style.display = 'none'), 2600); }
async function act(fn) {
  try { const j = await fn(); if (j && j.campaigns !== undefined) S = j; else if (j && j.state) S = j.state; render(); }
  catch (e) { toast(e.message); }
}

// 小红书: kết quả kiểm tra tuân thủ (block = chặn duyệt, warn = cảnh báo, info = nhắc)
function lintBox(l) {
  if (!l) return '';
  if (!l.issues.length) return '<div style="margin-top:6px"><span class="tag on">✓ Đạt kiểm tra tuân thủ</span></div>';
  const cls = { block: 'off', warn: 'dry', info: '' };
  const lab = { block: 'CHẶN', warn: 'Cảnh báo', info: 'Nhắc' };
  return `<div style="margin-top:6px">${l.issues.map((i) => `<div style="margin:2px 0"><span class="tag ${cls[i.level]}">${lab[i.level]}</span> <small>${esc(i.msg)}</small></div>`).join('')}</div>`;
}

let PKG = null; // gói đăng 小红书 đang mở ở trang Lịch đăng
function tiktokPkgPanel(k) {
  const box = (label, text, id, rows) => `<div style="margin:10px 0"><div class="row" style="justify-content:space-between"><b>${label}</b><button data-act="copy" data-id="${id}">Sao chép</button></div><textarea id="${id}" readonly rows="${rows}" style="width:100%">${esc(text)}</textarea></div>`;
  const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const lab = { block: ['off', 'CHẶN'], warn: ['dry', 'Cảnh báo'], info: ['on', 'Nhắc'] };
  return `<div class="card" style="border-color:#e5b9a0"><div class="row" style="justify-content:space-between"><h2 style="margin:0">📦 Gói đăng TikTok · ${esc(k.brandName)}${k.handle ? ' · ' + esc(k.handle) : ''}</h2><button data-act="pkgclose">Đóng</button></div>
    <p class="sub" style="margin:6px 0">Hẹn giờ: <b>${esc(k.scheduledVietnam)}</b> (giờ Việt Nam) · <a href="${esc(k.studioUrl)}" target="_blank" rel="noopener"><b>Mở TikTok Studio ↗</b></a></p>
    ${box(`Chú thích (${k.captionLength}/2200 ký tự)`, k.caption, 'pk_caption', 8)}
    <b>Video</b>${k.media.length ? k.media.map((f) => `<div style="margin:6px 0">${f.type === 'video' ? '🎬' : '🖼'} <b>${esc(f.name)}</b> · ${kb(f.size)}${f.info ? ` · ${f.info.width}×${f.info.height} · ${Math.round(f.info.durationSec)}s` : ''}${f.missing ? ' <span class="tag off">Thiếu file</span>' : ` <a href="${esc(f.downloadUrl)}" download="${esc(f.name)}"><button type="button" class="pri">⬇ Tải video về máy</button></a>`}</div>`).join('') : '<div class="empty">Bài chưa gắn video.</div>'}
    ${k.checks.length ? `<div style="margin-top:8px">${k.checks.map((c) => `<div style="margin:2px 0"><span class="tag ${lab[c.level][0]}">${lab[c.level][1]}</span> <small>${esc(c.msg)}</small></div>`).join('')}</div>` : ''}
    ${ttNickBox(k)}
    <b style="display:block;margin-top:12px">Các bước đăng</b><ol style="margin:6px 0 0 18px">${k.steps.map((x) => `<li style="margin:3px 0">${esc(x)}</li>`).join('')}</ol></div>`;
}

// TikTok nhiều nick: các nick ghi ở ô tên tài khoản của thương hiệu, cách nhau dấu phẩy (giống src/tiktok-manual.js)
function ttNicks(brandId) {
  // Chế độ API: nick = tài khoản đã kết nối
  if (S.tiktok && S.tiktok.mode === 'api') return [...new Set((((S.tiktok.accounts || {})[brandId] || {}).accounts || []).filter((a) => a.username).map((a) => '@' + a.username))].slice(0, 10);
  const b = (S.brands || []).find((x) => x.id === brandId);
  const raw = b && b.channels && b.channels.tiktok ? String(b.channels.tiktok.handle || '') : '';
  const out = [];
  for (const x of raw.split(/[\s,;]+/)) {
    const n = x.replace(/^https?:\/\/(www\.)?tiktok\.com\//i, '').replace(/[/?#].*$/, '').trim();
    if (n && !out.includes(n.startsWith('@') ? n : '@' + n)) out.push(n.startsWith('@') ? n : '@' + n);
  }
  return out.slice(0, 10);
}
const TT_NICK_ST = { pending: ['dry', 'Chưa đăng'], external_scheduled: ['info', 'Đã hẹn giờ'], published: ['on', 'Đã đăng'] };
function ttNickBox(k) {
  if (!k.nicks || k.nicks.length < 2) return '';
  const rows = k.nicks.map((n) => {
    const st = TT_NICK_ST[n.status] || TT_NICK_ST.pending;
    const btn = (action, label, pri) => `<button class="sm${pri ? ' pri' : ''}" data-act="mark" data-id="${esc(k.postId)}.${action}" data-nick="${esc(n.nick)}">${label}</button>`;
    const btns = n.status === 'pending' ? btn('external_scheduled', 'Đã hẹn giờ') + ' ' + btn('published', 'Đã đăng', true)
      : `${n.status === 'external_scheduled' ? btn('published', 'Đã đăng', true) + ' ' : ''}${btn('reset', 'Bỏ đánh dấu')}`;
    return `<tr><td><b>${esc(n.nick)}</b>${n.url ? ` <a href="${esc(n.url)}" target="_blank" rel="noopener">xem bài ↗</a>` : ''}</td><td><span class="tag ${st[0]}">${st[1]}</span></td><td>${btns}</td></tr>`;
  }).join('');
  const done = k.nicks.filter((n) => n.status !== 'pending').length;
  return `<b style="display:block;margin-top:12px">Đăng lên ${k.nicks.length} nick (${done}/${k.nicks.length} xong)</b><table style="margin-top:4px">${rows}</table>`;
}

// TikTok đăng tay: danh sách cần hẹn giờ trên TikTok Studio trong 10 ngày tới, gom theo nick
let TTB = null;
function ttBatchPanel() {
  if (!TTB) return '';
  const groups = TTB.groups.map((g, gi) => `<div style="margin-top:14px"><h3 style="margin:0 0 6px">${esc(g.brandName)}${g.nick ? ' · ' + esc(g.nick) : ''} <small style="color:var(--mute)">(${g.items.length} bài)</small></h3>
    ${g.items.map((it, ii) => `<div class="item" style="display:block;padding:10px 0;border-top:1px solid var(--line)">
      <div class="row" style="justify-content:space-between"><div><b>${esc(it.scheduledVietnam)}</b>${it.overdue ? ' <span class="tag off">quá giờ — đăng ngay</span>' : ''} · ${esc(it.topic)}</div>
      <div class="row">${it.media.map((m) => `<a href="${esc(m.downloadUrl)}" download="${esc(m.name)}"><button class="sm" type="button">⬇ ${esc(m.name)}</button></a>`).join('') || '<span class="tag off">Chưa có video</span>'}
      <button class="sm" data-act="copy" data-id="ttb_${gi}_${ii}">Sao chép chú thích</button>
      <button class="sm pri" data-act="mark" data-id="${esc(it.postId)}.${it.overdue ? 'published' : 'external_scheduled'}"${g.nick ? ` data-nick="${esc(g.nick)}"` : ''}>${it.overdue ? 'Đã đăng' : 'Đã hẹn giờ'}</button></div></div>
      <textarea id="ttb_${gi}_${ii}" readonly rows="2" style="width:100%;margin-top:6px">${esc(it.caption)}</textarea></div>`).join('')}</div>`).join('');
  return `<div class="card" style="border-color:#e5b9a0"><div class="row" style="justify-content:space-between"><h2 style="margin:0">📅 Lên lịch TikTok ${TTB.days} ngày tới</h2><button data-act="ttbclose">Đóng</button></div>
    <p class="sub" style="margin:6px 0">Mở <a href="${esc(TTB.studioUrl)}" target="_blank" rel="noopener"><b>TikTok Studio ↗</b></a>, đăng nhập đúng nick, rồi với từng bài: tải video lên → dán chú thích → bật <b>Lên lịch</b> đúng giờ ghi bên trái → bấm <b>Đã hẹn giờ</b> ở đây. Đến giờ TikTok tự đăng. Xong 1 nick thì đổi tài khoản sang nick tiếp theo.</p>
    ${TTB.total ? groups : '<div class="empty">Không còn bài TikTok nào cần hẹn giờ trong 10 ngày tới.</div>'}</div>`;
}

function pkgPanel() {
  if (TTB) return ttBatchPanel() + (PKG ? pkgPanelOne() : '');
  return pkgPanelOne();
}
function pkgPanelOne() {
  if (!PKG) return '';
  if (PKG.kind === 'tiktok') return tiktokPkgPanel(PKG);
  const k = PKG;
  const box = (label, text, id, rows) => `<div style="margin:10px 0"><div class="row" style="justify-content:space-between"><b>${label}</b><button data-act="copy" data-id="${id}">Sao chép</button></div><textarea id="${id}" readonly rows="${rows}" style="width:100%">${esc(text)}</textarea></div>`;
  const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  return `<div class="card" style="border-color:#e5b9a0"><div class="row" style="justify-content:space-between"><h2 style="margin:0">📦 Gói đăng 小红书 · ${esc(k.brandName)}</h2><button data-act="pkgclose">Đóng</button></div>
    <p class="sub" style="margin:6px 0">Hẹn giờ: <b>${esc(k.scheduledBeijing)}</b> giờ Bắc Kinh (= ${esc(k.scheduledVietnam)} giờ Việt Nam)</p>
    ${box('Tiêu đề (≤ 20 chữ)', k.title, 'pk_title', 1)}${box('Nội dung', k.body, 'pk_body', 10)}${box('Hashtag (nên chọn bằng nút 话题 trên trang đăng)', k.hashtags.join(' '), 'pk_tags', 2)}
    <b>File đính kèm</b>${k.media.length ? k.media.map((f) => `<div style="margin:4px 0">${f.type === 'video' ? '🎬' : '🖼'} <b>${esc(f.name)}</b> · ${kb(f.size)}${f.info ? ` · ${f.info.width}×${f.info.height} · ${Math.round(f.info.durationSec)}s · ${f.info.kbps} kbps` : ''}${f.missing ? ' <span class="tag off">Thiếu file</span>' : ''}<br><small style="color:var(--mute)">${esc(f.path || '')}</small></div>`).join('') : '<div class="empty">Bài chưa gắn file.</div>'}
    ${lintBox(k.lint)}
    <b style="display:block;margin-top:12px">Các bước đăng</b><ol style="margin:6px 0 0 18px">${k.steps.map((x) => `<li style="margin:3px 0">${esc(x)}</li>`).join('')}</ol></div>`;
}

// nav() nằm trong shell.js (khung giao diện)

// pageHome() nằm trong overview.js

function actionList(list) {
  if (!list.length) return '<div class="empty">Chưa có hoạt động.</div>';
  return list.map((a) => `<div class="item"><div><b>${esc(a.text)}</b></div><div style="white-space:nowrap;color:var(--mute)">${a.dry ? '<span class="tag dry">chạy thử</span> ' : ''}${when(a.at)}</div></div>`).join('');
}

// pageApprovals() nằm trong approvals.js

const brandsOfAccount = (id) => S.brands.filter((b) => b.adAccountId === id).map((b) => b.name).join(', ') || 'Tài khoản ' + id;

// Đối tượng agent đã học từ tài khoản quảng cáo thật (3 nhóm giá/tin nhắn tốt nhất mỗi thương hiệu)
function audienceBlock() {
  const rows = S.brands.filter((b) => (S.audiences || {})[b.id] && S.audiences[b.id].length).map((b) => `<tr><td><b>${esc(b.name)}</b></td><td>${S.audiences[b.id].map((a) =>
    `<div style="margin-bottom:6px">${esc(a.gender)} ${esc(a.age)} tuổi · ${esc(a.interests.slice(0, 4).join(', ') || 'không chọn sở thích')}${a.places.length ? ' · ' + esc(a.places.join(', ')) : ''}<br><small style="color:var(--mute)">${esc(a.campaign)} — ${vnd(a.cpl)}/tin (${a.msgs} tin, ${vnd(a.spend)} trong 30 ngày)</small></div>`).join('')}</td></tr>`).join('');
  return rows ? `<h3 style="margin:14px 0 6px">Đối tượng agent đã học (dùng cho quảng cáo thử)</h3><table>${rows}</table>` : '';
}

// Trạng thái quảng cáo thử → [lớp màu, nhãn]
// Page Facebook của cơ sở: "Lên bài & chạy QC" đăng bài lên Page này rồi chạy quảng cáo cho cơ sở
function unitPageSelect(u) {
  const b = (S.brands || []).find((x) => x.id === u.brand) || {};
  const names = S.pageNames || {};
  return `<select data-adunit-page="${esc(u.id)}" aria-label="Page của ${esc(u.name)}"><option value="">— Chưa chọn —</option>${(b.pageIds || []).map((id) => `<option value="${esc(id)}" ${u.pageId === id ? 'selected' : ''}>${esc(names[id] || 'Page ' + id)}</option>`).join('')}</select>`;
}
const AT_STATUS = { running: ['dry', 'Đang chạy'], pass: ['on', 'ĐẠT'], fail: ['off', 'Không đạt'], neutral: ['', 'Chưa rõ'], lost: ['off', 'Không thấy trên Facebook'] };
function adTestCard() {
  const t = S.settings.adTest;
  const ni = (k, w) => `<input type="number" data-adtest="${k}" value="${t[k]}" style="width:${w || 100}px">`;
  const unitRows = (S.adUnits || []).map((u) => `<tr><td><label class="f" style="display:inline"><input type="checkbox" data-adunit-on="${u.id}" ${u.on !== false ? 'checked' : ''} title="Bật/tắt chạy quảng cáo cho cơ sở này"> <b>${esc(u.name)}</b></label>${u.on === false ? ' <span class="tag off">không chạy quảng cáo</span>' : ''}</td>
      <td><input type="number" data-adunit="${u.id}" value="${u.dailyBudget}" style="width:120px"> đ/ngày</td>
      <td>${unitPageSelect(u)}</td><td>${vnd(u.committed)}</td><td>${vnd(u.today)}</td></tr>`).join('');
  const rows = (S.adTests || []).map((x) => {
    const st = AT_STATUS[x.status] || ['off', x.status];
    const unit = ((S.adUnits || []).find((u) => u.id === x.unitId) || {}).name || (S.brands.find((b) => b.id === x.brand) || {}).name || x.brand;
    const res = x.msgs !== undefined ? `${vnd(x.spend)} · ${x.msgs} tin${x.msgs ? ' · ' + vnd(x.spend / x.msgs) + '/tin' : ''}` : '—';
    const open = x.campaignId && (S.campaigns || []).some((c) => c.id === x.campaignId);
    return `<tr ${open ? `class="click" data-ads="detail" data-id="${esc(x.campaignId)}" title="Bấm để xem ảnh bài và chi tiết"` : ''}><td><b>${esc(x.topic)}</b>${open ? ' <small style="color:var(--mute)">xem chi tiết ›</small>' : ''}</td><td>${esc(unit)}</td><td>${new Date(x.createdAt).toLocaleDateString('vi-VN')}</td><td>${res}</td><td><span class="tag ${st[0]}">${st[1]}</span></td></tr>`;
  }).join('');
  return `<div class="card"><h2>Quảng cáo thử bài mới mỗi ngày</h2>
    <label class="f"><input type="checkbox" data-adtest="on" ${t.on ? 'checked' : ''}> Bật: mỗi ngày agent đề xuất chạy thử quảng cáo cho bài Facebook mới đăng, theo từng cơ sở. Mỗi quảng cáo phải được Sếp duyệt ở mục Duyệt mới được tạo và bật.</label>
    <div class="rule">Mỗi chiến dịch thử ${ni('budget')} đ/ngày · chạy ${ni('days', 60)} ngày rồi chấm trên tổng cả kỳ · tối đa ${ni('perUnitPerDay', 60)} bài/cơ sở/ngày<br>
    <b>Chấm sớm sau ${ni('checkDays', 60)} ngày:</b> chưa ra tin nhắn nào (hoặc giá/tin đã vượt ngưỡng loại) → <b>tắt luôn</b> và báo; có tin nhắn → báo số liệu, chạy tiếp.</div>
    <table style="margin-top:8px"><tr><th>Cơ sở (bỏ tick = không chạy quảng cáo)</th><th>Mức tối đa ngày</th><th title="Page đăng bài khi dùng Lên bài & chạy QC ở Thư viện Media">Page của cơ sở</th><th>Đang chạy (mọi chiến dịch + đề xuất chờ)</th><th>Đã tiêu hôm nay</th></tr>${unitRows}</table>
    <small style="color:var(--mute)">Không có trần tháng. <b>Mức tối đa ngày</b> tính trên tổng ngân sách ngày của <b>mọi chiến dịch đang bật</b> của cơ sở (cũ + mới + bài thử): đã chạm mức thì agent không thêm quảng cáo thử/video nữa (không tự tắt chiến dịch cũ). Hết kỳ: giá/tin nhắn ≤ ngưỡng "tăng ngân sách" của thương hiệu = đạt (ghi bài học); vượt ngưỡng "tắt" = không đạt (riêng Mishang: loại khi trên 60.000đ); bài thử luôn tự tắt khi hết kỳ. Mỗi tuần, cơ sở nào có mọi bài thử đều đạt thì agent đề xuất tăng ngân sách ngày ${ni('raisePct', 60)}% (chờ Sếp duyệt). Bài video dùng luật "video đang lên view" bên dưới. Khi ô "Chạy thử" ở trên còn bật thì chưa tạo gì trên Facebook.</small>
    ${boostBlock(t)}
    ${audienceBlock()}
    ${rows ? `<table style="margin-top:10px"><tr><th>Bài thử</th><th>Cơ sở</th><th>Bắt đầu</th><th>Kết quả</th><th></th></tr>${rows}</table>` : ''}
  </div>`;
}

// Luật "video đang lên view": mỗi cơ sở mỗi ngày 1 video nhiều lượt xem tự nhiên nhất chưa chạy quảng cáo → đề xuất, hoặc tự chạy nếu Sếp bật
function boostBlock(t) {
  const b = t.boost || {};
  const ni = (k, w) => `<input type="number" data-adboost="${k}" value="${b[k] ?? ''}" style="width:${w || 80}px">`;
  const pending = (S.approvals || []).filter((a) => a.status === 'pending' && a.type === 'ad_test' && a.payload && a.payload.source === 'organic').length;
  const autoRun = (S.adTests || []).filter((x) => x.status === 'running' && x.source === 'organic').length;
  return `<div class="rule" style="margin-top:12px"><b>Video đang lên view</b> —
    <label class="f" style="display:inline"><input type="checkbox" data-adboost="on" ${b.on !== false ? 'checked' : ''}> Bật</label>:
    mỗi cơ sở đang bật, mỗi ngày chọn 1 video/Reel trên Page (chỉ Page đã cấp quyền "Tạo quảng cáo" cho app) có ≥ ${ni('minViews')} lượt xem tự nhiên, đăng trong ${ni('maxAgeDays', 60)} ngày gần đây, chưa từng chạy quảng cáo.
    Cùng ngân sách và kỳ chạy như bài thử ở trên. Đề xuất không duyệt sau ${ni('expireDays', 60)} ngày thì tự đóng.
    <div style="margin-top:6px"><label class="f" style="display:inline"><input type="checkbox" data-adboost="auto" ${b.auto ? 'checked' : ''}> <b>Tự chạy, không chờ duyệt</b></label>
    — agent tự tạo và bật quảng cáo ngay khi chọn được video (vẫn trong hạn mức ngày của cơ sở; Facebook từ chối thì đề xuất nằm lại ở mục Duyệt kèm lý do).
    ${b.auto ? `<span class="tag on">đang tự chạy · ${autoRun} quảng cáo video đang chạy</span>` : `<span class="tag off">đang chờ Sếp duyệt · ${pending} đề xuất video đang chờ</span>`}</div>
  </div>`;
}

const PB = { brand: '', channel: 'facebook_page' };

// pageSchedule() nằm trong calendar.js

// ---- Kế hoạch tháng ----
const thisMonth = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 7);
const F = { brand: '', month: thisMonth(), channel: 'facebook_page', type: 'post', time: '09:00', days: [1, 2, 3, 4, 5, 6, 7], direction: '' };
const editing = new Set();
let planBusy = false;
const DAYS = [[1, 'T2'], [2, 'T3'], [3, 'T4'], [4, 'T5'], [5, 'T6'], [6, 'T7'], [7, 'CN']];
const dow = (iso) => { const d = new Date(iso).getDay(); return d === 0 ? 'CN' : 'Th ' + (d + 1); };
const hm = (iso) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });
const dm = (iso) => { const d = new Date(iso); return `${d.getDate()}/${d.getMonth() + 1}`; };

// ---- Thư viện Media ----
const fileUrl = (brand, name) => `/api/media/file?brand=${encodeURIComponent(brand)}&name=${encodeURIComponent(name)}`;
let MB = '';              // thương hiệu đang xem trong thư viện
let mediaFull = {};       // brand → danh sách đầy đủ (có ghi chú, dung lượng)
let mediaRoot = '';
let mediaDirty = true;
let uploadMsg = '';

async function loadMedia() {
  mediaDirty = false;
  try {
    const j = await call('GET', `/api/media?brand=${encodeURIComponent(MB)}`);
    mediaFull[MB] = j.files; mediaRoot = j.root;
  } catch (e) { toast(e.message); }
  render();
}

async function uploadFiles(files) {
  const brand = MB;
  let ok = 0;
  for (const [i, f] of [...files].entries()) {
    uploadMsg = `Đang tải ${i + 1}/${files.length}: ${f.name}…`; render();
    try {
      const r = await fetch(`/api/media/upload?brand=${encodeURIComponent(brand)}&name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f });
      const j = await r.json();
      if (!r.ok) throw new Error(`${f.name}: ${j.error}`);
      S = j.state; ok++;
    } catch (e) { toast(e.message); }
  }
  uploadMsg = ok ? `Đã tải lên ${ok} file.` : '';
  mediaDirty = true; render();
}

const sizeText = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

// pageMedia() nằm trong media.js

// Ảnh/video gắn vào 1 bài trong kế hoạch tháng
function mediaBlock(pl, it, pending) {
  const list = it.media || [];
  const lib = (S.media[pl.brand] || []);
  const onlyVideo = pl.type === 'reel' || pl.channel === 'tiktok'; // Reel và TikTok chỉ nhận video
  const free = lib.filter((f) => !list.some((m) => m.name === f.name) && (!onlyVideo || f.type === 'video'));
  const chip = (m, i) => `<span class="tag" style="display:inline-flex;align-items:center;gap:6px;padding:3px 8px">${m.type === 'video' ? '🎬' : '🖼'} ${esc(m.name)}${pending ? ` <a href="#" data-act="rmmedia" data-id="${pl.id}.${it.id}.${i}" style="color:var(--bad);text-decoration:none" title="Gỡ">✕</a>` : ''}</span>`;
  const thumbs = list.length && list[0].type === 'image' ? `<div class="row" style="margin-top:6px">${list.map((m) => `<img src="${fileUrl(pl.brand, m.name)}" loading="lazy" alt="" style="height:64px;border-radius:6px">`).join('')}</div>` : '';
  const need = onlyVideo ? 'video' : 'ảnh/video';
  return `<div style="margin-top:8px">${list.length ? list.map(chip).join(' ') : `<span style="color:var(--bad)">⚠ Chưa có ${need} — bỏ file vào Thư viện Media rồi chọn bên dưới</span>`}
    ${pending && free.length ? ` <select data-addmedia="${pl.id}.${it.id}" style="font-size:12px"><option value="">+ Thêm ảnh/video…</option>${free.map((f) => `<option value="${esc(f.name)}">${f.type === 'video' ? '🎬' : '🖼'} ${esc(f.name)}${f.uses ? ` (đã dùng ${f.uses})` : ''}</option>`).join('')}</select>` : ''}${thumbs}</div>`;
}

const SOCIAL = ['facebook_page', 'instagram', 'tiktok', 'youtube', 'xiaohongshu'];
// Kênh đang bật của thương hiệu (chỉ các kênh đăng bài); tự chọn lại kênh nếu kênh hiện tại đã tắt
function usableChannels(brandId, form) {
  const b = S.brands.find((x) => x.id === brandId);
  const list = S.channels.filter((c) => SOCIAL.includes(c.id) && b && b.channels[c.id] && b.channels[c.id].on);
  if (list.length && !list.some((c) => c.id === form.channel)) form.channel = list[0].id;
  return list;
}
const noChannelWarn = '<p style="color:var(--bad);margin:6px 0">Thương hiệu này chưa bật kênh nào để đăng bài — bật ở trang <a href="#thuonghieu">Thương hiệu & Kênh</a>.</p>';

function pagePlanPosts() {
  if (!F.brand) F.brand = S.brands[0].id;
  const planChannels = usableChannels(F.brand, F);
  const opt = (list, cur) => list.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const brandName = (id) => (S.brands.find((b) => b.id === id) || {}).name || id;
  const chName = (id) => (S.channels.find((c) => c.id === id) || {}).label || id;
  const itemSt = { pending: 'Chờ duyệt', scheduled: 'Đã lên lịch', rejected: 'Bỏ qua' };

  const plans = S.plans.map((pl) => {
    const pend = pl.items.filter((i) => i.status === 'pending');
    const sel = pend.filter((i) => i.selected).length;
    const [y, m] = pl.month.split('-');
    return `<div class="card" style="border-color:${pl.status === 'pending' ? '#e5b9a0' : 'var(--line)'}">
      <div class="row" style="justify-content:space-between"><div><b>${esc(brandName(pl.brand))} · tháng ${m}/${y} · ${esc(chName(pl.channel))}</b><br><small style="color:var(--mute)">${pl.items.length} bài · ${pl.days.map((d) => DAYS[d - 1][1]).join(', ')} lúc ${esc(pl.time)}${pl.aiDrafted ? '' : ' · bản mẫu (chưa có ANTHROPIC_API_KEY)'}</small></div>
      <span class="tag ${pl.status === 'approved' ? 'on' : 'dry'}">${pl.status === 'approved' ? 'Đã duyệt' : 'Chờ Sếp duyệt'}</span></div>
      ${pl.status === 'pending' ? `<div class="row" style="justify-content:space-between;background:#f9ece3;border-radius:8px;padding:10px 12px;margin:10px 0"><span>Đã chọn <b>${sel}/${pend.length}</b> bài chờ duyệt</span><button class="pri" data-act="approveplan" data-id="${pl.id}" ${sel ? '' : 'disabled'}>✓ Duyệt tất cả bài đã chọn</button></div>` : ''}
      ${pl.items.map((it) => {
        const ed = editing.has(it.id), pending = it.status === 'pending';
        return `<div class="card" style="margin:8px 0;${it.selected || !pending ? '' : 'opacity:.55'}">
          <div class="row" style="justify-content:space-between"><div class="row">
            ${pending ? `<input type="checkbox" data-pick="${pl.id}.${it.id}" ${it.selected ? 'checked' : ''}>` : ''}
            <span style="color:var(--brand)">${hm(it.at)} ${dow(it.at)}, ${dm(it.at)}</span>${it.nick ? `<span class="tag info">${esc(it.nick)}</span>` : ''}<b>${esc(it.topic)}</b></div>
            <div class="row"><span class="tag ${it.status === 'scheduled' ? 'on' : ''}">${itemSt[it.status]}</span>${pending ? `<button data-act="${ed ? 'saveitem' : 'edititem'}" data-id="${pl.id}.${it.id}">${ed ? 'Lưu' : 'Sửa'}</button>` : ''}</div></div>
          ${mediaBlock(pl, it, pending)}
          ${it.title !== undefined ? (ed ? `<input type="text" id="edt_${it.id}" value="${esc(it.title)}" placeholder="Tiêu đề ≤ 20 chữ" style="width:100%;margin-top:8px">` : `<div style="margin-top:8px"><span class="tag">标题</span> <b>${esc(it.title)}</b></div>`) : ''}${ed ? `<textarea id="ed_${it.id}" rows="6" style="width:100%;margin-top:8px">${esc(it.text)}</textarea>` : `<p style="white-space:pre-wrap;margin:8px 0 0;color:#4a453f">${esc(it.text)}</p>`}${pending ? lintBox(it.lint) : ''}${pending && it.qc ? qcBox(it.qc) + qcActions('plan', pl.id + '.' + it.id) : ''}</div>`;
      }).join('')}</div>`;
  }).join('');

  return `<h1>Kế hoạch tháng</h1><p class="sub">AI soạn sẵn cả tháng theo lịch. Sếp lướt một lượt, bỏ chọn bài không ưng, rồi duyệt tất cả một lần.</p>
  <div class="card"><h2>Tạo kế hoạch mới</h2>
    <div class="cards" style="margin-bottom:8px">
      <label>Thương hiệu<br><select data-f="brand" style="width:100%">${opt(S.brands.map((b) => [b.id, b.name]), F.brand)}</select></label>
      <label>Tháng<br><input type="month" data-f="month" value="${F.month}" style="width:100%"></label>
      <label>Kênh<br><select data-f="channel" style="width:100%">${opt(planChannels.map((c) => [c.id, c.label.replace(' Page', '')]), F.channel)}</select></label>
      <label>Loại<br><select data-f="type" style="width:100%">${opt(Object.entries(S.types), F.type)}</select></label>
      <label>Giờ đăng<br><input type="time" data-f="time" value="${F.time}" style="width:100%"></label>
    </div>
    <div class="row" style="margin-bottom:10px"><span>Ngày đăng trong tuần</span>${DAYS.map(([n, l]) => `<button data-act="day" data-id="${n}" class="${F.days.includes(n) ? 'pri' : ''}">${l}</button>`).join('')}</div>
    <label>Định hướng cho tháng (không bắt buộc)<br><textarea data-f="direction" rows="2" style="width:100%" placeholder="VD: Tháng 11 đẩy nhuộm màu lạnh, nhắc ưu đãi 20/11 cho thầy cô, 2 bài feedback khách">${esc(F.direction)}</textarea></label>
    <div style="margin-top:10px">${planChannels.length ? '' : noChannelWarn}<button class="pri" data-act="newplan" ${planBusy || !planChannels.length ? 'disabled' : ''}>${planBusy ? 'AI đang soạn…' : '✦ AI soạn cả tháng'}</button></div></div>
  ${plans || '<div class="empty">Chưa có kế hoạch nào.</div>'}`;
}

// ---- Bài học của AI ----
const LESSON = { text: '', scope: 'all' };
const SRC = { manual: 'Sếp tự thêm', auto: 'Rút từ số liệu', ai: 'AI rút ra' };

// pageLessons() nằm trong knowledge.js

// ---- Thương hiệu & Kênh ----
const CH_LABEL = { facebook_page: 'Facebook Page', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', xiaohongshu: '小红书 Xiaohongshu', zalo_oa: 'Zalo OA', google_ads: 'Google Ads' };
const CH_HINT = { facebook_page: 'tên hoặc link Page', instagram: '@tên_tài_khoản', tiktok: '@nick1, @nick2 (mỗi bài đăng lên tất cả nick)', youtube: 'tên kênh YouTube', xiaohongshu: 'tên tài khoản 小红书', zalo_oa: 'tên Official Account', google_ads: 'ID tài khoản (xxx-xxx-xxxx)' };

// Trạng thái kết nối của 1 kênh với 1 thương hiệu
function connTag(b, ch, tokenOk) {
  if (ch === 'xiaohongshu') return '<span class="tag on">Gói đăng thủ công</span>';
  if (ch === 'tiktok') {
    const t = S.tiktok || {};
    if (t.mode !== 'api') return '<span class="tag on">Gói đăng thủ công</span>';
    if (!t.configured) return '<span class="tag dry">Chưa cấu hình khóa TikTok (xem Cài đặt)</span>';
    const a = (t.accounts || {})[b.id];
    // Nhiều tài khoản/thương hiệu: bài TikTok đăng lên tất cả. Đăng nhập lại cùng tài khoản = làm mới quyền.
    const go = `<a href="/auth/tiktok/start?brand=${encodeURIComponent(b.id)}" style="color:var(--brand);font-weight:600">${a && a.connected ? '+ Thêm tài khoản' : 'Kết nối TikTok'}</a>`;
    if (a && a.connected) {
      const list = a.accounts && a.accounts.length ? a.accounts : [{ ...a, openId: '' }];
      return list.map((x) => `<span class="tag ${x.needsReauth ? 'off' : 'on'}">${x.needsReauth ? 'Cần kết nối lại' : 'Đã nối'} · ${esc(x.username ? '@' + x.username : x.name)}</span> <a href="#" data-act="ttdisc" data-id="${esc(b.id)}" data-open="${esc(x.openId || '')}" style="color:var(--bad)">Ngắt</a>`).join(' ') + ` · ${go}`;
    }
    return go;
  }
  if (ch === 'youtube') {
    const y = S.youtube || {};
    if (!y.configured) return '<span class="tag dry">Chưa có khoá YouTube (xem Cài đặt → Kết nối API)</span>';
    const c = (y.channels || {})[b.id];
    if (c && c.connected) return `<span class="tag ${c.needsReauth ? 'off' : 'on'}">${c.needsReauth ? 'Cần kết nối lại' : 'Đã nối'} · ${esc(c.title)}</span> <a href="#kenh">Quản lý ở trang Kênh</a>`;
    return `<a href="/api/youtube/start?brand=${encodeURIComponent(b.id)}" style="color:var(--brand);font-weight:600">Kết nối YouTube</a>`;
  }
  if (ch !== 'facebook_page') return '<span class="tag dry">Chế độ mẫu</span>';
  if (!tokenOk) return '<span class="tag dry">Chế độ mẫu</span>';
  return b.pageIds.length ? `<span class="tag on">Đã nối · ${b.pageIds.length} Page</span>` : '<span class="tag off">Thiếu Page ID</span>';
}

// pageBrands() nằm trong brands.js

// ---- Agent & Tác vụ ----
// pageAgents() nằm trong agents.js

// ---- Lái tự động ----
const AP = { brand: '', channel: 'facebook_page', type: 'post', time: '09:00', days: [1, 2, 3, 4, 5, 6, 7], direction: '' };
const brandOf = (id) => (S.brands.find((b) => b.id === id) || {}).name || id;
const channelOf = (id) => (S.channels.find((c) => c.id === id) || {}).label || id;

function pageAutopilotProfiles() {
  if (!AP.brand) AP.brand = S.brands[0].id;
  const apChannels = usableChannels(AP.brand, AP);
  const ap = S.settings.autopilot;
  const opt = (list, cur) => list.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const logs = S.actions.filter((a) => a.text.startsWith('Lái tự động')).slice(0, 8);
  return `<h1>Lái tự động</h1><p class="sub">Khi bật, agent tự soạn kế hoạch tháng sau theo các hồ sơ bên dưới, gần cuối tháng. Mặc định vẫn <b>chờ Sếp duyệt</b>.</p>
  <div class="card"><div class="row" style="justify-content:space-between"><div><h2 style="margin:0">Lái tự động: ${ap.on ? '<span class="tag on">ĐANG BẬT</span>' : '<span class="tag off">TẮT</span>'}</h2></div>
    <label class="f" style="margin:0"><input type="checkbox" data-ap="on" ${ap.on ? 'checked' : ''}> Bật lái tự động</label></div>
    <label class="f">Soạn kế hoạch tháng sau khi còn ≤ <input type="number" data-ap="draftDaysBefore" value="${ap.draftDaysBefore}" style="width:70px"> ngày nữa hết tháng</label>
    <div class="rule"><label class="f"><input type="checkbox" data-ap="autoApprove" ${ap.autoApprove ? 'checked' : ''}> <b>Tự duyệt luôn bài đăng</b> (không cần Sếp bấm duyệt)</label>
      <small style="color:var(--mute)">Nên để TẮT. Bài AI soạn sẽ lên lịch ngay; vẫn không đăng thật nếu "Chạy thử" đang bật.</small></div>
    <div class="rule" style="background:#faf8f5">🔒 <b>Luôn khóa:</b> agent không bao giờ tự tăng ngân sách quảng cáo, kể cả khi lái tự động bật. Tăng tiền luôn chờ Sếp duyệt.</div>
    <div class="row"><button class="pri" data-act="scan">⟳ Chạy ngay</button><small style="color:var(--mute)">Quét lần cuối: ${when(S.lastScan)}</small></div></div>
  <div class="card"><h2>Hồ sơ lái tự động</h2>${ap.profiles.length ? ap.profiles.map((p) => `<div class="item"><div><b>${esc(brandOf(p.brand))} · ${esc(channelOf(p.channel).replace(' Page', ''))} · ${esc(S.types[p.type])}</b>${(((S.brands.find((x) => x.id === p.brand) || {}).channels || {})[p.channel] || {}).on ? '' : ' <span class="tag off">Kênh đang tắt — hồ sơ tạm nghỉ</span>'}<p>${p.days.map((d) => DAYS[d - 1][1]).join(', ')} lúc ${esc(p.time)}${p.direction ? ' · ' + esc(p.direction) : ''}</p></div><button data-act="delprofile" data-id="${p.id}">Xóa</button></div>`).join('') : '<div class="empty">Chưa có hồ sơ — thêm bên dưới để agent có việc để làm.</div>'}</div>
  <div class="card"><h2>Thêm hồ sơ</h2>
    <div class="cards" style="margin-bottom:8px">
      <label>Thương hiệu<br><select data-apf="brand" style="width:100%">${opt(S.brands.map((b) => [b.id, b.name]), AP.brand)}</select></label>
      <label>Kênh<br><select data-apf="channel" style="width:100%">${opt(apChannels.map((c) => [c.id, c.label.replace(' Page', '')]), AP.channel)}</select></label>
      <label>Loại<br><select data-apf="type" style="width:100%">${opt(Object.entries(S.types), AP.type)}</select></label>
      <label>Giờ đăng<br><input type="time" data-apf="time" value="${AP.time}" style="width:100%"></label></div>
    <div class="row" style="margin-bottom:10px"><span>Ngày đăng</span>${DAYS.map(([n, l]) => `<button data-act="apday" data-id="${n}" class="${AP.days.includes(n) ? 'pri' : ''}">${l}</button>`).join('')}</div>
    <label>Định hướng cố định (không bắt buộc)<br><textarea data-apf="direction" rows="2" style="width:100%" placeholder="VD: luôn nhắc đặt lịch qua inbox, ưu tiên ảnh before/after">${esc(AP.direction)}</textarea></label>
    <div style="margin-top:10px">${apChannels.length ? '' : noChannelWarn}<button class="pri" data-act="addprofile" ${apChannels.length ? '' : 'disabled'}>+ Thêm hồ sơ</button></div></div>
  <div class="card"><h2>Lái tự động đã làm</h2>${actionList(logs)}</div>`;
}

// ---- Cài đặt ----
let metaChecks = null;
const TT_PRIV = { SELF_ONLY: 'Chỉ mình tôi (riêng tư)', MUTUAL_FOLLOW_FRIENDS: 'Bạn bè (theo dõi lẫn nhau)', FOLLOWER_OF_CREATOR: 'Người theo dõi', PUBLIC_TO_EVERYONE: 'Công khai' };
function tiktokCard() {
  const t = S.tiktok || {};
  const row = (label, ok, hint) => `<tr><td>${label}</td><td><span class="tag ${ok ? 'on' : 'dry'}">${ok ? 'Đã có' : 'Chưa có'}</span></td><td>${hint}</td></tr>`;
  return `<div class="card"><h2>TikTok</h2>
    <table><tr><th>Mục</th><th>Trạng thái</th><th>Biến môi trường</th></tr>
      ${row('Khóa ứng dụng TikTok', t.keySet && t.secretSet, 'TIKTOK_CLIENT_KEY + TIKTOK_CLIENT_SECRET')}
      ${row('Địa chỉ https của app', !!t.redirectUri, 'PUBLIC_BASE_URL (ví dụ https://agent.theonehairsalon.vn)')}</table>
    ${t.redirectUri ? `<p class="sub" style="margin:10px 0 0">Địa chỉ nhận đăng nhập — dán <b>y nguyên</b> vào ô Redirect URI của ứng dụng TikTok: <code>${esc(t.redirectUri)}</code></p>` : ''}
    <label class="f">Cách đăng TikTok <select data-ttset="tiktokMode"><option value="manual" ${t.mode !== 'api' ? 'selected' : ''}>Gói đăng thủ công — đăng bằng TikTok Studio (khuyên dùng, không cần chờ duyệt)</option><option value="api" ${t.mode === 'api' ? 'selected' : ''}>Tự đăng bằng API (cần ứng dụng TikTok được duyệt)</option></select></label>
    ${t.mode === 'api' ? '' : '<small style="color:var(--mute)">Đang ở chế độ gói đăng: agent soạn chú thích, chọn video, tạo "gói đăng" ở trang Lịch đăng; anh đăng bằng TikTok Studio. Các khóa và mục bên dưới chỉ cần khi chuyển sang "Tự đăng bằng API".</small>'}
    <label class="f">Chế độ hiển thị bài đăng (chỉ khi tự đăng bằng API) <select data-ttset="tiktokPrivacy">${Object.entries(TT_PRIV).map(([v, l]) => `<option value="${v}" ${t.privacy === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <small style="color:var(--mute)">Ứng dụng TikTok <b>chưa qua kiểm duyệt (audit)</b> chỉ đăng được ở chế độ riêng tư, và chỉ lên tài khoản TikTok đang đặt riêng tư. Để "Chỉ mình tôi" cho tới khi được duyệt.</small>
    <label class="f"><input type="checkbox" data-ttset="tiktokAigc" ${t.aigc ? 'checked' : ''}> Gắn nhãn "nội dung do AI tạo" cho video TikTok (bật nếu video làm bằng AI)</label>
    <p class="sub" style="margin:8px 0 0">Trang công khai cho hồ sơ TikTok: <a href="/privacy" target="_blank">Chính sách riêng tư</a> · <a href="/terms" target="_blank">Điều khoản</a></p></div>`;
}
// pageSettings() nằm trong settings.js

// pageChannels() nằm trong channels.js

// pageLog() nằm trong auditlog.js

function render() {
  nav();
  const id = location.hash.slice(1);
  const fn = { '': pageHome, duyet: pageApprovals, kehoach: pagePlan, laitudong: pageAutopilot, agent: pageAgents, thuonghieu: pageBrands, media: pageMedia, traloi: pageReplies, baihoc: pageLessons, caidat: pageSettings, lich: pageSchedule, ads: pageAds, kenh: pageChannels, nhatky: pageLog }[id] || pageHome;
  const keep = document.activeElement && document.activeElement.id;
  // Một trang lỗi (dữ liệu lạ, lỗi mã) thì hiện thông báo rõ thay vì màn hình trắng; menu và các trang khác vẫn dùng được
  let html;
  try { html = fn(); }
  catch (e) {
    console.error(e);
    html = `<div class="card"><div class="state err"><b>Trang này gặp lỗi hiển thị</b>${esc(e && e.message ? e.message : String(e))}<br><small>Chụp màn hình này gửi kỹ thuật. Các trang khác vẫn dùng bình thường.</small><br><button class="sm" type="button" onclick="location.reload()">Tải lại</button></div></div>`;
  }
  $('#view').innerHTML = html;
  if (keep && $('#' + keep)) $('#' + keep).focus();
}

function setPath(obj, path, v) { const [a, b] = path.split('.'); return { [a]: { [b]: v } }; }

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const a = b.dataset.act, id = b.dataset.id;
  b.disabled = true;
  const done = () => { b.disabled = false; };
  if (a === 'scan') act(async () => { const j = await call('POST', '/api/scan'); toast(j.result.skipped ? 'Agent đang dừng' : `Đã quét xong, ${j.result.changed} thay đổi`); return j; }).finally(done);
  else if (a === 'analyze') act(async () => { toast('AI đang phân tích…'); aiText = (await call('POST', '/api/analyze')).text; return S; }).finally(done);
  else if (a === 'reset') act(() => call('POST', '/api/reset-demo')).finally(done);
  else if (a === 'approve' || a === 'reject') act(() => call('POST', `/api/approvals/${id}/${a}`)).finally(done);
  else if (a === 'day') { const n = Number(id); F.days = F.days.includes(n) ? F.days.filter((x) => x !== n) : [...F.days, n].sort(); b.disabled = false; render(); }
  else if (a === 'mediaref') { mediaDirty = true; b.disabled = false; render(); }
  else if (a === 'rmmedia') {
    e.preventDefault();
    const [pid, iid, idx] = id.split('.');
    const it = S.plans.find((p) => p.id === pid).items.find((i) => i.id === iid);
    const names = it.media.map((m) => m.name).filter((_, i) => i !== Number(idx));
    act(() => call('PUT', `/api/plans/${pid}/items/${iid}`, { media: names })).finally(done);
  }
  else if (a === 'pkg') act(async () => { PKG = await call('GET', `/api/posts/${id}/package`); return null; }).finally(done);
  else if (a === 'pkgclose') { PKG = null; b.disabled = false; render(); }
  else if (a === 'ttbatch') act(async () => { TTB = await call('GET', '/api/tiktok/batch'); return null; }).finally(done);
  else if (a === 'ttbclose') { TTB = null; b.disabled = false; render(); }
  else if (a === 'copy') {
    const el = document.getElementById(id);
    navigator.clipboard.writeText(el ? el.value : '').then(() => toast('Đã sao chép'), () => toast('Trình duyệt không cho sao chép — chọn chữ rồi bấm Ctrl+C')).finally(done);
  }
  else if (a === 'mark') {
    const [pid, action] = id.split('.');
    const nick = b.dataset.nick || undefined; // TikTok nhiều nick: đánh dấu riêng nick này
    const url = action === 'published' ? (prompt('Dán link bài đã đăng (không bắt buộc, bấm Hủy/để trống để bỏ qua):') || '') : '';
    act(async () => {
      const j = await call('POST', `/api/posts/${pid}/manual`, { action, url, nick });
      if (PKG && PKG.postId === pid) PKG = nick ? await call('GET', `/api/posts/${pid}/package`) : null; // nhiều nick: giữ gói mở để làm nick tiếp
      if (TTB) TTB = await call('GET', '/api/tiktok/batch');
      toast(nick ? `Đã đánh dấu ${nick}` : 'Đã cập nhật');
      return j;
    }).finally(done);
  }
  else if (a === 'analyze1') act(async () => { toast('Gemini đang xem file…'); const j = await call('POST', '/api/media/analyze', { brand: MB, name: id }); mediaDirty = true; return j; }).finally(done);
  else if (a === 'analyzeall') act(async () => {
    toast('Gemini đang xem các file chưa phân tích…');
    const j = await call('POST', '/api/media/analyze', { brand: MB });
    mediaDirty = true;
    toast(`Đã xem ${j.result.done} file${j.result.stopped ? ' · dừng: ' + j.result.stopped : j.result.failed.length ? ' · lỗi: ' + j.result.failed[0] : ''}`);
    return j;
  }).finally(done);
  else if (a === 'ttdisc') {
    e.preventDefault();
    if (!confirm('Ngắt kết nối tài khoản TikTok này? Token sẽ bị thu hồi và xóa khỏi máy chủ; các tài khoản khác vẫn đăng bình thường.')) { b.disabled = false; return; }
    act(() => call('POST', '/api/tiktok/disconnect', { brand: id, openId: b.dataset.open || undefined })).finally(done);
  }
  else if (a === 'metacheck') act(async () => { metaChecks = (await call('POST', '/api/meta/check')).checks; return S; }).finally(done);
  else if (a === 'addlesson') {
    if (!LESSON.text.trim()) { toast('Nhập nội dung bài học'); done(); return; }
    act(async () => { const j = await call('POST', '/api/lessons', LESSON); LESSON.text = ''; toast('Đã thêm bài học'); return j; }).finally(done);
  }
  else if (a === 'suggestlessons') act(async () => { const j = await call('POST', '/api/lessons/suggest'); toast(j.suggest.added ? `Đã rút ${j.suggest.added} bài học mới, chờ Sếp xác nhận` : j.suggest.reason || 'Chưa rút được bài học mới'); return j; }).finally(done);
  else if (a === 'lessonon' || a === 'lessonoff') act(() => call('PUT', `/api/lessons/${id}`, { status: a === 'lessonon' ? 'active' : 'disabled' })).finally(done);
  else if (a === 'lessondel') act(() => call('DELETE', `/api/lessons/${id}`)).finally(done);
  else if (a === 'runagent') act(async () => { const j = await call('POST', `/api/agents/${id}/run`); toast('Đã chạy xong'); return j; }).finally(done);
  else if (a === 'apday') { const n = Number(id); AP.days = AP.days.includes(n) ? AP.days.filter((x) => x !== n) : [...AP.days, n].sort(); b.disabled = false; render(); }
  else if (a === 'addprofile') act(async () => { const j = await call('POST', '/api/autopilot/profiles', AP); toast('Đã thêm hồ sơ'); return j; }).finally(done);
  else if (a === 'delprofile') act(() => call('DELETE', `/api/autopilot/profiles/${id}`)).finally(done);
  else if (a === 'edititem') { editing.add(id.split('.')[1]); b.disabled = false; render(); }
  else if (a === 'saveitem') {
    const [pid, iid] = id.split('.');
    const text = $('#ed_' + iid).value;
    const titleEl = $('#edt_' + iid);
    act(async () => { const j = await call('PUT', `/api/plans/${pid}/items/${iid}`, titleEl ? { text, title: titleEl.value } : { text }); editing.delete(iid); return j; }).finally(done);
  }
  else if (a === 'approveplan') act(async () => { const j = await call('POST', `/api/plans/${id}/approve`); toast('Đã duyệt, các bài đã lên lịch'); return j; }).finally(done);
  else if (a === 'newplan') {
    planBusy = true; render();
    act(async () => { const j = await call('POST', '/api/plans', F); toast('AI đã soạn xong kế hoạch'); return j; }).finally(() => { planBusy = false; render(); });
  }
  else if (a === 'newpost') {
    const topic = $('#ptopic').value.trim();
    if (!topic) { toast('Nhập chủ đề trước'); done(); return; }
    act(() => call('POST', '/api/posts', { brand: PB.brand, channel: PB.channel, topic, scheduledAt: new Date($('#pwhen').value).toISOString() })).finally(done);
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.f) { F[t.dataset.f] = t.value; if (t.dataset.f === 'brand') render(); return; }
  if (t.dataset.pb) { PB[t.dataset.pb] = t.value; if (t.dataset.pb === 'brand') render(); return; }
  if (t.dataset.apf) { AP[t.dataset.apf] = t.value; if (t.dataset.apf === 'brand') render(); return; }
  if (t.dataset.ls) { LESSON[t.dataset.ls] = t.value; return; }
  if (t.dataset.mb) { MB = t.value; mediaDirty = true; render(); return; }
  if (t.id === 'mfile') { uploadFiles(t.files); t.value = ''; return; }
  if (t.dataset.consent !== undefined) { act(async () => { const j = await call('POST', '/api/media/consent', { brand: MB, name: t.dataset.consent, value: t.checked }); mediaDirty = true; return j; }); return; }
  if (t.dataset.note !== undefined) { act(() => call('POST', '/api/media/note', { brand: MB, name: t.dataset.note, note: t.value })); return; }
  if (t.dataset.addmedia) {
    if (!t.value) return;
    const [pid, iid] = t.dataset.addmedia.split('.');
    const it = S.plans.find((p) => p.id === pid).items.find((i) => i.id === iid);
    act(() => call('PUT', `/api/plans/${pid}/items/${iid}`, { media: [...it.media.map((m) => m.name), t.value] }));
    return;
  }
  if (t.dataset.agent) { act(() => call('POST', `/api/agents/${t.dataset.agent}/toggle`, { on: t.checked })); return; }
  // data-ap ở trang Lái tự động là cài đặt autopilot; trang Duyệt cũng dùng data-ap (pick/note/brand…) nhưng tự xử lý — không gửi lên /api/autopilot
  if (t.dataset.ap && location.hash.slice(1) === 'laitudong') { act(() => call('POST', '/api/autopilot', { [t.dataset.ap]: t.type === 'checkbox' ? t.checked : Number(t.value) })); return; }
  if (t.dataset.bf) { const [id, f] = t.dataset.bf.split('.'); act(() => call('POST', '/api/brands', { id, [f]: t.value })); return; }
  if (t.dataset.bc) { const [id, ch, f] = t.dataset.bc.split('.'); act(() => call('POST', '/api/brands', { id, channels: { [ch]: { [f]: t.type === 'checkbox' ? t.checked : t.value } } })); return; }
  if (t.dataset.pick) { const [pid, iid] = t.dataset.pick.split('.'); act(() => call('PUT', `/api/plans/${pid}/items/${iid}`, { selected: t.checked })); return; }
  if (t.dataset.adunit) { act(() => call('POST', '/api/settings', { adTest: { units: [{ id: t.dataset.adunit, dailyBudget: Number(t.value) }] } })); return; }
  if (t.dataset.adunitPage !== undefined) { act(() => call('POST', '/api/settings', { adTest: { units: [{ id: t.dataset.adunitPage, pageId: t.value }] } })); return; }
  if (t.dataset.adunitOn) { act(() => call('POST', '/api/settings', { adTest: { units: [{ id: t.dataset.adunitOn, on: t.checked }] } })); return; }
  if (t.dataset.adtest) { act(() => call('POST', '/api/settings', { adTest: { [t.dataset.adtest]: t.type === 'checkbox' ? t.checked : Number(t.value) } })); return; }
  if (t.dataset.adboost) {
    if (t.dataset.adboost === 'auto' && t.checked && !confirm('Bật tự chạy: mỗi ngày agent TỰ tạo và bật quảng cáo cho 1 video đang lên view ở mỗi cơ sở (tiền thật, không hỏi lại), trong hạn mức ngày của cơ sở. Bật không?')) { t.checked = false; return; }
    act(() => call('POST', '/api/settings', { adTest: { boost: { [t.dataset.adboost]: t.type === 'checkbox' ? t.checked : Number(t.value) } } }));
    return;
  }
  if (t.dataset.ttset) { act(() => call('POST', '/api/settings', { [t.dataset.ttset]: t.type === 'checkbox' ? t.checked : t.value })); return; }
  const v = t.type === 'checkbox' ? t.checked : Number(t.value);
  if (t.dataset.rule) { const [k, key] = t.dataset.rule.split('.'); act(() => call('POST', '/api/settings', { rules: { [k]: { [key]: v } } })); }
  else if (t.dataset.set) act(() => call('POST', '/api/settings', { [t.dataset.set]: v }));
});

$('#killBtn').onclick = () => {
  const stop = !S.settings.paused;
  if (stop && !confirm('Dừng khẩn cấp: agent sẽ ngừng mọi hành động. Tiếp tục?')) return;
  act(() => call('POST', '/api/settings', { paused: stop }));
};

document.addEventListener('input', (e) => { const t = e.target; if (t.dataset.f) F[t.dataset.f] = t.value; if (t.dataset.apf) AP[t.dataset.apf] = t.value; if (t.dataset.ls) LESSON[t.dataset.ls] = t.value; });
// Kéo thả file vào khung tải lên của Thư viện Media
document.addEventListener('dragover', (e) => { if (e.target.closest && e.target.closest('#drop')) e.preventDefault(); });
document.addEventListener('drop', (e) => {
  if (!(e.target.closest && e.target.closest('#drop'))) return;
  e.preventDefault();
  if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
});
window.addEventListener('hashchange', render);
(async function init() {
  // Chờ mọi tệp giao diện tải xong (nav() nằm ở shell.js, nạp sau) rồi mới vẽ — nếu không, API trả về sớm hơn
  // shell.js là vẽ hụt, màn hình trống.
  const ready = new Promise((r) => (document.readyState === 'complete' ? r() : window.addEventListener('load', r, { once: true })));
  const [state] = await Promise.all([call('GET', '/api/state'), ready]);
  S = state;
  render();
  setInterval(async () => { if (!document.hidden && !['INPUT', 'SELECT', 'TEXTAREA'].includes((document.activeElement || {}).tagName)) { try { S = await call('GET', '/api/state'); render(); } catch {} } }, 30000);
})();
