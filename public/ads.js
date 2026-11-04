// Trang Quảng cáo Facebook (Meta Ads): KPI, cảnh báo, biểu đồ theo ngày, bảng chiến dịch, panel chi tiết,
// bật/tắt + đổi ngân sách có xác nhận, đồng bộ Meta, xuất CSV/PDF. Dữ liệu từ /api/state và /api/ads/*.
// Nạp sau app.js (dùng chung S, esc, vnd, call, toast, render, actionList...).
const ADS = {
  period: 'd7', brand: '', account: '', status: '', q: '', sort: { key: 'spend', dir: -1 }, page: 1, per: 20,
  sel: new Set(), detail: null, days: 30,
  series: { key: '', state: 'idle', data: null, err: '' }, syncing: false,
};
const PERIODS = { today: 'Hôm nay', d7: '7 ngày', month: 'Tháng này' };

const adsNum = (n) => Math.round(n || 0).toLocaleString('vi-VN');
const vShort = (n) => { n = Math.round(n || 0); return n >= 1e9 ? (n / 1e9).toFixed(2).replace('.', ',') + ' tỷ' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace('.', ',') + ' tr' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : adsNum(n) + 'đ'; };
const cplOf = (w) => (w && w.msgs ? w.spend / w.msgs : null);
const adsMgr = (c) => `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(c.accountId || '')}&selected_campaign_ids=${encodeURIComponent(c.id)}`;
const brandName = (id) => (S.brands.find((b) => b.id === id) || {}).name || '—';
const budgetOf = (c) => (c.budgetTotal !== undefined ? c.budgetTotal : c.budget) || 0;

// ---------- Lọc / sắp xếp ----------
function adsRows() {
  const q = ADS.q.trim().toLowerCase();
  let rows = S.campaigns.filter((c) => (!ADS.brand || c.brand === ADS.brand) && (!ADS.account || c.accountId === ADS.account)
    && (!ADS.status || (ADS.status === 'ACTIVE' ? c.status === 'ACTIVE' : c.status !== 'ACTIVE')) && (!q || c.name.toLowerCase().includes(q) || c.id.includes(q)));
  const val = {
    brand: (c) => brandName(c.brand), name: (c) => c.name.toLowerCase(), status: (c) => (c.status === 'ACTIVE' ? 0 : 1), budget: budgetOf,
    spend: (c) => c[ADS.period].spend, msgs: (c) => c[ADS.period].msgs, cpl: (c) => { const v = cplOf(c[ADS.period]); return v === null ? Infinity : v; },
  }[ADS.sort.key];
  rows = rows.slice().sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * ADS.sort.dir; });
  return rows;
}

// ---------- Biểu đồ SVG (không phụ thuộc thư viện) ----------
function lineChart(points) {
  if (!points.length) return '';
  const W = 760, H = 230, L = 58, R = 40, T = 12, B = 28;
  const maxS = Math.max(1, ...points.map((p) => p.spend)), maxM = Math.max(1, ...points.map((p) => p.msgs));
  const x = (i) => L + (points.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (points.length - 1));
  const yS = (v) => T + (H - T - B) * (1 - v / maxS), yM = (v) => T + (H - T - B) * (1 - v / maxM);
  const bw = Math.max(2, Math.min(18, (W - L - R) / points.length - 3));
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => `<line x1="${L}" x2="${W - R}" y1="${yS(maxS * f)}" y2="${yS(maxS * f)}" stroke="var(--line)"/><text x="${L - 6}" y="${yS(maxS * f) + 4}" text-anchor="end" font-size="10" fill="var(--mute)">${vShort(maxS * f)}</text>`).join('');
  const step = Math.ceil(points.length / 7);
  const xl = points.map((p, i) => (i % step === 0 || i === points.length - 1 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--mute)">${esc(p.date.slice(8, 10) + '/' + p.date.slice(5, 7))}</text>` : '')).join('');
  const bars = points.map((p, i) => `<rect x="${x(i) - bw / 2}" y="${yM(p.msgs)}" width="${bw}" height="${H - B - yM(p.msgs)}" fill="var(--info)" opacity=".28"><title>${esc(p.date)}: ${p.msgs} tin nhắn</title></rect>`).join('');
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${yS(p.spend).toFixed(1)}`).join(' ');
  const dots = points.map((p, i) => `<circle cx="${x(i)}" cy="${yS(p.spend)}" r="3" fill="var(--brand)"><title>${esc(p.date)}: ${vnd(p.spend)} · ${p.msgs} tin${p.msgs ? ' · ' + vnd(p.spend / p.msgs) + '/tin' : ''}</title></circle>`).join('');
  return `<div class="chartbox"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Biểu đồ chi tiêu và tin nhắn theo ngày">${grid}${bars}<path d="${line}" fill="none" stroke="var(--brand)" stroke-width="2.2"/>${dots}${xl}<text x="${W - R + 6}" y="${T + 8}" font-size="10" fill="var(--info)">${maxM} tin</text></svg></div>
  <div class="legend"><span><i style="background:var(--brand)"></i>Chi tiêu (đ)</span><span><i style="background:var(--info);opacity:.5"></i>Tin nhắn</span></div>`;
}
function hbars(items, fmt) {
  const max = Math.max(1, ...items.map((i) => i.v));
  return items.map((i) => `<div class="hbar"><span title="${esc(i.label)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.label)}</span><span class="b"><i style="width:${Math.max(2, (i.v / max) * 100)}%"></i></span><b style="text-align:right">${fmt(i)}</b></div>`).join('');
}

