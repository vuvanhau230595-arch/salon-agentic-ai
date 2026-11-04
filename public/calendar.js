// Trang Lịch đăng: lịch tháng / tuần / ngày / danh sách, kéo thả đổi giờ, xem trước, sửa nội dung, huỷ bài, soạn bài mới.
// Dữ liệu từ GET /api/posts (theo khoảng ngày). Bài đã duyệt mà sửa nội dung thì quay về chờ duyệt; bài đã đăng thì không sửa.
// Nạp sau approvals.js (dùng chung confirmBox, brandName, lintBox, pkgPanel, call, toast, render, S).
const CAL = {
  view: window.innerWidth < 700 ? 'list' : 'month', date: new Date(), brand: '', channel: '', status: '', q: '',
  posts: [], state: 'idle', err: '', openId: null, edit: null, busy: false, seq: 0,
};
const CAL_ST = {
  draft: ['info', 'Chờ duyệt'], scheduled: ['brand', 'Đã lên lịch'], awaiting_manual: ['warn', 'Đến giờ — chờ đăng tay'], missed: ['bad', 'Bỏ lỡ — hẹn lại giờ'], external_scheduled: ['info', 'Đã hẹn giờ ngoài'],
  published: ['ok', 'Đã đăng'], rejected: ['bad', 'Bị từ chối'], failed: ['bad', 'Lỗi'], cancelled: ['mute', 'Đã huỷ'],
};
const CAL_VIEWS = [['month', 'Tháng'], ['week', 'Tuần'], ['day', 'Ngày'], ['list', 'Danh sách']];
const DOW = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

const dKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = (d) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
const hhmm = (iso) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });
const localInput = (iso) => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16); };
const shortBrand = (id) => ({ the_one: 'TO', dark_hair: 'DH', mishang: 'MS' }[id] || '··');
// Ô chọn giờ 24h (ngày + giờ 00–23 + phút): input datetime-local theo máy hay hiện SA/CH nên không dùng
const p2 = (n) => String(n).padStart(2, '0');
function dtPicker(id, iso, disabled) {
  const s = localInput(iso), h = +s.slice(11, 13), m = +s.slice(14, 16);
  const mins = [...new Set([...Array.from({ length: 12 }, (_, i) => i * 5), m])].sort((a, b) => a - b);
  const dis = disabled ? 'disabled' : '';
  return `<span class="dt24" id="${id}"><input type="date" value="${s.slice(0, 10)}" ${dis} aria-label="Ngày"><select ${dis} aria-label="Giờ">${Array.from({ length: 24 }, (_, i) => `<option value="${i}" ${i === h ? 'selected' : ''}>${p2(i)}</option>`).join('')}</select><b>:</b><select ${dis} aria-label="Phút">${mins.map((x) => `<option value="${x}" ${x === m ? 'selected' : ''}>${p2(x)}</option>`).join('')}</select></span>`;
}
// Đọc ô giờ 24h → chuỗi "YYYY-MM-DDTHH:mm" (giờ máy đang xem); thiếu ngày → ''
function dtValue(root, id) {
  const el = root.querySelector('#' + id);
  if (!el) return '';
  const [d, h, m] = [el.querySelector('input'), ...el.querySelectorAll('select')].map((x) => x.value);
  return d ? `${d}T${p2(h)}:${p2(m)}` : '';
}
const ACC_ICON = { fb: 'FB', ig: 'IG', tt: 'TT' };
// Tài khoản bài đăng lên, dạng ngắn cho ô lịch ("FB Quận 3", "IG @theone.hairsalon", "FB 4 Page")
function accShort(p) {
  const a = p.accounts || [];
  if (!a.length) return `<span class="an">${esc(p.channelLabel)}</span>`;
  const k = a[0].kind;
  return `<span class="acc ${k}">${ACC_ICON[k]}</span><span class="an">${esc(a.length > 1 ? `${a.length} ${k === 'fb' ? 'Page' : 'tài khoản'}` : a[0].short)}</span>`;
}
const accFull = (p) => (p.accounts || []).map((a) => `${ACC_ICON[a.kind]} ${a.name}`).join(', ') || p.channelLabel;

