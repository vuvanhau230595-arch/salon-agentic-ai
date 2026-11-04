// Trang Bài học của AI = kho tri thức: bài học theo nhóm, đề xuất chờ duyệt, quy chuẩn thương hiệu (và đoạn chữ AI thực sự nhận),
// mẫu nội dung hiệu quả (từ quảng cáo thử), lỗi đã xảy ra (từ nhật ký), phản hồi của Sếp. AI chỉ đề xuất — Sếp duyệt mới áp dụng.
// Nạp sau media.js (dùng chung call, toast, render, S, esc, confirmBox).
const KB = { tab: 'lessons', data: null, state: 'idle', err: '', seq: 0, q: '', cat: '', scope: '', status: '', open: new Set(), sel: new Set(), busy: false, form: { text: '', scope: 'all', category: 'rule', evidence: '' } };
const KB_TABS = [['lessons', 'Bài học'], ['pending', 'Chờ duyệt'], ['standards', 'Quy chuẩn thương hiệu'], ['effective', 'Mẫu hiệu quả'], ['errors', 'Lỗi đã xảy ra'], ['feedback', 'Phản hồi của Sếp']];
const KB_SRC = { manual: 'Sếp thêm', auto: 'Rút từ số liệu', ai: 'AI đề xuất', ads: 'Từ kết quả quảng cáo' };
const KB_ST = { active: ['on', 'Đang áp dụng'], pending: ['dry', 'Chờ duyệt'], disabled: ['off', 'Đã tắt'] };
const kbWhen = (t) => (t ? new Date(t).toLocaleString('vi-VN') : '—');
const kbScope = (s) => (s === 'all' ? 'Tất cả thương hiệu' : (S.brands.find((b) => b.id === s) || {}).name || s);

async function kbLoad() {
  const seq = ++KB.seq;
  KB.state = KB.data ? 'ok' : 'loading';
  kbPaint();
  try { const d = await call('GET', '/api/knowledge'); if (seq !== KB.seq) return; KB.data = d; KB.state = 'ok'; KB.err = ''; }
  catch (e) { if (seq !== KB.seq) return; KB.state = 'err'; KB.err = e.message; }
  kbPaint();
}
const kbFind = (id) => (KB.data ? KB.data.lessons.find((l) => l.id === id) : null);