// ---------- Số liệu theo ngày ----------
function seriesKey(campaignId) { return `${campaignId || ''}|${ADS.account}|${ADS.days}`; }
async function loadSeries(force) {
  const key = seriesKey();
  if (!force && ADS.series.key === key && ['loading', 'ok'].includes(ADS.series.state)) return;
  ADS.series = { key, state: 'loading', data: null, err: '' };
  paintChart();
  try {
    const qs = new URLSearchParams({ days: ADS.days, ...(ADS.account ? { account: ADS.account } : {}), ...(force ? { refresh: '1' } : {}) });
    const data = await call('GET', '/api/ads/series?' + qs);
    if (ADS.series.key !== key) return;
    ADS.series = { key, state: 'ok', data, err: '' };
  } catch (e) { if (ADS.series.key === key) ADS.series = { key, state: 'err', data: null, err: e.message }; }
  paintChart();
}
function chartHtml(s, retryAttr) {
  if (s.state === 'loading' || s.state === 'idle') return '<div class="skel" style="height:200px"></div>';
  if (s.state === 'err') return `<div class="state err"><b>Không tải được số liệu theo ngày</b>${esc(s.err)}<br><button class="sm" ${retryAttr}>Thử lại</button></div>`;
  const d = s.data;
  if (d.demo) return `<div class="state"><b>Chưa có số liệu theo ngày <span class="demo">DEMO</span></b>${esc(d.note)}</div>`;
  if (!d.points.length) return `<div class="state"><b>Không có dữ liệu trong ${d.days} ngày</b>${esc(d.note || 'Tài khoản chưa có chi tiêu trong khoảng này.')}</div>`;
  const tot = d.points.reduce((a, p) => ({ s: a.s + p.spend, m: a.m + p.msgs }), { s: 0, m: 0 });
  return `${lineChart(d.points)}<p class="sub" style="margin:8px 0 0">${d.days} ngày · chi ${vnd(tot.s)} · ${adsNum(tot.m)} tin${tot.m ? ' · ' + vnd(tot.s / tot.m) + '/tin' : ''} · nguồn Meta Insights${d.cached ? ' (bộ nhớ đệm ≤ 10 phút)' : ''}${d.partial ? ' · <span class="tag dry">một số tài khoản lỗi</span>' : ''}</p>`;
}
function paintChart() { const el = document.getElementById('adsChart'); if (el) el.innerHTML = chartHtml(ADS.series, 'data-ads="retry-series"'); }

// ---------- KPI / cảnh báo ----------
function adsKpis(rows) {
  const act = rows.filter((c) => c.status === 'ACTIVE');
  const w = rows.reduce((a, c) => ({ s: a.s + c[ADS.period].spend, m: a.m + c[ADS.period].msgs }), { s: 0, m: 0 });
  const bud = act.reduce((s, c) => s + budgetOf(c), 0);
  const unknown = act.filter((c) => !budgetOf(c)).length;
  const ids = new Set(rows.map((c) => c.id));
  const al = (S.adAlerts || []).filter((a) => ids.has(a.campaignId));
  const k = (l, v, s, cls = '', full = '') => `<div class="kpi ${cls}"><div class="l">${l}</div><div class="v" title="${esc(full)}">${v}</div><div class="s">${s}</div></div>`;
  return `<div class="kpis">
    ${k('Ngân sách / ngày', vShort(bud), `${act.length} chiến dịch đang chạy${unknown ? ` · ${unknown} chưa rõ ngân sách` : ''}`, '', vnd(bud))}
    ${k('Tổng chi tiêu', vShort(w.s), PERIODS[ADS.period], '', vnd(w.s))}
    ${k('Tin nhắn', adsNum(w.m), PERIODS[ADS.period])}
    ${k('Giá / tin nhắn', w.m ? vnd(w.s / w.m) : '—', w.m ? PERIODS[ADS.period] : 'chưa có tin nhắn')}
    ${k('Đang chạy', `${act.length}<small style="font-size:13px;color:var(--mute)"> / ${rows.length}</small>`, `${rows.length - act.length} đã tắt`)}
    ${k('Cảnh báo', String(al.length), al.length ? `${al.filter((a) => a.level === 'danger').length} nghiêm trọng` : 'không có bất thường', al.length ? 'danger' : '')}
  </div>`;
}
function adsAlerts(rows) {
  const ids = new Set(rows.map((c) => c.id));
  const al = (S.adAlerts || []).filter((a) => ids.has(a.campaignId));
  if (!al.length) return '';
  return `<div class="card"><h2>Cảnh báo tự động <span class="tag info">theo luật, chỉ để Sếp xem</span></h2>${al.slice(0, 8).map((a) => `<div class="alert ${a.level}"><b>${esc(a.campaign)}</b> · ${esc(brandName(a.brand))}<br>${esc(a.text)}<small>Nguồn: ${esc(a.basis)}</small> <button class="sm" data-ads="detail" data-id="${esc(a.campaignId)}">Xem chi tiết</button></div>`).join('')}${al.length > 8 ? `<p class="sub" style="margin:6px 0 0">… và ${al.length - 8} cảnh báo khác</p>` : ''}</div>`;
}