function calRange() {
  const d = CAL.date;
  if (CAL.view === 'day') return [startOfDay(d), addDays(startOfDay(d), 1)];
  if (CAL.view === 'week') { const m = mondayOf(d); return [m, addDays(m, 7)]; }
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  if (CAL.view === 'list') return [first, new Date(d.getFullYear(), d.getMonth() + 1, 1)];
  const m = mondayOf(first);
  return [m, addDays(m, 42)];
}
function calLabel() {
  const d = CAL.date;
  if (CAL.view === 'day') return d.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  if (CAL.view === 'week') { const [a, b] = calRange(); const e = addDays(b, -1); return `${a.getDate()}/${a.getMonth() + 1} – ${e.getDate()}/${e.getMonth() + 1}/${e.getFullYear()}`; }
  return `Tháng ${d.getMonth() + 1}/${d.getFullYear()}`;
}
function calStep(dir) {
  const d = new Date(CAL.date);
  if (CAL.view === 'day') d.setDate(d.getDate() + dir);
  else if (CAL.view === 'week') d.setDate(d.getDate() + 7 * dir);
  else { d.setDate(1); d.setMonth(d.getMonth() + dir); }
  CAL.date = d;
}

async function calLoad() {
  const seq = ++CAL.seq;
  CAL.state = CAL.posts.length ? 'ok' : 'loading';
  calPaint();
  try {
    const [a, b] = calRange();
    const qs = new URLSearchParams({ from: a.toISOString(), to: new Date(b.getTime() - 1).toISOString(), ...(CAL.brand ? { brand: CAL.brand } : {}), ...(CAL.channel ? { channel: CAL.channel } : {}), ...(CAL.status ? { status: CAL.status } : {}), ...(CAL.q.trim() ? { q: CAL.q.trim() } : {}) });
    const r = await call('GET', '/api/posts?' + qs);
    if (seq !== CAL.seq) return;
    CAL.posts = r.posts; CAL.state = 'ok'; CAL.err = '';
  } catch (e) { if (seq !== CAL.seq) return; CAL.state = 'err'; CAL.err = e.message; }
  calPaint();
}

// ---------- Vẽ ----------
function chip(p, compact) {
  const st = CAL_ST[p.status] || ['mute', p.status];
  const drag = p.movable ? 'draggable="true"' : '';
  return `<div class="chip st-${p.status}" ${drag} data-cal="open" data-id="${esc(p.id)}" title="${esc(`${st[1]} · ${hhmm(p.scheduledAt)} · ${p.brandName}\nĐăng lên: ${accFull(p)}\n${p.topic}`)}"><b>${hhmm(p.scheduledAt)}</b>${CAL.brand ? '' : ` <span class="bd">${shortBrand(p.brand)}</span>`} ${accShort(p)}${compact ? '' : ` <span class="tp">${esc(p.title || p.topic)}</span>`}</div>`;
}
function dayCell(day, posts, opts = {}) {
  const key = dKey(day), today = key === dKey(new Date());
  const past = startOfDay(day) < startOfDay(new Date());
  const max = opts.max || 3;
  const list = posts.filter((p) => dKey(new Date(p.scheduledAt)) === key);
  return `<div class="cell ${today ? 'today' : ''} ${past ? 'past' : ''} ${opts.dim ? 'dim' : ''}" data-day="${key}" ${past ? '' : 'data-drop="1"'}>
    <div class="dn"><span data-cal="add" data-day="${key}" title="Soạn bài cho ngày này">${day.getDate()}${day.getDate() === 1 || opts.showMonth ? '/' + (day.getMonth() + 1) : ''}</span>${list.length ? `<small>${list.length}</small>` : ''}</div>
    ${list.slice(0, max).map((p) => chip(p, opts.compact)).join('')}${list.length > max ? `<div class="more" data-cal="day" data-day="${key}">+${list.length - max} bài khác</div>` : ''}</div>`;
}
function monthHtml() {
  const [a] = calRange();
  const cells = Array.from({ length: 42 }, (_, i) => addDays(a, i));
  return `<div class="calgrid">${DOW.map((d) => `<div class="dow">${d}</div>`).join('')}${cells.map((d) => dayCell(d, CAL.posts, { dim: d.getMonth() !== CAL.date.getMonth(), compact: true, max: 8 })).join('')}</div>`;
}
function weekHtml() {
  const [a] = calRange();
  return `<div class="calgrid">${DOW.map((d, i) => `<div class="dow">${d} ${addDays(a, i).getDate()}/${addDays(a, i).getMonth() + 1}</div>`).join('')}${Array.from({ length: 7 }, (_, i) => dayCell(addDays(a, i), CAL.posts, { max: 12, showMonth: true })).join('')}</div>`;
}
function listItem(p) {
  const st = CAL_ST[p.status] || ['mute', p.status];
  return `<div class="item" style="cursor:pointer" data-cal="open" data-id="${esc(p.id)}"><div style="min-width:0"><span class="tag ${st[0] === 'ok' ? 'on' : st[0] === 'bad' ? 'off' : st[0] === 'warn' ? 'dry' : st[0] === 'info' ? 'info' : ''}">${esc(st[1])}</span> <b>${esc(p.title || p.topic)}</b><p style="margin:2px 0">${esc(p.brandName)} · <b>${esc(accFull(p))}</b>${p.media.length ? ` · ${p.media.length} file` : ''}</p><p style="margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(p.text)}</p></div><div style="white-space:nowrap;color:var(--mute);text-align:right">${esc(new Date(p.scheduledAt).toLocaleDateString('vi-VN'))}<br>${hhmm(p.scheduledAt)}</div></div>`;
}
function dayHtml() {
  const key = dKey(CAL.date);
  const list = CAL.posts.filter((p) => dKey(new Date(p.scheduledAt)) === key);
  const past = startOfDay(CAL.date) < startOfDay(new Date());
  return `<div class="cell ${past ? 'past' : ''}" data-day="${key}" ${past ? '' : 'data-drop="1"'} style="min-height:200px;padding:6px">${list.length ? list.map(listItem).join('') : '<div class="empty">Không có bài trong ngày này.</div>'}</div>`;
}
function listHtml() {
  return CAL.posts.length ? `<div class="card" style="padding:4px 16px">${CAL.posts.map(listItem).join('')}</div>` : '';
}
function calBody() {
  if (CAL.state === 'loading') return '<div class="skel" style="height:320px"></div>';
  if (CAL.state === 'err') return `<div class="card"><div class="state err"><b>Không tải được lịch đăng</b>${esc(CAL.err)}<br><button class="sm" data-cal="reload">Thử lại</button></div></div>`;
  const empty = !CAL.posts.length ? `<p class="sub" style="margin:8px 0 0">${CAL.q || CAL.brand || CAL.channel || CAL.status ? 'Không có bài nào khớp bộ lọc trong khoảng này.' : 'Chưa có bài nào trong khoảng này — bấm số ngày hoặc "＋ Soạn bài" để thêm.'}</p>` : '';
  const body = { month: monthHtml, week: weekHtml, day: dayHtml, list: listHtml }[CAL.view]();
  return body + empty;
}
function legend() {
  return `<div class="legend noprint">${Object.entries(CAL_ST).map(([k, [c, l]]) => `<span><i class="lg st-${k}"></i>${esc(l)}</span>`).join('')}</div>`;
}

