// Trang Lái tự động: danh sách quy trình tự động (trigger · điều kiện · hành động · quyền), bật/tắt, sửa điều kiện,
// chạy thử an toàn, lịch sử và lỗi. Mỗi công tắc/điều kiện ghi thẳng vào cài đặt thật qua /api/automations/*.
// Nạp sau monthplan.js (dùng chung confirmBox, dryNote, call, toast, render, S).
const AU = { data: null, state: 'idle', err: '', group: '', q: '', tab: 'flows', seq: 0, busy: new Set(), sim: null };
const AU_GROUPS = ['Quảng cáo', 'Nội dung', 'Bình luận', 'An toàn'];
const AU_PERM = { auto: ['info', 'Tự động (chỉ tắt/giảm)'], approval: ['dry', 'Chỉ đề xuất — chờ Sếp duyệt'], alert: ['', 'Chỉ cảnh báo — không tắt gì'] };
const auWhen = (t) => (t ? new Date(t).toLocaleString('vi-VN') : '—');
const auNum = (n) => Math.round(n).toLocaleString('vi-VN');
const auTrig = { schedule: 'Tự động', manual: 'Thủ công', simulation: 'Chạy thử an toàn' };

async function auLoad() {
  const seq = ++AU.seq;
  AU.state = AU.data ? 'ok' : 'loading';
  auPaint();
  try { const d = await call('GET', '/api/automations'); if (seq !== AU.seq) return; AU.data = d; AU.state = 'ok'; AU.err = ''; }
  catch (e) { if (seq !== AU.seq) return; AU.state = 'err'; AU.err = e.message; }
  auPaint();
}

function auStatus(w) {
  if (!w.enabled) return '<span class="tag off">Đang tắt</span>';
  if (w.blocked) return `<span class="tag dry">Bị chặn: ${esc(w.blocked)}</span>`;
  return `<span class="tag on">Đang hoạt động${S.settings.dryRun ? ' (chạy thử)' : ''}</span>`;
}
function auCard(w) {
  const perm = AU_PERM[w.permission.mode];
  const busy = AU.busy.has(w.id);
  const lr = w.lastRun;
  const lastTxt = !w.agent ? 'Chạy sau mỗi lần agent chạy' : !lr ? 'Chưa chạy lần nào' : lr.error ? `<span style="color:var(--bad)">Lần chạy cuối ${esc(auWhen(lr.at))}: lỗi — ${esc(lr.error.slice(0, 120))}</span>` : `Lần chạy cuối ${esc(auWhen(lr.at))} · ${lr.changed} thay đổi · ${lr.ms}ms`;
  const conds = w.conditions.length ? `<div class="rule" style="margin:8px 0">${w.conditions.map((c) => c.type === 'bool'
    ? `<label class="f" style="margin:4px 0"><input type="checkbox" data-au="cond" data-id="${esc(w.id)}" data-key="${esc(c.key)}" ${c.value ? 'checked' : ''}> ${esc(c.label)}${c.dangerous ? ' <span class="tag off">rủi ro</span>' : ''}</label>`
    : `<label class="f" style="margin:4px 0">${esc(c.label)} <input type="number" data-au="cond" data-id="${esc(w.id)}" data-key="${esc(c.key)}" value="${c.value}" min="${c.min}" max="${c.max}" step="${c.step}" style="width:130px"> ${esc(c.unit)}</label>`).join('')}</div>` : '';
  return `<div class="card" id="au_${esc(w.id)}" style="${w.effective ? '' : 'opacity:.92'}">
    <div class="row" style="justify-content:space-between;align-items:flex-start">
      <div style="min-width:0"><div class="row"><label class="f" style="margin:0" title="Bật/tắt quy trình"><input type="checkbox" data-au="toggle" data-id="${esc(w.id)}" ${w.enabled ? 'checked' : ''} ${busy ? 'disabled' : ''}></label><h2 style="margin:0">${esc(w.name)}</h2></div>
        <div class="row" style="margin-top:6px"><span class="tag">${esc(w.group)}</span><span class="tag ${perm[0]}">${esc(perm[1])}</span>${auStatus(w)}</div></div>
      <div class="row noprint"><button class="sm" data-au="history" data-id="${esc(w.id)}">Lịch sử</button>${w.simulatable ? `<button class="sm pri" data-au="simulate" data-id="${esc(w.id)}" ${busy || S.settings.paused ? 'disabled' : ''}>${busy ? 'Đang chạy thử…' : 'Chạy thử an toàn'}</button>` : ''}</div></div>
    <p class="sub" style="margin:8px 0">${esc(w.description)}</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;font-size:13px">
      <div><small style="color:var(--mute)">KÍCH HOẠT (trigger)</small><div>${esc(w.trigger)}${w.group === 'An toàn' ? '' : `<br><small style="color:var(--mute)">chu kỳ quét: mỗi ${AU.data.scanMinutes} phút</small>`}</div></div>
      <div><small style="color:var(--mute)">HÀNH ĐỘNG</small><ul style="margin:2px 0 0;padding-left:18px">${w.actions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>
      <div><small style="color:var(--mute)">QUYỀN HẠN</small><div>${esc(w.permission.text)}</div></div></div>
    ${conds}${w.note ? `<p class="sub" style="margin:6px 0 0">${esc(w.note)}</p>` : ''}
    <div class="row" style="margin-top:10px;justify-content:space-between"><small style="color:var(--mute)">${lastTxt}</small><small style="color:var(--mute)">24 giờ qua: <b>${w.activity24h}</b> hành động${w.errors24h ? ` · <span style="color:var(--bad)">${w.errors24h} lần lỗi</span>` : ''}</small></div></div>`;
}