// ---------- Bảng ----------
function tableHtml() {
  const rows = adsRows();
  const pages = Math.max(1, Math.ceil(rows.length / ADS.per));
  if (ADS.page > pages) ADS.page = pages;
  const slice = rows.slice((ADS.page - 1) * ADS.per, ADS.page * ADS.per);
  const th = (key, label, cls = '') => `<th class="s ${cls}" data-ads="sort" data-key="${key}">${label}${ADS.sort.key === key ? `<span class="ar"> ${ADS.sort.dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`;
  const body = slice.map((c) => {
    const w = c[ADS.period], cpl = cplOf(w);
    const lvl = c.budgetLevel === 'adset' ? '<br><small style="color:var(--mute)">cấp nhóm QC</small>' : '';
    return `<tr class="click" data-ads="detail" data-id="${esc(c.id)}">
      <td onclick="event.stopPropagation()"><input type="checkbox" data-ads="pick" data-id="${esc(c.id)}" ${ADS.sel.has(c.id) ? 'checked' : ''} aria-label="Chọn để so sánh"></td>
      <td>${esc(brandName(c.brand))}</td><td><small title="${esc(c.accountId || '')}">${c.accountId ? '…' + esc(String(c.accountId).slice(-4)) : '—'}</small></td>
      <td><b>${esc(c.name)}</b>${c.stale ? ' <span class="tag off">số liệu cũ</span>' : ''}${!engineMsg(c) ? ' <span class="tag info">không đo bằng tin nhắn</span>' : ''}</td>
      <td><span class="tag ${c.status === 'ACTIVE' ? 'on' : 'off'}">${c.status === 'ACTIVE' ? 'Đang chạy' : 'Đã tắt'}</span></td>
      <td class="num">${budgetOf(c) ? vnd(budgetOf(c)) : '—'}${lvl}</td><td class="num">${vnd(w.spend)}</td><td class="num">${adsNum(w.msgs)}</td><td class="num">${cpl === null ? '—' : vnd(cpl)}</td>
      <td class="num" onclick="event.stopPropagation()"><button class="sm" data-ads="detail" data-id="${esc(c.id)}">Chi tiết</button> <button class="sm ${c.status === 'ACTIVE' ? 'danger' : ''}" data-ads="toggle" data-id="${esc(c.id)}">${c.status === 'ACTIVE' ? 'Tắt' : 'Bật'}</button></td></tr>`;
  }).join('');
  return `<div class="tablewrap"><table class="tbl"><thead><tr><th></th>${th('brand', 'Thương hiệu')}<th>Tài khoản</th>${th('name', 'Chiến dịch')}${th('status', 'Trạng thái')}${th('budget', 'Ngân sách/ngày', 'num')}${th('spend', `Chi tiêu (${PERIODS[ADS.period].toLowerCase()})`, 'num')}${th('msgs', 'Kết quả (tin)', 'num')}${th('cpl', 'Giá/tin', 'num')}<th class="num">Thao tác</th></tr></thead><tbody>${
    body || `<tr><td colspan="10"><div class="state"><b>${S.campaigns.length ? 'Không có chiến dịch khớp bộ lọc' : 'Chưa có dữ liệu chiến dịch'}</b>${S.campaigns.length ? 'Thử bỏ bớt bộ lọc hoặc đổi từ khoá tìm kiếm.' : 'Bấm "Đồng bộ Meta" để kéo chiến dịch về.'}</div></td></tr>`}</tbody></table></div>
  <div class="pager"><span>${rows.length} chiến dịch${ADS.sel.size ? ` · đã chọn ${ADS.sel.size} để so sánh` : ''}</span>
    <span class="row"><button class="sm" data-ads="page" data-p="${ADS.page - 1}" ${ADS.page <= 1 ? 'disabled' : ''}>‹ Trước</button> Trang ${ADS.page}/${pages} <button class="sm" data-ads="page" data-p="${ADS.page + 1}" ${ADS.page >= pages ? 'disabled' : ''}>Sau ›</button></span></div>`;
}
const engineMsg = (c) => !/TRAFFIC|AWARENESS|REACH|LINK_CLICKS|VIDEO_VIEWS|BRAND/i.test(c.objective || '');
function paintTable() { const el = document.getElementById('adsTable'); if (el) el.innerHTML = tableHtml(); }

// ---------- So sánh ----------
function compareHtml(rows) {
  const picked = S.campaigns.filter((c) => ADS.sel.has(c.id)).slice(0, 4);
  const byBrand = Object.values(rows.reduce((m, c) => { const b = c.brand || '—'; const x = m[b] = m[b] || { label: brandName(b), spend: 0, msgs: 0 }; x.spend += c[ADS.period].spend; x.msgs += c[ADS.period].msgs; return m; }, {})).filter((x) => x.spend > 0);
  const cplItems = (list) => list.filter((x) => x.msgs).map((x) => ({ label: x.label, v: x.spend / x.msgs }));
  const part = (title, list, f) => (list.length ? `<div><h3>${title}</h3>${hbars(list, f)}</div>` : '');
  return `<div class="card"><h2>So sánh hiệu quả · ${PERIODS[ADS.period]}</h2><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px">
    ${part('Giá / tin nhắn theo thương hiệu (thấp = tốt)', cplItems(byBrand), (i) => vnd(i.v))}
    ${part('Chi tiêu theo thương hiệu', byBrand.map((x) => ({ label: x.label, v: x.spend })), (i) => vnd(i.v))}
    ${picked.length >= 2 ? part(`Giá / tin nhắn · ${picked.length} chiến dịch đã chọn`, cplItems(picked.map((c) => ({ label: c.name, spend: c[ADS.period].spend, msgs: c[ADS.period].msgs }))), (i) => vnd(i.v)) : '<div class="empty">Tick 2–4 chiến dịch ở bảng để so sánh trực tiếp.</div>'}
  </div></div>`;
}

// ---------- Xác nhận / Modal ----------
function confirmBox({ title, body, ok = 'Xác nhận', danger = false }) {
  return new Promise((resolve) => {
    const layer = document.getElementById('layer');
    const el = document.createElement('div');
    el.className = 'overlay';
    el.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h3>${esc(title)}</h3><div>${body}</div><div class="acts"><button data-r="0">Huỷ</button><button class="pri ${danger ? 'danger fill' : ''}" data-r="1">${esc(ok)}</button></div></div>`;
    const close = (v) => { el.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    el.addEventListener('click', (e) => { const r = e.target.closest('[data-r]'); if (r) close(r.dataset.r === '1'); else if (e.target === el) close(false); });
    document.addEventListener('keydown', onKey);
    layer.appendChild(el);
    el.querySelector('[data-r="1"]').focus();
  });
}
const dryNote = () => (S.settings.dryRun ? '<p class="alert"><b>Đang ở chế độ CHẠY THỬ.</b> Thao tác chỉ được ghi vào nhật ký, chưa thay đổi gì trên Facebook. Tắt "Chạy thử" ở phần Luật bên dưới để áp dụng thật.</p>' : '<p class="alert danger"><b>Thao tác sẽ thay đổi quảng cáo thật trên Facebook.</b></p>');

