// Trang Thương hiệu & Kênh: trung tâm từng thương hiệu — tổng quan (mức đầy đủ hồ sơ, quảng cáo, kế hoạch, khuyến mãi, kênh),
// hồ sơ & quy định truyền thông, nhận diện (logo, màu, font), chi nhánh, kênh & tài khoản quảng cáo. Mọi số liệu chỉ của đúng thương hiệu đang chọn.
// Nạp sau auditlog.js (dùng chung call, toast, render, S, esc, vnd, fileUrl, confirmBox).
const BR = { id: '', tab: 'overview', summary: null, data: null, state: 'idle', err: '', seq: 0, draft: {}, saving: false, images: null };
const BR_TABS = [['overview', 'Tổng quan'], ['profile', 'Hồ sơ & truyền thông'], ['identity', 'Nhận diện'], ['branches', 'Chi nhánh'], ['channels', 'Kênh & tài khoản']];
const BR_ST = { connected: 'on', limited: 'dry', error: 'off', unchecked: '', not_connected: '', manual: 'info', unsupported: '' };
const BR_KPI = { ok: ['on', 'Đúng tiến độ'], warn: ['dry', 'Hơi chậm'], bad: ['off', 'Chậm'], none: ['', 'Chưa có số liệu'] };
const BR_FIX = { hotline: 'profile', address: 'branches', services: 'profile', tone: 'profile', avoid: 'profile', hashtags: 'profile', page: 'channels', ads: 'channels', logo: 'identity', colors: 'identity' };

async function brLoad() {
  const seq = ++BR.seq;
  BR.state = BR.data && BR.data.brand.id === BR.id ? 'ok' : 'loading';
  brPaint();
  try {
    const sum = await call('GET', '/api/brand-center');
    if (!BR.id) BR.id = sum.brands[0].id;
    const d = await call('GET', `/api/brand-center/${encodeURIComponent(BR.id)}`);
    if (seq !== BR.seq) return;
    BR.summary = sum.brands; BR.data = d; BR.state = 'ok'; BR.err = '';
  } catch (e) { if (seq !== BR.seq) return; BR.state = 'err'; BR.err = e.message; }
  brPaint();
}
const brDraft = (key, fallback) => (BR.draft[key] !== undefined ? BR.draft[key] : fallback);
const brDirty = () => Object.keys(BR.draft).length > 0;

// ---------- Chọn thương hiệu ----------
function brPicker() {
  if (!BR.summary) return '';
  return `<div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">${BR.summary.map((b) => `<div class="card" data-br="pick" data-id="${esc(b.id)}" style="cursor:pointer;border-top:3px solid ${esc(b.color || 'var(--brand)')};${BR.id === b.id ? 'outline:2px solid var(--brand)' : ''}">
    <div class="row" style="justify-content:space-between"><b>${esc(b.name)}</b><span class="tag ${b.percent >= 80 ? 'on' : b.percent >= 50 ? 'dry' : 'off'}">${b.percent}%</span></div>
    <div class="bar"><i style="width:${b.percent}%"></i></div><small>Hồ sơ ${b.percent}% đầy đủ${b.missing ? ` · thiếu ${b.missing} mục` : ' · đủ'}</small></div>`).join('')}</div>`;
}

