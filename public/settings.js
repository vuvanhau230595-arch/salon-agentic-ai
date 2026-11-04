// Trang Cài đặt: tài khoản & phân quyền, hệ thống (chạy thử/thật, chu kỳ quét, ngưỡng cảnh báo, thông báo), kết nối API, AI,
// sao lưu & khôi phục, lịch sử thay đổi. Giao diện chỉ ẨN/KHOÁ theo quyền để dễ dùng — quyền thật được kiểm tra ở máy chủ.
// Nạp sau knowledge.js (dùng chung call, toast, render, S, esc, confirmBox, tiktokCard, metaChecks).
const ST = { tab: 'auto', me: null, users: null, backups: null, ai: null, activity: null, drive: null, state: 'idle', err: '', seq: 0, busy: false };
const ST_TABS = [['auto', '⚡ Tự động', 'view'], ['account', 'Tài khoản', 'view'], ['system', 'Hệ thống & cảnh báo', 'view'], ['api', 'Kết nối API', 'view'], ['ai', 'AI', 'view'], ['backup', 'Sao lưu & khôi phục', 'data_admin'], ['activity', 'Lịch sử thay đổi', 'view']];
const stWhen = (t) => (t ? new Date(t).toLocaleString('vi-VN') : '—');
const stCan = (perm) => !ST.me || ST.me.perms.includes(perm);
const stBrand = (id) => (S.brands.find((b) => b.id === id) || {}).name || id;
const stSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

async function stLoad() {
  const seq = ++ST.seq;
  ST.state = ST.me ? 'ok' : 'loading'; stPaint();
  try {
    ST.me = await call('GET', '/api/me');
    const jobs = [];
    if (stCan('users_admin')) jobs.push(call('GET', '/api/users').then((d) => { ST.users = d; }));
    if (stCan('data_admin')) jobs.push(call('GET', '/api/backups').then((d) => { ST.backups = d; }));
    jobs.push(call('GET', '/api/agent-center').then((d) => { ST.ai = d; }).catch(() => {}));
    jobs.push(call('GET', '/api/drive').then((d) => { ST.drive = d; }).catch(() => {}));
    jobs.push(Promise.all(['settings', 'user', 'security', 'data'].map((k) => call('GET', `/api/audit?kind=${k}&limit=15`))).then((rs) => { ST.activity = rs.flatMap((r) => r.rows).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30); }).catch(() => {}));
    await Promise.all(jobs);
    if (seq !== ST.seq) return;
    ST.state = 'ok'; ST.err = '';
  } catch (e) { if (seq !== ST.seq) return; ST.state = 'err'; ST.err = e.message; }
  stPaint();
}
async function stDo(fn, okMsg) {
  ST.busy = true; stPaint();
  try { const r = await fn(); if (okMsg) toast(okMsg); ST.busy = false; await stLoad(); S = await call('GET', '/api/state'); render(); return r; }
  catch (e) { toast(e.message); ST.busy = false; stPaint(); return null; }
}

