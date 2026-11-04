// Trang Agent & Tác vụ: hồ sơ từng agent (mục tiêu, phạm vi quyền, công cụ, lượng AI), chạy / chạy thử an toàn / tạm dừng,
// danh sách tác vụ (mỗi lần agent chạy) và báo cáo do Agent Báo cáo tạo. Agent chưa có thật hiển thị "chưa khả dụng" kèm lý do.
// Nạp sau automation.js (dùng chung confirmBox, dryNote, call, toast, render, S, vShort).
const AG = {
  tab: 'agents', data: null, state: 'idle', err: '', seq: 0, busy: new Set(), detail: null,
  tasks: { agent: '', status: '', trigger: '', offset: 0, per: 15, data: null, state: 'idle', err: '' },
  reports: { list: null, state: 'idle', err: '', open: null, busy: false }, poll: null,
};
const AG_STATUS = { on: 'on', running: 'info', off: 'off', autopaused: 'off', paused_all: 'off', unavailable: '' };
const AG_TRIG = { schedule: 'Tự động', manual: 'Thủ công', simulation: 'Chạy thử an toàn' };
const agWhen = (t) => (t ? new Date(t).toLocaleString('vi-VN') : '—');
const agTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' tr' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n));

async function agLoad() {
  const seq = ++AG.seq;
  AG.state = AG.data ? 'ok' : 'loading';
  agPaint();
  try { const d = await call('GET', '/api/agent-center'); if (seq !== AG.seq) return; AG.data = d; AG.state = 'ok'; AG.err = ''; }
  catch (e) { if (seq !== AG.seq) return; AG.state = 'err'; AG.err = e.message; }
  agPaint();
  clearTimeout(AG.poll);
  if (AG.data && AG.data.agents.some((a) => a.status.code === 'running')) AG.poll = setTimeout(agLoad, 3000); // đang chạy: tự cập nhật
}
async function agLoadTasks() {
  const t = AG.tasks;
  t.state = t.data ? 'ok' : 'loading'; agPaint();
  try {
    const qs = new URLSearchParams({ limit: t.per, offset: t.offset, ...(t.agent ? { agent: t.agent } : {}), ...(t.status ? { status: t.status } : {}), ...(t.trigger ? { trigger: t.trigger } : {}) });
    t.data = await call('GET', '/api/tasks?' + qs); t.state = 'ok'; t.err = '';
  } catch (e) { t.state = 'err'; t.err = e.message; }
  agPaint();
}
async function agLoadReports() {
  const r = AG.reports;
  r.state = r.list ? 'ok' : 'loading'; agPaint();
  try { r.list = (await call('GET', '/api/reports')).reports; r.state = 'ok'; r.err = ''; }
  catch (e) { r.state = 'err'; r.err = e.message; }
  agPaint();
}