// Hộp nhập văn bản (thay prompt): trả về chuỗi hoặc null nếu huỷ
function kbAsk({ title, label, value = '', ok = 'Lưu', hint = '' }) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'overlay';
    el.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h3>${esc(title)}</h3>${hint ? `<p class="sub" style="margin:0 0 8px">${esc(hint)}</p>` : ''}<label style="display:block">${esc(label)}<textarea id="kbAskText" rows="4" maxlength="300" style="width:100%;margin-top:4px">${esc(value)}</textarea></label><div class="acts"><button data-r="0">Huỷ</button><button class="pri" data-r="1">${esc(ok)}</button></div></div>`;
    const close = (v) => { el.remove(); resolve(v); };
    el.addEventListener('click', (e) => { const r = e.target.closest('[data-r]'); if (r) close(r.dataset.r === '1' ? el.querySelector('#kbAskText').value.trim() : null); else if (e.target === el) close(null); });
    document.getElementById('layer').appendChild(el);
    el.querySelector('#kbAskText').focus();
  });
}

// ---------- Danh sách bài học ----------
function kbFiltered(list) {
  const q = KB.q.trim().toLowerCase();
  return list.filter((l) => (!KB.cat || l.category === KB.cat) && (!KB.scope || l.scope === KB.scope) && (!KB.status || l.status === KB.status) && (!q || `${l.text} ${l.evidence}`.toLowerCase().includes(q)));
}
function kbItem(l, withSel = true) {
  const st = KB_ST[l.status], open = KB.open.has(l.id);
  const cats = KB.data.categories;
  const acts = l.status === 'pending'
    ? `<button class="sm pri" data-kb="on" data-id="${esc(l.id)}">Duyệt & áp dụng</button><button class="sm danger" data-kb="del" data-id="${esc(l.id)}">Bỏ</button>`
    : `<button class="sm" data-kb="edit" data-id="${esc(l.id)}">Sửa</button><button class="sm ${l.status === 'active' ? 'danger' : 'pri'}" data-kb="${l.status === 'active' ? 'off' : 'on'}" data-id="${esc(l.id)}">${l.status === 'active' ? 'Tạm tắt' : 'Bật lại'}</button><button class="sm danger" data-kb="del" data-id="${esc(l.id)}">Xoá</button>`;
  return `<div class="item" style="align-items:flex-start">${withSel ? `<input type="checkbox" data-kb="pick" data-id="${esc(l.id)}" ${KB.sel.has(l.id) ? 'checked' : ''} aria-label="Chọn" style="margin-top:4px">` : ''}
    <div style="flex:1;min-width:0"><b>${esc(l.text)}</b>
      <div class="row" style="gap:4px;margin:4px 0"><span class="tag info">${esc(cats[l.category] || l.category)}</span><span class="tag">${esc(kbScope(l.scope))}</span><span class="tag">${esc(KB_SRC[l.source] || l.source)}</span><span class="tag ${st[0]}">${st[1]}</span>
        ${l.status === 'active' ? `<span class="tag" title="Số lần được đưa vào lời nhắc AI">${l.uses.count ? `dùng ${l.uses.count} lần` : 'chưa được dùng'}</span>` : ''}</div>
      ${l.evidence ? `<p style="margin:2px 0;font-size:13px">📎 ${esc(l.evidence)}</p>` : ''}
      <small style="color:var(--mute)">Tạo ${esc(kbWhen(l.createdAt))}${l.uses.last ? ` · dùng lần cuối ${esc(kbWhen(l.uses.last))}` : ''} · <a href="#" data-kb="hist" data-id="${esc(l.id)}">${open ? 'Ẩn lịch sử' : `Lịch sử (${l.history.length})`}</a></small>
      ${open ? `<div style="margin-top:6px;background:var(--soft);border-radius:8px;padding:6px 10px">${l.history.map((h) => `<div style="font-size:12px"><b>${esc(kbWhen(h.at))}</b> · ${esc(h.by)}: ${esc(h.what)}</div>`).join('') || '<small>Chưa có lịch sử.</small>'}</div>` : ''}</div>
    <div class="row noprint" style="flex-wrap:nowrap">${acts}</div></div>`;
}
function kbBulk() {
  if (!KB.sel.size) return '';
  return `<div class="card" style="position:sticky;top:60px;z-index:15;border-color:var(--brand)"><div class="row" style="justify-content:space-between"><b>Đã chọn ${KB.sel.size} bài học</b><span class="row"><button class="pri sm" data-kb="bulk-activate">Duyệt / bật</button><button class="sm" data-kb="bulk-disable">Tắt</button><button class="sm danger" data-kb="bulk-delete">Xoá</button><button class="sm" data-kb="sel-clear">Bỏ chọn</button></span></div></div>`;
}
function kbLessons() {
  const d = KB.data, list = kbFiltered(d.lessons.filter((l) => l.status !== 'pending' || KB.status === 'pending'));
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`;
  return `<div class="card"><h2>Thêm bài học</h2>
    <div class="row"><input type="text" data-kb="f-text" value="${esc(KB.form.text)}" maxlength="300" placeholder='VD: Không dùng quá 2 emoji; luôn mời khách nhắn tin đặt lịch' style="flex:1;min-width:260px">
      <select data-kb="f-category">${Object.entries(d.categories).map(([k, l]) => opt(k, l, KB.form.category)).join('')}</select>
      <select data-kb="f-scope">${opt('all', 'Tất cả thương hiệu', KB.form.scope)}${S.brands.map((b) => opt(b.id, b.name, KB.form.scope)).join('')}</select></div>
    <div class="row" style="margin-top:6px"><input type="text" data-kb="f-evidence" value="${esc(KB.form.evidence)}" maxlength="300" placeholder="Bằng chứng / lý do (không bắt buộc): số liệu, ngày, nguồn…" style="flex:1;min-width:260px"><button class="pri" data-kb="add" ${KB.busy ? 'disabled' : ''}>+ Thêm (áp dụng ngay)</button></div>
    <p class="sub" style="margin:6px 0 0">Bài học Sếp thêm áp dụng ngay. Bài do AI hoặc số liệu đề xuất luôn nằm ở "Chờ duyệt" cho tới khi Sếp duyệt. Bài học chỉ định hướng cách VIẾT nội dung — không đổi luật quảng cáo hay ngân sách.</p></div>
    <div class="card"><div class="row" style="justify-content:space-between"><div><h2 style="margin:0">Để agent tự rút bài học</h2><span style="color:var(--mute)">Đã ghi nhận ${d.feedbackTotal} lần Sếp bỏ/sửa nội dung. ${d.hasAi ? 'AI (Claude) sẽ phân tích.' : 'Chưa có ANTHROPIC_API_KEY nên chỉ rút theo số liệu đơn giản.'} Kết quả luôn vào "Chờ duyệt".</span></div><button class="pri" data-kb="suggest" ${KB.busy ? 'disabled' : ''}>✦ Rút bài học</button></div></div>
    <div class="toolbar noprint"><input class="grow" type="search" id="kbSearch" placeholder="Tìm trong bài học và bằng chứng…" value="${esc(KB.q)}" aria-label="Tìm bài học">
      <select data-kb="v-cat" aria-label="Nhóm">${opt('', 'Mọi nhóm', KB.cat)}${Object.entries(d.categories).map(([k, l]) => opt(k, `${l} (${d.counts.byCategory[k] || 0})`, KB.cat)).join('')}</select>
      <select data-kb="v-scope" aria-label="Phạm vi">${opt('', 'Mọi phạm vi', KB.scope)}${opt('all', 'Tất cả thương hiệu', KB.scope)}${S.brands.map((b) => opt(b.id, b.name, KB.scope)).join('')}</select>
      <select data-kb="v-status" aria-label="Trạng thái">${opt('', 'Đang áp dụng & đã tắt', KB.status)}${opt('active', 'Đang áp dụng', KB.status)}${opt('disabled', 'Đã tắt', KB.status)}</select></div>
    ${kbBulk()}<div class="card">${list.length ? list.map((l) => kbItem(l)).join('') : `<div class="state"><b>${d.lessons.length ? 'Không có bài học nào khớp bộ lọc' : 'Chưa có bài học nào'}</b>${d.lessons.length ? 'Thử bỏ bớt bộ lọc.' : 'Thêm bài học ở trên hoặc bấm "Rút bài học".'}</div>`}</div>`;
}
function kbPending() {
  const list = KB.data.lessons.filter((l) => l.status === 'pending');
  return `<p class="sub">Các đề xuất do AI, số liệu quảng cáo hoặc luật tự động tạo ra. <b>Chưa được đưa vào lời nhắc AI</b> cho tới khi Sếp duyệt.</p>${kbBulk()}
    <div class="card">${list.length ? list.map((l) => kbItem(l)).join('') : '<div class="state"><b>Không có đề xuất nào chờ duyệt</b>Khi AI rút bài học hoặc quảng cáo thử có kết quả, đề xuất sẽ xuất hiện ở đây.</div>'}</div>`;
}