// ---------- Tổng quan ----------
function brOverview(d) {
  const c = d.completeness, p = d.plan, a = d.ads, ct = d.content;
  const k = (l, v, s) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  return `<div class="card"><h2>Mức đầy đủ hồ sơ: ${c.score}/${c.total} (${c.percent}%)</h2><div class="bar" style="margin-bottom:10px"><i style="width:${c.percent}%"></i></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:6px">${c.items.map((i) => `<div class="row" style="gap:6px;align-items:flex-start"><span style="color:${i.ok ? 'var(--ok)' : 'var(--bad)'}">${i.ok ? '✓' : '○'}</span><div>${i.ok ? esc(i.label) : `<a href="#" data-br="goto" data-v="${BR_FIX[i.key]}"><b>${esc(i.label)}</b></a><br><small style="color:var(--mute)">${esc(i.hint)}</small>`}</div></div>`).join('')}</div></div>
    <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
      ${k('Chi quảng cáo tháng này', a.available ? vShort(a.monthSpend) : '—', a.available ? `${a.monthMsgs} tin nhắn` : 'chưa nối Meta')}
      ${k('Chiến dịch đang chạy', `${a.activeCampaigns}<small style="font-size:13px;color:var(--mute)"> / ${a.campaigns}</small>`, 'theo tên chiến dịch')}
      ${k('Bài sắp đăng 7 ngày', ct.upcoming7d, `${ct.scheduled} bài đã lên lịch`)}
      ${k('Chờ Sếp duyệt', ct.pendingApprovals ? `<a href="#duyet" style="color:inherit;text-decoration:none">${ct.pendingApprovals}</a>` : '0', `${ct.published30d} bài đã đăng 30 ngày`)}
      ${k('Media / bài học AI', `${d.assets.media} / ${d.assets.lessons}`, 'file trong thư viện · bài học đang áp dụng')}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;align-items:start">
      <div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Kế hoạch ${esc(p.month.slice(5))}/${esc(p.month.slice(0, 4))}</h2><a href="#kehoach">Mở Kế hoạch tháng →</a></div>
        <p style="margin:8px 0">Mục tiêu xong <b>${p.goals.done}/${p.goals.total}</b> · công việc xong <b>${p.tasks.done}/${p.tasks.total}</b>${p.tasks.overdue ? ` · <span class="tag off">${p.tasks.overdue} quá hạn</span>` : ''}</p>
        ${p.budget.total ? `<p style="margin:4px 0">Ngân sách <b>${vnd(p.budget.total)}</b>${p.budget.spent !== null ? ` · đã chi quảng cáo ${vnd(p.budget.spent)} (${Math.round((p.budget.spent / p.budget.total) * 100)}%)` : ''}</p>` : '<p class="sub" style="margin:4px 0">Chưa đặt ngân sách tháng.</p>'}
        ${p.kpis.map((x) => { const st = BR_KPI[x.status] || BR_KPI.none; return `<div class="item"><span>${esc(x.name)}: ${x.actual === null ? '—' : esc(Math.round(x.actual).toLocaleString('vi-VN'))} / ${esc(x.target.toLocaleString('vi-VN'))} ${esc(x.unit)}</span><span class="tag ${st[0]}">${st[1]}</span></div>`; }).join('') || '<div class="empty">Chưa có KPI.</div>'}</div>
      <div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Chương trình ưu đãi</h2><a href="#kehoach">Quản lý →</a></div>
        ${d.promos.map((x) => `<div class="item"><div><b>${esc(x.name)}</b> <span class="tag ${x.state === 'running' ? 'on' : 'info'}">${x.state === 'running' ? 'đang diễn ra' : 'sắp tới'}</span><p style="margin:2px 0">${esc(x.from)} → ${esc(x.to)}${x.detail ? ' · ' + esc(x.detail) : ''}</p></div></div>`).join('') || '<div class="empty">Không có khuyến mãi đang chạy hoặc sắp tới.</div>'}</div>
      <div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Ngân sách quảng cáo theo cơ sở</h2><a href="#ads">Trang Quảng cáo →</a></div>
        ${a.units.map((u) => `<div class="item"><span>${esc(u.name)}</span><span>${vnd(u.dailyBudget)}/ngày <small style="color:var(--mute)">(thử: ${vnd(u.committed)})</small></span></div>`).join('') || '<div class="empty">Thương hiệu này chưa có cơ sở quảng cáo.</div>'}</div>
      <div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Kênh</h2><a href="#kenh">Kiểm tra kết nối →</a></div>
        ${d.channels.filter((r) => !['unsupported'].includes(r.status)).map((r) => `<div class="item"><span>${esc(r.channelLabel)} · ${esc(r.name)}</span><span class="tag ${BR_ST[r.status]}">${esc(r.statusText)}</span></div>`).join('') || '<div class="empty">Chưa có kênh.</div>'}</div></div>`;
}

