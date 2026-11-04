// Trang Nhật ký (audit log): ai làm gì, lên đối tượng nào, lúc nào, kết quả, lỗi, giá trị trước/sau. Dữ liệu từ /api/audit
// (file nhật ký bền, không giới hạn 300 dòng như danh sách tạm). Có lọc, tìm kiếm, phân trang, xuất CSV, in. Chỉ đọc.
// Nạp sau channels.js (dùng chung call, toast, render, S, esc).
const AUD = { range: '7d', from: '', to: '', actor: '', kind: '', status: '', object: '', q: '', offset: 0, per: 25, data: null, stats: null, state: 'idle', err: '', open: new Set(), seq: 0 };
const AUD_KIND = {
  pause: 'Tắt chiến dịch', propose: 'Đề xuất', approve: 'Duyệt', reject: 'Từ chối', publish: 'Đăng bài', error: 'Lỗi', system: 'Hệ thống',
  ads_change: 'Đổi quảng cáo', automation: 'Đổi quy trình', calendar: 'Lịch đăng', monthplan: 'Kế hoạch tháng', settings: 'Cài đặt', user: 'Tài khoản', security: 'Bảo mật', data: 'Dữ liệu', brand: 'Thương hiệu', lesson: 'Bài học AI', media: 'Thư viện media',
};
const AUD_STATUS = { ok: ['on', 'Thành công'], error: ['off', 'Lỗi'], dry: ['dry', 'Chạy thử'], proposed: ['info', 'Đề xuất'] };
const AUD_ICON = { user: '👤', agent: '🤖', system: '⚙️' };
const audWhen = (t) => new Date(t).toLocaleString('vi-VN');

function audRange() {
  const now = Date.now(), day = 864e5;
  if (AUD.range === 'custom') return { from: AUD.from ? new Date(AUD.from + 'T00:00:00').toISOString() : '', to: AUD.to ? new Date(AUD.to + 'T23:59:59').toISOString() : '' };
  const d = { '24h': 1, '7d': 7, '30d': 30 }[AUD.range];
  return d ? { from: new Date(now - d * day).toISOString(), to: '' } : { from: '', to: '' };
}
function audQuery(extra = {}) {
  const r = audRange();
  return new URLSearchParams(Object.entries({ ...r, actor: AUD.actor, kind: AUD.kind, status: AUD.status, object: AUD.object, q: AUD.q.trim(), ...extra }).filter(([, v]) => v !== '' && v !== undefined && v !== null));
}
async function audLoad() {
  const seq = ++AUD.seq;
  AUD.state = AUD.data ? 'ok' : 'loading';
  audPaint();
  try {
    const [data, stats] = await Promise.all([
      call('GET', '/api/audit?' + audQuery({ limit: AUD.per, offset: AUD.offset })),
      call('GET', '/api/audit?' + new URLSearchParams({ from: new Date(Date.now() - 864e5).toISOString(), limit: 1 })),
    ]);
    if (seq !== AUD.seq) return;
    AUD.data = data; AUD.stats = stats; AUD.state = 'ok'; AUD.err = '';
  } catch (e) { if (seq !== AUD.seq) return; AUD.state = 'err'; AUD.err = e.message; }
  audPaint();
}

