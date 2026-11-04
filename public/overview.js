// Trang Tổng quan: KPI marketing, biểu đồ ngày/tuần/tháng, so sánh thương hiệu, cảnh báo, lịch đăng sắp tới,
// việc chờ duyệt, tác vụ của agent. Dùng số liệu thật từ /api/state và /api/ads/series; không có số liệu thì nói rõ là chưa có.
// Nạp sau ads.js (dùng chung lineChart, hbars, chartHtml, vShort, adsNum, cplOf, budgetOf, brandName, PERIODS).
const OV = { period: 'd7', brand: '', days: 30, group: 'day', series: { key: '', state: 'idle', data: null, err: '' } };

function ovCampaigns() { return S.campaigns.filter((c) => !OV.brand || c.brand === OV.brand); }
function ovAccount() { return OV.brand ? ((S.brands.find((b) => b.id === OV.brand) || {}).adAccountId || '') : ''; }

async function ovLoadSeries(force) {
  const key = `${OV.days}|${ovAccount()}`;
  if (!force && OV.series.key === key && ['loading', 'ok'].includes(OV.series.state)) return;
  OV.series = { key, state: 'loading', data: null, err: '' };
  ovPaintChart();
  try {
    const qs = new URLSearchParams({ days: OV.days, ...(ovAccount() ? { account: ovAccount() } : {}), ...(force ? { refresh: '1' } : {}) });
    const data = await call('GET', '/api/ads/series?' + qs);
    if (OV.series.key === key) OV.series = { key, state: 'ok', data, err: '' };
  } catch (e) { if (OV.series.key === key) OV.series = { key, state: 'err', data: null, err: e.message }; }
  ovPaintChart();
}

// Gộp số liệu theo ngày thành tuần (bắt đầu thứ Hai) hoặc tháng
function ovGroup(points, mode) {
  if (mode === 'day') return points;
  const m = new Map();
  for (const p of points) {
    const d = new Date(p.date + 'T00:00:00Z');
    const key = mode === 'month' ? p.date.slice(0, 7) + '-01' : new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
    const cur = m.get(key) || { date: key, spend: 0, msgs: 0 };
    cur.spend += p.spend; cur.msgs += p.msgs;
    m.set(key, cur);
  }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
}
function ovChartHtml() {
  const s = OV.series;
  if (s.state === 'ok' && s.data && !s.data.demo && s.data.points.length) {
    const pts = ovGroup(s.data.points, OV.group);
    const tot = s.data.points.reduce((a, p) => ({ s: a.s + p.spend, m: a.m + p.msgs }), { s: 0, m: 0 });
    const note = OV.brand && ['the_one', 'dark_hair'].includes(OV.brand) ? ' · tài khoản quảng cáo dùng chung The One + Dark Hair' : '';
    return `${lineChart(pts)}<p class="sub" style="margin:8px 0 0">${s.data.days} ngày · chi ${vnd(tot.s)} · ${adsNum(tot.m)} tin${tot.m ? ' · ' + vnd(tot.s / tot.m) + '/tin' : ''} · nguồn Meta Insights${note}${s.data.cached ? ' (bộ nhớ đệm ≤ 10 phút)' : ''}</p>`;
  }
  return chartHtml(s, 'data-ov="retry"');
}
function ovPaintChart() { const el = document.getElementById('ovChart'); if (el) el.innerHTML = ovChartHtml(); }