async function adsToggle(id) {
  const c = S.campaigns.find((x) => x.id === id);
  if (!c) return;
  const to = c.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
  const ok = await confirmBox({ title: `${to === 'PAUSED' ? 'Tắt' : 'Bật'} chiến dịch?`, body: `<p><b>${esc(c.name)}</b><br><small>${esc(brandName(c.brand))} · tài khoản ${esc(c.accountId || '—')}</small></p>${dryNote()}`, ok: to === 'PAUSED' ? 'Tắt chiến dịch' : 'Bật chiến dịch', danger: to === 'PAUSED' });
  if (!ok) return;
  await adsWrite(() => call('POST', `/api/ads/campaigns/${encodeURIComponent(id)}/status`, { status: to }), to === 'PAUSED' ? 'Đã tắt' : 'Đã bật');
}
async function adsBudget(id, adsetId, from, name) {
  const inp = document.getElementById(adsetId ? 'bud_' + adsetId : 'bud_c');
  const to = Math.round(Number(inp && inp.value));
  const c = S.campaigns.find((x) => x.id === id);
  if (!c || !to) return toast('Nhập ngân sách hợp lệ');
  const ok = await confirmBox({ title: 'Đổi ngân sách ngày?', body: `<p><b>${esc(name || c.name)}</b></p><p>${vnd(from)} → <b>${vnd(to)}</b>/ngày ${to > from ? `(+${vnd(to - from)})` : `(−${vnd(from - to)})`}</p>${dryNote()}`, ok: 'Đổi ngân sách' });
  if (!ok) return;
  await adsWrite(() => call('POST', `/api/ads/campaigns/${encodeURIComponent(id)}/budget`, { budget: to, ...(adsetId ? { adsetId } : {}) }), 'Đã đổi ngân sách');
}
async function adsWrite(fn, okMsg) {
  try {
    const r = await fn();
    S = await call('GET', '/api/state');
    toast(r.dry ? `${okMsg} — chỉ ghi nhật ký (chế độ chạy thử)` : `${okMsg} trên Facebook`);
    render();
    if (ADS.detail) drawer();
  } catch (e) { toast(e.message); }
}
async function adsSync(btn) {
  if (ADS.syncing) return;
  ADS.syncing = true; btn.disabled = true; btn.textContent = 'Đang đồng bộ…';
  try {
    const r = await call('POST', '/api/ads/sync');
    S = await call('GET', '/api/state');
    ADS.series = { key: '', state: 'idle', data: null, err: '' };
    toast(`Đã đồng bộ ${r.synced} chiến dịch từ Meta`);
  } catch (e) { toast('Đồng bộ lỗi: ' + e.message); }
  ADS.syncing = false;
  render();
}