// ---------- Quy chuẩn thương hiệu ----------
function kbStandards() {
  const F = [['tone', 'Giọng văn'], ['avoid', 'Điều không được nói'], ['hashtags', 'Hashtag ưu tiên'], ['tagline', 'Khẩu hiệu'], ['services', 'Dịch vụ chính']];
  return `<p class="sub">Quy chuẩn lấy từ hồ sơ từng thương hiệu và được đưa vào lời nhắc mỗi lần AI viết bài/trả lời. Sửa ở trang <a href="#thuonghieu">Thương hiệu & Kênh</a>.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;align-items:start">${KB.data.standards.map((b) => `<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">${esc(b.name)}</h2><span class="tag ${b.filled === b.total ? 'on' : b.filled >= 3 ? 'dry' : 'off'}">${b.filled}/${b.total} mục</span></div>
      ${F.map(([k, l]) => `<div style="margin:8px 0"><small style="color:var(--mute)">${l}</small><div>${b[k] ? esc(b[k]) : '<span style="color:var(--bad)">— chưa có —</span>'}</div></div>`).join('')}
      <div class="row" style="justify-content:space-between"><small>${b.activeLessons} bài học riêng đang áp dụng</small><button class="sm" data-kb="preview" data-id="${esc(b.id)}">Xem lời nhắc AI nhận được</button></div></div>`).join('')}</div>`;
}

