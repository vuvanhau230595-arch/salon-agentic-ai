// Khung giao diện: sidebar có icon + thu gọn, breadcrumb, tìm kiếm toàn cục, thông báo, sáng/tối, trạng thái kết nối, mất mạng.
// Nạp sau app.js: định nghĩa lại nav() (app.js gọi nav() mỗi lần render).
const ICON = {
  '': '<path d="M3 11l9-8 9 8v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/>',
  duyet: '<path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/>',
  kehoach: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
  lich: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 14h2M14 14h2M8 18h2"/>',
  laitudong: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  agent: '<rect x="5" y="8" width="14" height="11" rx="2"/><path d="M12 8V4M9 13h.01M15 13h.01M9 17h6"/>',
  ads: '<path d="M3 20h18M6 16V9M11 16V5M16 16v-5M21 16V8"/>',
  kenh: '<circle cx="12" cy="12" r="3"/><path d="M5.6 5.6a9 9 0 000 12.8M18.4 5.6a9 9 0 010 12.8M8.5 8.5a5 5 0 000 7M15.5 8.5a5 5 0 010 7"/>',
  nhatky: '<path d="M8 4h10a2 2 0 012 2v14H8a2 2 0 01-2-2V6a2 2 0 012-2zM6 8H4M6 12H4M6 16H4M11 9h6M11 13h6"/>',
  thuonghieu: '<path d="M4 21V8l8-5 8 5v13M9 21v-6h6v6M9 11h.01M15 11h.01"/>',
  media: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>',
  traloi: '<path d="M21 12a8 8 0 01-11.5 7.2L4 20l1-4.5A8 8 0 1121 12zM8 11h8M8 14h5"/>',
  baihoc: '<path d="M9 18h6M10 21h4M12 3a6 6 0 00-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0012 3z"/>',
  caidat: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
};
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* chế độ riêng tư: bỏ qua */ } },
};

let ME = null;
call('GET', '/api/me').then((m) => { ME = m; if (typeof S !== 'undefined' && S) nav(); }).catch(() => {});

function connRows() {
  const e = S.env || {};
  const tt = S.tiktok || {};
  const meta = S.mode === 'live';
  const ai = e.anthropic || e.gemini;
  const row = (cls, label) => `<div title="${esc(label)}"><i class="dot ${cls}"></i><span>${esc(label)}</span></div>`;
  const who = ME ? `<div title="Người đang đăng nhập"><i class="dot ok"></i><span>${esc(ME.user.name)} · ${esc(ME.user.roleLabel)}</span></div>` : '';
  return who + row(meta ? 'ok' : 'warn', meta ? 'Meta API: đã nối' : 'Meta API: chế độ mẫu')
    + row(tt.mode === 'api' && tt.configured ? 'ok' : 'warn', tt.mode === 'api' ? (tt.configured ? 'TikTok: API' : 'TikTok: chưa cấu hình') : 'TikTok: đăng thủ công')
    + row(ai ? 'ok' : 'warn', ai ? 'AI: đã nối' : 'AI: chưa có khoá')
    + row(S.settings.dryRun ? 'warn' : 'ok', S.settings.dryRun ? 'Chế độ: chạy thử' : 'Chế độ: chạy thật');
}

function nav() {
  const cur = location.hash.slice(1);
  $('#nav').innerHTML = PAGES.map(([id, l]) => {
    const n = id === 'duyet' && S.approvals.length ? `<span class="n">${S.approvals.length}</span>` : '';
    return `<a href="#${id}" class="${cur === id ? 'on' : ''}" title="${esc(l)}" ${cur === id ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[id] || ICON['']}</svg><span class="t">${esc(l)}</span>${n}</a>`;
  }).join('');
  $('#conn').innerHTML = connRows();
  const page = (PAGES.find(([id]) => id === cur) || PAGES[0])[1];
  $('#crumb').innerHTML = `<span class="hide-s">Salon Agentic AI / </span><b>${esc(page)}</b>`;
  const k = $('#killBtn');
  k.textContent = S.settings.paused ? '▶ Bật lại agent' : '⏻ Dừng khẩn cấp';
  k.className = 'kill' + (S.settings.paused ? ' active' : '');
  bell();
}