function ovKpis(rows) {
  const act = rows.filter((c) => c.status === 'ACTIVE');
  const w = rows.reduce((a, c) => ({ s: a.s + c[OV.period].spend, m: a.m + c[OV.period].msgs }), { s: 0, m: 0 });
  const bud = act.reduce((s, c) => s + budgetOf(c), 0);
  const ids = new Set(rows.map((c) => c.id));
  const al = (S.adAlerts || []).filter((a) => ids.has(a.campaignId));
  const ps = S.postStats || { scheduled: 0, upcoming7d: 0, published30d: 0 };
  const pb = OV.brand ? (ps.byBrand || {})[OV.brand] || { scheduled: 0, upcoming7d: 0, published30d: 0 } : ps;
  const k = (l, v, sub, cls = '', full = '', href = '') => `<${href ? 'a href="' + href + '" style="text-decoration:none;color:inherit"' : 'div'} class="kpi ${cls}"><div class="l">${l}</div><div class="v" title="${esc(full)}">${v}</div><div class="s">${sub}</div></${href ? 'a' : 'div'}>`;
  const agentsOn = S.agents.filter((a) => a.on).length;
  const pend = S.approvals.length;
  return `<div class="kpis">
    ${k('Chi tiêu quảng cáo', vShort(w.s), PERIODS[OV.period], '', vnd(w.s))}
    ${k('Ngân sách / ngày', vShort(bud), `${act.length} chiến dịch đang chạy`, '', vnd(bud))}
    ${k('Tin nhắn', adsNum(w.m), PERIODS[OV.period])}
    ${k('Giá / tin nhắn', w.m ? vnd(w.s / w.m) : '—', w.m ? PERIODS[OV.period] : 'chưa có tin nhắn')}
    ${k('Chờ Sếp duyệt', String(pend), pend ? 'bấm để xử lý' : 'không có việc tồn', pend ? 'danger' : '', '', '#duyet')}
    ${k('Cảnh báo', String(al.length), al.length ? `${al.filter((a) => a.level === 'danger').length} nghiêm trọng` : 'không có bất thường', al.length ? 'danger' : '', '', '#ads')}
  </div>
  <div class="kpis">
    ${k('Bài sắp đăng (7 ngày)', String(pb.upcoming7d), `${pb.scheduled} bài đã lên lịch`, '', '', '#lich')}
    ${k('Bài đã đăng (30 ngày)', String(pb.published30d), OV.brand ? brandName(OV.brand) : 'cả 3 thương hiệu', '', '', '#lich')}
    ${k('Agent đang bật', `${agentsOn}<small style="font-size:13px;color:var(--mute)"> / ${S.agents.length}</small>`, S.settings.paused ? 'ĐANG DỪNG KHẨN CẤP' : S.settings.dryRun ? 'chế độ chạy thử' : 'chế độ chạy thật', S.settings.paused ? 'danger' : '', '', '#agent')}
    ${k('Quảng cáo thử', String(((S.adTests || []).filter((t) => t.status === 'running')).length), S.settings.adTest.on ? 'đang chạy thử' : 'tính năng đang tắt', '', '', '#ads')}
    ${k('Doanh thu', '—', 'chưa nối dữ liệu doanh thu / POS')}
    ${k('Chi phí AI', '—', 'chưa theo dõi')}
  </div>`;
}