function postById(id) { return CAL.posts.find((p) => p.id === id); }

// ---------- Panel chi tiết / sửa ----------
function calDrawer() {
  const layer = document.getElementById('layer');
  let el = document.getElementById('calDrawer');
  const p = CAL.openId ? postById(CAL.openId) : null;
  if (!p) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('aside'); el.id = 'calDrawer'; el.className = 'drawer'; layer.appendChild(el); }
  const st = CAL_ST[p.status] || ['mute', p.status];
  const ed = CAL.edit && CAL.edit.id === p.id ? CAL.edit : null;
  const xhs = p.channel === 'xiaohongshu';
  const thumbs = (list, removable) => list.length ? `<div class="row" style="gap:8px;margin:6px 0">${list.map((m) => `<div style="position:relative">${m.type === 'video'
    ? `<video src="${esc(m.url)}" preload="none" controls style="height:100px;border-radius:8px;background:#000"></video>`
    : `<img src="${esc(m.url)}" alt="${esc(m.name)}" loading="lazy" style="height:100px;border-radius:8px;display:block">`}${removable ? `<button class="sm" data-cal="rmmedia" data-name="${esc(m.name)}" style="position:absolute;top:2px;right:2px" title="Bỏ file này">✕</button>` : ''}</div>`).join('')}</div>` : '<p class="sub" style="margin:6px 0">Bài chưa gắn ảnh/video.</p>';
  const accOf = (key) => (p.accounts || []).find((a) => a.id === key || 'ig_' + a.id === key);
  const resName = (key) => { const a = accOf(key); return a ? `${ACC_ICON[a.kind]} ${a.name}` : `Page ${key}`; };
  const links = p.results.filter((r) => r.link || r.externalId).map((r) => (r.link ? `<a href="${esc(r.link)}" target="_blank" rel="noopener">Xem bài trên ${esc(resName(r.pageId))} ↗</a>` : `<small>${esc(resName(r.pageId))}: ${esc(r.externalId)}</small>`)).join('<br>');
  const accBox = `<div class="accbox"><b>Đăng lên</b>${(p.accounts || []).length ? p.accounts.map((a) => `<div class="accrow"><span class="acc ${a.kind}">${ACC_ICON[a.kind]}</span><div><b>${esc(a.name)}</b>${a.kind === 'ig' && a.via ? `<br><small>Instagram liên kết với Page ${esc(a.via)}</small>` : a.kind === 'fb' ? `<br><small>Facebook Page · mã ${esc(a.id)}</small>` : ''}</div></div>`).join('') : `<div class="accrow"><small>${esc(p.channelLabel)} — chưa xác định tài khoản (kiểm tra ở Thương hiệu & Kênh)</small></div>`}</div>`;
  const when = `${accBox}<div class="row"><b>Giờ đăng</b>${dtPicker('calWhen', p.scheduledAt, !(p.movable || p.editable))}${p.movable ? '<button class="sm pri" data-cal="resched">Đổi giờ</button>' : ''}</div>`;
  const edited = ed ? ed : { topic: p.topic, title: p.title, text: p.text, media: p.media.map((m) => m.name) };
  const curMedia = ed ? ed.mediaObjs : p.media;
  const content = p.editable
    ? `<h3 style="margin-top:14px">Nội dung</h3>
      <label class="f" style="display:block">Chủ đề<input type="text" data-cal="f-topic" value="${esc(edited.topic)}" style="width:100%"></label>
      ${xhs ? `<label class="f" style="display:block">Tiêu đề (≤ 20 chữ)<input type="text" data-cal="f-title" value="${esc(edited.title)}" style="width:100%"></label>` : ''}
      <label class="f" style="display:block">Nội dung bài<textarea data-cal="f-text" rows="9" style="width:100%">${esc(edited.text)}</textarea></label>
      <div class="row"><b>Ảnh / video</b><button class="sm" data-cal="pickmedia">+ Thêm từ thư viện</button></div>${thumbs(curMedia, true)}
      ${p.status !== 'draft' ? '<p class="alert"><b>Sửa nội dung bài đã duyệt/đã lỗi sẽ đưa bài về "Chờ duyệt"</b> — Sếp phải duyệt lại ở trang Duyệt mới được đăng.</p>' : ''}
      <div class="row"><button class="pri" data-cal="save" ${CAL.busy ? 'disabled' : ''}>${p.status === 'draft' ? 'Lưu chỉnh sửa' : 'Lưu & gửi duyệt lại'}</button>${ed ? '<button data-cal="discard">Bỏ thay đổi</button>' : ''}</div>`
    : `<h3 style="margin-top:14px">Nội dung</h3>${p.title ? `<div><b>${esc(p.title)}</b></div>` : ''}<div style="white-space:pre-wrap;background:var(--soft);border-radius:var(--r-sm);padding:10px 12px">${esc(p.text)}</div>${thumbs(p.media, false)}`;
  // TikTok nhiều nick: đánh dấu từng nick trong Gói đăng (nút chung không biết nick nào)
  const multiNick = p.channel === 'tiktok' && !p.tiktokNick && ttNicks(p.brand).length > 1;
  const manualBtns = p.manual && ['scheduled', 'awaiting_manual', 'external_scheduled'].includes(p.status) && multiNick
    ? `<div class="row" style="margin-top:10px"><button class="pri" data-act="pkg" data-id="${esc(p.id)}">📦 Gói đăng · ${ttNicks(p.brand).length} nick</button></div>`
    : p.manual && ['scheduled', 'awaiting_manual', 'external_scheduled'].includes(p.status)
    ? `<div class="row" style="margin-top:10px"><button data-act="pkg" data-id="${esc(p.id)}">📦 Gói đăng</button>${p.status !== 'external_scheduled' ? `<button data-act="mark" data-id="${esc(p.id)}.external_scheduled">Đã hẹn giờ ngoài</button>` : ''}<button class="pri" data-act="mark" data-id="${esc(p.id)}.published">Đã đăng</button></div>` : '';
  el.innerHTML = `<div class="hd"><div><h2>${esc(p.title || p.topic)}</h2><small style="color:var(--mute)">${esc(p.brandName)} · ${esc(accFull(p))}</small><br><span class="tag ${st[0] === 'ok' ? 'on' : st[0] === 'bad' ? 'off' : st[0] === 'warn' ? 'dry' : st[0] === 'info' ? 'info' : ''}">${esc(st[1])}</span>${p.approvalStatus === 'pending' ? ' <a href="#duyet" class="tag dry" style="text-decoration:none">Đang chờ Sếp duyệt →</a>' : ''}${p.manual ? ' <span class="tag">đăng thủ công</span>' : ''}</div><button class="sm" data-cal="close">✕ Đóng</button></div>
    ${p.error ? `<div class="alert danger">Lỗi đăng: ${esc(p.error)}${p.attempts ? ` (đã thử ${p.attempts} lần)` : ''}</div>` : ''}${p.skipReason ? `<div class="alert danger">${esc(p.skipReason)} — bật lại ở Thương hiệu & Kênh để bài được đăng.</div>` : ''}
    ${S.settings.dryRun && ['scheduled', 'draft'].includes(p.status) ? '<div class="alert">Đang <b>chạy thử</b>: đến giờ bài vẫn chưa được đăng thật.</div>' : ''}
    ${when}${links ? `<p style="margin:10px 0">${links}</p>` : ''}${p.url ? `<p><a href="${esc(p.url)}" target="_blank" rel="noopener">Mở bài đã đăng ↗</a></p>` : ''}
    ${lintBox(p.lint)}${p.qc ? qcBox(p.qc) : ''}${content}${manualBtns}
    ${p.cancellable ? '<div style="margin-top:18px;border-top:1px solid var(--line);padding-top:12px"><button class="danger" data-cal="cancel">Huỷ bài (không đăng nữa)</button></div>' : ''}`;
}