// ----- Thông báo -----
function notices() {
  const out = [];
  const nt = S.settings.notify || { approvals: true, alerts: true, errors: true };
  if (nt.approvals) for (const a of S.approvals.slice(0, 6)) out.push({ t: a.title, s: 'Chờ Sếp duyệt', h: '#duyet' });
  if (nt.alerts) for (const a of (S.adAlerts || []).filter((x) => x.level === 'danger').slice(0, 5)) out.push({ t: a.campaign, s: a.text, h: '#ads' });
  const day = Date.now() - 864e5;
  if (nt.errors) for (const a of S.actions.filter((x) => x.kind === 'error' && new Date(x.at).getTime() > day).slice(0, 4)) out.push({ t: 'Lỗi hệ thống', s: a.text, h: '#nhatky' });
  return out;
}
function bell() {
  const n = notices();
  const b = $('#bellN');
  b.style.display = n.length ? 'block' : 'none';
  b.textContent = n.length > 99 ? '99+' : n.length;
  $('#bellPop').innerHTML = `<h4>Thông báo (${n.length})</h4>${n.length ? n.map((x) => `<a class="it" style="display:block;color:inherit;text-decoration:none" href="${x.h}"><b>${esc(x.t)}</b><small>${esc(x.s)}</small></a>`).join('') : '<div class="empty">Không có thông báo mới.</div>'}`;
}

// ----- Tìm kiếm toàn cục -----
function searchResults(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const [id, l] of PAGES) if (l.toLowerCase().includes(q)) out.push({ label: l, sub: 'Trang', go: () => { location.hash = '#' + id; } });
  for (const b of S.brands) if (b.name.toLowerCase().includes(q)) out.push({ label: b.name, sub: 'Thương hiệu', go: () => { location.hash = '#thuonghieu'; } });
  for (const c of S.campaigns.filter((x) => x.name.toLowerCase().includes(q)).slice(0, 8)) out.push({ label: c.name, sub: 'Chiến dịch · ' + brandName(c.brand), go: () => { ADS.q = ''; ADS.brand = ''; ADS.account = ''; ADS.status = ''; location.hash = '#ads'; render(); openDetail(c.id); } });
  return out.slice(0, 10);
}
let gres = [];
function showResults() {
  const box = $('#gresults');
  gres = searchResults($('#gsearch').value);
  box.style.display = gres.length || $('#gsearch').value.trim() ? 'block' : 'none';
  box.innerHTML = gres.length ? gres.map((r, i) => `<a href="#" data-g="${i}"><b>${esc(r.label)}</b><br><small>${esc(r.sub)}</small></a>`).join('') : '<a href="#" onclick="return false"><small>Không có kết quả</small></a>';
}
function pickResult(i) { const r = gres[i]; if (!r) return; $('#gresults').style.display = 'none'; $('#gsearch').value = ''; r.go(); }

// ----- Gắn sự kiện -----
function applyCollapsed(on) { document.body.classList.toggle('collapsed', on); store.set('navCollapsed', on ? '1' : '0'); }
applyCollapsed(store.get('navCollapsed') === '1');
$('#collapseBtn').onclick = () => applyCollapsed(!document.body.classList.contains('collapsed'));
$('#menuBtn').onclick = () => document.body.classList.toggle('navopen');
document.addEventListener('click', (e) => {
  if (document.body.classList.contains('navopen') && (e.target.closest('#nav a') || e.target === document.body)) document.body.classList.remove('navopen');
  const g = e.target.closest('[data-g]');
  if (g) { e.preventDefault(); pickResult(Number(g.dataset.g)); return; }
  if (!e.target.closest('.gsearch')) $('#gresults').style.display = 'none';
  if (e.target.closest('#bellBtn')) $('#bellPop').classList.toggle('open');
  else if (!e.target.closest('#bellPop')) $('#bellPop').classList.remove('open');
});
$('#gsearch').addEventListener('input', showResults);
$('#gsearch').addEventListener('focus', showResults);
$('#gsearch').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); pickResult(0); }
  else if (e.key === 'Escape') { $('#gresults').style.display = 'none'; e.target.blur(); }
});
$('#themeBtn').onclick = () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  store.set('theme', next);
};
window.addEventListener('hashchange', () => document.body.classList.remove('navopen'));

// ----- Mất kết nối -----
let offline = false;
function setOffline(v) { if (v === offline) return; offline = v; $('#offline').classList.toggle('on', v); if (!v) call('GET', '/api/state').then((s) => { S = s; render(); }).catch(() => {}); }
async function heartbeat() {
  if (!navigator.onLine) return setOffline(true);
  try { const r = await fetch('/healthz', { cache: 'no-store' }); setOffline(!r.ok); } catch { setOffline(true); }
}
window.addEventListener('offline', () => setOffline(true));
window.addEventListener('online', heartbeat);
setInterval(heartbeat, 20000);