// ---------- Tự động: mọi công tắc "agent tự làm" ở một chỗ, chữ dễ hiểu ----------
function stAuto() {
  const st = S.settings;
  const t = st.adTest || {};
  const b = t.boost || {};
  const ap = st.autopilot || {};
  const agents = st.agents || {};
  const dis = ST.busy ? 'disabled' : '';
  const sw = (key, on, label, note, extra = '') => `<label class="f" style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--line)"><input type="checkbox" data-st="${key}" ${on ? 'checked' : ''} ${dis} ${extra}><span><b>${label}</b>${note ? `<br><small style="color:var(--mute)">${note}</small>` : ''}</span></label>`;
  const agentRow = (id, label, note) => sw(`auto-agent`, !!(agents[id] || {}).on, label, note + ((agents[id] || {}).autoPaused ? ' <span class="tag off">tự tạm dừng do lỗi</span>' : ''), `data-id="${id}"`);
  const units = (S.adUnits || []).map((u) => `<tr><td><label class="f" style="display:inline"><input type="checkbox" data-st="auto-unit" data-id="${esc(u.id)}" ${u.on !== false ? 'checked' : ''} ${dis}> <b>${esc(u.name)}</b></label></td>
      <td><input type="number" data-st="auto-unit-budget" data-id="${esc(u.id)}" value="${u.dailyBudget}" style="width:120px" ${dis}> đ/ngày</td><td>${vnd(u.committed)}</td></tr>`).join('');
  const mode = st.dryRun
    ? `<p class="alert"><b>Đang CHẠY THỬ:</b> agent chỉ ghi nhật ký, không tắt/tạo/đăng gì thật trên Facebook. <button class="sm pri" data-st="mode" ${dis}>Chuyển sang chạy thật</button></p>`
    : `<p class="alert danger"><b>Đang CHẠY THẬT</b> trên Facebook. <button class="sm" data-st="mode" ${dis}>Chuyển về chạy thử</button></p>`;
  const running = (S.adTests || []).filter((x) => x.status === 'running').length;
  return `<div class="card"><h2>Chế độ</h2>${mode}
    ${st.paused ? '<p class="alert danger"><b>ĐANG DỪNG KHẨN CẤP</b> — agent không làm gì cho tới khi bật lại (nút ở góc phải).</p>' : ''}</div>
  <div class="card"><h2>Agent nào được tự chạy</h2>
    ${agentRow('ads', 'Agent Quảng cáo', 'Quét mỗi ' + (st.scanMinutes || 30) + ' phút: cảnh báo chiến dịch xấu (không tắt quảng cáo cũ), lên quảng cáo thử bài mới, đề xuất tăng ngân sách, tìm video đang lên view.')}
    ${agentRow('content', 'Agent Nội dung', 'Soạn kế hoạch và đăng các bài đã duyệt đúng giờ.')}
    ${agentRow('comments', 'Agent Bình luận', 'Đọc bình luận mới, soạn sẵn câu trả lời chờ duyệt.')}
    ${agentRow('reporting', 'Agent Báo cáo', 'Tổng hợp báo cáo tuần (chỉ đọc).')}
  </div>
  <div class="card"><h2>Quảng cáo tự động</h2>
    ${sw('auto-adtest', !!t.on, 'Bật quảng cáo thử / video đang lên view', `Mỗi quảng cáo ${vnd(t.budget || 0)}/ngày × ${t.days || 7} ngày. Sau ${t.checkDays || 2} ngày chấm sớm: không ra tin nhắn thì tắt luôn và báo, có tin thì báo số liệu và chạy tiếp; hết kỳ chấm lần cuối. Đang chạy: ${running} quảng cáo.`)}
    ${sw('auto-boost', b.on !== false, 'Video đang lên view: mỗi cơ sở mỗi ngày 1 video', `Chọn video/Reel có ≥ ${b.minViews || 0} lượt xem tự nhiên trong ${b.maxAgeDays || 14} ngày, chưa từng chạy quảng cáo, chỉ từ Page đã cấp quyền "Tạo quảng cáo".`)}
    ${sw('auto-boost-auto', !!b.auto, 'Tự chạy luôn, không chờ anh duyệt', 'Tắt = agent chỉ đề xuất ở mục Duyệt. Bật = tự tạo và bật quảng cáo ngay (tiền thật), vẫn trong hạn mức ngày của cơ sở bên dưới.')}
    <h3 style="margin-top:12px">Cơ sở được chạy quảng cáo</h3>
    <table><tr><th>Bỏ tick = không chạy quảng cáo</th><th>Mức tối đa ngày</th><th>Đang chạy (mọi chiến dịch)</th></tr>${units}</table>
    <small style="color:var(--mute)">Mức tối đa ngày = trần cho <b>tổng ngân sách ngày của mọi chiến dịch đang bật</b> của cơ sở (chiến dịch cũ + bài thử + video). Chạm mức thì agent không thêm quảng cáo mới, không tự tắt chiến dịch cũ. Ngưỡng tắt/tăng theo thương hiệu chỉnh ở trang Quảng cáo.</small>
  </div>
  <div class="card"><h2>Trợ lý nhắn tin (Messenger)</h2>
    ${sw('auto-asst', !!(st.assistant || {}).on, 'Bật trợ lý đọc và trả lời Messenger của Page', 'Mỗi lần quét, trợ lý đọc tin khách mới (24 giờ gần nhất) chưa ai trả lời và trả lời theo đúng quy trình nhân viên: hỏi độ dài tóc → báo giá theo size kèm ưu đãi đặt lịch trước → hỏi số người → 2 chi nhánh. Cần token có quyền Nhắn tin (pages_messaging).')}
    ${sw('auto-leads', (st.leads || {}).on !== false, 'Chấm chất lượng tin nhắn: khách tiềm năng / chưa rõ / rác', 'Mỗi lần quét, đọc hộp thư Messenger 7 ngày của từng Page và chấm từng cuộc trò chuyện. Kết quả ở trang Quảng cáo, mục "Chất lượng tin nhắn".')}
    ${sw('auto-leads-ads', !!(st.leads || {}).useForAds, 'Luật quảng cáo dùng số khách thật ước tính', 'Tắt/tăng ngân sách và chấm bài thử tính theo số Facebook × tỷ lệ khách thật của thương hiệu (tỷ lệ theo Page, không theo từng chiến dịch).')}
    ${sw('auto-asst-auto', (st.assistant || {}).auto !== false, 'Tự gửi câu đơn giản, không chờ duyệt', 'Giá, địa chỉ, ưu đãi, bảo hành, thanh toán, nối tóc… gửi ngay. Khách gửi SĐT để chốt lịch hoặc câu lạ → vào mục Duyệt cho nhân viên. Tắt = mọi câu đều chờ duyệt.')}
    <div style="padding:8px 0"><b>Thương hiệu áp dụng:</b> ${S.brands.map((b) => `<label class="f" style="display:inline;margin-right:14px"><input type="checkbox" data-st="auto-asst-brand" data-id="${esc(b.id)}" ${((st.assistant || {}).brands || {})[b.id] ? 'checked' : ''} ${dis}> ${esc(b.name)}</label>`).join('')}</div>
    <p class="sub" style="margin:4px 0 0">Widget chat cho website: thêm 1 dòng vào web <code>&lt;script src="${esc(location.origin)}/widget/chat.js" data-brand="the_one" defer&gt;&lt;/script&gt;</code> — khách hỏi được giá/địa chỉ ngay trên web, muốn đặt lịch thì để lại SĐT, hiện ở mục Duyệt.</p>
    <div class="rule" style="margin-top:8px"><b>Thử trợ lý</b> (nhắn như khách, không gửi đi đâu):
      <div id="asstLog" style="max-height:220px;overflow:auto;margin:8px 0;font-size:14px"></div>
      <div class="row"><input id="asstIn" type="text" placeholder="VD: giá nhuộm tóc dài bao nhiêu?" style="flex:1"><button class="sm pri" data-st="asst-send" type="button">Gửi</button><button class="sm" data-st="asst-reset" type="button">Làm lại</button></div></div>
  </div>
  <div class="card"><h2>Nội dung tự động</h2>
    ${sw('auto-pilot', !!ap.on, 'Lái tự động: agent tự soạn kế hoạch bài đăng', `Soạn trước ${ap.draftDaysBefore ?? 5} ngày, bài chờ anh duyệt ở mục Duyệt. Cần ảnh/video trong Thư viện Media.`)}
    ${sw('auto-pilot-approve', !!ap.autoApprove, 'Tự duyệt bài đăng luôn', 'Bật = bài do agent soạn tự lên lịch đăng, không chờ duyệt. Chỉ nên bật khi đã có khóa AI và đã xem vài bài mẫu.')}
    <p class="sub" style="margin:8px 0 0">Chi tiết hồ sơ lái tự động theo thương hiệu: trang <a href="#automation">Lái tự động</a>.</p>
  </div>`;
}