// ---------- Mẫu hiệu quả ----------
function kbEffective() {
  const list = KB.data.effective;
  return `<p class="sub">Bài đăng chạy thử quảng cáo và <b>đạt</b> ngưỡng giá/tin nhắn của thương hiệu. Lưu thành bài học để AI làm thêm nội dung cùng kiểu (cần Sếp xác nhận nội dung).</p>
    <div class="tablewrap"><table class="tbl"><thead><tr><th>Bài</th><th>Thương hiệu</th><th class="num">Chi</th><th class="num">Tin nhắn</th><th class="num">Giá/tin</th><th>Kết thúc</th><th></th></tr></thead><tbody>${list.map((e) => `<tr><td><b>${esc(e.topic)}</b></td><td>${esc(e.brandName)}</td><td class="num">${vnd(e.spend)}</td><td class="num">${e.msgs}</td><td class="num">${e.cpl === null ? '—' : vnd(e.cpl)}</td><td>${esc(kbWhen(e.at))}</td><td class="num">${e.saved ? '<span class="tag on">Đã lưu</span>' : `<button class="sm pri" data-kb="save-effective" data-id="${esc(e.id)}">Lưu thành bài học</button>`}</td></tr>`).join('') || '<tr><td colspan="7"><div class="state"><b>Chưa có mẫu hiệu quả</b>Bật "Quảng cáo thử bài mới" ở trang Quảng cáo; bài nào đạt ngưỡng sẽ hiện ở đây.</div></td></tr>'}</tbody></table></div>`;
}

// ---------- Lỗi đã xảy ra ----------
function kbErrors() {
  const list = KB.data.errors;
  return `<p class="sub">Lỗi lặp lại trong 30 ngày qua (từ Nhật ký, gộp các lỗi giống nhau). Ghi thành bài học để cả Sếp và AI nhớ cách tránh.</p>
    <div class="tablewrap"><table class="tbl"><thead><tr><th>Lỗi</th><th class="num">Số lần</th><th>Lần đầu</th><th>Gần nhất</th><th></th></tr></thead><tbody>${list.map((e, i) => `<tr><td style="max-width:460px;word-break:break-word">${esc(e.text)}</td><td class="num"><b>${e.count}</b></td><td>${esc(kbWhen(e.firstAt))}</td><td>${esc(kbWhen(e.lastAt))}</td><td class="num">${e.saved ? '<span class="tag on">Đã ghi</span>' : `<button class="sm" data-kb="save-error" data-i="${i}">Ghi thành bài học</button>`}</td></tr>`).join('') || '<tr><td colspan="5"><div class="state"><b>Không có lỗi nào trong 30 ngày qua</b></div></td></tr>'}</tbody></table></div>
    <p class="sub" style="margin:8px 0 0"><a href="#nhatky">Xem toàn bộ trong Nhật ký →</a></p>`;
}

