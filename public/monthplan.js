// Trang Kế hoạch tháng: mục tiêu, KPI (số thực tế tự lấy từ Meta + bài đăng), ngân sách, công việc (Kanban / bảng / lịch),
// khuyến mãi, và phần AI soạn bài cả tháng (giao diện cũ). Dữ liệu qua /api/month-plan/*. Không có số liệu thì hiện "—", không bịa.
// Nạp sau calendar.js (dùng chung dKey, addDays, mondayOf, DOW, confirmBox, call, toast, render, S).
const PM = {
  month: new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7), brand: '', tab: 'overview', view: 'kanban',
  data: null, state: 'idle', err: '', seq: 0, busy: false, owner: '',
};
const PM_STATUS = [['todo', 'Cần làm'], ['doing', 'Đang làm'], ['review', 'Chờ duyệt'], ['done', 'Xong']];
const PM_METRIC = { spend: 'Chi tiêu quảng cáo (đ)', msgs: 'Tin nhắn', cpl: 'Giá / tin nhắn (đ, càng thấp càng tốt)', posts: 'Bài đã đăng', manual: 'Nhập tay' };
const PM_OK = { ok: ['on', 'Đúng tiến độ'], warn: ['dry', 'Hơi chậm'], bad: ['off', 'Chậm'], none: ['', 'Chưa có số liệu'] };
const pmNum = (n) => (n === null || n === undefined ? '—' : Math.round(n).toLocaleString('vi-VN'));
const pmMonthLabel = (m) => `Tháng ${m.slice(5)}/${m.slice(0, 4)}`;
const pmShift = (m, d) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1 + d, 1)).toISOString().slice(0, 7); };
const pmBrand = () => (PM.data && PM.brand ? PM.data.brands[PM.brand] : null);
const pmBrandName = (id) => (S.brands.find((b) => b.id === id) || {}).name || id;

async function pmLoad() {
  const seq = ++PM.seq;
  PM.state = PM.data && PM.data.month === PM.month ? 'ok' : 'loading';
  pmPaint();
  try {
    const d = await call('GET', `/api/month-plan?month=${PM.month}`);
    if (seq !== PM.seq) return;
    PM.data = d; PM.state = 'ok'; PM.err = '';
  } catch (e) { if (seq !== PM.seq) return; PM.state = 'err'; PM.err = e.message; }
  pmPaint();
}
// Lưu 1 phần của kế hoạch (goals/kpis/budget/promos/tasks/notes). Lỗi thì tải lại để không lệch dữ liệu.
async function pmSave(section, value, okMsg) {
  if (!PM.brand) return;
  PM.busy = true;
  try {
    const r = await call('PUT', `/api/month-plan/${PM.month}/${PM.brand}`, { [section]: value });
    PM.data.brands[PM.brand] = r;
    if (okMsg) toast(okMsg);
  } catch (e) { toast(e.message); await pmLoad(); }
  PM.busy = false;
  pmPaint();
}
const pmPlan = () => pmBrand().plan;
const pmUid = () => 'n' + Math.random().toString(36).slice(2, 8);

// ---------- Tổng hợp 3 thương hiệu ----------
function pmSummary() {
  const rows = S.brands.map((b) => {
    const d = PM.data.brands[b.id], p = d.progress, a = d.actuals;
    return `<tr class="click" data-pm="brand" data-id="${esc(b.id)}"><td><b>${esc(b.name)}</b></td>
      <td class="num">${p.goalsDone}/${p.goals}</td><td class="num">${p.kpis ? `<span class="tag on">${p.kpiOk}</span> / ${p.kpis}${p.kpiBad ? ` <span class="tag off">${p.kpiBad} chậm</span>` : ''}` : '—'}</td>
      <td class="num">${p.tasksDone}/${p.tasks}${p.tasksOverdue ? ` <span class="tag off">${p.tasksOverdue} quá hạn</span>` : ''}</td>
      <td class="num">${d.plan.budget.total ? vnd(d.plan.budget.total) : '—'}</td><td class="num">${a.spend === null ? '—' : vnd(a.spend)}${p.budgetUsedPct !== null ? `<br><small style="color:var(--mute)">${p.budgetUsedPct}% ngân sách</small>` : ''}</td>
      <td class="num">${pmNum(a.msgs)}</td><td class="num">${a.cpl === null ? '—' : vnd(a.cpl)}</td><td class="num">${a.posts.published}/${a.posts.planned}</td></tr>`;
  }).join('');
  const noAds = !Object.values(PM.data.brands)[0].actuals.adsAvailable;
  return `<div class="card"><h2>So sánh kế hoạch và kết quả · ${esc(pmMonthLabel(PM.month))}</h2>
    ${noAds ? '<p class="alert">Số liệu quảng cáo chỉ có cho <b>tháng hiện tại</b> (đọc từ Meta). Tháng khác hiện "—" — chưa lưu lịch sử số liệu từng tháng.</p>' : ''}
    <div class="tablewrap"><table class="tbl"><thead><tr><th>Thương hiệu</th><th class="num">Mục tiêu xong</th><th class="num">KPI đạt tiến độ</th><th class="num">Công việc xong</th><th class="num">Ngân sách kế hoạch</th><th class="num">Chi quảng cáo thực</th><th class="num">Tin nhắn</th><th class="num">Giá/tin</th><th class="num">Bài đã đăng / kế hoạch</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="sub" style="margin:8px 0 0">Bấm một thương hiệu để lập và theo dõi kế hoạch chi tiết. Tiến độ thời gian của tháng: <b>${Math.round(PM.data.elapsed * 100)}%</b>.</p></div>`;
}