function auBody() {
  if (AU.state === 'loading' || !AU.data) return AU.state === 'err' ? auErr() : '<div class="skel" style="height:260px"></div>';
  if (AU.state === 'err') return auErr();
  const q = AU.q.trim().toLowerCase();
  const list = AU.data.workflows.filter((w) => (!AU.group || w.group === AU.group) && (!q || `${w.name} ${w.description}`.toLowerCase().includes(q)));
  return list.length ? list.map(auCard).join('') : '<div class="card"><div class="state"><b>Không có quy trình nào khớp</b>Thử bỏ bộ lọc.</div></div>';
}
const auErr = () => `<div class="card"><div class="state err"><b>Không tải được danh sách quy trình</b>${esc(AU.err)}<br><button class="sm" data-au="reload">Thử lại</button></div></div>`;
function auPaint() { const el = document.getElementById('auBody'); if (el) el.innerHTML = auBody(); const t = document.getElementById('auTop'); if (t) t.innerHTML = auTop(); }

function auTop() {
  const d = AU.data;
  if (!d) return '';
  const on = d.workflows.filter((w) => w.effective).length;
  return `<div class="kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))">
    <div class="kpi ${d.paused ? 'danger' : ''}"><div class="l">Trạng thái hệ thống</div><div class="v">${d.paused ? 'Đã dừng' : 'Hoạt động'}</div><div class="s">${d.paused ? 'dừng khẩn cấp — không quy trình nào chạy' : d.mode === 'dry' ? 'CHẠY THỬ — chưa tác động Facebook' : 'CHẠY THẬT'}</div></div>
    <div class="kpi"><div class="l">Quy trình đang chạy</div><div class="v">${on}<small style="font-size:13px;color:var(--mute)"> / ${d.workflows.length}</small></div><div class="s">${d.workflows.filter((w) => w.permission.mode === 'approval').length} quy trình chỉ đề xuất</div></div>
    <div class="kpi"><div class="l">Chu kỳ quét</div><div class="v"><input type="number" data-au="scan" value="${d.scanMinutes}" min="5" max="1440" style="width:80px;font-size:18px;font-weight:700"> <small style="font-size:13px;color:var(--mute)">phút</small></div><div class="s">quét lần cuối: ${esc(auWhen(d.lastScan))}</div></div>
    <div class="kpi"><div class="l">Lỗi 24 giờ qua</div><div class="v" style="${d.workflows.some((w) => w.errors24h) ? 'color:var(--bad)' : ''}">${[...new Set(d.workflows.filter((w) => w.agent).map((w) => w.agent))].reduce((s, a) => s + d.workflows.find((w) => w.agent === a).errors24h, 0)}</div><div class="s">lần agent chạy bị lỗi</div></div></div>`;
}

function pageAutopilot() {
  const html = `<h1>Lái tự động</h1><p class="sub">Các quy trình tự động của hệ thống: bật/tắt, chỉnh điều kiện, chạy thử an toàn và xem lịch sử. Quy trình chạm tới tiền, đăng bài hay trả lời khách <b>chỉ đề xuất</b> — luôn chờ Sếp duyệt.</p>
  <div id="auTop">${auTop()}</div>
  <div class="seg" style="margin-bottom:12px"><button class="${AU.tab === 'flows' ? 'on' : ''}" data-au="tab" data-v="flows">Quy trình</button><button class="${AU.tab === 'profiles' ? 'on' : ''}" data-au="tab" data-v="profiles">Hồ sơ nội dung</button></div>
  ${AU.tab === 'profiles' ? pageAutopilotProfiles() : `<div class="toolbar noprint"><div class="seg"><button class="${!AU.group ? 'on' : ''}" data-au="group" data-v="">Tất cả</button>${AU_GROUPS.map((g) => `<button class="${AU.group === g ? 'on' : ''}" data-au="group" data-v="${g}">${g}</button>`).join('')}</div>
    <input class="grow" type="search" id="auSearch" placeholder="Tìm quy trình…" value="${esc(AU.q)}" aria-label="Tìm quy trình"><button class="pri" data-act="scan">⟳ Chạy tất cả ngay</button></div>
    <div id="auBody">${auBody()}</div>`}`;
  setTimeout(auLoad, 0);
  return html;
}