// ---------- Phản hồi của Sếp ----------
function kbFeedback() {
  const d = KB.data, lab = { reject: 'Bỏ qua', edit: 'Sửa bài' };
  return `<div class="row" style="justify-content:space-between;margin-bottom:8px"><p class="sub" style="margin:0">Khi Sếp bỏ chọn bài, bỏ qua đề xuất hoặc sửa bài AI soạn, hệ thống ghi lại để rút bài học. Tổng ${d.feedbackTotal} lần.</p><button class="pri" data-kb="suggest" ${KB.busy ? 'disabled' : ''}>✦ Rút bài học</button></div>
    <div class="tablewrap"><table class="tbl"><thead><tr><th>Thời gian</th><th>Loại</th><th>Thương hiệu</th><th>Chủ đề</th><th>Nội dung đổi</th></tr></thead><tbody>${d.feedback.map((e) => `<tr><td style="white-space:nowrap">${esc(kbWhen(e.at))}</td><td>${esc(lab[e.type] || e.type)}</td><td>${e.brand ? esc(kbScope(e.brand)) : '—'}</td><td>${esc(e.topic || '')}</td><td style="max-width:320px"><small>${e.before ? `<s>${esc(e.before.slice(0, 80))}</s><br>→ ${esc((e.after || '').slice(0, 80))}` : ''}</small></td></tr>`).join('') || '<tr><td colspan="5"><div class="state"><b>Chưa có phản hồi nào</b></div></td></tr>'}</tbody></table></div>`;
}