// ---------- Tab Agent ----------
function agCard(a) {
  const code = a.status.code;
  const busy = AG.busy.has(a.id);
  if (!a.available) {
    return `<div class="card" style="opacity:.8"><div class="row" style="justify-content:space-between"><h2 style="margin:0">${esc(a.name)}</h2><span class="tag">Chưa khả dụng</span></div>
      <small style="color:var(--mute)">${esc(a.vi)}</small><p style="margin:8px 0"><b>Mục tiêu dự kiến:</b> ${esc(a.goal)}</p><div class="alert">${esc(a.unavailable)}</div></div>`;
  }
  const lr = a.lastRun;
  const last = !lr ? 'Chưa chạy lần nào' : lr.error ? `<span style="color:var(--bad)">Lần cuối ${esc(agWhen(lr.at))}: lỗi — ${esc(lr.error.slice(0, 100))}</span>` : `Lần cuối ${esc(agWhen(lr.at))} · ${lr.changed} thay đổi · ${lr.ms}ms`;
  const canRun = ['on', 'off', 'autopaused'].includes(code) && !busy;
  return `<div class="card">
    <div class="row" style="justify-content:space-between;align-items:flex-start"><div><h2 style="margin:0">${esc(a.name)}</h2><small style="color:var(--mute)">${esc(a.vi)}</small></div>
      <span class="tag ${AG_STATUS[code]}">${esc(a.status.text)}</span></div>
    <p style="margin:8px 0">${esc(a.goal)}</p>
    <div class="row" style="gap:6px;margin-bottom:6px">${a.tools.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
    <details style="margin:6px 0"><summary style="cursor:pointer;color:var(--brand)">Phạm vi quyền</summary>
      <div style="font-size:13px;margin-top:6px"><b>Đọc:</b> ${a.reads.map(esc).join('; ')}<br><b>Ghi / thực hiện:</b> ${a.writes.map(esc).join('; ')}<br><b style="color:var(--bad)">Không bao giờ:</b> ${a.never.map(esc).join('; ')}</div></details>
    ${code === 'autopaused' ? '<div class="alert danger">Agent đã tự tắt vì lỗi liên tiếp. Xử lý nguyên nhân (ví dụ token Meta) rồi bấm "Bật".</div>' : ''}
    <div class="kv" style="grid-template-columns:repeat(4,1fr)"><div><small>Chạy 24h</small><b>${a.runs24h}</b>${a.errors24h ? `<br><small style="color:var(--bad)">${a.errors24h} lỗi</small>` : ''}</div>
      <div><small>Chờ duyệt</small><b>${a.pendingApprovals ? `<a href="#duyet">${a.pendingApprovals}</a>` : '0'}</b></div>
      <div><small>AI 7 ngày</small><b>${a.aiUsage7d.calls} lần</b><br><small>${agTok(a.aiUsage7d.in + a.aiUsage7d.out)} token</small></div>
      <div><small>Quy trình</small><b><a href="#laitudong">${a.workflows.length}</a></b></div></div>
    <small style="color:var(--mute)">${last}</small>
    <div class="row noprint" style="margin-top:10px">
      <button class="pri" data-ag="run" data-id="${esc(a.engine)}" ${canRun ? '' : 'disabled'}>${busy ? 'Đang chạy…' : '▶ Chạy ngay'}</button>
      ${a.simulatable ? `<button data-ag="sim" data-id="${esc(a.engine)}" ${['on', 'off', 'autopaused'].includes(code) && !busy ? '' : 'disabled'}>Chạy thử an toàn</button>` : ''}
      <button class="${a.on ? 'danger' : ''}" data-ag="toggle" data-id="${esc(a.engine)}" data-on="${a.on ? '0' : '1'}" ${busy ? 'disabled' : ''}>${a.on ? '⏸ Tạm dừng' : '▶ Bật'}</button>
      <button data-ag="detail" data-id="${esc(a.id)}">Chi tiết</button></div></div>`;
}
function agAgents() {
  if (AG.state === 'err' && !AG.data) return `<div class="card"><div class="state err"><b>Không tải được danh sách agent</b>${esc(AG.err)}<br><button class="sm" data-ag="reload">Thử lại</button></div></div>`;
  if (!AG.data) return '<div class="skel" style="height:240px"></div>';
  const d = AG.data, real = d.agents.filter((a) => a.available);
  const sum = (k) => real.reduce((s, a) => s + (a[k] || 0), 0);
  const ai = real.reduce((s, a) => s + a.aiUsage7d.calls, 0);
  return `<div class="kpis" style="grid-template-columns:repeat(5,minmax(0,1fr))">
    <div class="kpi ${d.paused ? 'danger' : ''}"><div class="l">Hệ thống</div><div class="v">${d.paused ? 'Đã dừng' : 'Hoạt động'}</div><div class="s">${d.paused ? 'dừng khẩn cấp' : d.mode === 'dry' ? 'chạy thử — chưa tác động ngoài' : 'chạy thật'}</div></div>
    <div class="kpi"><div class="l">Agent đang bật</div><div class="v">${real.filter((a) => a.on).length}<small style="font-size:13px;color:var(--mute)"> / ${real.length}</small></div><div class="s">${d.agents.length - real.length} agent chưa khả dụng</div></div>
    <div class="kpi"><div class="l">Lần chạy 24h</div><div class="v">${sum('runs24h')}</div><div class="s" style="${sum('errors24h') ? 'color:var(--bad)' : ''}">${sum('errors24h')} lỗi</div></div>
    <div class="kpi"><div class="l">Chờ Sếp duyệt</div><div class="v"><a href="#duyet" style="color:inherit;text-decoration:none">${sum('pendingApprovals')}</a></div><div class="s">việc do agent tạo</div></div>
    <div class="kpi"><div class="l">AI 7 ngày</div><div class="v">${ai}</div><div class="s">${d.hasAiKey ? 'lần gọi AI' : 'chưa có khoá AI'}</div></div></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:14px;align-items:start">${d.agents.map(agCard).join('')}</div>`;
}