// ---------- Tổng quan 1 thương hiệu ----------
function pmGoals(p) {
  return `<div class="card"><h2>Mục tiêu tháng</h2>${p.goals.map((g) => `<div class="item" style="align-items:center"><label class="f" style="margin:0;flex:1"><input type="checkbox" data-pm="goal-done" data-id="${esc(g.id)}" ${g.done ? 'checked' : ''}> <span style="${g.done ? 'text-decoration:line-through;color:var(--mute)' : ''}">${esc(g.text)}</span></label><button class="sm" data-pm="goal-del" data-id="${esc(g.id)}" aria-label="Xoá mục tiêu">✕</button></div>`).join('') || '<div class="empty">Chưa có mục tiêu. Thêm mục tiêu cụ thể, ví dụ "Tăng 30% khách mới ở Bình Thạnh".</div>'}
    <div class="row" style="margin-top:8px"><input type="text" id="pmGoalNew" placeholder="Thêm mục tiêu…" maxlength="200" style="flex:1;min-width:200px"><button class="pri" data-pm="goal-add">Thêm</button></div></div>`;
}
function pmKpis(p, act) {
  const rows = p.kpis.map((k) => {
    const st = PM_OK[k.status] || PM_OK.none;
    const actual = k.metric === 'manual' ? `<input type="number" data-pm="kpi-actual" data-id="${esc(k.id)}" value="${k.actual ?? ''}" style="width:100px" placeholder="nhập">` : `${k.actual === null ? '—' : esc(pmNum(k.actual))} <small style="color:var(--mute)">tự động</small>`;
    const w = Math.max(0, Math.min(100, k.pct || 0));
    return `<tr><td><b>${esc(k.name)}</b><br><small style="color:var(--mute)">${esc(PM_METRIC[k.metric])}${k.direction === 'down' ? ' · thấp là tốt' : ''}</small></td>
      <td class="num"><input type="number" data-pm="kpi-target" data-id="${esc(k.id)}" value="${k.target}" style="width:110px"> ${esc(k.unit)}</td><td class="num">${actual}</td>
      <td style="min-width:140px"><div class="bar"><i style="width:${w}%;background:${k.status === 'bad' ? 'var(--bad)' : k.status === 'warn' ? 'var(--warn)' : 'var(--ok)'}"></i></div><small>${k.pct === null ? '—' : k.pct + '%'} · <span class="tag ${st[0]}">${st[1]}</span></small></td>
      <td class="num"><button class="sm" data-pm="kpi-del" data-id="${esc(k.id)}" aria-label="Xoá KPI">✕</button></td></tr>`;
  }).join('');
  return `<div class="card"><h2>KPI marketing</h2>${!act.adsAvailable ? '<p class="alert">KPI quảng cáo chỉ tính được cho tháng hiện tại; tháng này hiện "—".</p>' : ''}
    <div class="tablewrap"><table class="tbl"><thead><tr><th>KPI</th><th class="num">Mục tiêu</th><th class="num">Thực tế</th><th>Tiến độ</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5"><div class="empty">Chưa có KPI.</div></td></tr>'}</tbody></table></div>
    <div class="row" style="margin-top:10px"><input type="text" id="pmKName" placeholder="Tên KPI" maxlength="80" style="flex:1;min-width:150px"><select id="pmKMetric">${Object.entries(PM_METRIC).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select><input type="number" id="pmKTarget" placeholder="Mục tiêu" min="0" style="width:120px"><input type="text" id="pmKUnit" placeholder="đơn vị" maxlength="12" style="width:80px"><button class="pri" data-pm="kpi-add">Thêm KPI</button></div></div>`;
}
function pmBudget(p, act) {
  const b = p.budget, used = act.spend;
  const pct = b.total && used !== null ? Math.min(100, Math.round((used / b.total) * 100)) : null;
  const items = b.items.map((i) => {
    const ip = i.actual !== null && i.amount ? Math.round((i.actual / i.amount) * 100) : null;
    return `<tr><td>${esc(i.name)}${i.auto ? ' <span class="tag info">tự lấy từ Meta</span>' : ''}</td><td class="num"><input type="number" data-pm="item-amount" data-id="${esc(i.id)}" value="${i.amount}" style="width:130px"></td><td class="num">${i.actual === null ? '—' : vnd(i.actual)}${ip !== null ? `<br><small style="color:var(--mute)">${ip}%</small>` : ''}</td><td class="num"><button class="sm" data-pm="item-del" data-id="${esc(i.id)}" aria-label="Xoá hạng mục">✕</button></td></tr>`;
  }).join('');
  return `<div class="card"><h2>Ngân sách tháng</h2>
    <div class="row"><b>Tổng ngân sách</b><input type="number" data-pm="budget-total" value="${b.total}" style="width:150px"> đ ${used !== null ? `· đã chi quảng cáo <b>${vnd(used)}</b>${pct !== null ? ` (${pct}%)` : ''}` : '· <small style="color:var(--mute)">chưa có số liệu chi tiêu cho tháng này</small>'}</div>
    ${pct !== null ? `<div class="bar" style="margin:8px 0"><i style="width:${pct}%;background:${pct > 100 ? 'var(--bad)' : pct > 85 ? 'var(--warn)' : 'var(--brand)'}"></i></div>` : ''}
    <div class="tablewrap" style="margin-top:8px"><table class="tbl"><thead><tr><th>Hạng mục</th><th class="num">Kế hoạch</th><th class="num">Thực tế</th><th></th></tr></thead><tbody>${items || '<tr><td colspan="4"><div class="empty">Chưa chia ngân sách theo hạng mục (Facebook Ads, quay chụp, KOL…).</div></td></tr>'}</tbody></table></div>
    <div class="row" style="margin-top:10px"><input type="text" id="pmIName" placeholder="Hạng mục (vd: Facebook Ads)" maxlength="60" style="flex:1;min-width:150px"><input type="number" id="pmIAmount" placeholder="Số tiền" min="0" style="width:130px"><label class="f" style="margin:0"><input type="checkbox" id="pmIAuto"> tự lấy chi tiêu Meta</label><button class="pri" data-pm="item-add">Thêm hạng mục</button></div></div>`;
}
function pmPosts(act) {
  const p = act.posts;
  return `<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Bài đăng trong tháng</h2><span class="row"><a href="#lich">Mở Lịch đăng →</a></span></div>
    <div class="kv" style="grid-template-columns:repeat(5,1fr)"><div><small>Kế hoạch</small><b>${p.planned}</b></div><div><small>Đã đăng</small><b>${p.published}</b></div><div><small>Đã lên lịch</small><b>${p.scheduled}</b></div><div><small>Chờ duyệt</small><b>${p.draft}</b></div><div><small>Lỗi</small><b>${p.failed}</b></div></div>
    <p class="sub" style="margin:0">Đếm theo giờ đăng nằm trong tháng, không tính bài đã huỷ hoặc bị từ chối. Soạn cả tháng bằng AI ở thẻ "Bài đăng AI soạn".</p></div>`;
}
function pmOverview() {
  const d = pmBrand(), p = d.plan, act = d.actuals;
  const empty = !p.goals.length && !p.kpis.length && !p.budget.total && !p.budget.items.length;
  const prev = pmShift(PM.month, -1);
  return `${empty ? `<div class="card"><div class="state"><b>Chưa có kế hoạch ${esc(pmMonthLabel(PM.month))} cho ${esc(pmBrandName(PM.brand))}</b>Thêm mục tiêu, KPI và ngân sách bên dưới, hoặc <button class="sm" data-pm="copy" data-from="${prev}">Sao chép khung từ ${esc(pmMonthLabel(prev))}</button></div></div>` : ''}
    ${pmGoals(p)}${pmKpis(p, act)}${pmBudget(p, act)}${pmPosts(act)}
    <div class="card"><h2>Ghi chú</h2><textarea data-pm="notes" rows="3" maxlength="2000" style="width:100%" placeholder="Ghi chú chiến lược, bài học tháng trước…">${esc(p.notes)}</textarea></div>`;
}