// ---------- Hộp soạn bài mới + chọn media ----------
function channelsOf(brandId) {
  const b = S.brands.find((x) => x.id === brandId);
  return S.channels.filter((c) => ['facebook_page', 'instagram', 'tiktok', 'xiaohongshu'].includes(c.id) && b && b.channels[c.id] && b.channels[c.id].on);
}
function openCompose(dayKeyStr, preset = {}) {
  const layer = document.getElementById('layer');
  const def = dayKeyStr ? new Date(`${dayKeyStr}T19:00:00`) : new Date(Date.now() + 3600e3);
  if (def.getTime() < Date.now()) def.setTime(Date.now() + 3600e3);
  const el = document.createElement('div');
  el.className = 'overlay';
  const brand0 = preset.brand || CAL.brand || S.brands[0].id;
  // TikTok nhiều nick: chọn nick cho bài này
  const drawNick = () => {
    const nicks = el.querySelector('#cmpCh').value === 'tiktok' ? ttNicks(el.querySelector('#cmpBrand').value) : [];
    el.querySelector('#cmpNickBox').style.display = nicks.length > 1 ? 'block' : 'none';
    el.querySelector('#cmpNick').innerHTML = nicks.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  };
  const draw = (brandId) => {
    const chs = channelsOf(brandId);
    el.querySelector('#cmpCh').innerHTML = chs.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join('');
    el.querySelector('#cmpWarn').innerHTML = chs.length ? '' : '<p class="alert danger">Thương hiệu này chưa bật kênh nào để đăng bài — bật ở <a href="#thuonghieu">Thương hiệu & Kênh</a>.</p>';
    drawNick();
    el.querySelector('[data-r="1"]').disabled = !chs.length;
  };
  el.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h3>Soạn bài mới</h3>
    <label class="f" style="display:block">Thương hiệu<select id="cmpBrand" style="width:100%">${S.brands.map((b) => `<option value="${esc(b.id)}" ${b.id === brand0 ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
    <label class="f" style="display:block">Kênh<select id="cmpCh" style="width:100%"></select></label><div id="cmpWarn"></div>
    <label class="f" id="cmpNickBox" style="display:none">Nick TikTok (mỗi nick đăng video riêng)<select id="cmpNick" style="width:100%"></select></label>
    <label class="f" style="display:block">Chủ đề<input type="text" id="cmpTopic" placeholder="Ví dụ: nhuộm balayage mùa thu" style="width:100%"></label>
    <div class="f" style="display:block">Giờ đăng (24h)<br>${dtPicker('cmpWhen', def.toISOString())}</div>
    <label class="f" style="display:block">Nội dung (để trống = AI viết nháp theo chủ đề)<textarea id="cmpText" rows="4" style="width:100%"></textarea></label>
    ${(preset.media || []).length ? `<p class="alert" style="margin:8px 0">📎 Đính kèm: <b>${esc(preset.media.join(', '))}</b></p>` : ''}
    <label class="f" style="display:flex;gap:8px;align-items:center;margin:8px 0"><input type="checkbox" id="cmpNow"> Duyệt luôn — tự đăng đúng giờ đã chọn</label>
    <p class="sub" style="margin:0">Nội dung để trống thì AI viết từ chủ đề + hồ sơ thương hiệu (giọng văn, dịch vụ, điều không được nói). Chưa tích "Duyệt luôn" thì bài vào hàng chờ duyệt, chưa đăng gì.</p>
    <div class="acts"><button data-r="0">Huỷ</button><button class="pri" data-r="1">Tạo bài</button></div></div>`;
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  el.addEventListener('click', async (e) => {
    if (e.target === el || e.target.closest('[data-r="0"]')) return close();
    if (!e.target.closest('[data-r="1"]')) return;
    const btn = e.target.closest('[data-r="1"]');
    const topic = el.querySelector('#cmpTopic').value.trim();
    if (!topic) return toast('Nhập chủ đề');
    const when = new Date(dtValue(el, 'cmpWhen'));
    if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() - 60e3) return toast('Chọn giờ đăng trong tương lai');
    btn.disabled = true; btn.textContent = 'Đang tạo…';
    try {
      S = await call('POST', '/api/posts', { brand: el.querySelector('#cmpBrand').value, channel: el.querySelector('#cmpCh').value, topic, text: el.querySelector('#cmpText').value.trim() || undefined, scheduledAt: when.toISOString(), approveNow: el.querySelector('#cmpNow').checked, ...(el.querySelector('#cmpNickBox').style.display !== 'none' ? { tiktokNick: el.querySelector('#cmpNick').value } : {}), ...((preset.media || []).length ? { media: preset.media } : {}) });
      toast(el.querySelector('#cmpNow').checked ? 'Đã tạo và duyệt — bài sẽ đăng đúng giờ' : 'Đã tạo bài — đang chờ Sếp duyệt');
      close(); render();
    } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = 'Tạo bài'; }
  });
  el.querySelector('#cmpBrand').addEventListener('change', (e) => draw(e.target.value));
  el.querySelector('#cmpCh').addEventListener('change', drawNick);
  document.addEventListener('keydown', onKey);
  layer.appendChild(el);
  draw(brand0);
  el.querySelector('#cmpTopic').focus();
}