// ---------- Tab Tác vụ ----------
function agTasks() {
  const t = AG.tasks;
  const names = AG.data ? AG.data.agents.filter((a) => a.available).map((a) => [a.engine, a.name]) : [];
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`;
  let body;
  if (t.state === 'err') body = `<div class="state err"><b>Không tải được tác vụ</b>${esc(t.err)}<br><button class="sm" data-ag="reload-tasks">Thử lại</button></div>`;
  else if (!t.data) body = '<div class="skel" style="height:200px"></div>';
  else {
    const pages = Math.max(1, Math.ceil(t.data.total / t.per)), page = Math.floor(t.offset / t.per) + 1;
    body = `<div class="tablewrap"><table class="tbl"><thead><tr><th>Thời gian</th><th>Agent</th><th>Kiểu chạy</th><th class="num">Thời lượng</th><th class="num">Thay đổi</th><th>Kết quả</th></tr></thead><tbody>${t.data.rows.map((r) => `<tr><td style="white-space:nowrap">${esc(agWhen(r.at))}</td><td>${esc(r.agentName)}</td><td>${esc(AG_TRIG[r.trigger] || r.trigger)}</td><td class="num">${r.ms}ms</td><td class="num">${r.changed}</td><td>${r.error ? `<span class="tag off">Lỗi</span> <small>${esc(r.error.slice(0, 110))}</small>` : '<span class="tag on">OK</span>'}</td></tr>`).join('') || '<tr><td colspan="6"><div class="state"><b>Chưa có tác vụ</b>Các lần agent chạy sẽ hiện ở đây.</div></td></tr>'}</tbody></table></div>
      <div class="pager"><span>${t.data.total} tác vụ (lưu 300 lần chạy gần nhất)</span><span class="row"><button class="sm" data-ag="tpage" data-p="${t.offset - t.per}" ${page <= 1 ? 'disabled' : ''}>‹ Trước</button> Trang ${page}/${pages} <button class="sm" data-ag="tpage" data-p="${t.offset + t.per}" ${page >= pages ? 'disabled' : ''}>Sau ›</button></span></div>`;
  }
  const running = t.data ? Object.keys(t.data.runningNow) : [];
  return `${running.length ? `<div class="alert"><b>Đang chạy:</b> ${running.map((id) => esc((names.find((n) => n[0] === id) || [id, id])[1])).join(', ')}</div>` : ''}
    <div class="toolbar noprint"><select data-ag="f-agent" aria-label="Agent">${opt('', 'Mọi agent', t.agent)}${names.map(([id, n]) => opt(id, n, t.agent)).join('')}</select>
    <select data-ag="f-status" aria-label="Kết quả">${opt('', 'Mọi kết quả', t.status)}${opt('ok', 'Thành công', t.status)}${opt('error', 'Lỗi', t.status)}</select>
    <select data-ag="f-trigger" aria-label="Kiểu chạy">${opt('', 'Mọi kiểu', t.trigger)}${Object.entries(AG_TRIG).map(([k, v]) => opt(k, v, t.trigger)).join('')}</select>
    <span class="grow"></span><button class="sm" data-ag="reload-tasks">⟳ Làm mới</button></div>${body}`;
}

// ---------- Tab Báo cáo ----------
function agReports() {
  const r = AG.reports;
  let body;
  if (r.state === 'err') body = `<div class="state err"><b>Không tải được báo cáo</b>${esc(r.err)}<br><button class="sm" data-ag="reload-reports">Thử lại</button></div>`;
  else if (!r.list) body = '<div class="skel" style="height:160px"></div>';
  else body = `<div class="tablewrap"><table class="tbl"><thead><tr><th>Tạo lúc</th><th>Kỳ</th><th>Khoảng thời gian</th><th>Nguồn</th><th></th></tr></thead><tbody>${r.list.map((x) => `<tr><td style="white-space:nowrap">${esc(agWhen(x.createdAt))}</td><td>${x.period === 'week' ? 'Tuần' : 'Tháng'}</td><td>${esc(x.range.label)}</td><td>${esc(AG_TRIG[x.trigger] || x.trigger)}${x.hasAi ? ' · <span class="tag info">có nhận xét AI</span>' : ''}</td><td class="num"><button class="sm" data-ag="report" data-id="${esc(x.id)}">Xem</button></td></tr>`).join('') || '<tr><td colspan="5"><div class="state"><b>Chưa có báo cáo</b>Bấm "Tạo báo cáo tuần" hoặc chờ Agent Báo cáo tự tạo mỗi tuần.</div></td></tr>'}</tbody></table></div>`;
  return `<p class="sub">Báo cáo tổng hợp từ dữ liệu có thật trong hệ thống, nêu rõ nguồn và khoảng thời gian. Phần "Đề xuất" chỉ để Sếp tham khảo — hệ thống không tự làm theo.</p>
    <div class="toolbar noprint"><button class="pri" data-ag="mkreport" data-p="week" ${r.busy ? 'disabled' : ''}>＋ Tạo báo cáo tuần</button><button data-ag="mkreport" data-p="month" ${r.busy ? 'disabled' : ''}>＋ Tạo báo cáo tháng</button></div>${body}`;
}

function agBody() {
  return { agents: agAgents, pipeline: agPipeline, analytics: agAnalytics, tasks: agTasks, reports: agReports }[AG.tab]();
}
function agPaint() { const el = document.getElementById('agBody'); if (el) el.innerHTML = agBody(); }

function pageAgents() {
  const html = `<h1>Agent & Tác vụ</h1><p class="sub">Các agent AI chạy nền theo chu kỳ quét. Mỗi agent có phạm vi quyền riêng và một agent lỗi không làm agent khác dừng. Việc chạm tới tiền, đăng bài, trả lời khách đều chờ Sếp duyệt.</p>
  <div class="seg" style="margin-bottom:12px">${[['agents', 'Agent'], ['pipeline', 'Dây chuyền nội dung'], ['analytics', 'Phân tích nội dung'], ['tasks', 'Tác vụ'], ['reports', 'Báo cáo']].map(([k, l]) => `<button class="${AG.tab === k ? 'on' : ''}" data-ag="tab" data-v="${k}">${l}</button>`).join('')}</div>
  <div id="agBody">${agBody()}</div>`;
  setTimeout(() => { agLoad(); if (AG.tab === 'tasks') agLoadTasks(); if (AG.tab === 'reports') agLoadReports(); }, 0);
  return html;
}

// ---------- Chi tiết agent ----------
async function agDetail(id) {
  const layer = document.getElementById('layer');
  let el = document.getElementById('agDrawer');
  if (!el) { el = document.createElement('aside'); el.id = 'agDrawer'; el.className = 'drawer'; layer.appendChild(el); }
  el.innerHTML = '<div class="skel" style="height:240px"></div>';
  try {
    const d = await call('GET', `/api/agent-center/${encodeURIComponent(id)}`);
    const max = Math.max(1, ...(d.aiUsageByDay || []).map((x) => x.in + x.out));
    const bars = (d.aiUsageByDay || []).map((x, i) => `<rect x="${i * 24 + 2}" y="${60 - ((x.in + x.out) / max) * 56}" width="18" height="${Math.max(1, ((x.in + x.out) / max) * 56)}" rx="2" fill="var(--brand)" opacity="${x.calls ? 1 : .25}"><title>${esc(x.date)}: ${x.calls} lần, ${x.in + x.out} token</title></rect>`).join('');
    el.innerHTML = `<div class="hd"><div><h2>${esc(d.name)}</h2><small style="color:var(--mute)">${esc(d.vi)}</small><br><span class="tag ${AG_STATUS[d.status.code]}">${esc(d.status.text)}</span></div><button class="sm" data-ag="close">✕ Đóng</button></div>
      <p>${esc(d.goal)}</p>
      ${d.available ? `<h3>Phạm vi quyền</h3><div style="font-size:13px"><b>Đọc:</b> ${d.reads.map(esc).join('; ')}<br><b>Ghi / thực hiện:</b> ${d.writes.map(esc).join('; ')}<br><b style="color:var(--bad)">Không bao giờ:</b> ${d.never.map(esc).join('; ')}<br><b>Công cụ:</b> ${d.tools.map(esc).join(', ')}</div>
      <h3 style="margin-top:12px">Quy trình agent chạy</h3>${d.workflows.map((w) => `<div class="item"><span>${esc(w.name)}</span><span class="tag ${w.mode === 'auto' ? 'info' : 'dry'}">${w.mode === 'auto' ? 'tự động (chỉ tắt/giảm)' : 'chỉ đề xuất'}</span></div>`).join('') || '<div class="empty">Không có.</div>'}
      <h3 style="margin-top:12px">Lượng AI dùng (14 ngày)</h3><svg viewBox="0 0 340 64" style="width:100%;height:64px">${bars}</svg><p class="sub" style="margin:0">Chỉ đếm số lần gọi và token, không lưu nội dung. Chưa quy ra tiền vì giá phụ thuộc gói/model.</p>
      <h3 style="margin-top:12px">Việc chờ duyệt (${d.pendingApprovals})</h3>${d.pending.map((a) => `<div class="item"><span>${esc(a.title)}</span></div>`).join('') || '<div class="empty">Không có.</div>'}${d.pendingApprovals ? '<p><a href="#duyet">Xử lý ở trang Duyệt →</a></p>' : ''}
      <h3 style="margin-top:12px">Hành động gần đây</h3>${d.recentActions.map((a) => `<div class="item"><small>${esc(a.text)}</small><small style="color:var(--mute);white-space:nowrap">${a.dry ? '<span class="tag dry">chạy thử</span> ' : ''}${esc(agWhen(a.at))}</small></div>`).join('') || '<div class="empty">Chưa có.</div>'}
      <h3 style="margin-top:12px">Lịch sử chạy</h3><div class="tablewrap"><table class="tbl"><thead><tr><th>Lúc</th><th>Kiểu</th><th class="num">Thay đổi</th><th>Kết quả</th></tr></thead><tbody>${d.runs.map((r) => `<tr><td>${esc(agWhen(r.at))}</td><td>${esc(AG_TRIG[r.trigger] || r.trigger)}</td><td class="num">${r.changed}</td><td>${r.error ? `<span class="tag off">Lỗi</span> <small>${esc(r.error.slice(0, 80))}</small>` : '<span class="tag on">OK</span>'}</td></tr>`).join('') || '<tr><td colspan="4"><div class="empty">Chưa chạy lần nào.</div></td></tr>'}</tbody></table></div>` : `<div class="alert">${esc(d.unavailable)}</div>`}`;
  } catch (e) { el.innerHTML = `<div class="hd"><h2>Chi tiết</h2><button class="sm" data-ag="close">✕ Đóng</button></div><div class="state err"><b>Không tải được</b>${esc(e.message)}</div>`; }
}

// ---------- Báo cáo: xem / AI / sao chép / in ----------
async function agReport(id) {
  const layer = document.getElementById('layer');
  let el = document.getElementById('agReport');
  if (!el) { el = document.createElement('aside'); el.id = 'agReport'; el.className = 'drawer'; el.style.width = '680px'; layer.appendChild(el); }
  el.innerHTML = '<div class="skel" style="height:240px"></div>';
  try {
    const r = await call('GET', `/api/reports/${encodeURIComponent(id)}`);
    AG.reports.open = r;
    el.innerHTML = `<div class="hd noprint"><div><h2>Báo cáo ${r.period === 'week' ? 'tuần' : 'tháng'}</h2><small style="color:var(--mute)">${esc(r.range.label)} · tạo ${esc(agWhen(r.createdAt))}</small></div><button class="sm" data-ag="close-report">✕ Đóng</button></div>
      <div class="row noprint" style="margin-bottom:10px"><button class="sm" data-ag="copy">Sao chép</button><button class="sm" data-ag="txt">Tải .txt</button><button class="sm" data-ag="print">🖨 In / PDF</button><button class="sm" data-ag="ai" ${AG.data && AG.data.hasAiKey ? '' : 'disabled title="Chưa có ANTHROPIC_API_KEY"'}>✦ Nhờ AI viết nhận xét</button></div>
      <pre class="ai" style="font-size:13px">${esc(r.text)}</pre>
      ${r.aiText ? `<h3>Nhận xét của AI (chỉ đề xuất)</h3><pre class="ai" style="font-size:13px">${esc(r.aiText)}</pre>` : ''}`;
  } catch (e) { el.innerHTML = `<div class="hd"><h2>Báo cáo</h2><button class="sm" data-ag="close-report">✕ Đóng</button></div><div class="state err"><b>Không tải được báo cáo</b>${esc(e.message)}</div>`; }
}

// ---------- Hành động ----------
async function agRun(id) {
  const a = AG.data.agents.find((x) => x.engine === id);
  if (!S.settings.dryRun && ['ads', 'content'].includes(id)) {
    const ok = await confirmBox({ title: `Chạy ${a.name} ngay?`, body: `<p>${esc(a.goal)}</p>${dryNote()}`, ok: 'Chạy ngay' });
    if (!ok) return;
  }
  AG.busy.add(a.id); agPaint();
  try {
    const r = await call('POST', `/api/agents/${encodeURIComponent(id)}/run`, {});
    S = r;
    toast(`${a.name} đã chạy xong`);
  } catch (e) { toast(e.message); }
  AG.busy.delete(a.id);
  await agLoad(); if (AG.tab === 'tasks') agLoadTasks(); if (AG.tab === 'reports') agLoadReports();
  render();
}
async function agSim(id) {
  const a = AG.data.agents.find((x) => x.engine === id);
  const ok = await confirmBox({ title: 'Chạy thử an toàn?', body: `<p>Chạy một lượt <b>${esc(a.name)}</b> ở chế độ giả lập: không gì được gửi ra Facebook (không tắt chiến dịch, không đăng bài, không đổi ngân sách), kể cả khi hệ thống đang chạy thật. Có thể phát sinh đề xuất chờ duyệt.</p>${id === 'content' ? '<p class="alert">Có thể gọi AI soạn bài (tốn một ít chi phí AI).</p>' : ''}`, ok: 'Chạy thử' });
  if (!ok) return;
  AG.busy.add(a.id); agPaint();
  try {
    const r = await call('POST', `/api/agent-center/${encodeURIComponent(a.id)}/simulate`, {});
    S = await call('GET', '/api/state');
    agShowSim(a, r);
  } catch (e) { toast(e.message); }
  AG.busy.delete(a.id);
  await agLoad();
}
function agShowSim(a, r) {
  const layer = document.getElementById('layer');
  const el = document.createElement('div');
  el.className = 'overlay';
  el.innerHTML = `<div class="modal" style="width:620px"><h3>Kết quả chạy thử an toàn</h3><p class="sub" style="margin:0 0 8px">${esc(a.name)} · ${r.run.ms}ms · ${r.run.changed} thay đổi giả lập</p>
    ${r.run.error ? `<div class="alert danger"><b>Agent báo lỗi:</b> ${esc(r.run.error)}</div>` : ''}<div class="alert"><b>Không có gì được gửi ra ngoài.</b></div>
    <div style="max-height:300px;overflow:auto">${r.actions.map((x) => `<div class="item"><small>${esc(x.text)}</small>${x.dry ? '<span class="tag dry">chạy thử</span>' : ''}</div>`).join('') || '<div class="empty">Agent không ghi nhận hành động nào.</div>'}</div>
    <div class="acts"><button class="pri" data-r="0">Đóng</button></div></div>`;
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-r="0"]')) el.remove(); });
  layer.appendChild(el);
}
async function agToggle(id, on) {
  const a = AG.data.agents.find((x) => x.engine === id);
  try { S = await call('POST', `/api/agents/${encodeURIComponent(id)}/toggle`, { on }); toast(on ? `Đã bật ${a.name}` : `Đã tạm dừng ${a.name}`); } catch (e) { toast(e.message); }
  await agLoad(); render();
}
async function agMkReport(period) {
  AG.reports.busy = true; agPaint();
  try { const r = await call('POST', '/api/reports', { period }); toast('Đã tạo báo cáo'); await agLoadReports(); agReport(r.id); }
  catch (e) { toast(e.message); }
  AG.reports.busy = false; agPaint();
}
async function agAi() {
  const r = AG.reports.open;
  if (!r) return;
  toast('AI đang viết nhận xét…');
  try { await call('POST', `/api/reports/${encodeURIComponent(r.id)}/ai`, {}); await agReport(r.id); agLoadReports(); toast('Đã thêm nhận xét của AI'); }
  catch (e) { toast(e.message); }
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-ag]');
  if (!t || ['SELECT', 'INPUT'].includes(t.tagName)) return;
  const k = t.dataset.ag, id = t.dataset.id;
  if (k === 'tab') { AG.tab = t.dataset.v; render(); }
  else if (k === 'reload') agLoad();
  else if (k === 'reload-tasks') agLoadTasks();
  else if (k === 'reload-reports') agLoadReports();
  else if (!AG.data && k !== 'close' && k !== 'close-report') return;
  else if (k === 'run') agRun(id);
  else if (k === 'sim') agSim(id);
  else if (k === 'toggle') agToggle(id, t.dataset.on === '1');
  else if (k === 'detail') agDetail(id);
  else if (k === 'close') { const d = document.getElementById('agDrawer'); if (d) d.remove(); }
  else if (k === 'close-report') { const d = document.getElementById('agReport'); if (d) d.remove(); }
  else if (k === 'tpage') { AG.tasks.offset = Math.max(0, Number(t.dataset.p)); agLoadTasks(); }
  else if (k === 'report') agReport(id);
  else if (k === 'mkreport') agMkReport(t.dataset.p);
  else if (k === 'ai') agAi();
  else if (k === 'copy') { navigator.clipboard.writeText(AG.reports.open.text).then(() => toast('Đã sao chép báo cáo'), () => toast('Không sao chép được — chọn chữ rồi Ctrl+C')); }
  else if (k === 'txt') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + AG.reports.open.text], { type: 'text/plain;charset=utf-8' }));
    a.download = `bao-cao-${AG.reports.open.period}-${new Date(AG.reports.open.createdAt).toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  else if (k === 'print') { document.body.classList.add('print-report'); window.print(); setTimeout(() => document.body.classList.remove('print-report'), 500); }
});
document.addEventListener('change', (e) => {
  const k = e.target.dataset.ag, t = AG.tasks;
  if (k === 'f-agent') { t.agent = e.target.value; t.offset = 0; agLoadTasks(); }
  else if (k === 'f-status') { t.status = e.target.value; t.offset = 0; agLoadTasks(); }
  else if (k === 'f-trigger') { t.trigger = e.target.value; t.offset = 0; agLoadTasks(); }
});