function audDetail(e) {
  const kv = (k, v) => (v ? `<div><small style="color:var(--mute)">${k}</small><div style="word-break:break-word">${esc(v)}</div></div>` : '');
  return `<tr><td colspan="6" style="background:var(--soft)"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;padding:4px 2px">
    ${kv('Hành động đầy đủ', e.action)}${kv('Người thực hiện', `${e.actor.name} (${{ user: 'con người', agent: 'agent AI', system: 'hệ thống' }[e.actor.type]})`)}
    ${kv('Đối tượng', e.object ? `${e.object.type}: ${e.object.id}` : '')}${kv('Trường thay đổi', e.field)}${kv('Giá trị trước', e.before)}${kv('Giá trị sau', e.after)}
    ${kv('Quy tắc / quy trình', e.rule)}${e.error ? `<div style="grid-column:1/-1"><small style="color:var(--mute)">Chi tiết lỗi</small><div class="alert danger" style="margin:2px 0">${esc(e.error)}</div></div>` : ''}
    ${kv('Mã nhật ký', e.id)}${e.imported ? kv('Ghi chú', 'Nhập từ nhật ký cũ (trước khi có nhật ký kiểm toán)') : ''}${e.dry ? kv('Chế độ', 'Chạy thử — chưa tác động ra ngoài') : ''}</div></td></tr>`;
}
function audRows() {
  return AUD.data.rows.map((e) => {
    const st = AUD_STATUS[e.status] || ['', e.status], open = AUD.open.has(e.id);
    return `<tr class="click" data-aud="toggle" data-id="${esc(e.id)}"><td style="white-space:nowrap">${esc(audWhen(e.at))}</td>
      <td style="white-space:nowrap">${AUD_ICON[e.actor.type]} ${esc(e.actor.name)}</td>
      <td style="min-width:260px"><span class="tag">${esc(e.kindLabel)}</span> ${esc(e.action.length > 140 && !open ? e.action.slice(0, 140) + '…' : e.action)}</td>
      <td>${e.object ? `${esc(e.object.type)}<br><small style="color:var(--mute)">${esc(e.object.id)}</small>` : '—'}</td>
      <td><span class="tag ${st[0]}">${esc(st[1])}</span></td><td class="num" aria-hidden="true">${open ? '▾' : '▸'}</td></tr>${open ? audDetail(e) : ''}`;
  }).join('');
}