async function pickMedia() {
  const p = postById(CAL.openId);
  if (!p) return;
  const layer = document.getElementById('layer');
  const el = document.createElement('div');
  el.className = 'overlay';
  el.innerHTML = '<div class="modal" style="width:620px"><h3>Chọn ảnh / video từ thư viện</h3><div id="pmBody"><div class="skel" style="height:120px"></div></div><div class="acts"><button data-r="0">Đóng</button></div></div>';
  const close = () => el.remove();
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-r="0"]')) close(); });
  layer.appendChild(el);
  try {
    const r = await call('GET', `/api/media?brand=${encodeURIComponent(p.brand)}`);
    const cur = new Set(((CAL.edit && CAL.edit.id === p.id) ? CAL.edit.media : p.media.map((m) => m.name)));
    const files = r.files.filter((f) => !cur.has(f.name));
    el.querySelector('#pmBody').innerHTML = files.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px">${files.map((f) => `<button type="button" data-pm="${esc(f.name)}" data-type="${esc(f.type)}" style="padding:4px;text-align:left">${f.type === 'video' ? `<video src="${esc(fileUrl(p.brand, f.name))}" preload="metadata" muted style="width:100%;height:90px;object-fit:cover;border-radius:6px"></video>` : `<img src="${esc(fileUrl(p.brand, f.name))}" alt="" loading="lazy" style="width:100%;height:90px;object-fit:cover;border-radius:6px">`}<small style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</small></button>`).join('')}</div>` : '<div class="empty">Thư viện không còn file nào để thêm. Tải file ở trang Thư viện Media.</div>';
    el.querySelector('#pmBody').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pm]');
      if (!b) return;
      const ed = beginEdit(p);
      ed.media.push(b.dataset.pm);
      ed.mediaObjs.push({ name: b.dataset.pm, type: b.dataset.type, url: fileUrl(p.brand, b.dataset.pm) });
      close(); calDrawer();
    });
  } catch (e) { el.querySelector('#pmBody').innerHTML = `<div class="state err"><b>Không tải được thư viện</b>${esc(e.message)}</div>`; }
}
function beginEdit(p) {
  if (!CAL.edit || CAL.edit.id !== p.id) CAL.edit = { id: p.id, topic: p.topic, title: p.title, text: p.text, media: p.media.map((m) => m.name), mediaObjs: p.media.map((m) => ({ ...m })) };
  return CAL.edit;
}