// ---------- Tài khoản ----------
function stAccount() {
  const me = ST.me.user;
  const roles = ST.users ? ST.users.roles : null;
  const mine = `<div class="card"><h2>Tài khoản của bạn</h2>
    <div class="kv" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))"><div><small>Tên</small><b>${esc(me.name)}</b></div><div><small>Vai trò</small><b>${esc(me.roleLabel)}</b></div><div><small>Đăng nhập bằng</small><b>${me.shared ? 'Mật khẩu chung' : esc(me.username)}</b></div><div><small>Thương hiệu được giao</small><b>${me.brands.length ? me.brands.map(stBrand).map(esc).join(', ') : 'Tất cả'}</b></div></div>
    ${me.shared ? '<p class="alert">Bạn đang đăng nhập bằng <b>mật khẩu chung</b> (APP_PASSWORD trong file .env). Nên tạo tài khoản riêng cho từng người rồi dùng tài khoản chủ riêng của mình.</p>'
      : `<h3>Đổi mật khẩu</h3><div class="row"><input type="password" id="stOld" placeholder="Mật khẩu hiện tại" autocomplete="current-password"><input type="password" id="stNew" placeholder="Mật khẩu mới (≥ 10 ký tự, có chữ và số)" autocomplete="new-password" style="width:300px"><button class="pri" data-st="chpw" ${ST.busy ? 'disabled' : ''}>Đổi mật khẩu</button></div>`}
    <p class="sub" style="margin:10px 0 0">Máy này nhớ đăng nhập 30 ngày. Muốn đổi tài khoản hoặc dùng máy chung: <button class="sm" data-st="logout" type="button">Đăng xuất</button></p></div>`;
  if (!ST.users) return mine + `<div class="card"><h2>Quản lý tài khoản</h2><p class="sub" style="margin:0">Chỉ vai trò <b>Chủ</b> quản lý được tài khoản và phân quyền.</p></div>${stRoleMatrix()}`;
  const u = ST.users;
  return `${mine}
    <div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Người dùng (${u.users.length})</h2><button class="pri" data-st="user-new">＋ Thêm người dùng</button></div>
      <div class="tablewrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Tên</th><th>Đăng nhập</th><th>Vai trò</th><th>Thương hiệu</th><th>Đăng nhập gần nhất</th><th></th></tr></thead><tbody>${u.users.map((x) => `<tr><td><b>${esc(x.name)}</b>${x.disabled ? ' <span class="tag off">Đã khoá</span>' : ''}</td><td>${esc(x.username)}</td><td>${esc(roles[x.role].label)}</td><td>${x.brands.length ? x.brands.map(stBrand).map(esc).join(', ') : 'Tất cả'}</td><td>${esc(stWhen(x.lastLoginAt))}</td>
        <td class="num"><button class="sm" data-st="user-edit" data-id="${esc(x.id)}">Sửa</button> <button class="sm" data-st="user-pw" data-id="${esc(x.id)}">Đặt lại mật khẩu</button> <button class="sm danger" data-st="user-del" data-id="${esc(x.id)}" data-name="${esc(x.name)}">Xoá</button></td></tr>`).join('') || '<tr><td colspan="6"><div class="empty">Chưa có tài khoản riêng nào — hiện mọi người dùng chung một mật khẩu.</div></td></tr>'}</tbody></table></div>
      <div class="rule" style="margin-top:12px"><label class="f"><input type="checkbox" data-st="shared" ${u.sharedPasswordLogin ? 'checked' : ''}> <b>Cho phép đăng nhập bằng mật khẩu chung</b> (APP_PASSWORD) — người dùng mật khẩu chung được toàn quyền như Chủ</label>
        <small style="color:var(--mute)">Sau khi tạo tài khoản chủ riêng và đăng nhập bằng nó, nên <b>tắt</b> mục này để chỉ người có tài khoản mới vào được. Hệ thống chặn việc tắt khi chưa có tài khoản chủ riêng, để bạn không bị khoá ngoài.</small></div></div>
    ${stRoleMatrix()}`;
}
function stRoleMatrix() {
  const roles = (ST.users && ST.users.roles) || null;
  const labels = (ST.users && ST.users.permLabels) || null;
  if (!roles) return `<div class="card"><h2>Vai trò</h2><p class="sub" style="margin:0">Chủ: toàn quyền · Quản lý: vận hành hằng ngày · Biên tập nội dung: soạn bài, lịch, media · Chỉ xem.</p></div>`;
  return `<div class="card"><h2>Vai trò và quyền</h2><div class="tablewrap"><table class="tbl"><thead><tr><th>Quyền</th>${Object.values(roles).map((r) => `<th class="num">${esc(r.label)}</th>`).join('')}</tr></thead><tbody>${Object.entries(labels).map(([k, l]) => `<tr><td>${esc(l)}</td>${Object.values(roles).map((r) => `<td class="num">${r.perms.includes(k) ? '<span style="color:var(--ok)">✓</span>' : '<span style="color:var(--mute)">—</span>'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    ${Object.values(roles).map((r) => `<p style="margin:6px 0"><b>${esc(r.label)}:</b> <small style="color:var(--mute)">${esc(r.desc)}</small></p>`).join('')}
    <p class="alert" style="margin-top:8px"><b>Giới hạn theo thương hiệu:</b> tài khoản được giao thương hiệu chỉ được <b>sửa/duyệt</b> trong thương hiệu đó (thao tác toàn hệ thống bị chặn). Tuy nhiên người đó vẫn <b>xem được số liệu</b> của cả 3 thương hiệu — hệ thống chưa tách quyền xem.</p></div>`;
}
function stUserModal(x) {
  return new Promise((resolve) => {
    const roles = ST.users.roles, el = document.createElement('div');
    el.className = 'overlay';
    el.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h3>${x ? 'Sửa người dùng' : 'Thêm người dùng'}</h3>
      <label style="display:block;margin:8px 0">Tên hiển thị<br><input type="text" id="umName" value="${esc(x ? x.name : '')}" style="width:100%" maxlength="60"></label>
      ${x ? `<p style="margin:4px 0"><small style="color:var(--mute)">Tên đăng nhập: <b>${esc(x.username)}</b></small></p>` : `<label style="display:block;margin:8px 0">Tên đăng nhập <small style="color:var(--mute)">(chữ thường không dấu, số, . _ -)</small><br><input type="text" id="umUser" style="width:100%" maxlength="30" autocomplete="off"></label>
      <label style="display:block;margin:8px 0">Mật khẩu ban đầu <small style="color:var(--mute)">(≥ 10 ký tự, có chữ và số)</small><br><input type="text" id="umPw" style="width:100%" autocomplete="off"></label>`}
      <label style="display:block;margin:8px 0">Vai trò<br><select id="umRole" style="width:100%">${Object.entries(roles).map(([k, r]) => `<option value="${k}" ${(x ? x.role : 'editor') === k ? 'selected' : ''}>${esc(r.label)} — ${esc(r.desc)}</option>`).join('')}</select></label>
      <div style="margin:8px 0"><b>Thương hiệu được giao</b> <small style="color:var(--mute)">(không chọn = tất cả)</small><div class="row" style="margin-top:4px">${S.brands.map((b) => `<label class="f" style="margin:0"><input type="checkbox" class="umBrand" value="${esc(b.id)}" ${x && x.brands.includes(b.id) ? 'checked' : ''}> ${esc(b.name)}</label>`).join('')}</div></div>
      ${x ? `<label class="f"><input type="checkbox" id="umOff" ${x.disabled ? 'checked' : ''}> Khoá tài khoản (không đăng nhập được)</label>` : ''}
      <div class="acts"><button data-r="0">Huỷ</button><button class="pri" data-r="1">${x ? 'Lưu' : 'Tạo tài khoản'}</button></div></div>`;
    const close = (v) => { el.remove(); resolve(v); };
    el.addEventListener('click', (e) => {
      const r = e.target.closest('[data-r]');
      if (!r) { if (e.target === el) close(null); return; }
      if (r.dataset.r === '0') return close(null);
      close({ name: el.querySelector('#umName').value.trim(), ...(x ? {} : { username: el.querySelector('#umUser').value.trim(), password: el.querySelector('#umPw').value }), role: el.querySelector('#umRole').value, brands: [...el.querySelectorAll('.umBrand:checked')].map((c) => c.value), ...(x ? { disabled: el.querySelector('#umOff').checked } : {}) });
    });
    document.getElementById('layer').appendChild(el);
    el.querySelector('#umName').focus();
  });
}

// ---------- Hệ thống ----------
function stSystem() {
  const s = S.settings, can = stCan('settings_write'), dis = can ? '' : 'disabled';
  const al = s.alerts, nt = s.notify;
  const num = (grp, k, v, w = 110, step = '') => `<input type="number" data-st="pref" data-grp="${grp}" data-key="${k}" value="${v}" style="width:${w}px" ${step} ${dis}>`;
  return `${can ? '' : '<p class="alert">Bạn không có quyền đổi cài đặt hệ thống — chỉ <b>Chủ</b> đổi được. Các mục dưới chỉ để xem.</p>'}
    <div class="card"><h2>Chế độ chạy</h2>
      <div class="row" style="justify-content:space-between"><div><span class="tag ${s.dryRun ? 'dry' : 'on'}" style="font-size:13px">${s.dryRun ? 'CHẠY THỬ' : 'CHẠY THẬT'}</span> <small style="color:var(--mute)">${s.dryRun ? 'chỉ ghi nhật ký, không tắt/đổi/đăng thật' : 'agent lên quảng cáo mới, đăng bài, thực hiện việc đã duyệt thật trên Facebook (không tắt quảng cáo cũ)'}</small></div>
        <button class="${s.dryRun ? 'pri' : ''}" data-st="mode" ${dis}>${s.dryRun ? 'Chuyển sang CHẠY THẬT' : 'Chuyển về CHẠY THỬ'}</button></div>
      <label class="f">Agent quét mỗi <input type="number" data-st="scan" value="${s.scanMinutes}" style="width:80px" ${dis}> phút (5–1440)</label>
      <small style="color:var(--mute)">Dừng khẩn cấp bấm ở thanh trên cùng. Luật tự động chỉnh ở trang <a href="#laitudong">Lái tự động</a>; ngân sách ở trang <a href="#ads">Quảng cáo</a>.</small></div>
    <div class="card"><h2>Ngưỡng cảnh báo bất thường</h2><p class="sub" style="margin:0 0 8px">Chỉ để hiện cảnh báo trên trang Quảng cáo và Tổng quan — không tự tắt hay đổi gì.</p>
      <div class="rule">Báo <b>chi tiêu vọt</b> khi hôm nay tiêu ≥ ${num('alerts', 'spikeMinSpend', al.spikeMinSpend, 130)} đ và gấp ${num('alerts', 'spikeRatio', al.spikeRatio, 70, 'step="0.1"')} lần trung bình 6 ngày trước</div>
      <div class="rule">Báo <b>giá/tin tăng</b> khi hôm nay có ≥ ${num('alerts', 'cplSpikeMinMsgs', al.cplSpikeMinMsgs, 70)} tin và giá cao gấp ${num('alerts', 'cplSpikeRatio', al.cplSpikeRatio, 70, 'step="0.1"')} lần trung bình 7 ngày</div></div>
    <div class="card"><h2>Thông báo (chuông trên thanh trên cùng)</h2>
      ${[['approvals', 'Việc chờ Sếp duyệt'], ['alerts', 'Cảnh báo quảng cáo nghiêm trọng'], ['errors', 'Lỗi hệ thống trong 24 giờ']].map(([k, l]) => `<label class="f"><input type="checkbox" data-st="pref" data-grp="notify" data-key="${k}" ${nt[k] ? 'checked' : ''} ${dis}> ${l}</label>`).join('')}
      <p class="sub" style="margin:6px 0 0">Thông báo hiện trong ứng dụng. <b>Chưa hỗ trợ</b> gửi qua email, Zalo hoặc Telegram.</p></div>
    <div class="card"><h2>Thương hiệu & tài khoản quảng cáo</h2><p class="sub" style="margin:0">Hồ sơ thương hiệu chỉnh ở <a href="#thuonghieu">Thương hiệu & Kênh</a>; Page và kết nối kiểm tra ở <a href="#kenh">Kênh</a>.</p></div>`;
}

// ---------- Kết nối API ----------
function stApi() {
  const e = S.env, row = (label, ok, hint) => `<tr><td>${label}</td><td><span class="tag ${ok ? 'on' : 'dry'}">${ok ? 'Đã có' : 'Chưa có'}</span></td><td>${hint}</td></tr>`;
  return `<div class="card"><h2>Kết nối (đặt trong file .env trên máy chủ)</h2><table><tr><th>Mục</th><th>Trạng thái</th><th>Biến môi trường</th></tr>
    ${row('Meta access token', e.meta, 'META_ACCESS_TOKEN')}<tr><td>Page và tài khoản quảng cáo</td><td><span class="tag dry">Theo thương hiệu</span></td><td>Nhập/kiểm tra ở trang <a href="#kenh">Kênh</a></td></tr>
    ${row('Claude (AI)', e.anthropic, 'ANTHROPIC_API_KEY · model: ' + esc(e.model))}${row('Gemini (agent xem ảnh/video)', e.gemini, 'GEMINI_API_KEY · GEMINI_MODEL')}${row('Mật khẩu chung', e.password, 'APP_PASSWORD')}</table>
    <div style="margin-top:12px"><button class="pri" data-act="metacheck" ${e.meta && stCan('agents_run') ? '' : 'disabled'}>🔌 Kiểm tra kết nối Meta</button> <a href="#kenh"><button type="button">Kiểm tra từng kênh →</button></a> <small style="color:var(--mute)">Chỉ đọc. API ${esc(e.apiVersion)}.</small></div>
    ${typeof metaChecks !== 'undefined' && metaChecks ? `<table style="margin-top:10px"><tr><th>Bước</th><th></th><th>Chi tiết</th></tr>${metaChecks.map((c) => `<tr><td>${esc(c.name)}</td><td><span class="tag ${c.ok ? (c.warn ? 'dry' : 'on') : 'off'}">${c.ok ? (c.warn ? 'Lưu ý' : 'OK') : 'Lỗi'}</span></td><td>${esc(c.detail)}</td></tr>`).join('')}</table>` : ''}
    <p class="sub" style="margin:10px 0 0">Vì an toàn, khoá API và token <b>không nhập qua web</b>: đặt bằng script <code>deploy\\set-token.ps1</code> / <code>set-secret.ps1</code> hoặc sửa file <code>.env</code> trên máy chủ rồi khởi động lại.</p></div>
    ${stDriveCard()}
    ${typeof tiktokCard === 'function' ? tiktokCard() : ''}
    ${stYoutubeCard()}`;
}

// Google Drive: khoá service account tải lên 1 lần (chỉ hiện đã có/chưa có + email để Sếp chia sẻ thư mục). Nội dung khoá không bao giờ gửi lại giao diện.
function stDriveCard() {
  const d = ST.drive, can = stCan('settings_write');
  if (!d) return '<div class="card"><h2>Google Drive (nạp media)</h2><div class="skel" style="height:40px"></div></div>';
  return `<div class="card"><h2>Google Drive (nạp media)</h2>
    <p style="margin:6px 0">Khoá service account: <span class="tag ${d.configured ? 'on' : 'dry'}">${d.configured ? 'Đã có' : 'Chưa có'}</span>${d.configured ? ` <small style="color:var(--mute)">${d.keySource === 'env' ? '(từ file GOOGLE_SERVICE_ACCOUNT_FILE trong .env)' : '(đã tải qua web, lưu riêng khỏi dữ liệu)'}</small>` : ''}</p>
    ${d.configured ? `<p style="margin:6px 0">Email service account (chia sẻ thư mục Drive cho email này, quyền <b>Người xem</b>):<br><code id="stDriveEmail" style="word-break:break-all">${esc(d.serviceEmail)}</code> <button class="sm" data-st="drive-copy">Sao chép</button></p>` : ''}
    <p class="sub" style="margin:6px 0">Tạo service account trong Google Cloud, tải file JSON, rồi chọn file đó ở đây (xem <code>HUONG-DAN-DRIVE.md</code>). Khoá được lưu riêng trong kho bí mật của máy chủ (như token TikTok), không nằm trong bản sao lưu dữ liệu và không hiện lại trên web.</p>
    <div class="row" style="flex-wrap:wrap;gap:6px"><input type="file" id="stDriveFile" accept="application/json,.json" style="display:none">
      <button class="pri" data-st="drive-pick" ${can && d.keySource !== 'env' && !ST.busy ? '' : 'disabled'}>📄 ${d.configured ? 'Thay file JSON service account' : 'Tải file JSON service account'}</button>
      <button data-st="drive-test" ${d.configured && stCan('agents_run') && !ST.busy ? '' : 'disabled'}>🔌 Kiểm tra khoá</button>
      ${d.configured && d.keySource !== 'env' ? `<button class="danger" data-st="drive-remove" ${can && !ST.busy ? '' : 'disabled'}>Gỡ khoá</button>` : ''}</div>
    <p class="sub" style="margin:8px 0 0">Thư mục Drive của từng thương hiệu đặt ở <a href="#media">Thư viện Media</a> (khối "Nạp từ Google Drive"). Đang bật tự nạp: ${Object.values(d.brands).filter((b) => b.on).map((b) => stBrand(b.brand)).join(', ') || 'chưa thương hiệu nào'}.</p></div>`;
}

// YouTube: khoá OAuth client (Client ID + secret) nhập 1 lần, lưu trong kho bí mật của máy chủ; secret không bao giờ gửi lại giao diện.
const YT_PRIV = { public: 'Công khai', unlisted: 'Không công khai (ai có link mới xem được)', private: 'Riêng tư' };
function stYoutubeCard() {
  const y = S.youtube || {}, can = stCan('settings_write');
  const fromEnv = y.keySource === 'env';
  const nConn = Object.values(y.channels || {}).filter((c) => c.connected).length;
  return `<div class="card"><h2>YouTube (Shorts)</h2>
    <p style="margin:6px 0">Khoá OAuth client: <span class="tag ${y.keySet ? 'on' : 'dry'}">${y.keySet ? 'Đã có' : 'Chưa có'}</span>${y.keySet ? ` <small style="color:var(--mute)">${fromEnv ? '(từ YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET trong .env)' : '(đã nhập qua web, lưu riêng khỏi dữ liệu)'}</small>` : ''} · Địa chỉ https của app: <span class="tag ${y.redirectUri ? 'on' : 'dry'}">${y.redirectUri ? 'Đã có' : 'Chưa có PUBLIC_BASE_URL'}</span> · Kênh đã nối: <b>${nConn}</b></p>
    ${y.redirectUri ? `<p class="sub" style="margin:6px 0">Redirect URI — dán <b>y nguyên</b> vào ô "Authorized redirect URIs" của OAuth client (loại Web application) trong Google Cloud: <code id="stYtRedirect" style="word-break:break-all">${esc(y.redirectUri)}</code> <button class="sm" data-st="yt-copy">Sao chép</button></p>` : ''}
    ${fromEnv ? '' : `<div class="row" style="flex-wrap:wrap;gap:6px"><input type="text" id="stYtId" placeholder="Client ID (…apps.googleusercontent.com)" style="width:320px" autocomplete="off" ${can ? '' : 'disabled'}><input type="password" id="stYtSecret" placeholder="Client secret (GOCSPX-…)" style="width:220px" autocomplete="new-password" ${can ? '' : 'disabled'}>
      <button class="pri" data-st="yt-keys" ${can && !ST.busy ? '' : 'disabled'}>${y.keySet ? 'Thay khoá' : 'Lưu khoá'}</button>${y.keySet ? ` <button class="danger" data-st="yt-keys-remove" ${can && !ST.busy ? '' : 'disabled'}>Gỡ khoá</button>` : ''}</div>`}
    <label class="f">Chế độ hiển thị video đăng lên YouTube <select data-st="yt-privacy" ${can ? '' : 'disabled'}>${Object.entries(YT_PRIV).map(([v, l]) => `<option value="${v}" ${(y.privacy || 'public') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <p class="alert" style="margin:8px 0 0"><b>Lưu ý:</b> dự án Google Cloud <b>chưa qua kiểm tra (audit) YouTube API</b> thì mọi video tải lên bằng API bị YouTube <b>khoá ở chế độ riêng tư</b>, dù chọn công khai — nộp đơn tại <a href="https://support.google.com/youtube/contact/yt_api_form" target="_blank" rel="noopener">yt_api_form</a>. Ứng dụng OAuth còn ở chế độ <b>Testing</b> thì quyền chỉ giữ 7 ngày — chuyển sang <b>Production</b>. Mỗi video tốn ~1.600 / 10.000 đơn vị hạn mức mỗi ngày (≈ 6 video/ngày). Xem <code>HUONG-DAN-YOUTUBE.md</code>.</p>
    <p class="sub" style="margin:8px 0 0">Kết nối kênh của từng thương hiệu ở trang <a href="#kenh">Kênh</a> (nút "Kết nối YouTube").</p></div>`;
}

// ---------- AI ----------
function stAi() {
  const s = S.settings, e = S.env, can = stCan('settings_write');
  const rows = ST.ai ? ST.ai.agents.filter((a) => a.available) : [];
  const tot = rows.reduce((a, r) => ({ c: a.c + r.aiUsage7d.calls, i: a.i + r.aiUsage7d.in, o: a.o + r.aiUsage7d.out }), { c: 0, i: 0, o: 0 });
  return `<div class="card"><h2>Cấu hình AI (Claude)</h2>
    <label class="f"><input type="checkbox" data-st="ai-on" ${s.ai.enabled ? 'checked' : ''} ${can ? '' : 'disabled'}> <b>Bật AI</b> — tắt thì hệ thống dùng mẫu câu có sẵn, không gọi Claude (không tốn chi phí AI)</label>
    <label class="f">Model <input type="text" data-st="ai-model" value="${esc(s.ai.model)}" placeholder="${esc(e.model)}" style="width:260px" ${can ? '' : 'disabled'}> <small style="color:var(--mute)">để trống = dùng mặc định (${esc(e.model)}). Biến môi trường ANTHROPIC_MODEL nếu có sẽ được ưu tiên.</small></label>
    <p style="margin:6px 0">Khoá AI: <span class="tag ${e.anthropic || e.gemini ? 'on' : 'dry'}">${e.anthropic ? 'Đã có (Claude)' : e.gemini ? 'Đã có (Gemini)' : 'Chưa có'}</span> ${e.anthropic || e.gemini ? '' : '<small style="color:var(--mute)">— đặt ANTHROPIC_API_KEY hoặc GEMINI_API_KEY trong file .env; chưa có khoá thì chỉ rút bài học theo số liệu và dùng mẫu câu.</small>'}</p></div>
    <div class="card"><h2>Lượng AI dùng (7 ngày)</h2>${rows.length ? `<div class="tablewrap"><table class="tbl"><thead><tr><th>Agent</th><th class="num">Lần gọi</th><th class="num">Token vào</th><th class="num">Token ra</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.aiUsage7d.calls}</td><td class="num">${r.aiUsage7d.in.toLocaleString('vi-VN')}</td><td class="num">${r.aiUsage7d.out.toLocaleString('vi-VN')}</td></tr>`).join('')}<tr><td><b>Tổng</b></td><td class="num"><b>${tot.c}</b></td><td class="num"><b>${tot.i.toLocaleString('vi-VN')}</b></td><td class="num"><b>${tot.o.toLocaleString('vi-VN')}</b></td></tr></tbody></table></div>` : '<div class="empty">Chưa có số liệu.</div>'}
      <p class="sub" style="margin:8px 0 0">Chỉ đếm số lần gọi và token (không lưu nội dung). Chưa quy ra tiền vì giá phụ thuộc gói/model. Lần gọi do Sếp bấm trên giao diện (AI viết nháp...) không tính cho agent nào.</p></div>`;
}

// ---------- Sao lưu ----------
function stBackup() {
  if (!ST.backups) return '<div class="card"><div class="state"><b>Bạn không có quyền sao lưu/khôi phục</b>Chỉ vai trò Chủ.</div></div>';
  const b = ST.backups;
  return `<div class="card"><h2>Sao lưu dữ liệu</h2><p class="sub" style="margin:0 0 8px">Máy chủ tự sao lưu mỗi ngày lúc 3h30 (giữ 14 bản). Bạn cũng có thể tạo bản sao lưu ngay. Bản sao lưu gồm cài đặt, chiến dịch, bài đăng, kế hoạch, bài học, nhật ký tạm — <b>không gồm token Meta/TikTok và tài khoản người dùng</b> (lưu riêng, an toàn hơn).</p>
    <div class="row"><button class="pri" data-st="bk-new" ${ST.busy ? 'disabled' : ''}>＋ Tạo bản sao lưu ngay</button><a href="/api/export"><button type="button">⬇ Tải toàn bộ dữ liệu (JSON)</button></a></div>
    <div class="tablewrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>File</th><th>Loại</th><th class="num">Dung lượng</th><th>Lúc</th><th></th></tr></thead><tbody>${b.backups.map((x) => `<tr><td style="word-break:break-all">${esc(x.name)}</td><td>${x.kind === 'data' ? 'Dữ liệu' : 'Nhật ký kiểm toán'}</td><td class="num">${stSize(x.size)}</td><td>${esc(stWhen(x.at))}</td><td class="num"><a href="/api/backups/${encodeURIComponent(x.name)}/download"><button class="sm" type="button">Tải</button></a>${x.kind === 'data' ? ` <button class="sm danger" data-st="bk-restore" data-name="${esc(x.name)}">Khôi phục…</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">Chưa có bản sao lưu nào.</div></td></tr>'}</tbody></table></div>
    <p class="sub" style="margin:8px 0 0">Thư mục sao lưu trên máy chủ: <code>${esc(b.dir)}</code></p></div>
    <div class="card" style="border-color:var(--bad)"><h2>Khôi phục</h2><p style="margin:0">Khôi phục sẽ <b>thay toàn bộ dữ liệu hiện tại</b> (kể cả chế độ chạy thử/thật, luật, bài đăng) bằng nội dung bản sao lưu. Hệ thống <b>tự sao lưu dữ liệu hiện tại trước</b> nên luôn quay lại được. Cần gõ chữ <code>KHOI PHUC</code> để xác nhận.</p></div>`;
}

// ---------- Lịch sử ----------
function stActivity() {
  const a = ST.activity;
  if (!a) return '<div class="skel" style="height:120px"></div>';
  return `<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Thay đổi cài đặt, tài khoản, bảo mật, dữ liệu</h2><a href="#nhatky">Toàn bộ Nhật ký →</a></div>${a.map((e) => `<div class="item"><div><span class="tag">${esc(e.kindLabel)}</span> ${esc(e.action)}${e.before || e.after ? `<br><small style="color:var(--mute)">${e.before ? 'trước: ' + esc(e.before) : ''} ${e.after ? '→ sau: ' + esc(e.after) : ''}</small>` : ''}</div><small style="color:var(--mute);white-space:nowrap">${esc(e.actor.name)} · ${esc(stWhen(e.at))}</small></div>`).join('') || '<div class="empty">Chưa có thay đổi nào được ghi lại.</div>'}</div>`;
}

function stBody() {
  if (ST.state === 'err' && !ST.me) return `<div class="card"><div class="state err"><b>Không tải được cài đặt</b>${esc(ST.err)}<br><button class="sm" data-st="reload">Thử lại</button></div></div>`;
  if (!ST.me) return '<div class="skel" style="height:240px"></div>';
  const tabs = ST_TABS.filter(([, , perm]) => stCan(perm));
  if (!tabs.some(([k]) => k === ST.tab)) ST.tab = 'auto';
  return `<div class="seg" style="margin-bottom:12px;flex-wrap:wrap">${tabs.map(([k, l]) => `<button class="${ST.tab === k ? 'on' : ''}" data-st="tab" data-v="${k}">${l}</button>`).join('')}</div>${{ auto: stAuto, account: stAccount, system: stSystem, api: stApi, ai: stAi, backup: stBackup, activity: stActivity }[ST.tab]()}`;
}
function stPaint() { const el = document.getElementById('stBody'); if (el) el.innerHTML = stBody(); }

function pageSettings() {
  const html = `<h1>Cài đặt</h1><p class="sub">Tài khoản và phân quyền, chế độ chạy, cảnh báo, thông báo, kết nối API, AI, sao lưu và khôi phục.</p><div id="stBody">${stBody()}</div>`;
  setTimeout(stLoad, 0);
  return html;
}

// ---------- Sự kiện ----------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-st]');
  if (!t || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) return;
  const k = t.dataset.st, id = t.dataset.id;
  if (k === 'tab') { ST.tab = t.dataset.v; stPaint(); return; }
  if (k === 'reload') return stLoad();
  if (k === 'logout') { try { await fetch('/logout', { method: 'POST' }); } catch { /* vẫn chuyển về trang đăng nhập */ } location.replace('/login'); return; }
  if (k === 'chpw') {
    const oldPassword = document.getElementById('stOld').value, newPassword = document.getElementById('stNew').value;
    if (!oldPassword || !newPassword) return toast('Nhập mật khẩu hiện tại và mật khẩu mới');
    const r = await stDo(() => call('POST', '/api/me/password', { oldPassword, newPassword }), 'Đã đổi mật khẩu — lần sau dùng mật khẩu mới');
    if (r) { document.getElementById('stOld').value = ''; document.getElementById('stNew').value = ''; }
  }
  else if (k === 'user-new') { const v = await stUserModal(null); if (v) stDo(() => call('POST', '/api/users', v), 'Đã tạo tài khoản'); }
  else if (k === 'user-edit') { const x = ST.users.users.find((u) => u.id === id); const v = await stUserModal(x); if (v) stDo(() => call('PUT', `/api/users/${encodeURIComponent(id)}`, v), 'Đã lưu'); }
  else if (k === 'user-pw') {
    const x = ST.users.users.find((u) => u.id === id);
    const pw = prompt(`Mật khẩu mới cho ${x.username} (≥ 10 ký tự, có chữ và số):`);
    if (pw) stDo(() => call('POST', `/api/users/${encodeURIComponent(id)}/password`, { password: pw }), 'Đã đặt lại mật khẩu — hãy báo cho người đó');
  }
  else if (k === 'user-del') { if (await confirmBox({ title: 'Xoá tài khoản?', body: `<p><b>${esc(t.dataset.name)}</b></p><p>Người này sẽ không đăng nhập được nữa. Lịch sử thao tác của họ trong Nhật ký vẫn còn.</p>`, ok: 'Xoá tài khoản', danger: true })) stDo(() => call('DELETE', `/api/users/${encodeURIComponent(id)}`), 'Đã xoá tài khoản'); }
  else if (k === 'mode') {
    const toLive = S.settings.dryRun;
    const ok = await confirmBox({ title: toLive ? 'Chuyển sang CHẠY THẬT?' : 'Chuyển về CHẠY THỬ?', body: toLive ? '<p class="alert danger"><b>Từ lúc này agent làm thật trên Facebook:</b> lên quảng cáo thử bài mới (không tắt quảng cáo cũ), đăng bài đã duyệt, và các việc bạn duyệt (đổi ngân sách, gửi trả lời bình luận) được thực hiện thật.</p>' : '<p>Từ lúc này mọi thao tác chỉ được ghi nhật ký, chưa tác động gì lên Facebook.</p>', ok: toLive ? 'Chạy thật' : 'Chạy thử', danger: toLive });
    if (ok) stDo(() => call('POST', '/api/settings', { dryRun: !toLive ? true : false }), toLive ? 'Đã chuyển sang CHẠY THẬT' : 'Đã chuyển về chạy thử');
  }
  else if (k === 'asst-send' || k === 'asst-reset') {
    const log = document.getElementById('asstLog'), inp = document.getElementById('asstIn');
    if (k === 'asst-reset') { ST.asstHist = []; log.innerHTML = ''; return; }
    const text = (inp.value || '').trim(); if (!text) return;
    ST.asstHist = ST.asstHist || [];
    ST.asstHist.push({ from: 'customer', text }); inp.value = '';
    const add = (who, html) => { const d = document.createElement('div'); d.style.cssText = `margin:4px 0;padding:6px 10px;border-radius:10px;max-width:85%;white-space:pre-wrap;${who === 'u' ? 'margin-left:auto;background:var(--accent);color:#fff' : 'background:var(--soft)'}`; d.innerHTML = html; log.appendChild(d); log.scrollTop = log.scrollHeight; };
    add('u', esc(text));
    try {
      const r = await call('POST', '/api/assistant/test', { brand: 'the_one', history: ST.asstHist });
      ST.asstHist.push({ from: 'salon', text: r.text });
      add('b', `${esc(r.text)}<div style="margin-top:4px"><span class="tag ${r.auto ? 'on' : 'off'}">${r.auto ? 'tự gửi' : 'chờ nhân viên'}</span> <small style="color:var(--mute)">${esc(r.intent)}${r.reason ? ' · ' + esc(r.reason) : ''}${r.notify ? ' · báo nhân viên chốt lịch' : ''}</small></div>`);
    } catch (e) { add('b', esc(e.message)); }
  }
  else if (k === 'yt-copy') { const el = document.getElementById('stYtRedirect'); navigator.clipboard.writeText(el ? el.textContent : '').then(() => toast('Đã sao chép Redirect URI'), () => toast('Không sao chép được')); }
  else if (k === 'yt-keys') {
    const clientId = (document.getElementById('stYtId') || {}).value || '', clientSecret = (document.getElementById('stYtSecret') || {}).value || '';
    if (!clientId.trim() || !clientSecret.trim()) return toast('Dán cả Client ID và Client secret');
    stDo(() => call('POST', '/api/youtube/keys', { clientId: clientId.trim(), clientSecret: clientSecret.trim() }), 'Đã lưu khoá YouTube — giờ bấm "Kết nối YouTube" ở trang Kênh');
  }
  else if (k === 'yt-keys-remove') { if (await confirmBox({ title: 'Gỡ khoá OAuth YouTube?', body: '<p>Agent sẽ không đăng lên YouTube được cho tới khi nhập khoá mới. Kênh đã nối vẫn giữ, nhưng cần khoá cũ để làm mới quyền.</p>', ok: 'Gỡ khoá', danger: true })) stDo(() => call('POST', '/api/youtube/keys', { remove: true }), 'Đã gỡ khoá YouTube'); }
  else if (k === 'bk-new') stDo(() => call('POST', '/api/backups'), 'Đã tạo bản sao lưu');
  else if (k === 'drive-pick') { const inp = document.getElementById('stDriveFile'); if (inp) inp.click(); }
  else if (k === 'drive-copy') { const el = document.getElementById('stDriveEmail'); navigator.clipboard.writeText(el ? el.textContent : '').then(() => toast('Đã sao chép email service account'), () => toast('Không sao chép được')); }
  else if (k === 'drive-test') { toast('Đang kiểm tra khoá Google…'); try { const r = await call('POST', '/api/drive/test', {}); toast(`Khoá hợp lệ: ${r.email}`); } catch (err) { toast(err.message); } }
  else if (k === 'drive-remove') { if (await confirmBox({ title: 'Gỡ khoá service account Google?', body: '<p>Agent sẽ không nạp được từ Google Drive cho tới khi tải khoá mới. File đã nạp vẫn còn trong Thư viện Media.</p>', ok: 'Gỡ khoá', danger: true })) stDo(() => call('POST', '/api/drive/key', { remove: true }), 'Đã gỡ khoá Google Drive'); }
  else if (k === 'bk-restore') {
    const name = t.dataset.name;
    const el = document.createElement('div');
    el.className = 'overlay';
    el.innerHTML = `<div class="modal"><h3>Khôi phục từ ${esc(name)}?</h3><p class="alert danger">Toàn bộ dữ liệu hiện tại sẽ được thay bằng bản này. Hệ thống tự sao lưu dữ liệu hiện tại trước khi khôi phục.</p><label style="display:block">Gõ <b>KHOI PHUC</b> để xác nhận<input type="text" id="bkConfirm" style="width:100%;margin-top:4px" autocomplete="off"></label><div class="acts"><button data-r="0">Huỷ</button><button class="pri danger fill" data-r="1">Khôi phục</button></div></div>`;
    el.addEventListener('click', async (ev) => {
      const r = ev.target.closest('[data-r]');
      if (!r) { if (ev.target === el) el.remove(); return; }
      if (r.dataset.r === '0') return el.remove();
      const confirm = el.querySelector('#bkConfirm').value.trim();
      el.remove();
      const res = await stDo(() => call('POST', `/api/backups/${encodeURIComponent(name)}/restore`, { confirm }), null);
      if (res) toast(`Đã khôi phục. Bản sao lưu an toàn của dữ liệu trước đó: ${res.safetyBackup}`);
    });
    document.getElementById('layer').appendChild(el);
    el.querySelector('#bkConfirm').focus();
  }
});
document.addEventListener('change', async (e) => {
  const t = e.target, k = t.dataset.st;
  if (t.id === 'stDriveFile') {
    const f = t.files && t.files[0]; t.value = '';
    if (!f) return;
    if (f.size > 20000) return toast('File JSON service account thường chỉ vài KB — chọn đúng file tải từ Google Cloud');
    let json; try { json = JSON.parse(await f.text()); } catch { return toast('File không phải JSON hợp lệ'); }
    stDo(() => call('POST', '/api/drive/key', { json }), 'Đã lưu khoá Google Drive — giờ chia sẻ thư mục Drive cho email service account');
    return;
  }
  if (!k) return;
  if (k === 'shared') {
    const on = t.checked;
    if (!on && !(await confirmBox({ title: 'Tắt đăng nhập bằng mật khẩu chung?', body: '<p>Sau đó chỉ tài khoản riêng đăng nhập được. Hãy chắc chắn bạn nhớ mật khẩu tài khoản chủ riêng của mình.</p>', ok: 'Tắt mật khẩu chung', danger: true }))) { t.checked = true; return; }
    const r = await stDo(() => call('POST', '/api/security', { sharedPasswordLogin: on }), on ? 'Đã bật đăng nhập bằng mật khẩu chung' : 'Đã tắt đăng nhập bằng mật khẩu chung');
    if (!r) t.checked = !on;
  }
  else if (k === 'scan') {
    const v = Math.round(Number(t.value));
    if (!(v >= 5 && v <= 1440)) { toast('Chu kỳ quét từ 5 đến 1440 phút'); t.value = S.settings.scanMinutes; return; }
    stDo(() => call('POST', '/api/settings', { scanMinutes: v }), 'Đã đổi chu kỳ quét');
  }
  else if (k === 'pref') {
    const body = { [t.dataset.grp]: { [t.dataset.key]: t.type === 'checkbox' ? t.checked : Number(t.value) } };
    const r = await stDo(() => call('POST', '/api/prefs', body), 'Đã lưu');
    if (!r) stPaint();
  }
  // Tab Tự động
  else if (k === 'auto-asst') { const r = await stDo(() => call('POST', '/api/settings', { assistant: { on: t.checked } }), t.checked ? 'Đã bật trợ lý nhắn tin' : 'Đã tắt trợ lý nhắn tin'); if (!r) stPaint(); }
  else if (k === 'auto-leads') { const r = await stDo(() => call('POST', '/api/settings', { leads: { on: t.checked } }), 'Đã lưu'); if (!r) stPaint(); }
  else if (k === 'auto-leads-ads') {
    if (t.checked && !(await confirmBox({ title: 'Dùng số khách thật cho luật quảng cáo?', body: '<p>Luật tắt/tăng ngân sách và chấm bài thử sẽ dùng số Facebook × tỷ lệ khách thật của thương hiệu (tính theo hộp thư Page, không theo từng chiến dịch). Thương hiệu chưa đủ 5 cuộc trò chuyện thì vẫn dùng số Facebook.</p>', ok: 'Bật' }))) { t.checked = false; return; }
    const r = await stDo(() => call('POST', '/api/settings', { leads: { useForAds: t.checked } }), 'Đã lưu'); if (!r) stPaint();
  }
  else if (k === 'auto-asst-auto') { const r = await stDo(() => call('POST', '/api/settings', { assistant: { auto: t.checked } }), 'Đã lưu'); if (!r) stPaint(); }
  else if (k === 'auto-asst-brand') { const r = await stDo(() => call('POST', '/api/settings', { assistant: { brands: { [t.dataset.id]: t.checked } } }), 'Đã lưu'); if (!r) stPaint(); }
  else if (k === 'auto-agent') { const r = await stDo(() => call('POST', `/api/agents/${encodeURIComponent(t.dataset.id)}/toggle`, { on: t.checked }), t.checked ? 'Đã bật agent' : 'Đã tạm dừng agent'); if (!r) stPaint(); }
  else if (k === 'auto-adtest') { const r = await stDo(() => call('POST', '/api/settings', { adTest: { on: t.checked } }), t.checked ? 'Đã bật quảng cáo tự động' : 'Đã tắt quảng cáo tự động'); if (!r) stPaint(); }
  else if (k === 'auto-boost') { const r = await stDo(() => call('POST', '/api/settings', { adTest: { boost: { on: t.checked } } }), 'Đã lưu'); if (!r) stPaint(); }
  else if (k === 'auto-boost-auto') {
    if (t.checked && !(await confirmBox({ title: 'Tự chạy quảng cáo, không chờ duyệt?', body: '<p class="alert danger">Mỗi ngày agent <b>tự tạo và bật</b> quảng cáo cho 1 video đang lên view ở mỗi cơ sở đang bật — tiền thật, không hỏi lại. Vẫn giữ hạn mức ngày của từng cơ sở.</p>', ok: 'Bật tự chạy', danger: true }))) { t.checked = false; return; }
    const r = await stDo(() => call('POST', '/api/settings', { adTest: { boost: { auto: t.checked } } }), t.checked ? 'Đã bật tự chạy' : 'Đã tắt tự chạy — về chế độ đề xuất chờ duyệt'); if (!r) stPaint();
  }
  else if (k === 'auto-unit') { const r = await stDo(() => call('POST', '/api/settings', { adTest: { units: [{ id: t.dataset.id, on: t.checked }] } }), t.checked ? 'Cơ sở này được chạy quảng cáo' : 'Cơ sở này không chạy quảng cáo nữa'); if (!r) stPaint(); }
  else if (k === 'auto-unit-budget') { const r = await stDo(() => call('POST', '/api/settings', { adTest: { units: [{ id: t.dataset.id, dailyBudget: Number(t.value) }] } }), 'Đã lưu hạn mức ngày'); if (!r) stPaint(); }
  else if (k === 'auto-pilot') { const r = await stDo(() => call('POST', '/api/autopilot', { on: t.checked }), t.checked ? 'Đã bật lái tự động' : 'Đã tắt lái tự động'); if (!r) stPaint(); }
  else if (k === 'auto-pilot-approve') {
    if (t.checked && !(await confirmBox({ title: 'Tự duyệt bài đăng?', body: '<p class="alert danger">Bài do agent soạn sẽ <b>tự lên lịch và đăng thật</b> lên Page, không chờ anh xem.</p>', ok: 'Bật tự duyệt', danger: true }))) { t.checked = false; return; }
    const r = await stDo(() => call('POST', '/api/autopilot', { autoApprove: t.checked }), 'Đã lưu'); if (!r) stPaint();
  }
  else if (k === 'yt-privacy') stDo(() => call('POST', '/api/settings', { youtubePrivacy: t.value }), 'Đã lưu chế độ hiển thị YouTube');
  else if (k === 'ai-on') stDo(() => call('POST', '/api/prefs', { ai: { enabled: t.checked } }), t.checked ? 'Đã bật AI' : 'Đã tắt AI — dùng mẫu câu có sẵn');
  else if (k === 'ai-model') stDo(() => call('POST', '/api/prefs', { ai: { model: t.value } }), 'Đã lưu model');
});