// ---------- Hành động ----------
async function auSave(id, body, okMsg) {
  AU.busy.add(id); auPaint();
  try {
    const r = await call('PUT', `/api/automations/${encodeURIComponent(id)}`, body);
    AU.data.workflows = AU.data.workflows.map((w) => (w.id === id ? r.workflow : w));
    S = await call('GET', '/api/state');
    toast(okMsg);
  } catch (e) { toast(e.message); }
  AU.busy.delete(id);
  await auLoad();
}
async function auToggle(id, on, box) {
  const w = AU.data.workflows.find((x) => x.id === id);
  if (on && w.permission.mode === 'auto' && w.group === 'Quảng cáo') {
    const ok = await confirmBox({ title: `Bật "${w.name}"?`, body: `<p>${esc(w.description)}</p><p>${esc(w.permission.text)}</p>${dryNote()}`, ok: 'Bật quy trình' });
    if (!ok) { box.checked = false; return; }
  }
  await auSave(id, { enabled: on }, on ? 'Đã bật quy trình' : 'Đã tắt quy trình');
}
async function auCond(id, key, el) {
  const w = AU.data.workflows.find((x) => x.id === id);
  const c = w.conditions.find((x) => x.key === key);
  if (c.type === 'bool') {
    if (el.checked && c.dangerous) {
      const ok = await confirmBox({ title: 'Bật tự duyệt bài?', body: '<p class="alert danger"><b>Rủi ro:</b> bài AI soạn sẽ được lên lịch đăng NGAY mà không chờ Sếp duyệt (vẫn không đăng thật nếu "Chạy thử" đang bật). Nên để tắt.</p>', ok: 'Vẫn bật', danger: true });
      if (!ok) { el.checked = false; return; }
    }
    return auSave(id, { conditions: { [key]: el.checked } }, 'Đã lưu điều kiện');
  }
  if (el.value === '' || Number(el.value) === c.value) { el.value = c.value; return; }
  return auSave(id, { conditions: { [key]: Number(el.value) } }, 'Đã lưu điều kiện');
}
async function auSimulate(id) {
  const w = AU.data.workflows.find((x) => x.id === id);
  const warn = w.agent === 'content' ? '<p class="alert">Agent Nội dung có thể gọi AI soạn bài (tốn một ít chi phí AI) và tạo kế hoạch chờ duyệt.</p>' : '';
  const ok = await confirmBox({ title: 'Chạy thử an toàn?', body: `<p>Chạy một lượt <b>cả agent ${esc(w.agent === 'ads' ? 'Quảng cáo' : w.agent === 'content' ? 'Nội dung' : 'Bình luận')}</b> (gồm quy trình này) ở chế độ giả lập.</p><p>Không thao tác nào được gửi ra Facebook (không tắt chiến dịch, không đăng bài, không đổi ngân sách), kể cả khi hệ thống đang ở chế độ chạy thật. Có thể phát sinh <b>đề xuất mới chờ duyệt</b> và dòng nhật ký.</p>${warn}`, ok: 'Chạy thử' });
  if (!ok) return;
  AU.busy.add(id); auPaint();
  try {
    const r = await call('POST', `/api/automations/${encodeURIComponent(id)}/simulate`, {});
    S = await call('GET', '/api/state');
    showSim(w, r);
  } catch (e) { toast(e.message); }
  AU.busy.delete(id);
  await auLoad();
}
function showSim(w, r) {
  const layer = document.getElementById('layer');
  const el = document.createElement('div');
  el.className = 'overlay';
  const rel = r.actions;
  el.innerHTML = `<div class="modal" style="width:620px"><h3>Kết quả chạy thử an toàn</h3>
    <p class="sub" style="margin:0 0 8px">${esc(r.agentName)} · ${r.run.ms}ms · ${r.run.changed} thay đổi giả lập</p>
    ${r.run.error ? `<div class="alert danger"><b>Agent báo lỗi:</b> ${esc(r.run.error)}</div>` : ''}
    <div class="alert"><b>Không có gì được gửi ra ngoài.</b> ${r.relevant ? `Quy trình "${esc(w.name)}" sẽ làm ${r.relevant} việc ở lần chạy thật (liệt kê bên dưới).` : `Quy trình "${esc(w.name)}" không có việc gì để làm lúc này.`}</div>
    <div style="max-height:300px;overflow:auto">${rel.length ? rel.map((a) => `<div class="item"><div><small>${esc(a.text)}</small>${a.rule ? ` <span class="tag ${a.rule === w.rule ? 'info' : ''}">${esc(a.rule)}</span>` : ''}</div><small style="color:var(--mute);white-space:nowrap">${a.dry ? '<span class="tag dry">chạy thử</span>' : ''}</small></div>`).join('') : '<div class="empty">Agent không ghi nhận hành động nào.</div>'}</div>
    <div class="acts"><a href="#duyet"><button type="button">Xem việc chờ duyệt</button></a><button class="pri" data-r="0">Đóng</button></div></div>`;
  const close = () => el.remove();
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-r="0"]') || e.target.closest('a')) close(); });
  layer.appendChild(el);
}
async function auHistory(id) {
  const layer = document.getElementById('layer');
  let el = document.getElementById('auDrawer');
  if (!el) { el = document.createElement('aside'); el.id = 'auDrawer'; el.className = 'drawer'; layer.appendChild(el); }
  el.innerHTML = '<div class="skel" style="height:200px"></div>';
  try {
    const h = await call('GET', `/api/automations/${encodeURIComponent(id)}/history`);
    el.innerHTML = `<div class="hd"><div><h2>${esc(h.name)}</h2><small style="color:var(--mute)">Lịch sử và lỗi</small></div><button class="sm" data-au="close">✕ Đóng</button></div>
      ${h.errors.length ? `<h3>Lỗi gần đây</h3>${h.errors.map((e) => `<div class="alert danger">${esc(e.text)}<small>${esc(auWhen(e.at))}</small></div>`).join('')}` : ''}
      ${h.agent ? `<h3 style="margin-top:12px">Các lần chạy của agent</h3><p class="sub" style="margin:0 0 6px">${esc(h.agentNote)}</p><div class="tablewrap"><table class="tbl"><thead><tr><th>Lúc</th><th>Kiểu</th><th class="num">Thay đổi</th><th>Kết quả</th></tr></thead><tbody>${h.runs.map((r) => `<tr><td>${esc(auWhen(r.at))}</td><td>${esc(auTrig[r.trigger] || r.trigger)}</td><td class="num">${r.changed}</td><td>${r.error ? `<span class="tag off">Lỗi</span> <small>${esc(r.error.slice(0, 80))}</small>` : '<span class="tag on">OK</span>'}</td></tr>`).join('') || '<tr><td colspan="4"><div class="empty">Chưa chạy lần nào.</div></td></tr>'}</tbody></table></div>` : ''}
      <h3 style="margin-top:14px">Hành động của quy trình này</h3>${h.actions.length ? h.actions.map((a) => `<div class="item"><div><small>${esc(a.text)}</small></div><small style="color:var(--mute);white-space:nowrap">${a.dry ? '<span class="tag dry">chạy thử</span> ' : ''}${esc(auWhen(a.at))}</small></div>`).join('') : '<div class="empty">Chưa có hành động nào được ghi nhận.</div>'}`;
  } catch (e) { el.innerHTML = `<div class="hd"><h2>Lịch sử</h2><button class="sm" data-au="close">✕ Đóng</button></div><div class="state err"><b>Không tải được lịch sử</b>${esc(e.message)}</div>`; }
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-au]');
  if (!t || ['SELECT', 'INPUT', 'TEXTAREA'].includes(t.tagName)) return;
  const k = t.dataset.au, id = t.dataset.id;
  if (k === 'tab') { AU.tab = t.dataset.v; render(); }
  else if (k === 'group') { AU.group = t.dataset.v; render(); }
  else if (k === 'reload') auLoad();
  else if (k === 'simulate') auSimulate(id);
  else if (k === 'history') auHistory(id);
  else if (k === 'close') { const d = document.getElementById('auDrawer'); if (d) d.remove(); }
});
document.addEventListener('change', async (e) => {
  const t = e.target, k = t.dataset.au;
  if (!k || !AU.data) return;
  if (k === 'toggle') auToggle(t.dataset.id, t.checked, t);
  else if (k === 'cond') auCond(t.dataset.id, t.dataset.key, t);
  else if (k === 'scan') {
    const v = Math.round(Number(t.value));
    if (!(v >= 5 && v <= 1440)) { toast('Chu kỳ quét từ 5 đến 1440 phút'); t.value = AU.data.scanMinutes; return; }
    try { S = await call('POST', '/api/settings', { scanMinutes: v }); toast('Đã đổi chu kỳ quét'); } catch (err) { toast(err.message); }
    await auLoad();
  }
});
document.addEventListener('input', (e) => { if (e.target.id === 'auSearch') { AU.q = e.target.value; auPaint(); } });