function audTop() {
  const s = AUD.stats;
  if (!s) return '';
  const f = s.facets, n = (o, k) => (o && o[k]) || 0;
  const agents = Object.entries(f.actors).filter(([name]) => name !== 'Sếp' && name !== 'Hệ thống').reduce((a, [, v]) => a + v, 0);
  const k = (l, v, sub, cls = '') => `<div class="kpi ${cls}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`;
  return `<div class="kpis" style="grid-template-columns:repeat(5,minmax(0,1fr))">
    ${k('24 giờ qua', s.total, 'dòng nhật ký')}${k('Lỗi', n(f.status, 'error'), '24 giờ qua', n(f.status, 'error') ? 'danger' : '')}
    ${k('Sếp thao tác', n(f.actors, 'Sếp'), '24 giờ qua')}${k('Agent thực hiện', agents, '24 giờ qua')}${k('Chạy thử', n(f.status, 'dry'), 'chưa tác động ra ngoài')}</div>`;
}
function audBody() {
  if (AUD.state === 'err' && !AUD.data) return `<div class="card"><div class="state err"><b>Không tải được nhật ký</b>${esc(AUD.err)}<br><button class="sm" data-aud="reload">Thử lại</button></div></div>`;
  if (!AUD.data) return '<div class="skel" style="height:300px"></div>';
  const d = AUD.data, pages = Math.max(1, Math.ceil(d.total / AUD.per)), page = Math.floor(AUD.offset / AUD.per) + 1;
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`;
  const actors = Object.keys(AUD.stats ? AUD.stats.facets.actors : {});
  const known = ['Sếp', 'Hệ thống', ...(S.agents || []).map((a) => a.name)];
  const actorList = [...new Set([...known, ...actors, ...(AUD.actor ? [AUD.actor] : [])])];
  return `<div class="toolbar noprint">
      <div class="seg">${[['24h', '24 giờ'], ['7d', '7 ngày'], ['30d', '30 ngày'], ['all', 'Tất cả'], ['custom', 'Tuỳ chọn']].map(([k, l]) => `<button class="${AUD.range === k ? 'on' : ''}" data-aud="range" data-v="${k}">${l}</button>`).join('')}</div>
      ${AUD.range === 'custom' ? `<input type="date" data-aud="from" value="${esc(AUD.from)}" aria-label="Từ ngày"> → <input type="date" data-aud="to" value="${esc(AUD.to)}" aria-label="Đến ngày">` : ''}
      <span class="grow"></span><button class="sm" data-aud="csv">⬇ Xuất CSV</button><button class="sm" data-aud="print">🖨 In</button></div>
    <div class="toolbar noprint">
      <select data-aud="f-actor" aria-label="Người thực hiện">${opt('', 'Mọi người thực hiện', AUD.actor)}${actorList.map((a) => opt(a, a, AUD.actor)).join('')}</select>
      <select data-aud="f-kind" aria-label="Loại hành động">${opt('', 'Mọi loại', AUD.kind)}${Object.entries(AUD_KIND).map(([k, l]) => opt(k, l, AUD.kind)).join('')}</select>
      <select data-aud="f-status" aria-label="Trạng thái">${opt('', 'Mọi trạng thái', AUD.status)}${Object.entries(AUD_STATUS).map(([k, v]) => opt(k, v[1], AUD.status)).join('')}</select>
      <select data-aud="f-object" aria-label="Đối tượng">${opt('', 'Mọi đối tượng', AUD.object)}${['Chiến dịch', 'Bài đăng', 'Quy trình', 'Công việc', 'Kế hoạch tháng', 'Agent', 'Thương hiệu'].map((o) => opt(o, o, AUD.object)).join('')}</select>
      <input class="grow" type="search" id="audSearch" placeholder="Tìm trong hành động, mã đối tượng, giá trị…" value="${esc(AUD.q)}" aria-label="Tìm nhật ký"></div>
    <div class="tablewrap"><table class="tbl"><thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Hành động</th><th>Đối tượng</th><th>Kết quả</th><th></th></tr></thead><tbody>${audRows() || '<tr><td colspan="6"><div class="state"><b>Không có dòng nhật ký nào</b>Thử mở rộng khoảng thời gian hoặc bỏ bớt bộ lọc.</div></td></tr>'}</tbody></table></div>
    <div class="pager"><span>${d.total} dòng khớp / ${d.all} dòng đã lưu · bấm một dòng để xem chi tiết, giá trị trước/sau</span><span class="row noprint"><button class="sm" data-aud="page" data-p="${AUD.offset - AUD.per}" ${page <= 1 ? 'disabled' : ''}>‹ Trước</button> Trang ${page}/${pages} <button class="sm" data-aud="page" data-p="${AUD.offset + AUD.per}" ${page >= pages ? 'disabled' : ''}>Sau ›</button></span></div>`;
}
function audPaint() { const b = document.getElementById('audBody'); if (b) b.innerHTML = audBody(); const t = document.getElementById('audTop'); if (t) t.innerHTML = audTop(); }

function pageLog() {
  const html = `<h1>Nhật ký</h1><p class="sub">Mọi việc Sếp, agent và hệ thống đã làm: ai, làm gì, lên đối tượng nào, lúc nào, kết quả. Nhật ký lưu bền ở máy chủ (xoay file khi lớn) và được sao lưu hằng ngày. Chuỗi giống token/khoá được che trước khi ghi.</p>
  <div id="audTop">${audTop()}</div><div id="audBody">${audBody()}</div>`;
  setTimeout(audLoad, 0);
  return html;
}

let audTimer = null;
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-aud]');
  if (!t || ['SELECT', 'INPUT'].includes(t.tagName)) return;
  const k = t.dataset.aud;
  if (k === 'reload') audLoad();
  else if (k === 'range') { AUD.range = t.dataset.v; AUD.offset = 0; audLoad(); }
  else if (k === 'page') { AUD.offset = Math.max(0, Number(t.dataset.p)); audLoad(); }
  else if (k === 'toggle') { const id = t.dataset.id; AUD.open.has(id) ? AUD.open.delete(id) : AUD.open.add(id); audPaint(); }
  else if (k === 'csv') {
    const a = document.createElement('a');
    a.href = '/api/audit/export?' + audQuery();
    a.download = '';
    document.body.appendChild(a); a.click(); a.remove();
    toast('Đang tải CSV theo bộ lọc hiện tại');
  }
  else if (k === 'print') { for (const x of AUD.data.rows) AUD.open.add(x.id); audPaint(); window.print(); }
});
document.addEventListener('change', (e) => {
  const t = e.target, k = t.dataset.aud;
  if (!k) return;
  const map = { 'f-actor': 'actor', 'f-kind': 'kind', 'f-status': 'status', 'f-object': 'object', from: 'from', to: 'to' };
  if (map[k]) { AUD[map[k]] = t.value; AUD.offset = 0; audLoad(); }
});
document.addEventListener('input', (e) => {
  if (e.target.id !== 'audSearch') return;
  AUD.q = e.target.value; AUD.offset = 0;
  clearTimeout(audTimer);
  audTimer = setTimeout(async () => { await audLoad(); const s = document.getElementById('audSearch'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }, 350);
});