// ---------- Hành động ----------
async function calMutate(fn, okMsg) {
  CAL.busy = true; calDrawer();
  try { const r = await fn(); toast(okMsg); S = await call('GET', '/api/state'); CAL.busy = false; return r; }
  catch (e) { CAL.busy = false; toast(e.message); calDrawer(); return null; }
}
async function calSave() {
  const p = postById(CAL.openId), ed = CAL.edit && CAL.edit.id === CAL.openId ? CAL.edit : null;
  if (!p || !ed) return toast('Chưa có thay đổi nào');
  const body = {};
  if (ed.topic !== p.topic) body.topic = ed.topic;
  if (ed.title !== p.title) body.title = ed.title;
  if (ed.text !== p.text) body.text = ed.text;
  if (JSON.stringify(ed.media) !== JSON.stringify(p.media.map((m) => m.name))) body.media = ed.media;
  if (!Object.keys(body).length) return toast('Chưa có thay đổi nào');
  if (p.status !== 'draft') {
    const ok = await confirmBox({ title: 'Lưu và gửi duyệt lại?', body: `<p><b>${esc(p.topic)}</b></p><p>Bài đang "${esc((CAL_ST[p.status] || [0, p.status])[1])}". Sửa nội dung sẽ đưa bài về <b>Chờ duyệt</b>; chỉ đăng khi Sếp duyệt lại.</p>`, ok: 'Lưu & gửi duyệt lại' });
    if (!ok) return;
  }
  const r = await calMutate(() => call('PUT', `/api/posts/${encodeURIComponent(p.id)}`, body), p.status === 'draft' ? 'Đã lưu' : 'Đã lưu — bài chờ duyệt lại');
  if (r) { CAL.edit = null; await calLoad(); render(); }
}
async function calResched() {
  const p = postById(CAL.openId);
  const v = dtValue(document, 'calWhen');
  if (!p || !v) return;
  const t = new Date(v);
  if (t.toISOString() === p.scheduledAt) return toast('Giờ mới trùng giờ hiện tại');
  const r = await calMutate(() => call('POST', `/api/posts/${encodeURIComponent(p.id)}/reschedule`, { scheduledAt: t.toISOString() }), 'Đã đổi giờ đăng');
  if (r) { await calLoad(); render(); }
}
async function calCancel() {
  const p = postById(CAL.openId);
  if (!p) return;
  const ok = await confirmBox({ title: 'Huỷ bài này?', body: `<p><b>${esc(p.topic)}</b><br><small>${esc(p.brandName)} · ${esc(p.channelLabel)} · ${esc(new Date(p.scheduledAt).toLocaleString('vi-VN'))}</small></p><p>Bài sẽ không được đăng nữa; mục chờ duyệt (nếu có) được đóng lại.</p>`, ok: 'Huỷ bài', danger: true });
  if (!ok) return;
  const r = await calMutate(() => call('DELETE', `/api/posts/${encodeURIComponent(p.id)}`), 'Đã huỷ bài');
  if (r) { CAL.openId = null; CAL.edit = null; await calLoad(); render(); }
}
async function calDrop(id, dayStr) {
  const p = postById(id);
  if (!p || !p.movable) return;
  const old = new Date(p.scheduledAt);
  const [y, m, d] = dayStr.split('-').map(Number);
  const t = new Date(y, m - 1, d, old.getHours(), old.getMinutes());
  if (t.getTime() < Date.now() - 60e3) return toast('Không đặt giờ đăng trong quá khứ — chọn ngày/giờ khác trong panel chi tiết');
  if (dKey(t) === dKey(old)) return;
  try { await call('POST', `/api/posts/${encodeURIComponent(id)}/reschedule`, { scheduledAt: t.toISOString() }); toast(`Đã dời sang ${t.toLocaleDateString('vi-VN')} lúc ${hhmm(t)}`); }
  catch (e) { toast(e.message); }
  await calLoad();
  S = await call('GET', '/api/state'); render();
}