// ---------- Công việc ----------
function pmTaskForm() {
  return `<div class="card"><h2>Thêm công việc</h2><div class="row"><input type="text" id="pmTTitle" placeholder="Việc cần làm (vd: Quay video khách Quận 3)" maxlength="120" style="flex:1;min-width:220px"><input type="text" id="pmTOwner" placeholder="Phụ trách" maxlength="60" style="width:140px"><input type="date" id="pmTDue"><button class="pri" data-pm="task-add">Thêm</button></div></div>`;
}
function pmTaskCard(t) {
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const late = t.status !== 'done' && t.due && t.due < today;
  return `<div class="kcard" draggable="true" data-id="${esc(t.id)}"><b>${esc(t.title)}</b><div class="row" style="margin-top:4px;gap:6px"><small style="color:var(--mute)">${esc(t.owner || 'Chưa giao')}</small>${t.due ? `<span class="tag ${late ? 'off' : ''}">${esc(t.due.slice(8))}/${esc(t.due.slice(5, 7))}${late ? ' · quá hạn' : ''}</span>` : ''}</div>
    <div class="row" style="margin-top:6px"><select data-pm="task-status" data-id="${esc(t.id)}" style="font-size:12px;padding:2px">${PM_STATUS.map(([k, l]) => `<option value="${k}" ${t.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="sm" data-pm="task-del" data-id="${esc(t.id)}" aria-label="Xoá công việc">✕</button></div></div>`;
}
function pmKanban(tasks) {
  return `<div class="kanban">${PM_STATUS.map(([k, l]) => { const cs = tasks.filter((t) => t.status === k); return `<div class="kcol" data-col="${k}"><div class="kh"><b>${l}</b> <small>${cs.length}</small></div>${cs.map(pmTaskCard).join('') || '<div class="empty" style="padding:8px">Trống</div>'}</div>`; }).join('')}</div>`;
}
function pmTable(tasks) {
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  return `<div class="tablewrap"><table class="tbl"><thead><tr><th>Công việc</th><th>Phụ trách</th><th>Hạn</th><th>Trạng thái</th><th></th></tr></thead><tbody>${tasks.map((t) => `<tr><td><b>${esc(t.title)}</b></td><td>${esc(t.owner || '—')}</td><td>${t.due ? `${esc(t.due)}${t.status !== 'done' && t.due < today ? ' <span class="tag off">quá hạn</span>' : ''}` : '—'}</td><td><select data-pm="task-status" data-id="${esc(t.id)}">${PM_STATUS.map(([k, l]) => `<option value="${k}" ${t.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td><td class="num"><button class="sm" data-pm="task-del" data-id="${esc(t.id)}">✕</button></td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">Chưa có công việc.</div></td></tr>'}</tbody></table></div>`;
}
function pmCalendar(p) {
  const first = new Date(Number(PM.month.slice(0, 4)), Number(PM.month.slice(5)) - 1, 1);
  const start = mondayOf(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  return `<div class="calgrid">${DOW.map((d) => `<div class="dow">${d}</div>`).join('')}${cells.map((day) => {
    const key = dKey(day), dim = day.getMonth() !== first.getMonth();
    const tasks = p.tasks.filter((t) => t.due === key && (!PM.owner || t.owner === PM.owner));
    const promos = p.promos.filter((x) => x.from <= key && key <= x.to);
    return `<div class="cell ${dim ? 'dim' : ''}"><div class="dn"><span>${day.getDate()}</span></div>${promos.map((x) => `<div class="chip st-scheduled" title="${esc(x.name)}"><span class="tp">🎁 ${esc(x.name)}</span></div>`).join('')}${tasks.map((t) => `<div class="chip st-${t.status === 'done' ? 'published' : t.status === 'doing' ? 'scheduled' : 'draft'}" title="${esc(t.title)} · ${esc(t.owner)}"><span class="tp">${esc(t.title)}</span></div>`).join('')}</div>`;
  }).join('')}</div>`;
}
function pmTasks() {
  const p = pmPlan();
  const owners = [...new Set(p.tasks.map((t) => t.owner).filter(Boolean))];
  const tasks = p.tasks.filter((t) => !PM.owner || t.owner === PM.owner);
  return `${pmTaskForm()}<div class="toolbar noprint"><div class="seg">${[['kanban', 'Kanban'], ['table', 'Bảng'], ['calendar', 'Lịch']].map(([k, l]) => `<button class="${PM.view === k ? 'on' : ''}" data-pm="view" data-v="${k}">${l}</button>`).join('')}</div>
    <select data-pm="owner" aria-label="Người phụ trách"><option value="">Mọi người</option>${owners.map((o) => `<option ${PM.owner === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>
    <span class="sub" style="margin:0">${p.tasks.filter((t) => t.status === 'done').length}/${p.tasks.length} xong</span></div>
    ${PM.view === 'kanban' ? pmKanban(tasks) : PM.view === 'table' ? pmTable(tasks) : pmCalendar(p)}`;
}

// ---------- Khuyến mãi ----------
function pmPromos() {
  const p = pmPlan();
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const lastDay = new Date(Number(PM.month.slice(0, 4)), Number(PM.month.slice(5)), 0).getDate();
  return `<div class="card"><h2>Chương trình khuyến mãi</h2>${p.promos.slice().sort((a, b) => a.from.localeCompare(b.from)).map((x) => `<div class="item" style="align-items:center"><div><b>${esc(x.name)}</b> ${x.from <= today && today <= x.to ? '<span class="tag on">đang diễn ra</span>' : x.to < today ? '<span class="tag">đã kết thúc</span>' : '<span class="tag info">sắp tới</span>'}<p style="margin:2px 0">${esc(x.from)} → ${esc(x.to)}${x.detail ? ' · ' + esc(x.detail) : ''}</p></div><button class="sm" data-pm="promo-del" data-id="${esc(x.id)}">✕</button></div>`).join('') || '<div class="empty">Chưa có chương trình khuyến mãi.</div>'}
    <div class="row" style="margin-top:10px"><input type="text" id="pmPName" placeholder="Tên chương trình" maxlength="100" style="flex:1;min-width:180px"><input type="date" id="pmPFrom" value="${PM.month}-01"><input type="date" id="pmPTo" value="${PM.month}-${String(lastDay).padStart(2, '0')}"></div>
    <div class="row" style="margin-top:6px"><input type="text" id="pmPDetail" placeholder="Nội dung ưu đãi (vd: giảm 20% nhuộm cho khách mới)" maxlength="500" style="flex:1;min-width:220px"><button class="pri" data-pm="promo-add">Thêm</button></div>
    <p class="sub" style="margin:8px 0 0">Khuyến mãi hiện cũng được vẽ trên tab "Công việc → Lịch". Agent chưa tự đọc khuyến mãi để soạn bài — nhờ AI nhắc ưu đãi bằng ô "Hướng nội dung" ở thẻ Bài đăng AI soạn.</p></div>`;
}

// ---------- Khung trang ----------
function pmBody() {
  if (PM.state === 'loading' || !PM.data) return PM.state === 'err' ? '' : '<div class="skel" style="height:240px"></div>';
  if (PM.state === 'err') return `<div class="card"><div class="state err"><b>Không tải được kế hoạch</b>${esc(PM.err)}<br><button class="sm" data-pm="reload">Thử lại</button></div></div>`;
  if (PM.tab === 'posts') return '';
  if (!PM.brand) return pmSummary();
  return { overview: pmOverview, tasks: pmTasks, promos: pmPromos }[PM.tab]();
}
function pmPaint() { const el = document.getElementById('pmBody'); if (el) el.innerHTML = pmBody(); const l = document.getElementById('pmMonth'); if (l) l.textContent = pmMonthLabel(PM.month); }

function pagePlan() {
  F.month = PM.month; // phần AI soạn bài (giao diện cũ) dùng chung tháng
  if (PM.brand) F.brand = PM.brand;
  const tabs = [['overview', 'Mục tiêu · KPI · Ngân sách'], ['tasks', 'Công việc'], ['promos', 'Khuyến mãi'], ['posts', 'Bài đăng AI soạn']];
  const html = `<h1>Kế hoạch tháng</h1><p class="sub">Đặt mục tiêu, KPI, ngân sách và công việc cho từng thương hiệu; số thực tế lấy tự động từ Meta và bài đăng. AI chỉ đề xuất — mọi bài đăng và chi tiêu vẫn do Sếp duyệt.</p>
  <div class="toolbar noprint"><div class="row"><button data-pm="prev" aria-label="Tháng trước">‹</button><b id="pmMonth" style="min-width:120px;text-align:center">${esc(pmMonthLabel(PM.month))}</b><button data-pm="next" aria-label="Tháng sau">›</button><button data-pm="now">Tháng này</button></div>
    <div class="seg"><button class="${!PM.brand ? 'on' : ''}" data-pm="brand" data-id="">Tổng hợp</button>${S.brands.map((b) => `<button class="${PM.brand === b.id ? 'on' : ''}" data-pm="brand" data-id="${esc(b.id)}">${esc(b.name)}</button>`).join('')}</div></div>
  ${PM.brand ? `<div class="seg" style="margin-bottom:12px;flex-wrap:wrap">${tabs.map(([k, l]) => `<button class="${PM.tab === k ? 'on' : ''}" data-pm="tab" data-v="${k}">${l}</button>`).join('')}</div>` : ''}
  <div id="pmBody">${pmBody()}</div>${PM.brand && PM.tab === 'posts' ? pagePlanPosts() : ''}`;
  setTimeout(pmLoad, 0);
  return html;
}

// ---------- Sự kiện ----------
async function pmTask(id, status) {
  try { PM.data.brands[PM.brand] = await call('POST', `/api/month-plan/${PM.month}/${PM.brand}/tasks/${encodeURIComponent(id)}`, { status }); }
  catch (e) { toast(e.message); await pmLoad(); }
  pmPaint();
}
const pmVal = (id) => (document.getElementById(id) || {}).value || '';
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-pm]');
  if (!t || ['SELECT', 'INPUT', 'TEXTAREA'].includes(t.tagName)) return;
  const k = t.dataset.pm, id = t.dataset.id;
  if (k === 'prev' || k === 'next') { PM.month = pmShift(PM.month, k === 'next' ? 1 : -1); PM.data = null; render(); }
  else if (k === 'now') { PM.month = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7); PM.data = null; render(); }
  else if (k === 'brand') { PM.brand = id; render(); }
  else if (k === 'tab') { PM.tab = t.dataset.v; render(); }
  else if (k === 'view') { PM.view = t.dataset.v; pmPaint(); }
  else if (k === 'reload') pmLoad();
  else if (!PM.data || !PM.brand || PM.busy) return;
  else if (k === 'goal-add') { const text = pmVal('pmGoalNew').trim(); if (!text) return toast('Nhập mục tiêu'); pmSave('goals', [...pmPlan().goals, { text }]); }
  else if (k === 'goal-del') pmSave('goals', pmPlan().goals.filter((g) => g.id !== id));
  else if (k === 'kpi-add') {
    const name = pmVal('pmKName').trim(), target = pmVal('pmKTarget');
    if (!name || target === '') return toast('Nhập tên và mục tiêu cho KPI');
    pmSave('kpis', [...pmPlan().kpis, { name, metric: pmVal('pmKMetric'), target: Number(target), unit: pmVal('pmKUnit'), ...(pmVal('pmKMetric') === 'manual' ? { actual: null } : {}) }]);
  }
  else if (k === 'kpi-del') pmSave('kpis', pmPlan().kpis.filter((x) => x.id !== id));
  else if (k === 'item-add') {
    const name = pmVal('pmIName').trim(), amount = pmVal('pmIAmount');
    if (!name || amount === '') return toast('Nhập hạng mục và số tiền');
    pmSave('budget', { total: pmPlan().budget.total, items: [...pmPlan().budget.items.map(({ actual, ...i }) => i), { name, amount: Number(amount), auto: document.getElementById('pmIAuto').checked ? 'meta_ads' : '' }] });
  }
  else if (k === 'item-del') pmSave('budget', { total: pmPlan().budget.total, items: pmPlan().budget.items.filter((i) => i.id !== id).map(({ actual, ...i }) => i) });
  else if (k === 'task-add') {
    const title = pmVal('pmTTitle').trim();
    if (!title) return toast('Nhập tên công việc');
    pmSave('tasks', [...pmPlan().tasks, { title, owner: pmVal('pmTOwner'), due: pmVal('pmTDue'), status: 'todo' }]);
  }
  else if (k === 'task-del') {
    const tk = pmPlan().tasks.find((x) => x.id === id);
    if (tk && await confirmBox({ title: 'Xoá công việc?', body: `<p><b>${esc(tk.title)}</b></p>`, ok: 'Xoá', danger: true })) pmSave('tasks', pmPlan().tasks.filter((x) => x.id !== id));
  }
  else if (k === 'promo-add') {
    const name = pmVal('pmPName').trim();
    if (!name) return toast('Nhập tên chương trình');
    pmSave('promos', [...pmPlan().promos, { name, from: pmVal('pmPFrom'), to: pmVal('pmPTo'), detail: pmVal('pmPDetail') }]);
  }
  else if (k === 'promo-del') pmSave('promos', pmPlan().promos.filter((x) => x.id !== id));
  else if (k === 'copy') {
    try { PM.data.brands[PM.brand] = await call('POST', `/api/month-plan/${PM.month}/${PM.brand}/copy`, { from: t.dataset.from }); toast('Đã sao chép khung kế hoạch'); } catch (err) { toast(err.message); }
    pmPaint();
  }
});
document.addEventListener('change', (e) => {
  const t = e.target, k = t.dataset.pm;
  if (!k) return;
  if (k === 'owner') { PM.owner = t.value; pmPaint(); return; }
  if (!PM.data || !PM.brand || PM.busy) return;
  const p = pmPlan(), id = t.dataset.id;
  if (k === 'goal-done') pmSave('goals', p.goals.map((g) => (g.id === id ? { ...g, done: t.checked } : g)));
  else if (k === 'kpi-target') pmSave('kpis', p.kpis.map((x) => (x.id === id ? { ...x, target: Number(t.value) } : x)));
  else if (k === 'kpi-actual') pmSave('kpis', p.kpis.map((x) => (x.id === id ? { ...x, actual: t.value === '' ? null : Number(t.value) } : x)));
  else if (k === 'budget-total') pmSave('budget', { total: Number(t.value), items: p.budget.items.map(({ actual, ...i }) => i) });
  else if (k === 'item-amount') pmSave('budget', { total: p.budget.total, items: p.budget.items.map(({ actual, ...i }) => (i.id === id ? { ...i, amount: Number(t.value) } : i)) });
  else if (k === 'notes') pmSave('notes', t.value, 'Đã lưu ghi chú');
  else if (k === 'task-status') pmTask(id, t.value);
});
let pmDrag = null;
document.addEventListener('dragstart', (e) => { const c = e.target.closest && e.target.closest('.kcard'); if (c) { pmDrag = c.dataset.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', pmDrag); } });
document.addEventListener('dragover', (e) => { const c = e.target.closest && e.target.closest('.kcol'); if (c && pmDrag) { e.preventDefault(); c.classList.add('over'); } });
document.addEventListener('dragleave', (e) => { const c = e.target.closest && e.target.closest('.kcol'); if (c) c.classList.remove('over'); });
document.addEventListener('drop', (e) => {
  const c = e.target.closest && e.target.closest('.kcol');
  document.querySelectorAll('.kcol.over').forEach((x) => x.classList.remove('over'));
  if (!c || !pmDrag) return;
  e.preventDefault();
  const id = pmDrag; pmDrag = null;
  const tk = pmPlan().tasks.find((x) => x.id === id);
  if (tk && tk.status !== c.dataset.col) pmTask(id, c.dataset.col);
});
document.addEventListener('dragend', () => { pmDrag = null; document.querySelectorAll('.kcol.over').forEach((x) => x.classList.remove('over')); });
// Ô tháng / thương hiệu của phần AI soạn bài (giao diện cũ) đồng bộ ngược về trang
document.addEventListener('change', (e) => {
  const f = e.target.dataset && e.target.dataset.f;
  if (f === 'month' && /^\d{4}-\d{2}$/.test(e.target.value)) { PM.month = e.target.value; PM.data = null; }
  else if (f === 'brand' && PM.brand) PM.brand = e.target.value;
});
