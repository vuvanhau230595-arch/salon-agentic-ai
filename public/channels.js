// Trang Kênh: bảng kết nối theo thương hiệu × nền tảng với trạng thái THẬT (Facebook Page, Instagram, Facebook Ads, TikTok,
// YouTube, 小红书, Zalo OA, Threads). Chưa kiểm tra thì ghi "Chưa kiểm tra"; kiểm tra chỉ ĐỌC. Thêm/gỡ Page, kết nối/ngắt TikTok và YouTube,
// bật/tắt kênh cho thương hiệu. Nền tảng chưa tích hợp ghi rõ lý do. Giữ lại phần luật 小红书 ở cuối trang.
// Nạp sau agents.js (dùng chung confirmBox, call, toast, render, S, esc).
const CH = { data: null, state: 'idle', err: '', seq: 0, busy: false, brand: '', channel: '', status: '', q: '' };
const CH_TAG = { connected: 'on', limited: 'dry', error: 'off', unchecked: '', not_connected: '', manual: 'info', unsupported: '' };
const CH_ORDER = ['facebook_page', 'instagram', 'ads', 'tiktok', 'youtube', 'xiaohongshu', 'zalo_oa', 'threads'];
const chWhen = (t) => (t ? new Date(t).toLocaleString('vi-VN') : '—');

async function chLoad() {
  const seq = ++CH.seq;
  CH.state = CH.data ? 'ok' : 'loading';
  chPaint();
  try { const d = await call('GET', '/api/channels'); if (seq !== CH.seq) return; CH.data = d; CH.state = 'ok'; CH.err = ''; }
  catch (e) { if (seq !== CH.seq) return; CH.state = 'err'; CH.err = e.message; }
  chPaint();
}
function chRows() {
  const q = CH.q.trim().toLowerCase();
  return CH.data.rows.filter((r) => (!CH.brand || r.brand === CH.brand) && (!CH.channel || r.channel === CH.channel) && (!CH.status || r.status === CH.status)
    && (!q || `${r.name} ${r.externalId} ${r.channelLabel}`.toLowerCase().includes(q)))
    .sort((a, b) => a.brand.localeCompare(b.brand) || CH_ORDER.indexOf(a.channel) - CH_ORDER.indexOf(b.channel));
}