// ---------- Xuất báo cáo ----------
function exportCsv() {
  const rows = adsRows();
  if (!rows.length) return toast('Không có dòng nào để xuất');
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Thương hiệu', 'Tài khoản', 'ID chiến dịch', 'Chiến dịch', 'Trạng thái', 'Ngân sách/ngày', 'Chi tiêu hôm nay', 'Tin nhắn hôm nay', 'Chi tiêu 7 ngày', 'Tin nhắn 7 ngày', 'Giá/tin 7 ngày', 'Chi tiêu tháng', 'Tin nhắn tháng', 'Giá/tin tháng'];
  const cpl = (w) => (w.msgs ? Math.round(w.spend / w.msgs) : '');
  const lines = [head.map(q).join(',')].concat(rows.map((c) => [brandName(c.brand), c.accountId, c.id, c.name, c.status === 'ACTIVE' ? 'Đang chạy' : 'Đã tắt', budgetOf(c), c.today.spend, c.today.msgs, c.d7.spend, c.d7.msgs, cpl(c.d7), c.month.spend, c.month.msgs, cpl(c.month)].map(q).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `quang-cao-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`Đã xuất ${rows.length} chiến dịch (CSV, mở được bằng Excel)`);
}

// ---------- Panel chi tiết ----------
const DETAIL = { adsets: { state: 'idle', list: [], err: '' }, series: { key: '', state: 'idle', data: null, err: '' }, creatives: { state: 'idle', data: null, err: '' } };
const fmtN = (n) => Number(n || 0).toLocaleString('vi-VN');
const dmy = (iso) => (iso ? new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
// Bài quảng cáo: ảnh/thumbnail video, nội dung, link xem trên Facebook, nhóm quảng cáo, số liệu 7 ngày của từng quảng cáo
function creativesHtml(c) {
  const cr = DETAIL.creatives;
  if (cr.state === 'loading') return '<div class="skel" style="height:120px"></div>';
  if (cr.state === 'err') return `<div class="state err"><b>Không tải được bài quảng cáo</b>${esc(cr.err)}<br><button class="sm" data-ads="reload-creatives">Thử lại</button></div>`;
  if (!cr.data) return '';
  const info = cr.data.campaign || {};
  const head = `<div class="kv" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:10px"><div><small>Tạo lúc</small><b>${esc(dmy(info.createdAt))}</b></div><div><small>Bắt đầu</small><b>${esc(dmy(info.startAt))}</b></div><div><small>Kết thúc</small><b>${info.stopAt ? esc(dmy(info.stopAt)) : 'không hẹn'}</b></div><div><small>Mục tiêu</small><b>${esc(info.objective || c.objective || '—')}</b></div></div>`;
  if (cr.data.demo) return head + '<div class="empty">Chế độ mẫu: chưa nối Meta nên chưa có ảnh bài quảng cáo.</div>';
  if (!cr.data.ads.length) return head + '<div class="empty">Chiến dịch này chưa có quảng cáo nào.</div>';
  const card = (a) => `<div class="adcard" style="display:flex;gap:12px;border:1px solid var(--line);border-radius:var(--r-sm);padding:10px;margin:8px 0;align-items:flex-start">
    <div style="flex:0 0 112px">${a.image ? `<a href="#" data-ads="lightbox" data-src="${esc(a.image)}" data-link="${esc(a.link)}" title="Bấm để xem ảnh to"><img src="${esc(a.image)}" alt="" loading="lazy" style="width:112px;height:112px;object-fit:cover;border-radius:10px;display:block;background:#000"></a>${a.video ? '<small style="display:block;text-align:center;color:var(--mute)">▶ video</small>' : ''}` : '<div style="width:112px;height:112px;border-radius:10px;background:var(--soft);display:grid;place-items:center;color:var(--mute)"><small>không có ảnh</small></div>'}</div>
    <div style="flex:1;min-width:0"><div class="row" style="gap:6px;flex-wrap:wrap"><span class="tag ${a.status === 'ACTIVE' ? 'on' : a.status === 'IN_PROCESS' || a.status === 'PENDING_REVIEW' ? 'dry' : 'off'}">${a.status === 'ACTIVE' ? 'Đang chạy' : a.status === 'IN_PROCESS' || a.status === 'PENDING_REVIEW' ? 'Facebook đang duyệt' : a.status === 'PAUSED' || a.status === 'CAMPAIGN_PAUSED' || a.status === 'ADSET_PAUSED' ? 'Đã tắt' : esc(a.status || '')}</span>${a.adset ? `<small style="color:var(--mute)">nhóm: ${esc(a.adset.name)}${a.adset.budget ? ' · ' + vnd(a.adset.budget) + '/ngày' : ''}</small>` : ''}</div>
      ${a.title ? `<div><b>${esc(a.title)}</b></div>` : ''}<div style="white-space:pre-wrap;font-size:14px;margin:4px 0;max-height:120px;overflow:auto">${esc(a.text || '(bài không có chữ)')}</div>
      <div class="kv" style="grid-template-columns:repeat(auto-fit,minmax(90px,1fr));margin:6px 0"><div><small>7 ngày tiêu</small><b>${vnd(a.spend)}</b></div><div><small>Tin nhắn</small><b>${a.msgs}</b></div><div><small>Giá/tin</small><b>${a.cpl !== null ? vnd(a.cpl) : '—'}</b></div><div><small>Hiển thị</small><b>${fmtN(a.impressions)}</b></div><div><small>Người xem</small><b>${fmtN(a.reach)}</b></div><div><small>Bấm</small><b>${fmtN(a.clicks)}</b></div></div>
      <div class="row" style="gap:6px;flex-wrap:wrap"><small style="color:var(--mute)">${a.postedAt ? 'bài đăng ' + esc(dmy(a.postedAt)) + ' · ' : ''}quảng cáo tạo ${esc(dmy(a.createdAt))}</small>${a.link ? `<a href="${esc(a.link)}" target="_blank" rel="noopener"><button class="sm" type="button">Xem bài trên Facebook ↗</button></a>` : ''}${a.preview && a.preview !== a.link ? `<a href="${esc(a.preview)}" target="_blank" rel="noopener"><button class="sm" type="button">Xem mẫu quảng cáo ↗</button></a>` : ''}${a.instagram ? `<a href="${esc(a.instagram)}" target="_blank" rel="noopener"><button class="sm" type="button">Instagram ↗</button></a>` : ''}</div></div></div>`;
  return head + cr.data.ads.map(card).join('') + `<small style="color:var(--mute)">Số liệu từng quảng cáo tính 7 ngày gần nhất${cr.data.cached ? ' · đã lưu tạm, ' : ' · '}<a href="#" data-ads="reload-creatives">tải lại</a></small>`;
}
function lightbox(src, link) {
  const el = document.createElement('div');
  el.className = 'overlay';
  el.style.cssText = 'display:grid;place-items:center;background:rgba(0,0,0,.85);z-index:99';
  el.innerHTML = `<div style="max-width:min(96vw,900px);text-align:center"><img src="${esc(src)}" alt="" style="max-width:100%;max-height:80vh;border-radius:12px;display:block;margin:0 auto"><div class="row" style="justify-content:center;margin-top:10px;gap:8px">${link ? `<a href="${esc(link)}" target="_blank" rel="noopener"><button class="sm pri" type="button">Mở bài trên Facebook ↗</button></a>` : ''}<button class="sm" type="button" data-lb="close">✕ Đóng</button></div></div>`;
  el.addEventListener('click', (ev) => { if (ev.target === el || ev.target.closest('[data-lb="close"]')) el.remove(); });
  document.getElementById('layer').appendChild(el);
}
function drawer() {
  const layer = document.getElementById('layer');
  let el = document.getElementById('adsDrawer');
  const c = S.campaigns.find((x) => x.id === ADS.detail);
  if (!c) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('aside'); el.id = 'adsDrawer'; el.className = 'drawer'; layer.appendChild(el); }
  const win = (k) => { const w = c[k], v = cplOf(w); return `<div><small>${PERIODS[k]}</small><b>${vnd(w.spend)}</b><br><small>${w.msgs} tin${v !== null ? ' · ' + vnd(v) + '/tin' : ''}</small></div>`; };
  const al = (S.adAlerts || []).filter((a) => a.campaignId === c.id);
  const logs = S.actions.filter((a) => a.campaignId === c.id || (a.text || '').includes(c.name)).slice(0, 6);
  const sets = DETAIL.adsets;
  const adsetHtml = sets.state === 'loading' ? '<div class="skel"></div><div class="skel"></div>'
    : sets.state === 'err' ? `<div class="state err"><b>Không tải được nhóm quảng cáo</b>${esc(sets.err)}<br><button class="sm" data-ads="reload-adsets">Thử lại</button></div>`
    : sets.list.length ? `<div class="tablewrap"><table class="tbl"><tr><th>Nhóm quảng cáo</th><th>Trạng thái</th><th class="num">Ngân sách/ngày</th></tr>${sets.list.map((s) => `<tr><td>${esc(s.name)}</td><td><span class="tag ${s.status === 'ACTIVE' ? 'on' : 'off'}">${s.status === 'ACTIVE' ? 'Đang chạy' : 'Không chạy'}</span></td><td class="num">${s.budget ? `<input type="number" id="bud_${esc(s.id)}" value="${s.budget}" style="width:110px"> <button class="sm" data-ads="save-budget" data-id="${esc(c.id)}" data-adset="${esc(s.id)}" data-from="${s.budget}" data-name="${esc(c.name + ' › ' + s.name)}">Lưu</button>` : '<small>theo chiến dịch</small>'}</td></tr>`).join('')}</table></div>`
    : sets.state === 'ok' ? '<div class="empty">Không có nhóm quảng cáo.</div>' : '<div class="empty">Chế độ mẫu: không có nhóm quảng cáo.</div>';
  const budgetBlock = c.budgetLevel !== 'adset' && c.budget
    ? `<div class="row"><b>Ngân sách ngày (cấp chiến dịch)</b><input type="number" id="bud_c" value="${c.budget}" style="width:130px"> <button class="sm pri" data-ads="save-budget" data-id="${esc(c.id)}" data-from="${c.budget}">Lưu</button></div>`
    : '<p class="sub" style="margin:0 0 8px">Ngân sách đặt ở cấp nhóm quảng cáo — sửa từng nhóm bên dưới.</p>';
  el.innerHTML = `<div class="hd"><div><h2>${esc(c.name)}</h2><small style="color:var(--mute)">${esc(brandName(c.brand))} · tài khoản ${esc(c.accountId || '—')} · ID ${esc(c.id)}</small><br><span class="tag ${c.status === 'ACTIVE' ? 'on' : 'off'}">${c.status === 'ACTIVE' ? 'Đang chạy' : 'Đã tắt'}</span>${c.stale ? ' <span class="tag off">số liệu cũ</span>' : ''}${c.objective ? ` <span class="tag">${esc(c.objective)}</span>` : ''}</div><button class="sm" data-ads="close">✕ Đóng</button></div>
    <div class="row" style="margin-bottom:10px"><button class="sm ${c.status === 'ACTIVE' ? 'danger' : 'pri'}" data-ads="toggle" data-id="${esc(c.id)}">${c.status === 'ACTIVE' ? 'Tắt chiến dịch' : 'Bật chiến dịch'}</button><a href="${esc(adsMgr(c))}" target="_blank" rel="noopener"><button class="sm" type="button">Mở Meta Ads Manager ↗</button></a></div>
    <div class="kv">${win('today')}${win('d7')}${win('month')}</div>
    ${c.d7 && c.d7.real !== undefined ? `<p class="sub" style="margin:6px 0 0">Khách thật ước tính 7 ngày: <b>${c.d7.real}/${c.d7.msgs} tin</b> (tỷ lệ ${Math.round(c.d7.ratio * 100)}% theo hộp thư của ${esc(brandName(c.brand))})${S.leadStats && S.leadStats.useForAds ? ' — luật đang dùng số này' : ''}.</p>` : ''}
    ${al.map((a) => `<div class="alert ${a.level}">${esc(a.text)}<small>Nguồn: ${esc(a.basis)}</small></div>`).join('')}
    <h3>Bài quảng cáo</h3>${creativesHtml(c)}
    <h3 style="margin-top:16px">Chi tiêu theo ngày (30 ngày)</h3><div id="drawerChart">${chartHtml(DETAIL.series, 'data-ads="reload-dseries"')}</div>
    <h3 style="margin-top:16px">Ngân sách</h3>${budgetBlock}${adsetHtml}
    <h3 style="margin-top:16px">Lịch sử thay đổi gần đây</h3>${logs.length ? logs.map((a) => `<div class="item"><div><small>${esc(a.text)}</small>${a.before !== undefined ? `<br><small style="color:var(--mute)">trước: ${esc(a.before)} → sau: ${esc(a.after)}${a.by ? ' · ' + esc(a.by) : ''}</small>` : ''}</div><small style="color:var(--mute);white-space:nowrap">${when(a.at)}</small></div>`).join('') : '<div class="empty">Chưa có thay đổi nào được ghi nhận.</div>'}`;
}
async function openDetail(id) {
  ADS.detail = id;
  DETAIL.adsets = { state: 'loading', list: [], err: '' };
  DETAIL.series = { key: id, state: 'loading', data: null, err: '' };
  DETAIL.creatives = { state: 'loading', data: null, err: '' };
  drawer();
  loadCreatives(id); loadAdsets(id); loadDetailSeries(id);
}
async function loadCreatives(id, refresh = false) {
  try { const r = await call('GET', `/api/ads/campaigns/${encodeURIComponent(id)}/creatives${refresh ? '?refresh=1' : ''}`); if (ADS.detail === id) DETAIL.creatives = { state: 'ok', data: r, err: '' }; }
  catch (e) { if (ADS.detail === id) DETAIL.creatives = { state: 'err', data: null, err: e.message }; }
  if (ADS.detail === id) drawer();
}
async function loadAdsets(id) {
  try { const r = await call('GET', `/api/ads/campaigns/${encodeURIComponent(id)}/adsets`); if (ADS.detail === id) DETAIL.adsets = { state: 'ok', list: r.adsets, err: '' }; }
  catch (e) { if (ADS.detail === id) DETAIL.adsets = { state: 'err', list: [], err: e.message }; }
  if (ADS.detail === id) drawer();
}
async function loadDetailSeries(id) {
  try { const d = await call('GET', `/api/ads/series?days=30&campaign=${encodeURIComponent(id)}`); if (ADS.detail === id) DETAIL.series = { key: id, state: 'ok', data: d, err: '' }; }
  catch (e) { if (ADS.detail === id) DETAIL.series = { key: id, state: 'err', data: null, err: e.message }; }
  if (ADS.detail === id) drawer();
}

// ---------- Chất lượng tin nhắn: khách tiềm năng / chưa rõ / rác, so với số Facebook báo ----------
const LQ = { lead: ['on', 'Khách tiềm năng'], unknown: ['', 'Chưa rõ'], spam: ['off', 'Rác'] };
function leadQualityCard() {
  const q = S.leadStats;
  if (!q) return '';
  const fbMsgs = (brand) => S.campaigns.filter((c) => c.brand === brand && !c.stale).reduce((s, c) => s + (c.d7 ? c.d7.msgs : 0), 0);
  const rows = S.brands.map((b) => {
    const x = q.byBrand[b.id] || { lead: 0, unknown: 0, spam: 0, total: 0, ratio: null };
    const fb = fbMsgs(b.id);
    return `<tr><td><b>${esc(b.name)}</b></td><td class="num">${fb}</td><td class="num">${x.total}</td><td class="num"><span class="tag on">${x.lead}</span></td><td class="num"><span class="tag">${x.unknown}</span></td><td class="num"><span class="tag off">${x.spam}</span></td><td class="num"><b>${x.ratio === null ? '—' : Math.round(x.ratio * 100) + '%'}</b>${x.ratio !== null && fb ? `<br><small style="color:var(--mute)">≈ ${Math.round(fb * x.ratio)} khách thật</small>` : ''}</td></tr>`;
  }).join('');
  const recent = (q.recent || []).slice(0, 8).map((r) => `<div class="item"><div><span class="tag ${LQ[r.label][0]}">${LQ[r.label][1]}</span> <b>${esc(r.name)}</b> <small style="color:var(--mute)">· ${esc(brandName(r.brand))}${r.reasons && r.reasons.length ? ' · ' + esc(r.reasons.slice(0, 3).join(', ')) : ''}</small><br><small>${esc(r.lastText || '(ảnh/sticker)')}</small></div><small style="color:var(--mute);white-space:nowrap">${when(r.lastAt)}${r.replied ? '' : '<br>chưa trả lời'}</small></div>`).join('');
  const sw = (key, on, label) => `<label class="f" style="display:inline-block;margin-right:14px"><input type="checkbox" data-ads-leads="${key}" ${on ? 'checked' : ''}> ${label}</label>`;
  return `<div class="card"><h2>Chất lượng tin nhắn (7 ngày) <span class="tag info">khách thật so với số Facebook báo</span></h2>
    <p class="sub" style="margin:0 0 8px">Facebook đếm mọi người nhắn, kể cả rác. Agent đọc hộp thư Messenger từng Page và chấm từng cuộc trò chuyện: <b>khách tiềm năng</b> (hỏi dịch vụ, giá, lịch, địa chỉ, gửi ảnh, để lại SĐT), <b>chưa rõ</b> (chỉ chào, chưa hỏi gì), <b>rác</b> (link lạ, chào bán, bot, chửi). Hộp thư không cho biết khách đến từ quảng cáo nào nên tỷ lệ tính theo thương hiệu.${q.lastScan ? ` Chấm lần cuối ${when(q.lastScan)}.` : ' <b>Chưa chấm được lần nào</b> — token cần quyền Nhắn tin (pages_messaging), xem Nhật ký.'}</p>
    <div class="tablewrap"><table class="tbl"><tr><th>Thương hiệu</th><th class="num">Facebook báo (tin, 7 ngày)</th><th class="num">Hội thoại đã chấm</th><th class="num">Khách tiềm năng</th><th class="num">Chưa rõ</th><th class="num">Rác</th><th class="num">Tỷ lệ khách thật</th></tr>${rows}</table></div>
    <div style="margin:8px 0">${sw('on', q.on, 'Chấm chất lượng tin nhắn mỗi lần quét')}${sw('useForAds', q.useForAds, '<b>Luật quảng cáo dùng số khách thật ước tính</b> (tắt/tăng ngân sách, chấm bài thử)')}</div>
    ${recent ? `<h3 style="margin-top:10px">Hội thoại gần đây</h3>${recent}` : '<div class="empty">Chưa có hội thoại nào được chấm.</div>'}
  </div>`;
}

// ---------- Luật + quảng cáo thử (phần cài đặt cũ, giữ nguyên chức năng) ----------
function adsRulesCard() {
  const r = S.settings.rules, s = S.settings;
  const num = (k, key, f, w) => `<input type="number" data-rule="${k}.${key}" value="${f}" ${w || ''}>`;
  const tog = (k) => `<input type="checkbox" data-rule="${k}.on" ${r[k].on ? 'checked' : ''}>`;
  return `<div class="card"><h2>Luật kiểm soát của Sếp</h2>
    <label class="f"><input type="checkbox" data-set="dryRun" ${s.dryRun ? 'checked' : ''}> Chạy thử (bỏ chọn = chạy thật, thao tác ghi lên Facebook)</label>
    <label class="f">Trần ngân sách tháng ${`<input type="number" data-set="monthlyCap" value="${s.monthlyCap}">`} đ (0 = không giới hạn)</label>
    <div class="rule"><label class="f">${tog('highCpl')} <b>Cảnh báo khi giá mỗi kết quả quá cao</b></label>
      Nếu 7 ngày gần nhất đã tiêu ≥ ${num('highCpl', 'minSpend', r.highCpl.minSpend)} đ và giá mỗi tin nhắn (tính cả tuần) > ${num('highCpl', 'maxCostPerMsg', r.highCpl.maxCostPerMsg)} đ → cảnh báo (agent không tự tắt quảng cáo cũ)</div>
    <div class="rule"><label class="f">${tog('noResult')} <b>Cảnh báo chiến dịch tiêu tiền mà không ra kết quả nào</b></label>
      Nếu 7 ngày gần nhất đã tiêu ≥ ${num('noResult', 'minSpend', r.noResult.minSpend)} đ mà 0 tin nhắn → cảnh báo (agent không tự tắt quảng cáo cũ)</div>
    <div class="rule"><label class="f">${tog('monthCap')} <b>Báo khi tổng tiêu trong tháng chạm trần</b> (không tắt quảng cáo cũ)</label></div>
    <div class="rule"><label class="f">${tog('scaleUp')} <b>Đề xuất tăng ngân sách chiến dịch đang rẻ (chờ Sếp duyệt)</b></label>
      Nếu 7 ngày qua có ≥ ${num('scaleUp', 'minMsgs7d', r.scaleUp.minMsgs7d, 'style="width:70px"')} tin nhắn và giá ≤ ${num('scaleUp', 'maxCostPerMsg', r.scaleUp.maxCostPerMsg)} đ → đề xuất tăng ${num('scaleUp', 'pct', r.scaleUp.pct, 'style="width:70px"')}% (tối đa ${num('scaleUp', 'maxDaily', r.scaleUp.maxDaily)} đ/ngày)</div>
    <small style="color:var(--mute)">Luật chỉ áp cho chiến dịch đo bằng tin nhắn. Ngân sách cấp nhóm quảng cáo được đề xuất theo từng nhóm. "Hôm nay" theo múi giờ tài khoản quảng cáo.</small>
  </div>`;
}

// ---------- Trang ----------
function pageAds() {
  const rows = adsRows();
  const accounts = [...new Set(S.campaigns.map((c) => c.accountId).filter(Boolean))];
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`;
  const demo = S.mode !== 'live';
  const html = `<h1>Quảng cáo Facebook${demo ? '<span class="demo">DEMO</span>' : ''}</h1>
  <p class="sub">${demo ? 'Chế độ mẫu — số liệu bên dưới là DỮ LIỆU GIẢ để xem thử giao diện. Nối Meta API để dùng số liệu thật.' : `${esc(S.adsLabel)} · đồng bộ lần cuối ${esc(when(S.lastSync || S.lastScan))}. AI chỉ cảnh báo và đề xuất — không tự đổi ngân sách hay tắt quảng cáo ngoài luật bạn bật.`}</p>
  <div class="toolbar noprint">
    <div class="seg" id="adsPeriod">${Object.entries(PERIODS).map(([k, l]) => `<button class="${ADS.period === k ? 'on' : ''}" data-ads="period" data-p="${k}">${l}</button>`).join('')}</div>
    <select data-ads="f-brand" aria-label="Thương hiệu">${opt('', 'Mọi thương hiệu', ADS.brand)}${S.brands.map((b) => opt(b.id, b.name, ADS.brand)).join('')}</select>
    <select data-ads="f-account" aria-label="Tài khoản quảng cáo">${opt('', 'Mọi tài khoản', ADS.account)}${accounts.map((a) => opt(a, `${a} — ${brandsOfAccount(a)}`, ADS.account)).join('')}</select>
    <select data-ads="f-status" aria-label="Trạng thái">${opt('', 'Mọi trạng thái', ADS.status)}${opt('ACTIVE', 'Đang chạy', ADS.status)}${opt('OFF', 'Đã tắt', ADS.status)}</select>
    <span class="grow"></span>
    <button data-ads="sync" ${ADS.syncing ? 'disabled' : ''}>⟳ Đồng bộ Meta</button><button data-ads="csv">⬇ Xuất Excel (CSV)</button><button data-ads="print">🖨 Xuất PDF (in)</button>
  </div>
  ${adsKpis(rows)}
  ${adsAlerts(rows)}
  <div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Chi tiêu & tin nhắn theo ngày${ADS.account ? ` · tài khoản ${esc(ADS.account)}` : ''}</h2><span class="row noprint"><div class="seg">${[7, 14, 30, 90].map((d) => `<button class="${ADS.days === d ? 'on' : ''}" data-ads="days" data-p="${d}">${d} ngày</button>`).join('')}</div><button class="sm" data-ads="reload-series">⟳</button></span></div><div id="adsChart" style="margin-top:10px">${chartHtml(ADS.series, 'data-ads="retry-series"')}</div></div>
  ${compareHtml(rows)}
  <div class="card"><div class="toolbar" style="margin-bottom:10px"><h2 style="margin:0">Chiến dịch</h2><input class="grow noprint" type="search" id="adsSearch" placeholder="Tìm theo tên hoặc ID chiến dịch…" value="${esc(ADS.q)}" aria-label="Tìm chiến dịch"></div><div id="adsTable">${tableHtml()}</div></div>
  ${leadQualityCard()}${adsRulesCard()}${typeof adTestCard === 'function' ? adTestCard() : ''}
  <div class="card"><h2>Nhật ký thay đổi quảng cáo</h2>${actionList(S.actions.filter((a) => ['pause', 'propose', 'approve', 'reject', 'ads_change'].includes(a.kind)).slice(0, 15))}</div>`;
  setTimeout(() => { if (document.getElementById('adsChart')) loadSeries(false); }, 0);
  return html;
}

// ---------- Sự kiện ----------
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-ads]');
  if (!t) return;
  const k = t.dataset.ads, d = t.dataset;
  if (k === 'period') { ADS.period = d.p; ADS.page = 1; render(); }
  else if (k === 'sort') { ADS.sort = { key: d.key, dir: ADS.sort.key === d.key ? -ADS.sort.dir : (d.key === 'name' || d.key === 'brand' ? 1 : -1) }; paintTable(); }
  else if (k === 'page') { ADS.page = Math.max(1, Number(d.p)); paintTable(); }
  else if (k === 'detail') openDetail(d.id);
  else if (k === 'close') { ADS.detail = null; drawer(); }
  else if (k === 'toggle') adsToggle(d.id);
  else if (k === 'save-budget') adsBudget(d.id, d.adset || '', Number(d.from), d.name);
  else if (k === 'sync') adsSync(t);
  else if (k === 'csv') exportCsv();
  else if (k === 'print') window.print();
  else if (k === 'days') { ADS.days = Number(d.p); ADS.series = { key: '', state: 'idle', data: null, err: '' }; render(); }
  else if (k === 'retry-series' || k === 'reload-series') loadSeries(true);
  else if (k === 'reload-adsets') { DETAIL.adsets = { state: 'loading', list: [], err: '' }; drawer(); loadAdsets(ADS.detail); }
  else if (k === 'reload-creatives') { e.preventDefault(); DETAIL.creatives = { state: 'loading', data: null, err: '' }; drawer(); loadCreatives(ADS.detail, true); }
  else if (k === 'lightbox') { e.preventDefault(); lightbox(d.src, d.link); }
  else if (k === 'reload-dseries') { DETAIL.series = { key: ADS.detail, state: 'loading', data: null, err: '' }; drawer(); loadDetailSeries(ADS.detail); }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.ads === 'pick') {
    if (t.checked && ADS.sel.size >= 4) { t.checked = false; return toast('Chọn tối đa 4 chiến dịch để so sánh'); }
    t.checked ? ADS.sel.add(t.dataset.id) : ADS.sel.delete(t.dataset.id);
    render();
  } else if (t.dataset.ads === 'f-brand') { ADS.brand = t.value; ADS.page = 1; render(); }
  else if (t.dataset.ads === 'f-account') { ADS.account = t.value; ADS.page = 1; ADS.series = { key: '', state: 'idle', data: null, err: '' }; render(); }
  else if (t.dataset.ads === 'f-status') { ADS.status = t.value; ADS.page = 1; render(); }
  else if (t.dataset.adsLeads) {
    if (t.dataset.adsLeads === 'useForAds' && t.checked && !confirm('Luật tắt/tăng ngân sách và chấm bài thử sẽ dùng số khách thật ước tính (số Facebook × tỷ lệ khách thật của thương hiệu) thay vì số Facebook báo. Bật không?')) { t.checked = false; return; }
    act(() => call('POST', '/api/settings', { leads: { [t.dataset.adsLeads]: t.checked } }));
  }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'adsSearch') { ADS.q = e.target.value; ADS.page = 1; paintTable(); }
});