// ---------- Hồ sơ & truyền thông ----------
function brField(label, key, val, { rows = 0, ph = '', hint = '', ro = false } = {}) {
  const v = brDraft(key, val);
  return `<label style="display:block;margin:10px 0">${label}${hint ? ` <small style="color:var(--mute)">${hint}</small>` : ''}<br>${rows
    ? `<textarea data-br="field" data-key="${key}" rows="${rows}" style="width:100%" placeholder="${esc(ph)}" ${ro ? 'readonly' : ''}>${esc(v)}</textarea>`
    : `<input type="text" data-br="field" data-key="${key}" value="${esc(v)}" style="width:100%" placeholder="${esc(ph)}" ${ro ? 'readonly' : ''}>`}</label>`;
}
function brSaveBar() {
  return `<div class="row" style="margin-top:12px"><button class="pri" data-br="save" ${BR.saving || !brDirty() ? 'disabled' : ''}>${BR.saving ? 'Đang lưu…' : 'Lưu thay đổi'}</button>${brDirty() ? '<button data-br="discard">Bỏ thay đổi</button><small style="color:var(--warn)">Có thay đổi chưa lưu</small>' : '<small style="color:var(--mute)">Đã lưu</small>'}</div>`;
}
function brProfile(b) {
  return `<div class="card"><h2>Hồ sơ thương hiệu</h2>
    <div class="cards" style="margin-bottom:0;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))"><div>${brField('Tên thương hiệu', 'name', b.name)}</div><div>${brField('Hotline', 'hotline', b.hotline, { ph: '0900 000 000' })}</div></div>
    ${brField('Khẩu hiệu', 'tagline', b.tagline, { ph: 'VD: MORE BEAUTIFUL EVERY VISIT' })}
    ${brField('Dịch vụ chính', 'services', b.services, { rows: 2, ph: 'VD: nhuộm, uốn, phục hồi tóc, nối mi' })}</div>
    <div class="card"><h2>Quy định truyền thông (AI tuân theo khi soạn bài)</h2>
    ${brField('Giọng văn (tin nhắn trả lời khách)', 'tone', b.tone, { rows: 2, ph: 'VD: thân thiện, gần gũi, xưng em – chị, dùng "Dạ"' })}
    ${brField('Giọng BÀI ĐĂNG fanpage', 'postTone', b.postTone, { rows: 2, ph: 'VD: tinh tế, tự nhiên, xưng "salon", gọi "chị em"' , hint: '— khác với tin nhắn: bài đăng công khai, không mở bằng "Dạ"' })}
    ${brField('Điều KHÔNG được nói / hứa', 'avoid', b.avoid, { rows: 3, ph: 'VD: không cam kết tóc không hư, không nêu giá khi chưa được duyệt' })}
    ${brField('Hashtag ưu tiên', 'hashtags', b.hashtags, { ph: '#theone #lamdep (tối đa 12)', hint: '— tự thêm # và bỏ trùng' })}
    <p class="sub" style="margin:0">Các mục trên được đưa vào lời nhắc mỗi lần AI viết bài/trả lời của đúng thương hiệu này.</p></div>
    ${ctFactsPanel(b.id)}
    <div class="card"><h2>Nội dung tiếng Trung (小红书)</h2>
    ${brField('Địa chỉ tiếng Trung', 'addressZh', b.addressZh, { ph: '胡志明市三郡 … 街 …号', hint: '— chèn cuối bài 小红书, không ghi số điện thoại' })}
    ${brField('Khu vực (tiếng Trung)', 'locationZh', b.locationZh, { ph: '胡志明市三郡' })}
    ${brField('Khẩu hiệu (tiếng Trung)', 'taglineZh', b.taglineZh, { ph: 'MORE BEAUTIFUL EVERY VISIT' })}${brSaveBar()}</div>`;
}

