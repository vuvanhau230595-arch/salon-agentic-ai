// Trang Thư viện Media: tải lên (kéo thả, nhiều file, thanh tiến độ), thư mục ảo, thẻ, tìm kiếm/lọc/sắp xếp, xem trước,
// ghi chú, quyền hình ảnh, lịch sử sử dụng, tạo bài từ file, thùng rác (xoá = chuyển vào .trash, khôi phục được; xoá hẳn cần data_admin). Không đổi tên file thật. Dữ liệu từ /api/media-lib và /api/media/*.
// Nạp sau brands.js (dùng chung call, toast, render, S, esc, fileUrl, sizeText, confirmBox).
const ML = {
  brand: '', lib: null, state: 'idle', err: '', seq: 0, q: '', type: '', folder: '', tag: '', sort: 'new', unused: false, status: '', page: 1, per: 36, view: 'lib', trash: null,
  sel: new Set(), detail: null, usage: null, uploads: [], busy: false, drive: null, driveBusy: false,
};
// Lọc theo trạng thái dùng (mặc định ẩn file đã lưu trữ)
const ML_FSTATUS = { '': 'Mọi trạng thái', unused: 'Chưa dùng', scheduled: 'Sắp đăng / trong kế hoạch', published: 'Đã đăng', nonote: 'Chưa có ghi chú', needconsent: 'Có người, chưa xác nhận đồng ý', excluded: 'Không cho agent dùng', archived: 'Đã lưu trữ' };
const mlUseText = (u) => {
  if (!u) return '';
  const d = new Date(u.at).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
  return { published: `Đã đăng ${d}`, scheduled: `Sẽ đăng ${d}`, plan: `Kế hoạch ${d} (chờ duyệt)`, pending: `Chờ duyệt ${d}`, awaiting_manual: `Chờ đăng tay ${d}`, external_scheduled: `Hẹn giờ ngoài ${d}`, failed: `Đăng lỗi ${d}` }[u.status] || `${u.status} ${d}`;
};
const ML_SORT = { new: 'Mới nhất', old: 'Cũ nhất', name: 'Tên A→Z', size: 'Dung lượng lớn → nhỏ', used: 'Dùng nhiều nhất', unused: 'Dùng ít nhất' };
const mlSize = (n) => (n > 1048576 * 1024 ? (n / 1073741824).toFixed(2) + ' GB' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const mlExt = (n) => (n.match(/\.[^.]+$/) || [''])[0].toLowerCase();
const mlUrl = (f) => `/api/media/file?brand=${encodeURIComponent(f.brand)}&name=${encodeURIComponent(f.name)}`;
const ML_STATUS = { published: 'Đã đăng', scheduled: 'Đã lên lịch', draft: 'Chờ duyệt', awaiting_manual: 'Chờ đăng tay', external_scheduled: 'Đã hẹn giờ ngoài', pending: 'Trong kế hoạch', failed: 'Lỗi', rejected: 'Bị từ chối', cancelled: 'Đã huỷ' };

async function mlLoad() {
  const seq = ++ML.seq;
  if (!ML.brand) ML.brand = S.brands[0].id;
  ML.state = ML.lib && ML.lib.brand === ML.brand ? 'ok' : 'loading';
  mlPaint();
  call('GET', '/api/drive').then((d) => { ML.drive = d; mlPaint(); }).catch(() => {}); // khối Google Drive: lỗi không làm hỏng thư viện
  try { const d = await call('GET', `/api/media-lib?brand=${encodeURIComponent(ML.brand)}`); if (seq !== ML.seq) return; ML.lib = { ...d, brand: ML.brand }; ML.state = 'ok'; ML.err = ''; }
  catch (e) { if (seq !== ML.seq) return; ML.state = 'err'; ML.err = e.message; }
  mlPaint();
}
const mlFile = (name) => (ML.lib ? ML.lib.files.find((f) => f.name === name) : null);

// ---------- Lọc / sắp xếp ----------
function mlFiltered() {
  const q = ML.q.trim().toLowerCase();
  const st = ML.status;
  const byStatus = (f) => {
    if (st === 'archived') return f.archived;
    if (f.archived) return false; // mặc định ẩn file đã lưu trữ
    if (st === 'unused') return !f.uses && !f.excluded;
    if (st === 'scheduled') return !!(f.lastUse && ['scheduled', 'plan', 'pending', 'awaiting_manual', 'external_scheduled'].includes(f.lastUse.status));
    if (st === 'published') return !!(f.lastUse && f.lastUse.status === 'published');
    if (st === 'nonote') return !f.note;
    if (st === 'needconsent') return !!(f.meta && f.meta.faces && !f.consent);
    if (st === 'excluded') return f.excluded;
    return true;
  };
  let r = ML.lib.files.filter((f) => (!ML.type || f.type === ML.type) && (!ML.folder || (ML.folder === '__none' ? !f.folder : f.folder === ML.folder)) && (!ML.tag || f.tags.includes(ML.tag)) && (!ML.unused || !f.uses) && byStatus(f)
    && (!q || `${f.name} ${f.title || ''} ${f.note} ${f.tags.join(' ')} ${(f.meta && f.meta.summary) || ''} ${f.folder}`.toLowerCase().includes(q)));
  const by = { new: (a, b) => b.mtime - a.mtime, old: (a, b) => a.mtime - b.mtime, name: (a, b) => a.name.localeCompare(b.name), size: (a, b) => b.size - a.size, used: (a, b) => b.uses - a.uses, unused: (a, b) => a.uses - b.uses }[ML.sort];
  return r.sort(by);
}

// ---------- Vẽ ----------
function mlSummary() {
  const t = ML.lib.totals;
  const k = (l, v, s) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  return `<div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">${k('Tổng file', t.files, `${t.images} ảnh · ${t.videos} video · ${mlSize(t.bytes)}`)}${k('Chưa dùng', t.unused, 'agent ưu tiên lấy file này')}${k('Sắp đăng', t.scheduled || 0, 'đã lên lịch / trong kế hoạch')}${k('Cần xác nhận', t.needConsent || 0, 'có người hiện mặt, chưa xác nhận')}${k('Không cho agent', t.excluded || 0, `${t.archived || 0} file đã lưu trữ`)}${k('Thư mục · thẻ', `${ML.lib.folders.length} · ${ML.lib.tags.length}`, `${ML.lib.unassigned} file chưa phân loại`)}</div>`;
}
function mlUpload() {
  const l = ML.lib.limits;
  const target = ML.folder && ML.folder !== '__none' ? ` vào thư mục <b>${esc(ML.folder)}</b>` : '';
  return `<div class="card"><div id="mlDrop" style="border:2px dashed var(--line);border-radius:var(--r);padding:20px;text-align:center;color:var(--mute)">
    <b>Kéo thả ảnh/video vào đây</b>${target}<input type="file" id="mlFile" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" style="display:none">
    <div style="margin:10px 0 6px"><button type="button" class="pri" data-ml="pick-file" style="font-size:14px;padding:10px 18px">📂 Chọn file từ máy</button></div>
    <div style="font-size:12px;margin-top:4px">Ảnh jpg/png/webp (≤ ${mlSize(l.image)}) · Video mp4/mov (≤ ${mlSize(l.video)}) · hệ thống kiểm tra nội dung file có đúng định dạng không</div></div>
    ${ML.uploads.length ? `<div style="margin-top:10px">${ML.uploads.map((u) => `<div class="item" style="align-items:center"><div style="min-width:0;flex:1"><b style="word-break:break-all">${esc(u.name)}</b> <small style="color:var(--mute)">${mlSize(u.size)}</small>
      ${u.status === 'uploading' ? `<div class="bar"><i style="width:${u.pct}%"></i></div>` : ''}${u.error ? `<div style="color:var(--bad);font-size:12px">${esc(u.error)}</div>` : ''}</div>
      <span class="tag ${u.status === 'done' ? 'on' : u.status === 'error' ? 'off' : 'info'}">${u.status === 'done' ? 'Xong' : u.status === 'error' ? 'Lỗi' : u.status === 'wait' ? 'Chờ' : u.pct + '%'}</span></div>`).join('')}
      ${ML.uploads.every((u) => ['done', 'error'].includes(u.status)) ? '<button class="sm" data-ml="clear-uploads">Xoá danh sách tải lên</button>' : ''}</div>` : ''}
    <p class="sub" style="margin:10px 0 0">Hoặc chép thẳng vào thư mục <code>${esc(ML.lib.root)}\\${esc(ML.brand)}</code> trên máy chủ rồi bấm Làm mới.</p></div>`;
}
// ---------- Nạp từ Google Drive ----------
// Mỗi thương hiệu 1 thư mục Drive (chia sẻ cho email service account). Agent kéo file MỚI về theo lượt quét; không xoá gì trên Drive, không xoá file local.
function mlDrive() {
  const d = ML.drive;
  if (!d) return '<div class="card" id="mlDrive"><b>☁ Nạp từ Google Drive</b> <small style="color:var(--mute)">đang tải trạng thái…</small></div>';
  const b = d.brands[ML.brand] || { folders: [], on: false, count: 0 };
  const folders = b.folders || [];
  const r = b.lastResult;
  const when = (t) => (t ? new Date(t).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '');
  const can = mlCan('content_write');
  const busy = ML.driveBusy;
  const status = b.lastError ? `<span class="tag off">Lỗi</span> ${esc(b.lastError)}`
    : r ? `<span class="tag ${r.error ? 'off' : r.added ? 'on' : 'dry'}">${r.error ? 'Có lỗi' : r.added ? '+' + r.added + ' file' : 'Không có file mới'}</span> lần nạp ${when(b.lastRun)}: ${r.added} nạp · ${r.skipped} đã có · ${r.rejected} bỏ qua${r.pending ? ' · ' + r.pending + ' chờ lượt sau' : ''}${r.error ? ' — ' + esc(r.error) : ''}`
    : folders.length ? '<span class="tag dry">Chưa nạp lần nào</span>' : '';
  const rows = folders.map((f) => `<div class="item" style="align-items:center;gap:8px"><div style="min-width:0;flex:1">📁 <a href="${esc(f.link)}" target="_blank" rel="noopener"><b>${esc(f.label || f.name || f.id)}</b></a> <small style="color:var(--mute)">${f.count} file đã nạp${f.tag ? ` · thẻ #${esc(f.tag)}` : ''}</small>
        <label style="font-size:12px;margin-left:6px" title="Agent chỉ lấy video/ảnh của thư mục này cho kênh đã chọn">Dùng cho <select data-ml="drive-ch" data-v="${esc(f.id)}" ${can && !busy ? '' : 'disabled'}>${[['', 'Mọi kênh'], ['tiktok', 'TikTok'], ['facebook_page', 'Facebook'], ['instagram', 'Instagram']].map(([k, l]) => `<option value="${k}" ${(f.channel || '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>${f.error ? `<div style="color:var(--bad);font-size:12px">${esc(f.error)}</div>` : ''}</div>
      <button class="sm" data-ml="drive-test" data-v="${esc(f.id)}" ${d.configured && !busy ? '' : 'disabled'} title="Kiểm tra quyền xem thư mục này">Kiểm tra</button><button class="sm danger" data-ml="drive-remove" data-v="${esc(f.id)}" data-name="${esc(f.label || f.name || f.id)}" ${can && !busy ? '' : 'disabled'} title="Bỏ thư mục khỏi danh sách (file đã nạp vẫn còn)">✕</button></div>`).join('');
  return `<div class="card" id="mlDrive"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><b>☁ Nạp từ Google Drive</b>
      ${d.configured ? `<small style="color:var(--mute)">Chia sẻ thư mục cho <code data-ml="drive-copy-email" style="cursor:pointer" title="Bấm để sao chép">${esc(d.serviceEmail)}</code> (quyền Người xem)</small>` : '<small style="color:var(--bad)">Chưa có khoá service account — <a href="#caidat">tải file JSON ở Cài đặt → Kết nối API</a></small>'}</div>
    ${rows ? `<div style="margin-top:8px">${rows}</div>` : '<p class="sub" style="margin:8px 0 0">Chưa có thư mục Drive nào cho thương hiệu này.</p>'}
    <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:6px"><input type="url" id="mlDriveLink" class="grow" style="min-width:200px" placeholder="Dán link thư mục Google Drive (https://drive.google.com/drive/folders/…)" ${can ? '' : 'disabled'}>
      <input type="text" id="mlDriveLabel" placeholder="Nhãn / thẻ (vd: TikTok)" style="width:150px" ${can ? '' : 'disabled'} title="File nạp từ thư mục này sẽ tự gắn thẻ theo nhãn; để trống thì lấy tên thư mục trên Drive">
      <button class="sm" data-ml="drive-save" ${can && !busy && folders.length < (d.maxFolders || 10) ? '' : 'disabled'}>＋ Thêm thư mục</button></div>
    <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:6px"><label class="f" style="margin:0"><input type="checkbox" data-ml="drive-on" ${b.on ? 'checked' : ''} ${can && folders.length && !busy ? '' : 'disabled'}> Tự nạp theo lịch quét</label>
      <button class="sm pri" data-ml="drive-sync" ${can && folders.length && d.configured && !busy ? '' : 'disabled'}>${busy ? 'Đang nạp…' : '⬇ Nạp ngay'}</button>
      <button class="sm" data-ml="drive-test" data-v="" ${folders.length && d.configured && !busy ? '' : 'disabled'} title="Kiểm tra khoá và quyền xem mọi thư mục, không tải gì">Kiểm tra tất cả</button></div>
    <p class="sub" style="margin:8px 0 0">${status}${b.count ? ` · đã nạp tổng ${b.count} file từ Drive` : ''}</p>
    <p class="sub" style="margin:4px 0 0">Chỉ lấy ảnh jpg/png/webp và video mp4/mov; mỗi lượt tối đa ${d.maxPerRun} file. File đã nạp không tải lại; trùng tên thì thêm hậu tố; file từ thư mục nào tự gắn thẻ theo thư mục đó. <b>"Dùng cho"</b>: agent chỉ lấy video của thư mục đó cho đúng kênh (thư mục có chữ TikTok mặc định chỉ cho TikTok); kênh có thư mục riêng mà thư mục trống thì agent báo thiếu, không lấy video kênh khác. <b>Không xoá/sửa gì trên Drive</b>, xoá trên Drive cũng không xoá file ở đây.</p></div>`;
}
async function mlDriveDo(fn, okMsg) {
  if (ML.driveBusy) return;
  ML.driveBusy = true; mlPaint();
  try { const d = await fn(); if (d && d.brands) ML.drive = d; if (okMsg) toast(typeof okMsg === 'function' ? okMsg(d) : okMsg); }
  catch (e) { toast(e.message); try { ML.drive = await call('GET', '/api/drive'); } catch { /* giữ trạng thái cũ */ } }
  ML.driveBusy = false;
  await mlLoad();
}
function mlSidebar() {
  const lib = ML.lib;
  const item = (key, label, count, extra = '') => `<div class="item" style="padding:6px 8px;cursor:pointer;${ML.folder === key ? 'background:var(--brand-soft);border-radius:8px' : ''}" data-ml="folder" data-v="${esc(key)}"><span>📁 ${esc(label)}</span><span><small style="color:var(--mute)">${count}</small> ${extra}</span></div>`;
  return `<div class="card" style="padding:10px"><div class="row" style="justify-content:space-between"><b>Thư mục</b><span class="row" style="gap:4px"><button class="sm" data-ml="pick-file" title="Chọn ảnh/video từ máy">⬆ Tải lên</button><button class="sm" data-ml="folder-new" title="Tạo thư mục">＋</button></span></div>
    ${item('', 'Tất cả', lib.totals.files)}${item('__none', 'Chưa phân loại', lib.unassigned)}
    ${lib.folders.map((f) => item(f.name, f.name, f.count, ML.folder === f.name ? `<button class="sm" data-ml="folder-rename" data-v="${esc(f.name)}" title="Đổi tên">✎</button><button class="sm danger" data-ml="folder-del" data-v="${esc(f.name)}" title="Xoá thư mục (file vẫn còn)">✕</button>` : '')).join('')}
    <div class="item" style="padding:6px 8px;cursor:pointer;margin-top:6px;border-top:1px solid var(--line)" data-ml="trash-view" title="File đã xoá, khôi phục được"><span>🗑 Thùng rác</span><span><small style="color:var(--mute)">${lib.trash ? lib.trash.count : 0}</small></span></div>
    <div style="margin-top:10px"><b>Thẻ</b></div><div class="row" style="gap:4px;margin-top:4px">${lib.tags.map((t) => `<span class="tag ${ML.tag === t.name ? 'on' : ''}" style="cursor:pointer" data-ml="tag" data-v="${esc(t.name)}">#${esc(t.name)} ${t.count}</span>`).join('') || '<small style="color:var(--mute)">Chưa có thẻ</small>'}</div></div>`;
}
// Chuyển mã H.265 → H.264 (máy chủ tự làm để trình duyệt xem được video)
function mlCodecTag(f) {
  const t = f.transcode;
  if (!t) return '';
  if (t.status === 'running') return '<span class="tag info" title="Video H.265 trình duyệt không phát được — máy chủ đang chuyển sang H.264, xong tự hiện">⏳ Đang chuyển H.264</span>';
  if (t.status === 'waiting') return `<span class="tag dry" title="${esc(t.error)}">⏳ Chờ chuyển H.264</span>`;
  if (t.status === 'failed') return `<span class="tag off" title="${esc(t.error)}">⚠ Lỗi chuyển mã</span>`;
  return '';
}
function mlCodecLine(f) {
  const t = f.transcode;
  if (!t) return '';
  const when = t.at ? new Date(t.at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';
  if (t.status === 'done') return `<p class="sub" style="margin:6px 0">🎞 Đã tự chuyển từ H.265 sang H.264 lúc ${esc(when)} để xem được trên mọi trình duyệt${t.before ? ` (${mlSize(t.before)} → ${mlSize(t.after)})` : ''}. Bản gốc: ${t.backup === 'drive' ? 'vẫn còn trên Google Drive' : `<code>media/${esc(t.backup || '')}</code> trên máy chủ`}.</p>`;
  if (t.status === 'running') return '<p class="alert">⏳ Video này là H.265 nên trình duyệt chưa phát được. Máy chủ đang chuyển sang H.264 (mỗi phút video mất khoảng 1–3 phút), xong sẽ tự hiện. Vẫn gắn vào bài được.</p>';
  if (t.status === 'waiting') return `<p class="alert">⏳ ${esc(t.error)}</p>`;
  if (t.status === 'failed') return `<p class="alert">⚠ Không chuyển được sang H.264: ${esc(t.error)}. File gốc vẫn giữ nguyên. <button class="sm" data-ml="d-transcode">Thử lại</button></p>`;
  return '';
}
// Quảng cáo của file: đang chạy (tiêu/tin 7 ngày), chờ bài đăng, lỗi
function mlAdsTag(a) {
  if (!a) return '';
  const out = [];
  if (a.running) out.push(`<span class="tag on" title="Quảng cáo thử đang chạy · 7 ngày + hôm nay: tiêu ${vnd(a.spend)}, ${a.msgs} tin nhắn">📣 QC ${a.running} · ${vnd(a.spend)}${a.msgs ? ` · ${a.msgs} tin` : ''}</span>`);
  if (a.waiting) out.push(`<span class="tag info" title="Bài chưa đăng xong; đăng xong agent tự tạo quảng cáo">⏳ Chờ chạy QC ${a.waiting}</span>`);
  if (a.error) out.push(`<span class="tag off" title="${esc(a.lastError)}">⚠ QC lỗi ${a.error}</span>`);
  if (!a.running && !a.waiting && !a.error && a.done) out.push(`<span class="tag" title="Đã chạy thử xong · tiêu ${vnd(a.spend)}, ${a.msgs} tin">📣 Đã chạy ${a.done}</span>`);
  return out.join(' ');
}
function mlCard(f) {
  const sel = ML.sel.has(f.name);
  const warn = f.type === 'video' && f.info && f.info.width && Math.min(f.info.width, f.info.height) < 1080 ? '<span class="tag dry" title="Nền tảng khuyên 1080P trở lên">&lt; 1080P</span>' : f.type === 'image' && f.dims && Math.min(f.dims.width, f.dims.height) < 1080 ? '<span class="tag dry">&lt; 1080px</span>' : '';
  const badges = [
    f.archived ? '<span class="tag off" title="Đã lưu trữ: ẩn khỏi agent và thư viện">📦 Lưu trữ</span>' : f.excluded ? '<span class="tag off" title="Agent không tự lấy file này">🚫 Không cho agent</span>' : `<span class="tag ${f.uses ? 'dry' : 'on'}">${f.uses ? `Đã dùng ${f.uses}` : 'Chưa dùng'}</span>`,
    warn,
    f.meta && f.meta.faces && !f.consent ? '<span class="tag dry" title="Có người hiện mặt, chưa xác nhận đồng ý đăng">⚠ cần xác nhận</span>' : '',
    f.note ? '<span class="tag" title="Có ghi chú cho AI">📝</span>' : '',
    f.meta ? `<span class="tag" title="${esc(f.meta.summary || 'Gemini đã xem')}">👁</span>` : '',
    f.folder ? `<span class="tag">📁 ${esc(f.folder)}</span>` : '',
    mlCodecTag(f),
    mlAdsTag(f.ads),
  ].filter(Boolean).join(' ');
  const use = mlUseText(f.lastUse);
  return `<div class="mlcard" style="border:1px solid ${sel ? 'var(--brand)' : 'var(--line)'};border-radius:10px;overflow:hidden;background:var(--card);position:relative;display:flex;flex-direction:column">
    <input type="checkbox" data-ml="pick" data-v="${esc(f.name)}" ${sel ? 'checked' : ''} aria-label="Chọn ${esc(f.name)}" style="position:absolute;top:8px;left:8px;z-index:2;width:18px;height:18px">
    <div data-ml="open" data-v="${esc(f.name)}" style="cursor:pointer;position:relative" title="Bấm để xem chi tiết">${f.type === 'video' ? `<video src="${esc(mlUrl(f))}#t=0.1" preload="metadata" muted playsinline style="width:100%;height:140px;object-fit:cover;background:#000;display:block"></video><span class="tag" style="position:absolute;top:8px;right:8px">🎬 ${f.info && f.info.durationSec ? Math.round(f.info.durationSec) + 's' : 'Video'}</span>` : `<img src="${esc(mlUrl(f))}" loading="lazy" alt="" style="width:100%;height:140px;object-fit:cover;display:block"><span class="tag" style="position:absolute;top:8px;right:8px">🖼 Ảnh</span>`}</div>
    <div style="padding:8px;flex:1"><div style="word-break:break-all;font-weight:600;font-size:13px" title="${esc(f.name)}">${esc(f.title || f.name)}</div>
      ${f.title ? `<small style="color:var(--mute);word-break:break-all">${esc(f.name)}</small><br>` : ''}
      <small style="color:var(--mute)">${mlSize(f.size)}${f.dims ? ` · ${f.dims.width}×${f.dims.height}` : f.info && f.info.width ? ` · ${f.info.width}×${f.info.height}` : ''} · ${esc(new Date(f.mtime).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }))}</small>
      <div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:3px">${badges}</div>
      ${use ? `<div style="margin-top:4px"><small style="color:${f.lastUse.status === 'published' ? 'var(--ok)' : 'var(--info)'}">📅 ${esc(use)}${f.lastUse.topic ? ` · ${esc(f.lastUse.topic.slice(0, 30))}` : ''}</small></div>` : ''}
      ${f.tags.length ? `<div style="margin-top:4px">${f.tags.map((t) => `<small style="color:var(--info)">#${esc(t)}</small>`).join(' ')}</div>` : ''}</div>
    <div class="row noprint" style="gap:4px;padding:6px 8px;border-top:1px solid var(--line);flex-wrap:wrap">
      <button class="sm" data-ml="open" data-v="${esc(f.name)}" title="Xem chi tiết, ghi chú, thẻ, lịch sử">🔍 Xem</button>
      <button class="sm" data-ml="card-post" data-v="${esc(f.name)}" title="Soạn 1 bài với file này">📅 Lên bài</button>
      <button class="sm" data-ml="card-ads" data-v="${esc(f.name)}" title="Lên bài trên Page cơ sở và tự chạy quảng cáo thử">📣 Chạy QC</button>
      <button class="sm" data-ml="card-note" data-v="${esc(f.name)}" title="Ghi chú để AI viết đúng nội dung">📝</button>
      <button class="sm" data-ml="card-exclude" data-v="${esc(f.name)}" title="${f.excluded ? 'Cho agent dùng lại' : 'Không cho agent tự lấy file này'}">${f.excluded ? '✅' : '🚫'}</button>
      <button class="sm danger" data-ml="card-trash" data-v="${esc(f.name)}" title="Xoá: chuyển vào thùng rác, khôi phục được">🗑</button>
    </div></div>`;
}
function mlBody() {
  if (ML.state === 'err' && !ML.lib) return `<div class="card"><div class="state err"><b>Không tải được thư viện</b>${esc(ML.err)}<br><button class="sm" data-ml="reload">Thử lại</button></div></div>`;
  if (!ML.lib || ML.lib.brand !== ML.brand) return '<div class="skel" style="height:300px"></div>';
  if (ML.view === 'trash') return mlTrashBody();
  const list = mlFiltered(), pages = Math.max(1, Math.ceil(list.length / ML.per));
  if (ML.page > pages) ML.page = pages;
  const slice = list.slice((ML.page - 1) * ML.per, ML.page * ML.per);
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`;
  const selFiles = [...ML.sel].map(mlFile).filter(Boolean);
  const bulk = ML.sel.size ? `<div class="card" style="position:sticky;top:60px;z-index:15;border-color:var(--brand)"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><b>Đã chọn ${ML.sel.size} file</b><span class="row" style="flex-wrap:wrap;gap:4px">
      <button class="sm pri" data-ml="post-ads" title="Đăng lên Page của từng cơ sở, đăng xong tự chạy quảng cáo thử">📣 Lên bài & chạy QC</button>
      <button class="sm" data-ml="bulk-plan" title="Mỗi file 1 bài, lên lịch liên tiếp, chờ Sếp duyệt ở Kế hoạch tháng">📅 Lên bài hàng loạt</button>
      <select id="mlBulkFolder"><option value="">Chuyển vào thư mục…</option><option value="__none">Chưa phân loại</option>${ML.lib.folders.map((f) => `<option>${esc(f.name)}</option>`).join('')}</select><button class="sm" data-ml="bulk-folder">Chuyển</button>
      <input type="text" id="mlBulkTag" placeholder="Thẻ…" style="width:110px"><button class="sm" data-ml="bulk-addtag">+ Thẻ</button><button class="sm" data-ml="bulk-rmtag">− Thẻ</button>
      ${selFiles.some((f) => !f.excluded) ? '<button class="sm" data-ml="bulk-exclude" title="Agent không tự lấy các file này">🚫 Không cho agent</button>' : ''}${selFiles.some((f) => f.excluded) ? '<button class="sm" data-ml="bulk-include">✅ Cho agent dùng</button>' : ''}
      ${selFiles.some((f) => !f.archived) ? '<button class="sm" data-ml="bulk-archive" title="Ẩn khỏi thư viện và agent; file thật vẫn còn">📦 Lưu trữ</button>' : ''}${selFiles.some((f) => f.archived) ? '<button class="sm" data-ml="bulk-unarchive">📤 Bỏ lưu trữ</button>' : ''}
      ${S.env && S.env.gemini ? '<button class="sm" data-ml="bulk-analyze" title="Gemini xem từng file: dịch vụ, màu tóc, số người hiện mặt">✦ Gemini xem</button>' : ''}
      <button class="sm danger" data-ml="bulk-trash" title="Chuyển vào thùng rác, khôi phục được">🗑 Xoá</button>
      <button class="sm" data-ml="sel-clear">Bỏ chọn</button></span></div></div>` : '';
  return `${mlSummary()}${mlUpload()}${mlDrive()}
    <div class="toolbar noprint"><input class="grow" type="search" id="mlSearch" placeholder="Tìm theo tên, ghi chú, thẻ, mô tả…" value="${esc(ML.q)}" aria-label="Tìm file">
      <select data-ml="f-type" aria-label="Loại"><option value="">Ảnh & video</option>${opt('image', 'Chỉ ảnh', ML.type)}${opt('video', 'Chỉ video', ML.type)}</select>
      <select data-ml="f-sort" aria-label="Sắp xếp">${Object.entries(ML_SORT).map(([k, l]) => opt(k, l, ML.sort)).join('')}</select>
      <select data-ml="f-status" aria-label="Trạng thái">${Object.entries(ML_FSTATUS).map(([k, l]) => opt(k, l, ML.status)).join('')}</select>
      <button class="sm" data-ml="reload">⟳ Làm mới</button>${list.length ? `<label class="f" style="margin:0"><input type="checkbox" data-ml="pick-all" ${slice.every((f) => ML.sel.has(f.name)) ? 'checked' : ''}> Chọn trang này</label><button class="sm" data-ml="sel-all" title="Chọn mọi file đang khớp bộ lọc">Chọn tất cả (${list.length})</button>` : ''}</div>
    ${bulk}
    <div style="display:grid;grid-template-columns:230px 1fr;gap:14px;align-items:start" class="mlgrid"><div>${mlSidebar()}</div><div>
      ${slice.length ? `<div class="mlcards" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px">${slice.map(mlCard).join('')}</div>` : `<div class="card"><div class="state"><b>${ML.lib.files.length ? 'Không có file nào khớp bộ lọc' : 'Thư viện đang trống'}</b>${ML.lib.files.length ? 'Thử bỏ bớt bộ lọc.' : 'Kéo thả ảnh/video vào khung phía trên, hoặc bấm nút bên dưới.<br><button type="button" class="pri" data-ml="pick-file" style="margin-top:10px">📂 Chọn file từ máy</button>'}</div></div>`}
      <div class="pager"><span>${list.length} file</span><span class="row"><button class="sm" data-ml="page" data-v="${ML.page - 1}" ${ML.page <= 1 ? 'disabled' : ''}>‹ Trước</button> Trang ${ML.page}/${pages} <button class="sm" data-ml="page" data-v="${ML.page + 1}" ${ML.page >= pages ? 'disabled' : ''}>Sau ›</button></span></div></div></div>`;
}
function mlPaint() { const el = document.getElementById('mlBody'); if (el) el.innerHTML = mlBody(); mlDrawer(); mlWatchTranscode(); }
let mlTcTimer = null;
function mlWatchTranscode() {
  const busy = ML.lib && ML.lib.files && ML.lib.files.some((f) => f.transcode && ['running', 'waiting'].includes(f.transcode.status));
  if (!busy || mlTcTimer || typeof location === 'undefined' || location.hash !== '#media') return;
  mlTcTimer = setTimeout(() => { mlTcTimer = null; if (location.hash === '#media') mlLoad(); }, 30e3);
}

function pageMedia() {
  const html = `<h1>Thư viện Media</h1><p class="sub">Ảnh/video của từng thương hiệu: agent tự lấy file chưa dùng để ghép bài. Thư mục và thẻ chỉ là cách sắp xếp trong hệ thống — <b>không đổi tên file thật</b>; bấm 🗑 chỉ chuyển file vào Thùng rác (giữ 30 ngày, khôi phục được).</p>
  <div class="seg" style="margin-bottom:12px">${S.brands.map((b) => `<button class="${(ML.brand || S.brands[0].id) === b.id ? 'on' : ''}" data-ml="brand" data-v="${esc(b.id)}">${esc(b.name)}</button>`).join('')}</div>
  <div id="mlBody">${mlBody()}</div>`;
  setTimeout(mlLoad, 0);
  return html;
}

// ---------- Chi tiết file ----------
const mlUseLine = (f) => (f.lastUse ? `<p style="margin:8px 0 0"><span class="tag ${f.lastUse.status === 'published' ? 'on' : 'info'}">📅 ${esc(mlUseText(f.lastUse))}</span> ${f.lastUse.topic ? `<b>${esc(f.lastUse.topic.slice(0, 60))}</b>` : ''} <a href="${f.lastUse.status === 'plan' ? '#kehoach' : '#lich'}">mở →</a></p>` : '');
function mlDrawer() {
  const layer = document.getElementById('layer');
  let el = document.getElementById('mlDrawer');
  const f = ML.detail ? mlFile(ML.detail) : null;
  if (!f) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('aside'); el.id = 'mlDrawer'; el.className = 'drawer'; layer.appendChild(el); }
  const usage = ML.usage && ML.usage.name === f.name ? ML.usage : null;
  const gem = S.env && S.env.gemini;
  const list = mlFiltered();
  const idx = list.findIndex((x) => x.name === f.name);
  const prev = idx > 0 ? list[idx - 1] : null, next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;
  el.innerHTML = `<div class="hd"><div><h2 style="word-break:break-all">${esc(f.title || f.name)}</h2><small style="color:var(--mute)">${esc((S.brands.find((b) => b.id === f.brand) || {}).name || f.brand)}${f.title ? ` · ${esc(f.name)}` : ''}${idx >= 0 ? ` · ${idx + 1}/${list.length}` : ''}</small></div>
      <span class="row" style="gap:4px"><button class="sm" data-ml="nav" data-v="${prev ? esc(prev.name) : ''}" ${prev ? '' : 'disabled'} title="File trước">◀</button><button class="sm" data-ml="nav" data-v="${next ? esc(next.name) : ''}" ${next ? '' : 'disabled'} title="File sau">▶</button><button class="sm" data-ml="close">✕ Đóng</button></span></div>
    ${f.archived ? '<p class="alert">📦 File này đã lưu trữ: ẩn khỏi thư viện và agent không dùng. File thật vẫn còn trên máy chủ.</p>' : f.excluded ? '<p class="alert">🚫 Agent không tự lấy file này. Anh vẫn gắn tay được khi soạn bài.</p>' : ''}
    ${f.type === 'video' ? `<video src="${esc(mlUrl(f))}" controls preload="metadata" playsinline style="width:100%;max-height:360px;background:#000;border-radius:8px"></video>` : `<a href="${esc(mlUrl(f))}" target="_blank" rel="noopener"><img src="${esc(mlUrl(f))}" alt="" style="width:100%;max-height:360px;object-fit:contain;background:var(--soft);border-radius:8px"></a>`}
    ${mlCodecLine(f)}${mlUseLine(f)}
    <div class="kv" style="grid-template-columns:repeat(3,1fr)"><div><small>Loại</small><b>${f.type === 'video' ? 'Video' : 'Ảnh'}</b></div><div><small>Dung lượng</small><b>${mlSize(f.size)}</b></div><div><small>Kích thước</small><b>${f.dims ? `${f.dims.width}×${f.dims.height}` : f.info && f.info.width ? `${f.info.width}×${f.info.height}` : '—'}</b></div>
      ${f.info && f.info.durationSec ? `<div><small>Thời lượng</small><b>${Math.round(f.info.durationSec)}s</b></div><div><small>Bitrate</small><b>${f.info.kbps} kbps</b></div>` : ''}<div><small>Thêm lúc</small><b>${esc(new Date(f.mtime).toLocaleDateString('vi-VN'))}</b></div></div>
    <div class="row noprint" style="margin:8px 0;flex-wrap:wrap;gap:4px"><button class="sm pri" data-ml="make-post">📅 Lên bài với file này</button><a href="${esc(mlUrl(f))}" target="_blank" rel="noopener"><button class="sm" type="button">⛶ Mở toàn màn hình</button></a><a href="${esc(mlUrl(f))}" download="${esc(f.name)}"><button class="sm" type="button">⬇ Tải về</button></a>
      <button class="sm" data-ml="copy-link">🔗 Sao chép liên kết</button><button class="sm" data-ml="copy-name">Sao chép tên file</button><button class="sm danger" data-ml="d-trash" title="Chuyển vào thùng rác, khôi phục được">🗑 Xoá</button>${f.type === 'image' ? '<button class="sm" data-ml="as-logo">Dùng làm logo</button>' : ''}</div>
    <div class="row noprint" style="margin:0 0 8px;flex-wrap:wrap;gap:10px"><label class="f" style="margin:0"><input type="checkbox" data-ml="d-excluded" ${f.excluded ? 'checked' : ''}> 🚫 Không cho agent tự dùng</label><label class="f" style="margin:0"><input type="checkbox" data-ml="d-archived" ${f.archived ? 'checked' : ''}> 📦 Lưu trữ (ẩn, không xoá file)</label></div>
    <h3>Tên hiển thị</h3><input type="text" data-ml="d-title" value="${esc(f.title || '')}" maxlength="80" placeholder="VD: Khách Lan nhuộm balayage (tên file thật không đổi)" style="width:100%">
    <p class="sub" style="margin:4px 0 8px;font-size:12px">Liên kết chỉ mở được khi đã đăng nhập vào hệ thống (không phải link công khai).</p>
    <h3>Thư mục & thẻ</h3>
    <div class="row"><select data-ml="d-folder"><option value="__none" ${!f.folder ? 'selected' : ''}>Chưa phân loại</option>${ML.lib.folders.map((x) => `<option ${f.folder === x.name ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
    <div class="row" style="margin-top:6px;gap:4px">${f.tags.map((t) => `<span class="tag on">#${esc(t)} <a href="#" data-ml="d-rmtag" data-v="${esc(t)}" style="text-decoration:none;color:inherit">✕</a></span>`).join('') || '<small style="color:var(--mute)">Chưa có thẻ</small>'}<input type="text" id="mlTagNew" placeholder="Thêm thẻ + Enter" style="width:150px" maxlength="30"></div>
    <h3 style="margin-top:12px">Ghi chú cho AI</h3><textarea data-ml="d-note" rows="2" style="width:100%" maxlength="300" placeholder="VD: khách Lan nhuộm balayage">${esc(f.note)}</textarea>
    ${f.meta ? `<h3 style="margin-top:12px">Gemini đã xem</h3><p style="margin:0">👁 ${esc(f.meta.summary)}${f.meta.faces ? ` · <b>${f.meta.faces} người hiện mặt</b>` : ''}${f.meta.watermark ? ` · watermark: ${esc(f.meta.watermark)}` : ''}</p>` : ''}
    ${f.meta && f.meta.faces ? `<label class="f"><input type="checkbox" data-ml="d-consent" ${f.consent ? 'checked' : ''}> Người trong file đã đồng ý đăng công khai</label>` : ''}
    ${gem ? `<button class="sm" data-ml="analyze">✦ ${f.meta ? 'Xem lại bằng Gemini' : 'Nhờ Gemini xem file'}</button>` : '<p class="sub" style="font-size:12px">Chưa có GEMINI_API_KEY nên agent chưa xem được nội dung file.</p>'}
    <h3 style="margin-top:14px">Lịch sử sử dụng</h3>${!usage ? '<div class="skel" style="height:50px"></div>' : usage.err ? `<div class="state err">${esc(usage.err)}</div>` : usage.list.length ? usage.list.map((u) => `<div class="item"><div><b>${esc(u.topic)}</b><p style="margin:2px 0">${u.kind === 'plan' ? 'Kế hoạch tháng' : esc(u.channel)} · ${esc(ML_STATUS[u.status] || u.status)}</p></div><small style="color:var(--mute);white-space:nowrap">${esc(new Date(u.at).toLocaleDateString('vi-VN'))}</small></div>`).join('') + '<p><a href="#lich">Mở Lịch đăng →</a></p>' : '<div class="empty">Chưa dùng cho bài nào.</div>'}`;
}
async function mlOpen(name) {
  ML.detail = name; ML.usage = null; mlDrawer();
  try { const r = await call('GET', `/api/media-lib/usage?brand=${encodeURIComponent(ML.brand)}&name=${encodeURIComponent(name)}`); if (ML.detail === name) ML.usage = { name, list: r.usage }; }
  catch (e) { if (ML.detail === name) ML.usage = { name, err: e.message, list: [] }; }
  mlDrawer();
}

// ---------- Hành động ----------
async function mlOrganize(names, body, okMsg) {
  try { const d = await call('POST', '/api/media-lib/organize', { brand: ML.brand, names, ...body }); ML.lib = { ...d, brand: ML.brand }; toast(okMsg); }
  catch (e) { toast(e.message); }
  mlPaint();
}
async function mlFolderOp(body, okMsg) {
  try { const d = await call('POST', '/api/media-lib/folders', { brand: ML.brand, ...body }); ML.lib = { ...d, brand: ML.brand }; if (okMsg) toast(okMsg); return true; }
  catch (e) { toast(e.message); return false; }
  finally { mlPaint(); }
}
// Tải lên tuần tự bằng XHR để có thanh tiến độ; kiểm tra sơ bộ ở trình duyệt, máy chủ kiểm tra lại nội dung file
function mlUploadFiles(files) {
  const lim = ML.lib.limits;
  const target = ML.folder && ML.folder !== '__none' ? ML.folder : '';
  for (const f of files) {
    const kind = ['.jpg', '.jpeg', '.png', '.webp'].includes(mlExt(f.name)) ? 'image' : ['.mp4', '.mov'].includes(mlExt(f.name)) ? 'video' : null;
    const u = { name: f.name, size: f.size, pct: 0, status: 'wait', error: '', file: f, target, brand: ML.brand };
    if (!kind) { u.status = 'error'; u.error = 'Chỉ nhận ảnh jpg/png/webp và video mp4/mov'; }
    else if (f.size === 0) { u.status = 'error'; u.error = 'File rỗng'; }
    else if (f.size > lim[kind]) { u.status = 'error'; u.error = `Quá lớn (tối đa ${mlSize(lim[kind])})`; }
    ML.uploads.push(u);
  }
  mlPaint();
  mlRunQueue();
}
let mlRunning = false;
async function mlRunQueue() {
  if (mlRunning) return;
  mlRunning = true;
  for (;;) {
    const u = ML.uploads.find((x) => x.status === 'wait');
    if (!u) break;
    u.status = 'uploading'; mlPaint();
    try {
      const name = await new Promise((resolve, reject) => {
        const x = new XMLHttpRequest();
        x.open('POST', `/api/media/upload?brand=${encodeURIComponent(u.brand)}&name=${encodeURIComponent(u.name)}`);
        x.upload.onprogress = (e) => { if (e.lengthComputable) { u.pct = Math.round((e.loaded / e.total) * 100); const bar = document.querySelector('#mlBody .bar i'); if (bar) mlPaint(); } };
        x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch { /* không phải JSON */ } x.status === 200 ? resolve(j.name) : reject(new Error(j.error || `Lỗi ${x.status}`)); };
        x.onerror = () => reject(new Error('Mất kết nối khi tải lên'));
        x.send(u.file);
      });
      u.status = 'done'; u.pct = 100;
      if (u.target) { try { await call('POST', '/api/media-lib/organize', { brand: u.brand, names: [name], folder: u.target }); } catch { /* giữ ở chưa phân loại */ } }
    } catch (e) { u.status = 'error'; u.error = e.message; }
    delete u.file;
    mlPaint();
  }
  mlRunning = false;
  await mlLoad();
}
function mlComposeFrom(f) {
  location.hash = '#lich';
  setTimeout(() => { if (typeof openCompose === 'function') openCompose('', { brand: f.brand, media: [f.name] }); }, 150);
}
// ---- Thùng rác: "xoá" chỉ chuyển file sang thùng rác (khôi phục được), "xoá hẳn" cần quyền quản trị dữ liệu
const mlCan = (p) => typeof ME !== 'undefined' && !!(ME && Array.isArray(ME.perms) && ME.perms.includes(p));
function mlTrashBody() {
  const t = ML.trash, canPurge = mlCan('data_admin'), days = (t && t.days) || (ML.lib.trash && ML.lib.trash.days) || 30;
  const head = `<div class="card"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><div><button class="sm" data-ml="lib-view">← Về thư viện</button> <b>🗑 Thùng rác</b> <small style="color:var(--mute)">file đã xoá nằm ở đây ${days} ngày rồi mới tự xoá hẳn; trước đó khôi phục được bất cứ lúc nào</small></div>${t && t.items && t.items.length && canPurge ? `<button class="sm danger" data-ml="purge-all">Dọn sạch (xoá hẳn ${t.items.length} file)</button>` : ''}</div></div>`;
  if (!t) return head + '<div class="skel" style="height:200px"></div>';
  if (t.err) return head + `<div class="card"><div class="state err"><b>Không tải được thùng rác</b>${esc(t.err)}<br><button class="sm" data-ml="trash-view">Thử lại</button></div></div>`;
  if (!t.items.length) return head + '<div class="card"><div class="state"><b>Thùng rác trống</b>Bấm 🗑 ở thư viện thì file chuyển vào đây, chưa mất.</div></div>';
  return head + `<div class="card" style="padding:0">${t.items.map((x) => `<div class="item" style="padding:10px 12px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;border-bottom:1px solid var(--line)"><div style="min-width:0"><b style="word-break:break-all">${esc(x.name)}</b><br><small style="color:var(--mute)">${x.type === 'video' ? '🎬 Video' : '🖼 Ảnh'} · ${mlSize(x.size || 0)} · xoá ${esc(new Date(x.at).toLocaleString('vi-VN'))}${x.info && x.info.folder ? ` · 📁 ${esc(x.info.folder)}` : ''}${x.note ? ` · 📝 ${esc(x.note.slice(0, 40))}` : ''}${x.uses ? ' · đang gắn vào bài' : ''}</small><br><span class="tag ${!x.exists ? 'off' : x.daysLeft <= 3 ? 'dry' : ''}">${x.exists ? `tự xoá hẳn sau ${x.daysLeft} ngày` : 'file không còn trên máy chủ'}</span></div><span class="row" style="gap:4px">${x.exists ? `<button class="sm pri" data-ml="restore" data-v="${esc(x.id)}">↩ Khôi phục</button>` : ''}${canPurge ? `<button class="sm danger" data-ml="purge" data-v="${esc(x.id)}" title="Xoá hẳn khỏi máy chủ, không khôi phục được">Xoá hẳn</button>` : ''}</span></div>`).join('')}</div>`;
}
async function mlTrashLoad() {
  ML.trash = null; mlPaint();
  try { ML.trash = await call('GET', `/api/media-lib/trash?brand=${encodeURIComponent(ML.brand)}`); } catch (e) { ML.trash = { items: [], err: e.message }; }
  mlPaint();
}
async function mlTrash(names, force = false) {
  names = (names || []).filter(Boolean);
  if (!names.length) return;
  const days = (ML.lib && ML.lib.trash && ML.lib.trash.days) || 30;
  if (!force) {
    const ok = await confirmBox({ title: `Xoá ${names.length} file?`, body: `<p>File chuyển vào <b>Thùng rác</b>, khôi phục được trong ${days} ngày; sau đó mới tự xoá hẳn khỏi máy chủ.</p><p style="word-break:break-all"><small>${esc(names.slice(0, 5).join(', '))}${names.length > 5 ? ` … (+${names.length - 5})` : ''}</small></p>`, ok: 'Xoá', danger: true });
    if (!ok) return;
  }
  try {
    const d = await call('POST', '/api/media-lib/trash', { brand: ML.brand, names, force });
    ML.lib = { ...d, brand: ML.brand };
    names.forEach((n) => ML.sel.delete(n));
    if (names.includes(ML.detail)) ML.detail = null;
    toast(`Đã chuyển ${d.moved.length} file vào thùng rác`);
    mlPaint();
  } catch (e) {
    if (!force && /đang gắn vào bài/.test(e.message)) {
      const ok = await confirmBox({ title: 'File đang dùng trong bài', body: `<p>${esc(e.message)}</p><p>Vẫn xoá thì bài đó thiếu file và sẽ bị bỏ qua khi đến giờ đăng.</p>`, ok: 'Vẫn xoá', danger: true });
      if (ok) return mlTrash(names, true);
    } else toast(e.message);
  }
}
async function mlTrashAct(kind, ids) {
  try {
    if (kind === 'restore') {
      const d = await call('POST', '/api/media-lib/restore', { brand: ML.brand, ids });
      ML.lib = { ...d, brand: ML.brand };
      toast(`Đã khôi phục: ${d.restored.join(', ')}`);
    } else {
      const n = ids === 'all' ? (ML.trash && ML.trash.items.length) : ids.length;
      const ok = await confirmBox({ title: `Xoá hẳn ${n} file?`, body: '<p><b>Không khôi phục được.</b> File bị xoá khỏi máy chủ ngay.</p>', ok: 'Xoá hẳn', danger: true });
      if (!ok) return;
      const d = await call('POST', '/api/media-lib/purge', { brand: ML.brand, ids });
      if (ML.lib && ML.lib.trash) ML.lib.trash.count = d.items.length;
      toast(`Đã xoá hẳn ${d.gone.length} file`);
    }
    await mlTrashLoad();
  } catch (e) { toast(e.message); }
}
// "Lên bài & chạy QC": mỗi file × mỗi cơ sở 1 bài trên Page của cơ sở; AI viết chữ theo mô tả; đăng xong agent tự chạy quảng cáo thử
function mlLocalInput(d) { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
async function mlPostAds(names) {
  const files = names.map(mlFile).filter(Boolean);
  if (!files.length) return;
  if (files.length > 20) return toast('Tối đa 20 file mỗi lần');
  try { S = await call('GET', '/api/state'); } catch { /* dùng dữ liệu đang có */ } // Page/hạn mức cơ sở có thể vừa đổi ở trang khác
  const units = (S.adUnits || []).filter((u) => u.brand === ML.brand && u.on !== false);
  if (!units.length) return toast('Thương hiệu này chưa có cơ sở chạy quảng cáo (trang Quảng cáo)');
  const pn = S.pageNames || {};
  const start = new Date(Date.now() + 15 * 60e3); start.setSeconds(0, 0);
  const room = (u) => Math.max(0, (u.dailyBudget || 0) - (u.committed || 0));
  const body = `<p class="sub" style="margin-top:0">Mỗi file đăng 1 bài lên Page của <b>từng cơ sở đã chọn</b>. AI viết nội dung theo mô tả (kèm địa chỉ, hotline đã xác nhận). Đăng xong agent <b>tự tạo quảng cáo thử</b> cho đúng cơ sở, nhắm nhóm khách tốt nhất đã học của cơ sở đó.</p>
    <div style="margin:8px 0"><b>Cơ sở</b>${units.map((u) => `<label class="f" style="display:block;margin:4px 0"><input type="checkbox" class="paUnit" value="${esc(u.id)}" ${u.pageId ? 'checked' : 'disabled'}> ${esc(u.name)} ${u.pageId ? `<small style="color:var(--mute)">→ ${esc(pn[u.pageId] || 'Page ' + u.pageId)} · còn trống ${vnd(room(u))}/ngày</small>` : '<small style="color:var(--bad)">chưa chọn Page (trang Quảng cáo → cột "Page của cơ sở")</small>'}</label>`).join('')}</div>
    <div style="margin:8px 0"><b>Mô tả từng file</b> <small style="color:var(--mute)">(AI viết theo mô tả; để trống thì AI tự xem/đoán)</small>
      ${files.map((f, i) => `<label style="display:block;margin:4px 0"><small>${esc(f.title || f.name)}</small><input type="text" class="paTopic" data-i="${i}" style="width:100%" maxlength="200" value="${esc(f.note || (f.meta && f.meta.summary) || '')}" placeholder="VD: Uốn layer dài nâu trà sữa, tóc bồng bềnh"></label>`).join('')}</div>
    <div class="row" style="flex-wrap:wrap;gap:10px;margin:8px 0">
      <label class="f"><input type="checkbox" id="paRun" checked> Chạy quảng cáo thử</label>
      <label>Ngân sách <input type="number" id="paBudget" value="100000" step="10000" min="20000" style="width:110px"> đ/ngày</label>
      <label>Số ngày <input type="number" id="paDays" value="3" min="1" max="30" style="width:60px"></label></div>
    <div class="row" style="flex-wrap:wrap;gap:10px;margin:8px 0">
      <label>Đăng từ ${dtPicker('paStart', start.toISOString())}</label>
      <label>Cách nhau <input type="number" id="paGap" value="60" min="0" max="1440" style="width:70px"> phút/file</label></div>
    <label class="f" style="display:block"><input type="checkbox" id="paNow" checked> Duyệt luôn (không cần vào mục Duyệt)</label>
    <p class="sub" id="paSum" style="margin:8px 0 0"></p>`;
  const vals = { units: [], topics: [] };
  const grab = () => {
    const g = (id) => document.getElementById(id);
    if (!g('paBudget')) return;
    vals.units = [...document.querySelectorAll('.paUnit:checked')].map((x) => x.value);
    vals.topics = [...document.querySelectorAll('.paTopic')].map((x) => x.value.trim());
    Object.assign(vals, { run: g('paRun').checked, budget: Number(g('paBudget').value), days: Number(g('paDays').value), start: dtValue(document, 'paStart'), gap: Number(g('paGap').value), now: g('paNow').checked });
    const n = files.length * vals.units.length;
    g('paSum').innerHTML = n ? `${files.length} file × ${vals.units.length} cơ sở = <b>${n} bài</b>${vals.run ? `, mỗi bài chạy thử ${vnd(vals.budget)}/ngày × ${vals.days} ngày → tối đa <b>${vnd(n * vals.budget * vals.days)}</b> (${vnd(n * vals.budget)}/ngày)` : ', không chạy quảng cáo'}.` : '<span style="color:var(--bad)">Chọn ít nhất 1 cơ sở</span>';
  };
  document.addEventListener('input', grab, true); document.addEventListener('change', grab, true); document.addEventListener('click', grab, true);
  setTimeout(grab, 0);
  let ok = false;
  try { ok = await confirmBox({ title: `📣 Lên bài & chạy QC (${files.length} file)`, body, ok: 'Lên bài' }); }
  finally { document.removeEventListener('input', grab, true); document.removeEventListener('change', grab, true); document.removeEventListener('click', grab, true); }
  if (!ok) return;
  if (!vals.units.length) return toast('Chọn ít nhất 1 cơ sở');
  toast(`AI đang viết ${files.length} bài, chờ chút…`);
  try {
    const r = await call('POST', '/api/posts/with-ads', {
      brand: ML.brand, items: files.map((f, i) => ({ name: f.name, topic: vals.topics[i] || '' })), unitIds: vals.units,
      runAds: vals.run, budget: vals.budget, days: vals.days, startAt: vals.start ? new Date(vals.start).toISOString() : undefined, gapMinutes: vals.gap, approveNow: vals.now,
    });
    S = r.state;
    ML.sel.clear();
    await mlLoad();
    const errs = r.errors && r.errors.length ? `\nChưa duyệt được ${r.errors.length} bài:\n${r.errors.slice(0, 5).join('\n')}` : '';
    toast(`Đã lên ${r.posts.length} bài${vals.now ? ', đã duyệt' : ', chờ duyệt ở mục Duyệt'}${vals.run ? '. Đăng xong agent tự chạy quảng cáo — xem nhãn 📣 trên từng file' : ''}.${errs}`);
  } catch (e) { toast(e.message); }
}

// Lên bài hàng loạt từ các file đã chọn: mỗi file 1 bài, đăng liên tiếp theo các ngày đã chọn, tất cả chờ Sếp duyệt ở Kế hoạch tháng
async function mlBulkPlan() {
  const files = [...ML.sel].map(mlFile).filter(Boolean);
  if (!files.length) return;
  const allVideo = files.every((f) => f.type === 'video');
  const chans = Object.entries((S.brands.find((b) => b.id === ML.brand) || {}).channels || {}).filter(([, v]) => v && v.on !== false && v !== false).map(([k]) => k);
  const today = new Date();
  const left = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() - today.getDate();
  const month = left >= files.length ? today.toISOString().slice(0, 7) : new Date(today.getFullYear(), today.getMonth() + 1, 1).toISOString().slice(0, 7);
  const body = `<p>${files.length} file → ${files.length} bài${allVideo ? ' <b>Reel/video</b>' : ' (ảnh + chữ)'}, mỗi ngày 1 bài theo thứ tự đã chọn, bắt đầu từ ngày mai. Agent soạn chữ, bài <b>chờ anh duyệt</b> ở Kế hoạch tháng.</p>
    <label>Kênh <select id="bpChannel">${(chans.length ? chans : ['facebook_page']).map((c) => `<option value="${esc(c)}">${esc((typeof CH_LABEL !== 'undefined' && CH_LABEL[c]) || c)}</option>`).join('')}</select></label>
    <label style="margin-left:10px">Giờ đăng <input type="time" id="bpTime" value="19:00"></label>
    <label style="display:block;margin-top:8px">Ngày trong tuần: ${[[1, 'T2'], [2, 'T3'], [3, 'T4'], [4, 'T5'], [5, 'T6'], [6, 'T7'], [7, 'CN']].map(([d, l]) => `<label class="f" style="display:inline;margin-right:6px"><input type="checkbox" class="bpDay" value="${d}" checked> ${l}</label>`).join('')}</label>
    <label style="display:block;margin-top:8px">Định hướng nội dung (không bắt buộc)<input type="text" id="bpDir" style="width:100%" placeholder="VD: nhấn ưu đãi tháng 10, mời đặt lịch trước"></label>
    <p class="sub" style="margin:8px 0 0">Tháng ${esc(month)}. ${allVideo ? '' : 'Có ảnh nên loại bài là "Bài đăng"; '}muốn nhiều bài/ngày thì tạo thêm hồ sơ ở Lái tự động.</p>`;
  // confirmBox gỡ hộp thoại trước khi trả kết quả nên phải đọc giá trị ngay khi người dùng đổi
  const vals = { channel: chans[0] || 'facebook_page', time: '19:00', days: [1, 2, 3, 4, 5, 6, 7], direction: '' };
  const grab = () => {
    const g = (id) => document.getElementById(id);
    if (g('bpChannel')) vals.channel = g('bpChannel').value;
    if (g('bpTime') && g('bpTime').value) vals.time = g('bpTime').value;
    if (g('bpDir')) vals.direction = g('bpDir').value;
    if (document.querySelector('.bpDay')) vals.days = [...document.querySelectorAll('.bpDay:checked')].map((x) => Number(x.value));
  };
  document.addEventListener('input', grab, true); document.addEventListener('change', grab, true);
  document.addEventListener('click', grab, true); // bắt trạng thái cuối trước khi nút "Soạn kế hoạch" đóng hộp
  let ok = false;
  try { ok = await confirmBox({ title: `Lên bài hàng loạt (${files.length} file)`, body, ok: 'Soạn kế hoạch' }); }
  finally { document.removeEventListener('input', grab, true); document.removeEventListener('change', grab, true); document.removeEventListener('click', grab, true); }
  if (!ok) return;
  const { channel, time, days, direction } = vals;
  if (!days.length) return toast('Chọn ít nhất 1 ngày trong tuần');
  try {
    S = await call('POST', '/api/plans', { brand: ML.brand, channel, type: allVideo ? 'reel' : 'post', month, time, days, direction, media: files.map((f) => f.name) });
    toast(`Đã soạn ${files.length} bài, chờ duyệt ở Kế hoạch tháng`);
    ML.sel.clear();
    await mlLoad();
    if (confirm('Mở Kế hoạch tháng để duyệt luôn?')) location.hash = '#kehoach';
  } catch (e) { toast(e.message); }
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-ml]');
  if (!t || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) return;
  const k = t.dataset.ml, v = t.dataset.v;
  if (k === 'd-rmtag') e.preventDefault();
  if (k === 'brand') { ML.brand = v; ML.lib = null; ML.view = 'lib'; ML.trash = null; ML.sel.clear(); ML.folder = ''; ML.tag = ''; ML.page = 1; ML.detail = null; render(); }
  else if (k === 'reload') mlLoad();
  else if (k === 'folder') { ML.folder = v; ML.page = 1; mlPaint(); }
  else if (k === 'tag') { ML.tag = ML.tag === v ? '' : v; ML.page = 1; mlPaint(); }
  else if (k === 'page') { ML.page = Math.max(1, Number(v)); mlPaint(); }
  else if (k === 'open') mlOpen(v);
  else if (k === 'nav') { if (v) mlOpen(v); }
  else if (k === 'close') { ML.detail = null; mlDrawer(); }
  else if (k === 'card-post') { const f = mlFile(v); if (f) mlComposeFrom(f); }
  else if (k === 'card-note') { await mlOpen(v); setTimeout(() => { const ta = document.querySelector('#mlDrawer [data-ml="d-note"]'); if (ta) ta.focus(); }, 50); }
  else if (k === 'card-exclude') { const f = mlFile(v); if (f) mlOrganize([v], { excluded: !f.excluded }, f.excluded ? 'Agent được dùng lại file này' : 'Agent sẽ không tự lấy file này'); }
  else if (k === 'sel-all') { mlFiltered().forEach((f) => ML.sel.add(f.name)); mlPaint(); }
  else if (k === 'bulk-plan') mlBulkPlan();
  else if (k === 'post-ads') mlPostAds([...ML.sel]);
  else if (k === 'card-ads') mlPostAds([v]);
  else if (k === 'trash-view') { ML.view = 'trash'; ML.detail = null; mlDrawer(); mlTrashLoad(); }
  else if (k === 'lib-view') { ML.view = 'lib'; mlPaint(); }
  else if (k === 'card-trash') mlTrash([v]);
  else if (k === 'd-trash') mlTrash([ML.detail]);
  else if (k === 'bulk-trash') mlTrash([...ML.sel]);
  else if (k === 'restore') mlTrashAct('restore', [v]);
  else if (k === 'purge') mlTrashAct('purge', [v]);
  else if (k === 'purge-all') mlTrashAct('purge', 'all');
  else if (k === 'bulk-exclude' || k === 'bulk-include') { await mlOrganize([...ML.sel], { excluded: k === 'bulk-exclude' }, k === 'bulk-exclude' ? 'Agent sẽ không tự lấy các file này' : 'Agent được dùng lại các file này'); }
  else if (k === 'bulk-archive' || k === 'bulk-unarchive') {
    if (k === 'bulk-archive' && !(await confirmBox({ title: `Lưu trữ ${ML.sel.size} file?`, body: '<p>File sẽ ẩn khỏi thư viện và agent không dùng nữa. <b>File thật vẫn còn trên máy chủ</b>, xem lại bằng bộ lọc "Đã lưu trữ".</p>', ok: 'Lưu trữ' }))) return;
    await mlOrganize([...ML.sel], { archived: k === 'bulk-archive' }, k === 'bulk-archive' ? 'Đã lưu trữ' : 'Đã bỏ lưu trữ'); ML.sel.clear(); mlPaint();
  }
  else if (k === 'bulk-analyze') { const names = [...ML.sel]; toast(`Gemini đang xem ${names.length} file…`); let ok = 0; for (const n of names) { try { await call('POST', '/api/media/analyze', { brand: ML.brand, name: n }); ok++; } catch (err) { toast(err.message); break; } } await mlLoad(); toast(`Gemini đã xem ${ok}/${names.length} file`); }
  else if (k === 'd-transcode') { try { const d = await call('POST', '/api/media-lib/transcode', { brand: ML.brand, name: ML.detail }); ML.lib = { ...d, brand: ML.brand }; mlPaint(); toast('Đã đưa video vào hàng chuyển H.264'); } catch (err) { toast(err.message); } }
  else if (k === 'copy-name') { navigator.clipboard.writeText(ML.detail).then(() => toast('Đã sao chép tên file'), () => toast('Không sao chép được')); }
  else if (k === 'clear-uploads') { ML.uploads = []; mlPaint(); }
  else if (k === 'drive-save') { const link = ((document.getElementById('mlDriveLink') || {}).value || '').trim(); const label = ((document.getElementById('mlDriveLabel') || {}).value || '').trim(); if (!link) return toast('Dán link thư mục Drive trước'); mlDriveDo(() => call('POST', '/api/drive/settings', { brand: ML.brand, link, label }), 'Đã thêm thư mục Drive — bấm "Nạp ngay" hoặc bật tự nạp'); }
  else if (k === 'drive-remove') { if (await confirmBox({ title: 'Bỏ thư mục Drive?', body: `<p><b>${esc(t.dataset.name)}</b></p><p>Chỉ bỏ khỏi danh sách nạp. <b>File đã nạp vẫn còn</b> trong thư viện, thư mục trên Drive không bị động tới.</p>`, ok: 'Bỏ thư mục', danger: true })) mlDriveDo(() => call('POST', '/api/drive/settings', { brand: ML.brand, remove: v }), 'Đã bỏ thư mục khỏi danh sách'); }
  else if (k === 'drive-sync') mlDriveDo(() => call('POST', '/api/drive/sync', { brand: ML.brand }), (d) => (d && d.result ? (d.result.added ? `Đã nạp ${d.result.added} file mới từ Drive${d.result.pending ? `, còn ${d.result.pending} file sẽ nạp lượt sau` : ''}` : d.result.errors && d.result.errors.length ? d.result.errors[0] : `Không có file mới (${d.result.skipped} file đã có, ${d.result.rejected} bỏ qua)`) : 'Xong'));
  else if (k === 'drive-test') { toast('Đang kiểm tra Google Drive…'); try { const r = await call('POST', '/api/drive/test', { brand: ML.brand, folderId: v || '' }); toast(`OK: ${r.folder} — ${r.total} file, ${r.usable} ảnh/video dùng được, ${r.newFiles} file mới chưa nạp${r.failed ? `; ${r.failed} thư mục lỗi (xem dòng đỏ)` : ''}`); ML.drive = await call('GET', '/api/drive'); mlPaint(); } catch (err) { toast(err.message); try { ML.drive = await call('GET', '/api/drive'); mlPaint(); } catch { /* giữ nguyên */ } } }
  else if (k === 'drive-copy-email') { navigator.clipboard.writeText(t.textContent).then(() => toast('Đã sao chép email service account'), () => toast('Không sao chép được')); }
  else if (k === 'pick-file') { if (!ML.lib) return toast('Thư viện đang tải, thử lại sau giây lát'); const inp = document.getElementById('mlFile'); if (inp) inp.click(); }
  else if (k === 'sel-clear') { ML.sel.clear(); mlPaint(); }
  else if (!ML.lib) return;
  else if (k === 'folder-new') { const n = prompt('Tên thư mục mới:'); if (n && n.trim()) await mlFolderOp({ action: 'create', name: n.trim() }, 'Đã tạo thư mục'); }
  else if (k === 'folder-rename') { const n = prompt('Tên mới cho thư mục:', v); if (n && n.trim() && n.trim() !== v) { if (await mlFolderOp({ action: 'rename', name: v, to: n.trim() }, 'Đã đổi tên thư mục')) ML.folder = n.trim(); mlPaint(); } }
  else if (k === 'folder-del') {
    if (await confirmBox({ title: 'Xoá thư mục?', body: `<p><b>${esc(v)}</b></p><p>Chỉ bỏ nhãn thư mục. <b>File vẫn còn nguyên</b>, chuyển về "Chưa phân loại".</p>`, ok: 'Xoá thư mục', danger: true })) { await mlFolderOp({ action: 'delete', name: v }, 'Đã xoá thư mục (file không bị xoá)'); ML.folder = ''; mlPaint(); }
  }
  else if (k === 'bulk-folder') { const v2 = document.getElementById('mlBulkFolder').value; if (!v2) return toast('Chọn thư mục đích'); await mlOrganize([...ML.sel], { folder: v2 === '__none' ? '' : v2 }, 'Đã chuyển thư mục'); ML.sel.clear(); mlPaint(); }
  else if (k === 'bulk-addtag' || k === 'bulk-rmtag') { const tag = document.getElementById('mlBulkTag').value.trim(); if (!tag) return toast('Nhập thẻ'); await mlOrganize([...ML.sel], k === 'bulk-addtag' ? { addTags: [tag] } : { removeTags: [tag] }, k === 'bulk-addtag' ? 'Đã thêm thẻ' : 'Đã bớt thẻ'); }
  else if (k === 'd-rmtag') mlOrganize([ML.detail], { removeTags: [v] }, 'Đã bỏ thẻ');
  else if (k === 'copy-link') { const f = mlFile(ML.detail); navigator.clipboard.writeText(location.origin + mlUrl(f)).then(() => toast('Đã sao chép liên kết (cần đăng nhập để mở)'), () => toast('Không sao chép được')); }
  else if (k === 'make-post') mlComposeFrom(mlFile(ML.detail));
  else if (k === 'as-logo') { const f = mlFile(ML.detail); try { S = await call('POST', '/api/brands', { id: f.brand, identity: { logo: f.name } }); toast('Đã đặt làm logo của thương hiệu'); } catch (err) { toast(err.message); } }
  else if (k === 'analyze') { toast('Gemini đang xem file…'); try { await call('POST', '/api/media/analyze', { brand: ML.brand, name: ML.detail }); await mlLoad(); toast('Gemini đã xem xong'); } catch (err) { toast(err.message); } }
});
document.addEventListener('change', async (e) => {
  const t = e.target, k = t.dataset.ml;
  if (e.target.id === 'mlFile') { if (ML.lib && t.files.length) mlUploadFiles([...t.files]); t.value = ''; return; }
  if (!k) return;
  if (k === 'pick') { t.checked ? ML.sel.add(t.dataset.v) : ML.sel.delete(t.dataset.v); mlPaint(); }
  else if (k === 'pick-all') { const list = mlFiltered().slice((ML.page - 1) * ML.per, ML.page * ML.per); list.forEach((f) => (t.checked ? ML.sel.add(f.name) : ML.sel.delete(f.name))); mlPaint(); }
  else if (k === 'drive-ch') mlDriveDo(() => call('POST', '/api/drive/settings', { brand: ML.brand, folder: t.dataset.v, channel: t.value }), 'Đã đổi kênh dùng cho thư mục');
  else if (k === 'f-type') { ML.type = t.value; ML.page = 1; mlPaint(); }
  else if (k === 'f-sort') { ML.sort = t.value; mlPaint(); }
  else if (k === 'f-unused') { ML.unused = t.checked; ML.page = 1; mlPaint(); }
  else if (k === 'f-status') { ML.status = t.value; ML.page = 1; mlPaint(); }
  else if (k === 'drive-on') mlDriveDo(() => call('POST', '/api/drive/settings', { brand: ML.brand, on: t.checked }), t.checked ? 'Đã bật tự nạp từ Drive theo lịch quét' : 'Đã tắt tự nạp từ Drive');
  else if (k === 'd-excluded') mlOrganize([ML.detail], { excluded: t.checked }, t.checked ? 'Agent sẽ không tự lấy file này' : 'Agent được dùng lại file này');
  else if (k === 'd-archived') mlOrganize([ML.detail], { archived: t.checked }, t.checked ? 'Đã lưu trữ (file thật vẫn còn)' : 'Đã bỏ lưu trữ');
  else if (k === 'd-title') mlOrganize([ML.detail], { title: t.value }, 'Đã lưu tên hiển thị');
  else if (k === 'd-folder') mlOrganize([ML.detail], { folder: t.value === '__none' ? '' : t.value }, 'Đã chuyển thư mục');
  else if (k === 'd-note') { try { await call('POST', '/api/media/note', { brand: ML.brand, name: ML.detail, note: t.value }); await mlLoad(); toast('Đã lưu ghi chú'); } catch (err) { toast(err.message); } }
  else if (k === 'd-consent') { try { await call('POST', '/api/media/consent', { brand: ML.brand, name: ML.detail, value: t.checked }); await mlLoad(); } catch (err) { toast(err.message); } }
});
document.addEventListener('input', (e) => { if (e.target.id === 'mlSearch') { ML.q = e.target.value; ML.page = 1; const pos = e.target.selectionStart; mlPaint(); const s = document.getElementById('mlSearch'); if (s) { s.focus(); s.setSelectionRange(pos, pos); } } });
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'mlTagNew' && e.key === 'Enter') { e.preventDefault(); const v = e.target.value.trim(); if (v) mlOrganize([ML.detail], { addTags: [v] }, 'Đã thêm thẻ'); }
});
document.addEventListener('dragover', (e) => { if (e.target.closest && e.target.closest('#mlDrop')) e.preventDefault(); });
document.addEventListener('drop', (e) => {
  if (!(e.target.closest && e.target.closest('#mlDrop'))) return;
  e.preventDefault();
  if (ML.lib && e.dataTransfer.files.length) mlUploadFiles([...e.dataTransfer.files]);
});