// ---------- Trang ----------
function calPaint() {
  const b = document.getElementById('calBody'); if (b) b.innerHTML = calBody();
  const l = document.getElementById('calLabel'); if (l) l.textContent = calLabel();
  calDrawer();
}
function pageSchedule() {
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`;
  const html = `<h1>Lịch đăng</h1><p class="sub">Kéo bài sang ngày khác để đổi giờ, bấm bài để xem trước hoặc sửa. Bài mới và bài sửa nội dung đều phải được Sếp duyệt trước khi đăng.${S.settings.dryRun ? ' <span class="tag dry">Đang chạy thử</span> Bài đến giờ chưa được đăng thật.' : ''}</p>
  ${pkgPanel()}
  <div class="toolbar noprint">
    <div class="row"><button data-cal="prev" aria-label="Trước">‹</button><button data-cal="today">Hôm nay</button><button data-cal="next" aria-label="Sau">›</button><b id="calLabel" style="min-width:150px;text-align:center">${esc(calLabel())}</b></div>
    <div class="seg">${CAL_VIEWS.map(([k, l]) => `<button class="${CAL.view === k ? 'on' : ''}" data-cal="view" data-v="${k}">${l}</button>`).join('')}</div>
    <span class="grow"></span>${S.tiktok && S.tiktok.mode !== 'api' ? '<button data-act="ttbatch" title="Các bài TikTok cần hẹn giờ trên TikTok Studio trong 10 ngày tới, theo từng nick">📅 Lên lịch TikTok</button>' : ''}<button class="pri" data-cal="add">＋ Soạn bài</button>
  </div>
  <div class="toolbar noprint">
    <select data-cal="f-brand" aria-label="Thương hiệu">${opt('', 'Mọi thương hiệu', CAL.brand)}${S.brands.map((b) => opt(b.id, b.name, CAL.brand)).join('')}</select>
    <select data-cal="f-channel" aria-label="Kênh">${opt('', 'Mọi kênh', CAL.channel)}${S.channels.filter((c) => ['facebook_page', 'instagram', 'tiktok', 'xiaohongshu'].includes(c.id)).map((c) => opt(c.id, c.label, CAL.channel)).join('')}</select>
    <select data-cal="f-status" aria-label="Trạng thái">${opt('', 'Mọi trạng thái', CAL.status)}${Object.entries(CAL_ST).map(([k, v]) => opt(k, v[1], CAL.status)).join('')}</select>
    <input class="grow" type="search" id="calSearch" placeholder="Tìm theo chủ đề, nội dung…" value="${esc(CAL.q)}" aria-label="Tìm bài"></div>
  ${legend()}<div id="calBody" style="margin-top:8px">${calBody()}</div>`;
  setTimeout(calLoad, 0);
  return html;
}

// ---------- Sự kiện ----------
let dragId = null;
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-cal]');
  if (!t || ['SELECT', 'INPUT', 'TEXTAREA'].includes(t.tagName)) return;
  const k = t.dataset.cal, d = t.dataset;
  if (k === 'open') { CAL.openId = d.id; CAL.edit = null; calDrawer(); }
  else if (k === 'close') { CAL.openId = null; CAL.edit = null; calDrawer(); }
  else if (k === 'prev' || k === 'next') { calStep(k === 'next' ? 1 : -1); CAL.posts = []; render(); }
  else if (k === 'today') { CAL.date = new Date(); CAL.posts = []; render(); }
  else if (k === 'view') { CAL.view = d.v; CAL.posts = []; render(); }
  else if (k === 'day') { CAL.date = new Date(`${d.day}T12:00:00`); CAL.view = 'day'; CAL.posts = []; render(); }
  else if (k === 'add') { e.stopPropagation(); openCompose(d.day); }
  else if (k === 'reload') calLoad();
  else if (k === 'save') calSave();
  else if (k === 'discard') { CAL.edit = null; calDrawer(); }
  else if (k === 'resched') calResched();
  else if (k === 'cancel') calCancel();
  else if (k === 'pickmedia') pickMedia();
  else if (k === 'rmmedia') { const p = postById(CAL.openId); if (!p) return; const ed = beginEdit(p); ed.media = ed.media.filter((n) => n !== d.name); ed.mediaObjs = ed.mediaObjs.filter((m) => m.name !== d.name); calDrawer(); }
});
document.addEventListener('change', (e) => {
  const k = e.target.dataset.cal;
  if (k === 'f-brand') { CAL.brand = e.target.value; CAL.posts = []; render(); }
  else if (k === 'f-channel') { CAL.channel = e.target.value; CAL.posts = []; render(); }
  else if (k === 'f-status') { CAL.status = e.target.value; CAL.posts = []; render(); }
});
let calTimer = null;
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'calSearch') { CAL.q = t.value; clearTimeout(calTimer); calTimer = setTimeout(calLoad, 350); }
  else if (t.dataset.cal && t.dataset.cal.startsWith('f-') && ['f-topic', 'f-title', 'f-text'].includes(t.dataset.cal)) {
    const p = postById(CAL.openId); if (!p) return;
    beginEdit(p)[t.dataset.cal.slice(2)] = t.value;
  }
});
document.addEventListener('dragstart', (e) => {
  const c = e.target.closest && e.target.closest('.chip[draggable="true"]');
  if (!c) return;
  dragId = c.dataset.id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragId);
});
document.addEventListener('dragover', (e) => {
  const c = e.target.closest && e.target.closest('[data-drop]');
  if (c && dragId) { e.preventDefault(); c.classList.add('over'); }
});
document.addEventListener('dragleave', (e) => { const c = e.target.closest && e.target.closest('.cell'); if (c) c.classList.remove('over'); });
document.addEventListener('drop', (e) => {
  const c = e.target.closest && e.target.closest('[data-drop]');
  document.querySelectorAll('.cell.over').forEach((x) => x.classList.remove('over'));
  if (!c || !dragId) return;
  e.preventDefault();
  const id = dragId; dragId = null;
  calDrop(id, c.dataset.day);
});
document.addEventListener('dragend', () => { dragId = null; document.querySelectorAll('.cell.over').forEach((x) => x.classList.remove('over')); });