// ---------- Nhận diện ----------
async function brLoadImages() {
  if (BR.images && BR.images.brand === BR.id) return;
  try { const r = await call('GET', `/api/media?brand=${encodeURIComponent(BR.id)}`); BR.images = { brand: BR.id, files: r.files.filter((f) => f.type === 'image') }; }
  catch (e) { BR.images = { brand: BR.id, files: [], err: e.message }; }
  brPaint();
}
function brIdentity(b) {
  const id = b.identity;
  const val = (k) => brDraft('identity.' + k, id[k]);
  const color = (k, label) => `<div><label>${label}<br><span class="row" style="gap:6px"><input type="color" data-br="color" data-key="identity.${k}" value="${esc(val(k) || '#000000')}" style="width:44px;height:34px;padding:0"><input type="text" data-br="field" data-key="identity.${k}" value="${esc(val(k))}" placeholder="#RRGGBB" style="width:110px"></span></label></div>`;
  const logo = val('logo');
  const imgs = BR.images && BR.images.brand === BR.id ? BR.images : null;
  return `<div class="card"><h2>Nhận diện thương hiệu</h2>
    <div class="row" style="gap:24px;align-items:flex-start">
      <div style="min-width:260px">${color('primary', 'Màu chủ đạo')}${color('secondary', 'Màu phụ')}${color('accent', 'Màu nhấn')}
        <label style="display:block;margin:10px 0">Font chữ<br><input type="text" data-br="field" data-key="identity.font" value="${esc(val('font'))}" placeholder="VD: Be Vietnam Pro" style="width:100%"></label></div>
      <div><b>Mẫu thẻ thương hiệu</b><div style="margin-top:6px;width:300px;border-radius:12px;overflow:hidden;border:1px solid var(--line);font-family:${esc(val('font') || 'inherit')}">
        <div style="background:${esc(val('primary') || '#888')};color:#fff;padding:16px;display:flex;gap:12px;align-items:center">${logo ? `<img src="${esc(fileUrl(b.id, logo))}" alt="logo" style="height:48px;max-width:96px;object-fit:contain;background:#fff;border-radius:8px;padding:4px">` : '<div style="width:48px;height:48px;border-radius:8px;background:rgba(255,255,255,.25)"></div>'}<div><b style="font-size:16px">${esc(brDraft('name', b.name))}</b><div style="font-size:12px;opacity:.9">${esc(brDraft('tagline', b.tagline) || '—')}</div></div></div>
        <div style="background:${esc(val('secondary') || '#222')};color:#fff;padding:10px 16px;font-size:13px">${esc(brDraft('hotline', b.hotline) || 'Hotline')} <span style="float:right;background:${esc(val('accent') || '#fff')};color:#111;padding:0 8px;border-radius:99px">Đặt lịch</span></div></div>
        <p class="sub" style="margin:6px 0 0;max-width:300px">Chỉ để xem trước và làm tham chiếu thương hiệu — hệ thống chưa tự áp màu/logo lên ảnh hay bài đăng.</p></div></div></div>
    <div class="card"><h2>Logo</h2><p class="sub" style="margin:0 0 8px">Chọn từ ảnh trong Thư viện Media của ${esc(b.name)}. Chưa có logo? <a href="#media">Tải lên Thư viện Media</a> rồi quay lại.</p>
      ${!imgs ? '<div class="skel" style="height:80px"></div>' : imgs.err ? `<div class="state err"><b>Không tải được thư viện</b>${esc(imgs.err)}</div>` : !imgs.files.length ? '<div class="empty">Thư viện chưa có ảnh nào.</div>'
      : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px"><button type="button" data-br="logo" data-name="" class="${!logo ? 'pri' : ''}" style="padding:6px">Không dùng logo</button>${imgs.files.map((f) => `<button type="button" data-br="logo" data-name="${esc(f.name)}" style="padding:4px;${logo === f.name ? 'outline:2px solid var(--brand)' : ''}"><img src="${esc(fileUrl(b.id, f.name))}" alt="" loading="lazy" style="width:100%;height:70px;object-fit:contain;border-radius:6px"><small style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</small></button>`).join('')}</div>`}${brSaveBar()}</div>`;
}

// ---------- Chi nhánh ----------
function brBranches(b) {
  const list = brDraft('branches', b.branches);
  const split = !list.length && b.address ? `<button class="sm" data-br="splitaddr">Tách địa chỉ hiện tại thành chi nhánh</button>` : '';
  return `<div class="card"><h2>Chi nhánh</h2><p class="sub" style="margin:0 0 8px">Địa chỉ chèn cuối bài đăng sẽ <b>tự ghép từ các chi nhánh</b> (mỗi chi nhánh một địa chỉ, ngăn cách bằng " | ").</p>
    ${list.map((x, i) => `<div class="rule"><div class="row" style="justify-content:space-between"><b>Chi nhánh ${i + 1}</b><button class="sm danger" data-br="br-del" data-i="${i}">Xoá</button></div>
      <div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin:6px 0 0">
        <label>Tên<br><input type="text" data-br="br-field" data-i="${i}" data-k="name" value="${esc(x.name)}" style="width:100%"></label>
        <label>Điện thoại<br><input type="text" data-br="br-field" data-i="${i}" data-k="phone" value="${esc(x.phone)}" style="width:100%"></label>
        <label>Giờ mở cửa<br><input type="text" data-br="br-field" data-i="${i}" data-k="hours" value="${esc(x.hours)}" placeholder="9h–21h" style="width:100%"></label></div>
      <label style="display:block;margin-top:6px">Địa chỉ<br><input type="text" data-br="br-field" data-i="${i}" data-k="address" value="${esc(x.address)}" style="width:100%"></label>
      <label style="display:block;margin-top:6px">Địa chỉ tiếng Trung<br><input type="text" data-br="br-field" data-i="${i}" data-k="addressZh" value="${esc(x.addressZh)}" style="width:100%"></label>
      <label style="display:block;margin-top:6px">Liên kết bản đồ<br><input type="text" data-br="br-field" data-i="${i}" data-k="map" value="${esc(x.map)}" placeholder="https://maps.google.com/…" style="width:100%"></label></div>`).join('') || '<div class="empty">Chưa có chi nhánh.</div>'}
    <div class="row" style="margin-top:8px"><button data-br="br-add" ${list.length >= 10 ? 'disabled' : ''}>+ Thêm chi nhánh</button>${split}</div>
    ${!list.length && b.address ? `<p class="sub" style="margin:8px 0 0">Địa chỉ hiện tại: ${esc(b.address)}</p>` : ''}${brSaveBar()}</div>`;
}

// ---------- Kênh & tài khoản ----------
function brChannels(b, d) {
  const CHL = { facebook_page: 'Facebook Page', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', xiaohongshu: '小红书 Xiaohongshu', zalo_oa: 'Zalo OA', google_ads: 'Google Ads' };
  return `<div class="card"><h2>Tài khoản quảng cáo</h2>${brField('ID tài khoản quảng cáo (chỉ chữ số, không cần act_)', 'adAccountId', b.adAccountId, { ph: '1234567890' })}${brSaveBar()}</div>
    <div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Facebook Page (${b.pageIds.length})</h2><a href="#kenh">Thêm / gỡ / kiểm tra ở trang Kênh →</a></div>
      ${b.id === 'mishang' && !b.pageIds.length ? '<p class="alert danger">Mishang chưa có Page nào — Facebook không cho đăng lên trang cá nhân. Thêm Fanpage (đã gán cho <code>salon-agent</code>) ở trang Kênh.</p>' : ''}
      ${d.channels.filter((r) => r.channel === 'facebook_page' && r.externalId).map((r) => `<div class="item"><span>${esc(r.name)} <small style="color:var(--mute)">${esc(r.externalId)}</small></span><span class="tag ${BR_ST[r.status]}">${esc(r.statusText)}</span></div>`).join('') || '<div class="empty">Chưa gán Page.</div>'}</div>
    <div class="card"><h2>Kênh đang dùng</h2><p class="sub" style="margin:0 0 8px">Tick = dùng kênh này cho thương hiệu (tắt thì bài không đăng lên kênh đó). Tên/ID công khai chỉ để ghi nhớ. Trạng thái kết nối thật xem ở trang <a href="#kenh">Kênh</a>.</p>
      <div class="tablewrap"><table class="tbl"><thead><tr><th>Dùng</th><th>Kênh</th><th>Tên / ID công khai</th><th>Kết nối</th></tr></thead><tbody>${Object.entries(b.channels).map(([ch, v]) => {
        const row = d.channels.find((r) => r.channel === ch);
        return `<tr><td><input type="checkbox" data-br="ch-on" data-ch="${ch}" ${v.on ? 'checked' : ''} aria-label="Dùng ${esc(CHL[ch] || ch)}"></td><td>${esc(CHL[ch] || ch)}</td><td><input type="text" data-br="ch-handle" data-ch="${ch}" value="${esc(v.handle)}" style="width:100%" placeholder="${ch === 'tiktok' ? '@nick1, @nick2 (nhiều nick cách nhau dấu phẩy)' : 'tên hoặc @tài_khoản'}"></td><td>${row ? `<span class="tag ${BR_ST[row.status]}">${esc(row.statusText)}</span>` : '<span class="tag">Chưa hỗ trợ API</span>'}</td></tr>`;
      }).join('')}</tbody></table></div></div>`;
}

// ---------- Khung trang ----------
function brBody() {
  if (BR.state === 'err' && !BR.data) return `<div class="card"><div class="state err"><b>Không tải được thương hiệu</b>${esc(BR.err)}<br><button class="sm" data-br="reload">Thử lại</button></div></div>`;
  if (!BR.data || BR.data.brand.id !== BR.id) return '<div class="skel" style="height:260px"></div>';
  const d = BR.data, b = d.brand;
  const body = { overview: () => brOverview(d), profile: () => brProfile(b), identity: () => brIdentity(b), branches: () => brBranches(b), channels: () => brChannels(b, d) }[BR.tab]();
  return `<div class="seg" style="margin-bottom:12px;flex-wrap:wrap">${BR_TABS.map(([k, l]) => `<button class="${BR.tab === k ? 'on' : ''}" data-br="tab" data-v="${k}">${l}</button>`).join('')}</div>${body}`;
}
function brPaint() { const el = document.getElementById('brBody'); if (el) el.innerHTML = brBody(); const p = document.getElementById('brPick'); if (p) p.innerHTML = brPicker(); }

function pageBrands() {
  const html = `<h1>Thương hiệu & Kênh</h1><p class="sub">Trung tâm từng thương hiệu: hồ sơ, nhận diện, chi nhánh, kênh, ngân sách. Dữ liệu mỗi thương hiệu được tách riêng — AI chỉ dùng hồ sơ của đúng thương hiệu khi viết bài.</p>
  <div id="brPick">${brPicker()}</div><div id="brBody">${brBody()}</div>
  <p class="sub">Phân quyền xem/sửa theo từng thương hiệu và từng người <b>chưa có</b>: hiện cả hệ thống dùng một mật khẩu chung, ai đăng nhập đều thấy và sửa được cả 3 thương hiệu.</p>`;
  setTimeout(() => { brLoad(); if (BR.tab === 'identity') brLoadImages(); }, 0);
  return html;
}

// ---------- Lưu / hành động ----------
// Gom các thay đổi đang soạn (draft) thành 1 yêu cầu POST /api/brands
function brPayload() {
  const out = { id: BR.id };
  for (const [k, v] of Object.entries(BR.draft)) {
    if (k.startsWith('identity.')) (out.identity = out.identity || {})[k.slice(9)] = v;
    else out[k] = v;
  }
  return out;
}
async function brSave() {
  if (!brDirty() || BR.saving) return;
  BR.saving = true; brPaint();
  try {
    S = await call('POST', '/api/brands', brPayload());
    BR.draft = {};
    toast('Đã lưu hồ sơ thương hiệu');
    BR.saving = false;
    await brLoad();
    render();
  } catch (e) { toast(e.message); BR.saving = false; brPaint(); }
}
async function brDiscard() {
  if (!(await confirmBox({ title: 'Bỏ thay đổi chưa lưu?', body: '<p>Các chỉnh sửa trên trang này sẽ bị bỏ.</p>', ok: 'Bỏ thay đổi', danger: true }))) return;
  BR.draft = {}; brPaint();
}
function brBranchEdit(fn) {
  const b = BR.data.brand;
  const list = (BR.draft.branches !== undefined ? BR.draft.branches : b.branches).map((x) => ({ ...x }));
  fn(list);
  BR.draft.branches = list;
  brPaint();
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-br]');
  if (!t || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) return;
  const k = t.dataset.br;
  if (k === 'goto') { e.preventDefault(); BR.tab = t.dataset.v; if (BR.tab === 'identity') brLoadImages(); brPaint(); }
  else if (k === 'reload') brLoad();
  else if (k === 'pick') {
    if (brDirty() && !(await confirmBox({ title: 'Chuyển thương hiệu?', body: '<p>Bạn có thay đổi chưa lưu — chuyển đi sẽ bỏ các thay đổi đó.</p>', ok: 'Chuyển và bỏ thay đổi', danger: true }))) return;
    BR.id = t.dataset.id; BR.draft = {}; BR.images = null; BR.data = null; brLoad(); if (BR.tab === 'identity') brLoadImages();
  }
  else if (k === 'tab') { BR.tab = t.dataset.v; if (BR.tab === 'identity') brLoadImages(); brPaint(); }
  else if (k === 'save') brSave();
  else if (k === 'discard') brDiscard();
  else if (!BR.data) return;
  else if (k === 'logo') { BR.draft['identity.logo'] = t.dataset.name; brPaint(); }
  else if (k === 'br-add') brBranchEdit((l) => l.push({ name: `Chi nhánh ${l.length + 1}`, address: '', addressZh: '', phone: '', hours: '', map: '' }));
  else if (k === 'br-del') brBranchEdit((l) => l.splice(Number(t.dataset.i), 1));
  else if (k === 'splitaddr') brBranchEdit((l) => { for (const [i, part] of BR.data.brand.address.split('|').map((x) => x.trim()).filter(Boolean).entries()) l.push({ name: `Chi nhánh ${i + 1}`, address: part, addressZh: '', phone: '', hours: '', map: '' }); });
});
document.addEventListener('input', (e) => {
  const t = e.target, k = t.dataset.br;
  if (!k || !BR.data) return;
  if (k === 'field') { BR.draft[t.dataset.key] = t.value; const sv = document.querySelector('[data-br="save"]'); if (sv) sv.disabled = false; if (t.dataset.key.startsWith('identity.') || ['name', 'tagline', 'hotline'].includes(t.dataset.key)) { const pos = t.selectionStart; brPaint(); const el = document.querySelector(`[data-br="field"][data-key="${t.dataset.key}"]`); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { /* ô màu */ } } } }
  else if (k === 'color') { BR.draft[t.dataset.key] = t.value.toUpperCase(); brPaint(); }
  else if (k === 'br-field') { const i = Number(t.dataset.i), key = t.dataset.k; const b = BR.data.brand; const list = (BR.draft.branches !== undefined ? BR.draft.branches : b.branches).map((x) => ({ ...x })); list[i][key] = t.value; BR.draft.branches = list; const sv = document.querySelector('[data-br="save"]'); if (sv) sv.disabled = false; }
});
document.addEventListener('change', async (e) => {
  const t = e.target, k = t.dataset.br;
  if (!k || !BR.data) return;
  if (k === 'ch-on' || k === 'ch-handle') {
    try {
      S = await call('POST', '/api/brands', { id: BR.id, channels: { [t.dataset.ch]: k === 'ch-on' ? { on: t.checked } : { handle: t.value } } });
      toast('Đã lưu'); await brLoad(); render();
    } catch (err) { toast(err.message); await brLoad(); }
  }
});
window.addEventListener('beforeunload', (e) => { if (brDirty()) { e.preventDefault(); e.returnValue = ''; } });