function ovBrandTable() {
  const rows = S.brands.filter((b) => !OV.brand || b.id === OV.brand).map((b) => {
    const cs = S.campaigns.filter((c) => c.brand === b.id);
    const w = cs.reduce((a, c) => ({ s: a.s + c[OV.period].spend, m: a.m + c[OV.period].msgs }), { s: 0, m: 0 });
    const act = cs.filter((c) => c.status === 'ACTIVE');
    const ids = new Set(cs.map((c) => c.id));
    const ps = ((S.postStats || {}).byBrand || {})[b.id] || { upcoming7d: 0, published30d: 0 };
    return { b, spend: w.s, msgs: w.m, cpl: w.m ? w.s / w.m : null, act: act.length, total: cs.length, bud: act.reduce((s, c) => s + budgetOf(c), 0), al: (S.adAlerts || []).filter((a) => ids.has(a.campaignId)).length, ps };
  });
  const withCpl = rows.filter((r) => r.cpl !== null).map((r) => ({ label: r.b.name, v: r.cpl }));
  const withSpend = rows.filter((r) => r.spend > 0).map((r) => ({ label: r.b.name, v: r.spend }));
  return `<div class="card"><h2>Hiệu quả từng thương hiệu · ${PERIODS[OV.period]}</h2>
    <div class="tablewrap"><table class="tbl"><thead><tr><th>Thương hiệu</th><th class="num">Chi tiêu</th><th class="num">Tin nhắn</th><th class="num">Giá/tin</th><th class="num">Ngân sách/ngày</th><th class="num">Đang chạy</th><th class="num">Cảnh báo</th><th class="num">Bài sắp đăng</th></tr></thead><tbody>${
      rows.map((r) => `<tr><td><b>${esc(r.b.name)}</b></td><td class="num">${vnd(r.spend)}</td><td class="num">${adsNum(r.msgs)}</td><td class="num">${r.cpl === null ? '—' : vnd(r.cpl)}</td><td class="num">${vnd(r.bud)}</td><td class="num">${r.act}/${r.total}</td><td class="num">${r.al ? `<span class="tag off">${r.al}</span>` : '0'}</td><td class="num">${r.ps.upcoming7d}</td></tr>`).join('') || '<tr><td colspan="8"><div class="empty">Chưa có thương hiệu.</div></td></tr>'}</tbody></table></div>
    ${withCpl.length > 1 || withSpend.length > 1 ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px;margin-top:14px">${withCpl.length > 1 ? `<div><h3>Giá / tin nhắn (thấp = tốt)</h3>${hbars(withCpl, (i) => vnd(i.v))}</div>` : ''}${withSpend.length > 1 ? `<div><h3>Chi tiêu</h3>${hbars(withSpend, (i) => vnd(i.v))}</div>` : ''}</div>` : ''}
  </div>`;
}

function ovUpcoming() {
  const now = Date.now();
  const list = S.posts.filter((p) => p.status === 'scheduled' && new Date(p.scheduledAt).getTime() >= now && (!OV.brand || p.brand === OV.brand))
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)).slice(0, 7);
  const chLabel = (c) => ((S.channels || []).find((x) => x.id === c) || {}).label || c;
  return `<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Lịch đăng sắp tới</h2><a href="#lich">Mở lịch đăng →</a></div>${
    list.length ? list.map((p) => `<div class="item"><div><b>${esc(p.topic || p.text.slice(0, 50))}</b><p style="margin:2px 0">${esc(brandName(p.brand))} · ${esc(chLabel(p.channel))}</p></div><div style="white-space:nowrap;color:var(--mute)">${esc(when(p.scheduledAt))}</div></div>`).join('') : '<div class="empty">Chưa có bài nào lên lịch sắp tới.</div>'}</div>`;
}
function ovApprovals() {
  const labels = { budget_increase: 'Tăng ngân sách', post_publish: 'Đăng bài', comment_reply: 'Trả lời bình luận', ad_test: 'Quảng cáo thử', unit_budget: 'Ngân sách cơ sở', month_plan: 'Kế hoạch tháng' };
  return `<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Chờ Sếp duyệt (${S.approvals.length})</h2><a href="#duyet">Xử lý →</a></div>${
    S.approvals.length ? S.approvals.slice(0, 6).map((a) => `<div class="item"><div><span class="tag">${esc(labels[a.type] || a.type)}</span> <b>${esc(a.title)}</b></div></div>`).join('') + (S.approvals.length > 6 ? `<p class="sub" style="margin:8px 0 0">… và ${S.approvals.length - 6} việc khác</p>` : '') : '<div class="empty">Không có việc nào chờ duyệt.</div>'}</div>`;
}
function ovAlerts() {
  const ids = new Set(ovCampaigns().map((c) => c.id));
  const al = (S.adAlerts || []).filter((a) => ids.has(a.campaignId));
  return `<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Cảnh báo bất thường</h2><a href="#ads">Trang Quảng cáo →</a></div>${
    al.length ? al.slice(0, 5).map((a) => `<div class="alert ${a.level}"><b>${esc(a.campaign)}</b> · ${esc(brandName(a.brand))}<br>${esc(a.text)}<small>Nguồn: ${esc(a.basis)}</small></div>`).join('') + (al.length > 5 ? `<p class="sub" style="margin:8px 0 0">… và ${al.length - 5} cảnh báo khác</p>` : '') : '<div class="empty">Không có bất thường nào trong dữ liệu Meta gần nhất.</div>'}</div>`;
}
function ovAgents() {
  const last = (id) => S.runs.find((r) => r.agent === id);
  return `<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Công việc của AI</h2><a href="#agent">Chi tiết →</a></div>${S.agents.map((a) => {
    const r = last(a.id);
    const res = !r ? 'chưa chạy lần nào' : r.error ? `<span style="color:var(--bad)">lỗi: ${esc(r.error.slice(0, 90))}</span>` : `${r.changed} thay đổi · ${esc(when(r.at))}`;
    return `<div class="item"><div><b>${esc(a.name)}</b> <span class="tag ${a.on ? 'on' : 'off'}">${a.on ? 'Bật' : 'Tắt'}</span><p style="margin:2px 0">${res}</p></div></div>`;
  }).join('')}</div>`;
}

function pageHome() {
  const rows = ovCampaigns();
  const demo = S.mode !== 'live';
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`;
  const html = `<h1>Tổng quan${demo ? '<span class="demo">DEMO</span>' : ''}</h1>
  <p class="sub">${demo ? 'Chế độ mẫu — số liệu quảng cáo là DỮ LIỆU GIẢ. Nối Meta API để xem số liệu thật.' : `Số liệu từ Meta (đồng bộ lần cuối ${esc(when(S.lastSync || S.lastScan))}) và dữ liệu trong hệ thống.`} Agent quét chiến dịch mỗi ${S.settings.scanMinutes} phút; mọi việc tăng tiền hoặc đăng bài đều chờ Sếp duyệt.</p>
  <div class="toolbar noprint">
    <div class="seg">${Object.entries(PERIODS).map(([k, l]) => `<button class="${OV.period === k ? 'on' : ''}" data-ov="period" data-p="${k}">${l}</button>`).join('')}</div>
    <select data-ov="brand" aria-label="Thương hiệu">${opt('', 'Cả 3 thương hiệu', OV.brand)}${S.brands.map((b) => opt(b.id, b.name, OV.brand)).join('')}</select>
    <span class="grow"></span>
    <button class="pri" data-act="scan">⟳ Kiểm tra ngay</button><button data-act="analyze">✦ AI phân tích chiến dịch</button>${S.mode === 'mock' ? '<button data-act="reset">Đặt lại dữ liệu mẫu</button>' : ''}
  </div>
  ${ovKpis(rows)}
  ${aiText ? `<div class="card"><h2>Phân tích của AI</h2><pre class="ai">${esc(aiText)}</pre></div>` : ''}
  <div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Chi tiêu & tin nhắn</h2><span class="row noprint">
    <div class="seg">${[['day', 'Ngày'], ['week', 'Tuần'], ['month', 'Tháng']].map(([k, l]) => `<button class="${OV.group === k ? 'on' : ''}" data-ov="group" data-p="${k}">${l}</button>`).join('')}</div>
    <div class="seg">${[7, 14, 30, 90].map((d) => `<button class="${OV.days === d ? 'on' : ''}" data-ov="days" data-p="${d}">${d} ngày</button>`).join('')}</div>
    <button class="sm" data-ov="retry" title="Tải lại">⟳</button></span></div><div id="ovChart" style="margin-top:10px">${ovChartHtml()}</div></div>
  ${ovBrandTable()}
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;align-items:start">${ovAlerts()}${ovApprovals()}${ovUpcoming()}${ovAgents()}${ctOverviewCard()}</div>
  <div class="card"><h2>Hoạt động gần đây</h2>${actionList(S.actions.slice(0, 8))}</div>`;
  setTimeout(() => { if (document.getElementById('ovChart')) ovLoadSeries(false); }, 0);
  return html;
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-ov]');
  if (!t) return;
  const k = t.dataset.ov, p = t.dataset.p;
  if (k === 'period') { OV.period = p; render(); }
  else if (k === 'group') { OV.group = p; ovPaintChart(); document.querySelectorAll('[data-ov="group"]').forEach((b) => b.classList.toggle('on', b.dataset.p === p)); }
  else if (k === 'days') { OV.days = Number(p); OV.series = { key: '', state: 'idle', data: null, err: '' }; render(); }
  else if (k === 'retry') ovLoadSeries(true);
});
document.addEventListener('change', (e) => {
  if (e.target.dataset.ov === 'brand') { OV.brand = e.target.value; OV.series = { key: '', state: 'idle', data: null, err: '' }; render(); }
});