function kbBody() {
  if (KB.state === 'err' && !KB.data) return `<div class="card"><div class="state err"><b>Không tải được kho tri thức</b>${esc(KB.err)}<br><button class="sm" data-kb="reload">Thử lại</button></div></div>`;
  if (!KB.data) return '<div class="skel" style="height:260px"></div>';
  const c = KB.data.counts;
  const k = (l, v, s, cls = '') => `<div class="kpi ${cls}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  return `<div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">${k('Tổng bài học', c.total, 'đã lưu')}${k('Đang áp dụng', c.active, 'đưa vào lời nhắc AI')}${k('Chờ duyệt', c.pending, c.pending ? 'cần Sếp xử lý' : 'không có', c.pending ? 'danger' : '')}${k('Đã tắt', c.disabled, 'không dùng')}${k('Phản hồi của Sếp', KB.data.feedbackTotal, 'lần bỏ/sửa nội dung')}</div>
    <div class="seg" style="margin-bottom:12px;flex-wrap:wrap">${KB_TABS.map(([k2, l]) => `<button class="${KB.tab === k2 ? 'on' : ''}" data-kb="tab" data-v="${k2}">${l}${k2 === 'pending' && c.pending ? ` (${c.pending})` : ''}</button>`).join('')}</div>
    ${{ lessons: kbLessons, pending: kbPending, standards: kbStandards, effective: kbEffective, errors: kbErrors, feedback: kbFeedback }[KB.tab]()}`;
}
function kbPaint() { const el = document.getElementById('kbBody'); if (el) el.innerHTML = kbBody(); }

function pageLessons() {
  const html = `<h1>Bài học của AI</h1><p class="sub">Kho tri thức của AI: quy chuẩn thương hiệu, mẫu nội dung hiệu quả, kinh nghiệm quảng cáo, lỗi đã xảy ra, phản hồi của Sếp. <b>AI chỉ đề xuất</b> — chỉ bài học Sếp duyệt mới được đưa vào lời nhắc.</p><div id="kbBody">${kbBody()}</div>`;
  setTimeout(kbLoad, 0);
  return html;
}

// ---------- Hành động ----------
async function kbCall(fn, okMsg) {
  KB.busy = true; kbPaint();
  try { const r = await fn(); if (okMsg) toast(okMsg); KB.busy = false; await kbLoad(); S = await call('GET', '/api/state'); return r; }
  catch (e) { toast(e.message); KB.busy = false; kbPaint(); return null; }
}
async function kbBulkDo(action) {
  const ids = [...KB.sel];
  const n = ids.length;
  const verb = { activate: 'Duyệt / bật', disable: 'Tắt', delete: 'Xoá' }[action];
  if (!(await confirmBox({ title: `${verb} ${n} bài học?`, body: `<ul style="margin:6px 0;padding-left:18px;max-height:180px;overflow:auto">${ids.slice(0, 10).map((id) => `<li>${esc((kbFind(id) || {}).text || id)}</li>`).join('')}${n > 10 ? `<li>… và ${n - 10} bài khác</li>` : ''}</ul>${action === 'activate' ? '<p class="sub">Bài được bật sẽ được đưa vào lời nhắc AI.</p>' : ''}`, ok: `${verb} ${n} bài`, danger: action === 'delete' }))) return;
  const r = await kbCall(() => call('POST', '/api/knowledge/bulk', { ids, action }));
  if (r) { const bad = r.results.filter((x) => !x.ok); toast(bad.length ? `${r.results.length - bad.length}/${r.results.length} bài thành công. Lỗi: ${bad[0].error}` : `Đã ${verb.toLowerCase()} ${n} bài học`); KB.sel.clear(); kbPaint(); }
}
async function kbPreview(brand) {
  try {
    const r = await call('GET', `/api/knowledge/preview?brand=${encodeURIComponent(brand)}`);
    const el = document.createElement('div');
    el.className = 'overlay';
    el.innerHTML = `<div class="modal" style="width:640px"><h3>Lời nhắc AI nhận được — ${esc(r.name)}</h3><p class="sub" style="margin:0 0 6px">Đây là phần hồ sơ + bài học đang áp dụng được ghép vào mỗi lần AI viết cho thương hiệu này (${r.activeLessons} bài học).</p><pre class="ai" style="max-height:340px;overflow:auto;font-size:13px">${esc(r.text || '(trống — chưa có hồ sơ hay bài học nào)')}</pre><div class="acts"><button class="pri" data-r="0">Đóng</button></div></div>`;
    el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-r="0"]')) el.remove(); });
    document.getElementById('layer').appendChild(el);
  } catch (e) { toast(e.message); }
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-kb]');
  if (!t || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) return;
  const k = t.dataset.kb, id = t.dataset.id;
  if (k === 'hist') { e.preventDefault(); KB.open.has(id) ? KB.open.delete(id) : KB.open.add(id); kbPaint(); return; }
  if (k === 'tab') { KB.tab = t.dataset.v; KB.sel.clear(); kbPaint(); }
  else if (k === 'reload') kbLoad();
  else if (!KB.data) return;
  else if (k === 'sel-clear') { KB.sel.clear(); kbPaint(); }
  else if (k === 'bulk-activate') kbBulkDo('activate');
  else if (k === 'bulk-disable') kbBulkDo('disable');
  else if (k === 'bulk-delete') kbBulkDo('delete');
  else if (k === 'add') {
    if (!KB.form.text.trim()) return toast('Nhập nội dung bài học');
    const r = await kbCall(() => call('POST', '/api/lessons', { text: KB.form.text, scope: KB.form.scope, category: KB.form.category, evidence: KB.form.evidence }), 'Đã thêm bài học — đang áp dụng');
    if (r) { KB.form.text = ''; KB.form.evidence = ''; kbPaint(); }
  }
  else if (k === 'suggest') { toast('Đang rút bài học…'); const r = await kbCall(() => call('POST', '/api/lessons/suggest', {})); if (r && r.suggest) toast(r.suggest.added ? `Đã rút ${r.suggest.added} bài học mới — vào "Chờ duyệt"` : (r.suggest.reason || 'Không có bài học mới')); }
  else if (k === 'on') kbCall(() => call('PUT', `/api/lessons/${encodeURIComponent(id)}`, { status: 'active' }), 'Đã duyệt — bài học đang áp dụng');
  else if (k === 'off') kbCall(() => call('PUT', `/api/lessons/${encodeURIComponent(id)}`, { status: 'disabled' }), 'Đã tắt bài học');
  else if (k === 'del') {
    const l = kbFind(id);
    if (await confirmBox({ title: l && l.status === 'pending' ? 'Bỏ đề xuất này?' : 'Xoá bài học?', body: `<p>${esc(l ? l.text : '')}</p>`, ok: l && l.status === 'pending' ? 'Bỏ' : 'Xoá', danger: true })) kbCall(() => call('DELETE', `/api/lessons/${encodeURIComponent(id)}`), 'Đã xoá');
  }
  else if (k === 'edit') {
    const l = kbFind(id);
    const text = await kbAsk({ title: 'Sửa bài học', label: 'Nội dung', value: l.text });
    if (text && text !== l.text) kbCall(() => call('PUT', `/api/lessons/${encodeURIComponent(id)}`, { text }), 'Đã sửa bài học');
  }
  else if (k === 'preview') kbPreview(id);
  else if (k === 'save-effective') {
    const x = KB.data.effective.find((v) => v.id === id);
    const text = await kbAsk({ title: 'Lưu thành bài học', label: 'Nội dung bài học (sửa nếu cần)', value: `Nội dung kiểu "${x.topic}" chạy thử quảng cáo đạt (${x.cpl ? vnd(x.cpl) : '—'}/tin nhắn) — làm thêm nội dung cùng kiểu.`, ok: 'Lưu & áp dụng', hint: 'Bài học Sếp lưu sẽ áp dụng ngay cho thương hiệu này.' });
    if (text) kbCall(() => call('POST', '/api/lessons', { text, scope: x.brand, category: 'content', evidence: `Quảng cáo thử ${x.id}: chi ${vnd(x.spend)}, ${x.msgs} tin, ${x.cpl ? vnd(x.cpl) + '/tin' : ''}` }), 'Đã lưu thành bài học');
  }
  else if (k === 'save-error') {
    const x = KB.data.errors[Number(t.dataset.i)];
    const text = await kbAsk({ title: 'Ghi lỗi thành bài học', label: 'Bài học rút ra (cách tránh / cách xử lý)', value: '', ok: 'Lưu & áp dụng', hint: `Lỗi: ${x.text.slice(0, 160)}` });
    if (text) kbCall(() => call('POST', '/api/lessons', { text, scope: 'all', category: 'mistake', evidence: `Lỗi lặp ${x.count} lần (30 ngày): ${x.key.slice(0, 120)}` }), 'Đã ghi thành bài học');
  }
});
document.addEventListener('change', (e) => {
  const t = e.target, k = t.dataset.kb;
  if (!k) return;
  if (k === 'pick') { t.checked ? KB.sel.add(t.dataset.id) : KB.sel.delete(t.dataset.id); kbPaint(); }
  else if (k === 'f-category') KB.form.category = t.value;
  else if (k === 'f-scope') KB.form.scope = t.value;
  else if (k === 'v-cat') { KB.cat = t.value; kbPaint(); }
  else if (k === 'v-scope') { KB.scope = t.value; kbPaint(); }
  else if (k === 'v-status') { KB.status = t.value; kbPaint(); }
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.kb === 'f-text') KB.form.text = t.value;
  else if (t.dataset.kb === 'f-evidence') KB.form.evidence = t.value;
  else if (t.id === 'kbSearch') { KB.q = t.value; const pos = t.selectionStart; kbPaint(); const s = document.getElementById('kbSearch'); if (s) { s.focus(); s.setSelectionRange(pos, pos); } }
});