function chSummary() {
  const s = CH.data.summary;
  const k = (l, v, sub, cls = '') => `<div class="kpi ${cls}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`;
  return `<div class="kpis" style="grid-template-columns:repeat(5,minmax(0,1fr))">
    ${k('Đã kết nối', s.connected, 'đã kiểm tra, hoạt động')}
    ${k('Kết nối một phần', s.limited, 'dùng được nhưng có hạn chế')}
    ${k('Lỗi', s.error, s.error ? 'cần xử lý' : 'không có lỗi', s.error ? 'danger' : '')}
    ${k('Chưa kiểm tra', s.unchecked, s.unchecked ? 'bấm "Kiểm tra kết nối"' : 'đã kiểm tra hết')}
    ${k('Đăng thủ công / chưa hỗ trợ', `${s.manual} / ${s.unsupported}`, 'TikTok, 小红书 · Zalo, Threads')}</div>`;
}
function chPerms(p) {
  if (!p.length) return '<small style="color:var(--mute)">Chưa kiểm tra quyền</small>';
  return p.map((x) => `<span class="tag ${x.granted ? 'on' : 'off'}" title="${x.granted ? 'Đã có' : 'Thiếu quyền này'}">${x.granted ? '✓' : '✕'} ${esc(x.name)}</span>`).join(' ');
}
function chActions(r) {
  const out = [];
  const label = r.channel === 'tiktok' ? 'tài khoản TikTok' : 'Page';
  if (r.actions.includes('toggle') && r.channel !== 'ads') out.push(`<label class="f" style="margin:0" title="Bật/tắt kênh này cho thương hiệu"><input type="checkbox" data-ch="toggle" data-brand="${esc(r.brand)}" data-channel="${esc(r.channel)}" ${r.enabled ? 'checked' : ''}> Dùng</label>`);
  if (r.actions.includes('remove')) out.push(`<button class="sm danger" data-ch="remove" data-brand="${esc(r.brand)}" data-id="${esc(r.externalId)}" data-name="${esc(r.name)}">Gỡ ${label}</button>`);
  if (r.actions.includes('connect') && r.channel === 'youtube') out.push(`<a href="/api/youtube/start?brand=${encodeURIComponent(r.brand)}" title="Đăng nhập Google bằng tài khoản sở hữu kênh YouTube của thương hiệu (mỗi thương hiệu 1 kênh)"><button class="sm pri" type="button">${r.externalId ? 'Kết nối lại YouTube' : 'Kết nối YouTube'}</button></a>`);
  else if (r.actions.includes('connect')) out.push(`<a href="/auth/tiktok/start?brand=${encodeURIComponent(r.brand)}" title="Đăng nhập thêm tài khoản TikTok: bài TikTok của thương hiệu sẽ đăng lên tất cả tài khoản"><button class="sm pri" type="button">${r.externalId ? '+ Thêm tài khoản TikTok' : 'Kết nối TikTok'}</button></a>`);
  if (r.actions.includes('nicks')) out.push(`<button class="sm pri" data-ch="nicks" data-brand="${esc(r.brand)}" data-name="${esc(r.brandName)}" data-val="${esc((r.nicks || []).join(', '))}">✏️ ${r.nicks && r.nicks.length ? 'Sửa nick TikTok' : 'Nhập nick TikTok'}</button>`);
  if (r.actions.includes('disconnect')) out.push(`<button class="sm danger" data-ch="disconnect" data-channel="${esc(r.channel)}" data-brand="${esc(r.brand)}" data-id="${esc(r.externalId)}" data-name="${esc(r.name)}">Ngắt kết nối</button>`);
  return out.join(' ');
}
function chRow(r) {
  return `<tr><td><b>${esc(r.brandName)}</b></td><td>${esc(r.channelLabel)}</td>
    <td><b>${esc(r.name)}</b>${r.externalId ? `<br><small style="color:var(--mute)">${esc(r.externalId)}</small>` : ''}</td>
    <td><span class="tag ${CH_TAG[r.status]}">${esc(r.statusText)}</span>${r.error ? `<br><small style="color:var(--bad)">${esc(r.error.slice(0, 220))}</small>` : ''}${r.note ? `<br><small style="color:var(--mute)">${esc(r.note)}</small>` : ''}</td>
    <td style="max-width:230px">${chPerms(r.permissions)}</td>
    <td style="white-space:nowrap"><small>Kiểm tra: ${esc(chWhen(r.lastCheckedAt))}<br>Dùng gần nhất: ${esc(chWhen(r.lastUsedAt))}</small></td>
    <td>${chActions(r)}</td></tr>`;
}
function chAdd() {
  return `<div class="card"><h2>Thêm Facebook Page cho thương hiệu</h2>
    <p class="sub" style="margin:0 0 8px">Page phải được gán cho người dùng hệ thống (<code>salon-agent</code>) trong Meta Business. Hệ thống kiểm tra thật trước khi thêm — Page lỗi sẽ không được thêm.</p>
    <div class="row"><select id="chAddBrand">${S.brands.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select><input type="text" id="chAddPage" placeholder="Page ID (chỉ chữ số)" inputmode="numeric" style="width:230px"><button class="pri" data-ch="add" ${CH.busy ? 'disabled' : ''}>Kiểm tra &amp; thêm Page</button></div></div>`;
}
function chBody() {
  if (CH.state === 'err' && !CH.data) return `<div class="card"><div class="state err"><b>Không tải được danh sách kênh</b>${esc(CH.err)}<br><button class="sm" data-ch="reload">Thử lại</button></div></div>`;
  if (!CH.data) return '<div class="skel" style="height:260px"></div>';
  const d = CH.data, rows = chRows();
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`;
  return `${d.mode === 'mock' ? '<div class="alert danger"><b>Chưa có META_ACCESS_TOKEN</b> — hệ thống đang ở chế độ mẫu, chưa kiểm tra được Facebook/Instagram.</div>' : ''}
    ${d.perms && d.perms.error ? `<div class="alert">Không đọc được danh sách quyền của token: ${esc(d.perms.error)} (token hệ thống đôi khi không trả danh sách này; trạng thái từng kênh vẫn dựa trên kiểm tra thật bên dưới).</div>` : ''}
    ${chSummary()}
    <div class="toolbar noprint"><button class="pri" data-ch="check" ${CH.busy || d.checking ? 'disabled' : ''}>${CH.busy ? 'Đang kiểm tra…' : '⟳ Kiểm tra kết nối'}</button><small style="color:var(--mute)">Lần kiểm tra gần nhất: ${esc(chWhen(d.lastCheckedAt))} · chỉ đọc, không đăng hay đổi gì</small></div>
    <div class="toolbar noprint"><select data-ch="f-brand" aria-label="Thương hiệu">${opt('', 'Mọi thương hiệu', CH.brand)}${S.brands.map((b) => opt(b.id, b.name, CH.brand)).join('')}</select>
      <select data-ch="f-channel" aria-label="Nền tảng">${opt('', 'Mọi nền tảng', CH.channel)}${[...new Set(d.rows.map((r) => r.channel))].sort((a, b) => CH_ORDER.indexOf(a) - CH_ORDER.indexOf(b)).map((c) => opt(c, d.rows.find((r) => r.channel === c).channelLabel, CH.channel)).join('')}</select>
      <select data-ch="f-status" aria-label="Trạng thái">${opt('', 'Mọi trạng thái', CH.status)}${[['connected', 'Đã kết nối'], ['limited', 'Kết nối một phần'], ['error', 'Lỗi'], ['unchecked', 'Chưa kiểm tra'], ['not_connected', 'Chưa kết nối'], ['manual', 'Đăng thủ công'], ['unsupported', 'Chưa hỗ trợ']].map(([k, l]) => opt(k, l, CH.status)).join('')}</select>
      <input class="grow" type="search" id="chSearch" placeholder="Tìm Page, tài khoản, ID…" value="${esc(CH.q)}" aria-label="Tìm kênh"></div>
    <div class="tablewrap"><table class="tbl"><thead><tr><th>Thương hiệu</th><th>Nền tảng</th><th>Tài khoản / Page</th><th>Trạng thái</th><th>Quyền token</th><th>Thời gian</th><th>Thao tác</th></tr></thead><tbody>${rows.map(chRow).join('') || '<tr><td colspan="7"><div class="state"><b>Không có kênh nào khớp bộ lọc</b></div></td></tr>'}</tbody></table></div>
    <p class="sub" style="margin:8px 0 0">${rows.length} kênh. "Dùng" là bật/tắt kênh cho thương hiệu (tắt thì không đăng bài lên kênh đó); không phải ngắt kết nối. Token Meta nằm trong file .env trên máy chủ, không bao giờ hiện ở giao diện.</p>${chAdd()}`;
}
function chPaint() { const el = document.getElementById('chBody'); if (el) el.innerHTML = chBody(); }

function pageChannels() {
  const html = `<h1>Kênh</h1><p class="sub">Tình trạng kết nối thật của từng nền tảng theo thương hiệu. Hệ thống không báo "đã kết nối" khi chưa kiểm tra bằng API.</p>
  <div id="chBody">${chBody()}</div>
  <div class="card"><h2>Luật kiểm tra bài 小红书</h2>
    <p class="sub" style="margin:0 0 8px">Tổng hợp từ bài viết của các trang marketing và văn phòng luật — <b>không phải điều khoản chính thức</b> của Xiaohongshu, có thể đã cũ. Hãy đối chiếu với "社区公约" trong app định kỳ.</p>
    <table><tr><th>Mức</th><th>Luật</th></tr>
      <tr><td><span class="tag off">CHẶN</span></td><td>WeChat/Zalo/số điện thoại/link/mã QR/sàn TMĐT trong bài · từ cực đoan (最/第一/顶级/唯一…) · tiêu đề &gt; 20 chữ · nội dung &gt; 1000 chữ · thiếu tiêu đề/nội dung</td></tr>
      <tr><td><span class="tag dry">Cảnh báo</span></td><td>Giọng khách tự kể từ tài khoản salon · lời hứa kết quả · hạ thấp đối thủ · công dụng y tế · &gt; 10 hashtag · video &lt; 1080P · người hiện mặt chưa xác nhận đồng ý · watermark nền tảng khác</td></tr>
      <tr><td><span class="tag">Nhắc</span></td><td>Từ khuyến mại trực diện · thiếu hashtag · thiếu lời mời nhắn riêng (私信)</td></tr></table>
    <p class="sub" style="margin:10px 0 0">Bài bị CHẶN không duyệt được cho đến khi sửa. Vị trí (POI) của quán ở Việt Nam không gắn được trên 小红书 nên địa chỉ nằm trong nội dung bài.</p></div>`;
  setTimeout(chLoad, 0);
  return html;
}

// ---------- Hành động ----------
async function chCheck() {
  CH.busy = true; chPaint();
  try { CH.data = await call('POST', '/api/channels/check', {}); toast('Đã kiểm tra xong (chỉ đọc)'); }
  catch (e) { toast(e.message); }
  CH.busy = false; chPaint();
}
async function chAddPage() {
  const brand = document.getElementById('chAddBrand').value, pageId = document.getElementById('chAddPage').value.trim();
  if (!/^\d{5,25}$/.test(pageId)) return toast('Page ID chỉ gồm chữ số');
  CH.busy = true; chPaint();
  try { CH.data = await call('POST', '/api/channels/facebook/add', { brand, pageId }); S = await call('GET', '/api/state'); toast(`Đã thêm Page "${CH.data.added.name}"`); render(); }
  catch (e) { toast(e.message); }
  CH.busy = false; chPaint();
}
async function chRemovePage(brand, pageId, name) {
  const ok = await confirmBox({ title: 'Gỡ Page khỏi thương hiệu?', body: `<p><b>${esc(name)}</b> (${esc(pageId)})</p><p>Các bài đăng sau này sẽ không lên Page này nữa. Page vẫn còn nguyên trên Facebook, chỉ ngừng dùng trong hệ thống.</p>`, ok: 'Gỡ Page', danger: true });
  if (!ok) return;
  try { CH.data = await call('POST', '/api/channels/facebook/remove', { brand, pageId }); S = await call('GET', '/api/state'); toast('Đã gỡ Page'); render(); } catch (e) { toast(e.message); }
  chPaint();
}
async function chDisconnectTiktok(brand, name, openId) {
  const ok = await confirmBox({ title: 'Ngắt kết nối TikTok?', body: `<p><b>${esc(name)}</b></p><p>Hệ thống sẽ xoá quyền đăng nhập đã lưu của tài khoản TikTok này (và thu hồi nếu TikTok cho phép). Các tài khoản TikTok khác của thương hiệu vẫn đăng bình thường. Muốn dùng lại phải kết nối lại.</p>`, ok: 'Ngắt kết nối', danger: true });
  if (!ok) return;
  try { await call('POST', '/api/tiktok/disconnect', { brand, openId }); S = await call('GET', '/api/state'); toast('Đã ngắt kết nối TikTok'); render(); } catch (e) { toast(e.message); }
}
async function chDisconnectYoutube(brand, name) {
  const ok = await confirmBox({ title: 'Ngắt kết nối YouTube?', body: `<p><b>${esc(name)}</b></p><p>Hệ thống sẽ thu hồi quyền ở Google và xoá quyền đăng nhập đã lưu của kênh này. Video đã đăng vẫn còn trên YouTube. Muốn dùng lại phải kết nối lại.</p>`, ok: 'Ngắt kết nối', danger: true });
  if (!ok) return;
  try { await call('POST', '/api/youtube/disconnect', { brand }); S = await call('GET', '/api/state'); toast('Đã ngắt kết nối YouTube'); chLoad(); render(); } catch (e) { toast(e.message); }
}
// TikTok đăng tay: các nick của thương hiệu (tên công khai, không cần mật khẩu/mã). Lưu vào ô tên tài khoản TikTok.
async function chEditNicks(brand, name, val) {
  // confirmBox xoá hộp thoại trước khi trả kết quả: giữ nội dung ô nhập mỗi lần gõ
  let typed = String(val || '').split(', ').join(String.fromCharCode(10));
  const onInput = (e) => { if (e.target.id === 'ttNicksInput') typed = e.target.value; };
  document.addEventListener('input', onInput);
  const ok = await confirmBox({ title: `Nick TikTok · ${name}`, ok: 'Lưu',
    body: `<p>Ghi các nick TikTok của thương hiệu, cách nhau dấu phẩy hoặc mỗi dòng 1 nick (dán link trang TikTok cũng được). Tối đa 10 nick. Mỗi bài TikTok sẽ cần đăng lên tất cả nick này.</p>
      <textarea id="ttNicksInput" rows="4" style="width:100%" placeholder="@theone.hairsalon, @theone.hcm">${esc(String(val || '').split(', ').join(String.fromCharCode(10)))}</textarea>` });
  document.removeEventListener('input', onInput);
  if (!ok) return;
  const handle = typed.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean).join(', ');
  if (handle.length > 200) { toast('Danh sách nick quá dài (tối đa 200 ký tự)'); return; }
  try { S = await call('POST', '/api/brands', { id: brand, channels: { tiktok: { handle } } }); toast(handle ? 'Đã lưu nick TikTok' : 'Đã xoá nick TikTok'); chLoad(); render(); }
  catch (e) { toast(e.message); }
}
async function chToggle(brand, channel, on, box) {
  try { S = await call('POST', '/api/brands', { id: brand, channels: { [channel]: { on } } }); toast(on ? 'Đã bật kênh cho thương hiệu' : 'Đã tắt kênh cho thương hiệu'); render(); }
  catch (e) { toast(e.message); box.checked = !on; }
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-ch]');
  if (!t || ['SELECT', 'INPUT'].includes(t.tagName)) return;
  const k = t.dataset.ch;
  if (k === 'reload') chLoad();
  else if (k === 'check') chCheck();
  else if (k === 'add') chAddPage();
  else if (k === 'remove') chRemovePage(t.dataset.brand, t.dataset.id, t.dataset.name);
  else if (k === 'nicks') chEditNicks(t.dataset.brand, t.dataset.name, t.dataset.val);
  else if (k === 'disconnect' && t.dataset.channel === 'youtube') chDisconnectYoutube(t.dataset.brand, t.dataset.name);
  else if (k === 'disconnect') chDisconnectTiktok(t.dataset.brand, t.dataset.name, t.dataset.id);
});
document.addEventListener('change', (e) => {
  const t = e.target, k = t.dataset.ch;
  if (!k) return;
  if (k === 'toggle') chToggle(t.dataset.brand, t.dataset.channel, t.checked, t);
  else if (k === 'f-brand') { CH.brand = t.value; chPaint(); }
  else if (k === 'f-channel') { CH.channel = t.value; chPaint(); }
  else if (k === 'f-status') { CH.status = t.value; chPaint(); }
});
document.addEventListener('input', (e) => { if (e.target.id === 'chSearch') { CH.q = e.target.value; const el = document.getElementById('chBody'); if (el) { const pos = e.target.selectionStart; chPaint(); const s = document.getElementById('chSearch'); if (s) { s.focus(); s.setSelectionRange(pos, pos); } } } });
