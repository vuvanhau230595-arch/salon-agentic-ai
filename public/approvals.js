// Trung tâm Duyệt & Phê duyệt: hàng đợi có xem trước thật, ghi chú, duyệt/bỏ qua từng mục hoặc hàng loạt, lịch sử người duyệt.
// Luồng: Nháp → Chờ duyệt → Đã duyệt / Từ chối → Đã thực hiện. Mọi quyết định đi qua /api/approvals/* (kiểm tra và ghi nhật ký ở máy chủ).
// Nạp sau overview.js (dùng chung confirmBox, dryNote, brandName, lintBox, call, toast, render, S).
const APV = { tab: 'pending', type: '', brand: '', q: '', sel: new Set(), notes: {}, busy: false, hStatus: '', hPage: 1 };
const AP_LABEL = { post_publish: 'Đăng bài', comment_reply: 'Trả lời bình luận', ad_test: 'Quảng cáo thử', budget_increase: 'Tăng ngân sách', unit_budget: 'Ngân sách cơ sở', month_plan: 'Kế hoạch tháng' };
const AP_GROUP = { post_publish: 'post', comment_reply: 'comment', ad_test: 'ads', budget_increase: 'ads', unit_budget: 'ads', month_plan: 'plan' };
const AP_GROUPS = [['', 'Tất cả'], ['post', 'Bài đăng'], ['ads', 'Quảng cáo & ngân sách'], ['comment', 'Bình luận'], ['plan', 'Kế hoạch']];
const AP_SPEND = new Set(['ad_test', 'budget_increase', 'unit_budget']); // đụng tới tiền: luôn hỏi xác nhận
const AP_STAGE = {
  pending: ['info', 'Chờ duyệt'], approved: ['on', 'Đã duyệt'], approved_dry: ['dry', 'Đã duyệt (chạy thử, chưa áp dụng)'],
  done: ['on', 'Đã thực hiện'], rejected: ['off', 'Từ chối'], failed: ['off', 'Lỗi khi thực hiện'],
};
const apWhen = (t) => (t ? new Date(t).toLocaleString('vi-VN') : '—');
const apAgo = (t) => { const m = Math.round((Date.now() - new Date(t).getTime()) / 60000); return m < 1 ? 'vừa xong' : m < 60 ? `${m} phút trước` : m < 1440 ? `${Math.round(m / 60)} giờ trước` : `${Math.round(m / 1440)} ngày trước`; };

function apBlocked(a) { return !!(a.lint && a.lint.blocked); }
function apList() {
  const q = APV.q.trim().toLowerCase();
  return S.approvals.filter((a) => (!APV.type || AP_GROUP[a.type] === APV.type) && (!APV.brand || a.brand === APV.brand)
    && (!q || `${a.title} ${a.detail}`.toLowerCase().includes(q)));
}

// Dải giai đoạn: Nháp → Chờ duyệt → Đã duyệt/Từ chối → Đã thực hiện
function stageStrip(stage) {
  const idx = { pending: 1, approved: 2, approved_dry: 2, rejected: 2, done: 3, failed: 3 }[stage] ?? 1;
  const third = stage === 'rejected' ? 'Từ chối' : 'Đã duyệt';
  const steps = ['Nháp', 'Chờ duyệt', third, stage === 'failed' ? 'Lỗi' : 'Đã thực hiện'];
  const bad = stage === 'rejected' || stage === 'failed';
  return `<div class="row" style="gap:4px;margin:6px 0;font-size:12px">${steps.map((s, i) => {
    const on = i <= idx, cur = i === idx;
    const col = cur && bad ? 'var(--bad)' : cur ? 'var(--brand)' : on ? 'var(--ok)' : 'var(--mute)';
    return `<span style="color:${col};font-weight:${cur ? 600 : 400}">${on && !cur ? '✓ ' : cur ? '● ' : '○ '}${s}</span>${i < 3 ? '<span style="color:var(--line)">—</span>' : ''}`;
  }).join('')}</div>`;
}

function previewHtml(a) {
  const p = a.preview, pl = a.payload || {};
  if (a.type === 'post_publish' && p) {
    const thumbs = p.media.length ? `<div class="row" style="gap:8px;margin-top:8px">${p.media.map((m) => m.type === 'video'
      ? `<video src="${esc(m.url)}" preload="none" controls style="height:120px;border-radius:8px;background:#000"></video>`
      : `<a href="${esc(m.url)}" target="_blank" rel="noopener"><img src="${esc(m.url)}" alt="${esc(m.name)}" loading="lazy" style="height:120px;border-radius:8px;display:block"></a>`).join('')}</div>` : '<p class="sub" style="margin:6px 0 0">Bài chưa gắn ảnh/video.</p>';
    return `<div style="background:var(--soft);border-radius:var(--r-sm);padding:10px 12px;margin-top:6px"><small style="color:var(--mute)">${esc(p.channelLabel)} · hẹn đăng ${esc(apWhen(p.scheduledAt))}</small>${p.title ? `<div><b>${esc(p.title)}</b></div>` : ''}<div style="white-space:pre-wrap;margin-top:4px">${esc(p.text)}</div>${thumbs}</div>${a.qc ? qcBox(a.qc) + qcActions('post', a.postId) : lintBox(a.lint)}${apBlocked(a) ? '<p style="color:var(--bad)">Bài vi phạm nặng — bấm Từ chối rồi soạn lại ở Lịch đăng.</p>' : ''}`;
  }
  if (a.type === 'comment_reply' && p) {
    return `<div style="background:var(--soft);border-radius:var(--r-sm);padding:10px 12px;margin-top:6px"><small style="color:var(--mute)">${esc(p.author)} hỏi:</small><div style="white-space:pre-wrap">${esc(p.original)}</div><small style="color:var(--mute);display:block;margin-top:8px">Agent đề xuất trả lời:</small><div style="white-space:pre-wrap"><b>${esc(p.reply)}</b></div></div>`;
  }
  if (a.type === 'message_reply') {
    return `<div style="background:var(--soft);border-radius:var(--r-sm);padding:10px 12px;margin-top:6px"><small style="color:var(--mute)">${esc(pl.author)} nhắn (Messenger):</small><div style="white-space:pre-wrap">${esc(pl.original)}</div><small style="color:var(--mute);display:block;margin-top:8px">${esc(pl.reason)} · trợ lý soạn sẵn, bấm Duyệt là gửi:</small><div style="white-space:pre-wrap"><b>${esc(pl.text)}</b></div></div>`;
  }
  if (a.type === 'lead') {
    return `<div style="background:var(--soft);border-radius:var(--r-sm);padding:10px 12px;margin-top:6px"><div>📞 <b>${esc(pl.phone)}</b> · ${esc(pl.name)}</div><p class="sub" style="margin:6px 0 0;white-space:pre-wrap">${esc(a.detail)}</p></div>`;
  }
  if (a.type === 'budget_increase' || a.type === 'unit_budget') {
    return `<div class="kv" style="grid-template-columns:repeat(3,1fr)"><div><small>Hiện tại</small><b>${vnd(pl.from)}/ngày</b></div><div><small>Đề xuất</small><b>${vnd(pl.to)}/ngày</b></div><div><small>Chênh lệch</small><b>${pl.to >= pl.from ? '+' : '−'}${vnd(Math.abs(pl.to - pl.from))}</b></div></div><p class="sub" style="margin:0">${esc(a.detail)}</p>`;
  }
  if (a.type === 'ad_test') {
    return `<div class="kv" style="grid-template-columns:repeat(3,1fr)"><div><small>Ngân sách</small><b>${vnd(pl.budget)}/ngày</b></div><div><small>Thời gian chạy</small><b>${pl.days} ngày</b></div><div><small>Tối đa</small><b>${vnd(pl.budget * pl.days)}</b></div></div><p class="sub" style="margin:0">${esc(a.detail)}</p>`;
  }
  return `<p class="sub" style="margin:6px 0 0;white-space:pre-wrap">${esc(a.detail || '')}</p>`;
}

function cardHtml(a) {
  const checked = APV.sel.has(a.id);
  return `<div class="card" id="ap_${esc(a.id)}">
    <div class="row" style="justify-content:space-between"><div class="row"><input type="checkbox" data-ap="pick" data-id="${esc(a.id)}" ${checked ? 'checked' : ''} ${apBlocked(a) ? 'disabled' : ''} aria-label="Chọn mục này">
      <span class="tag ${AP_SPEND.has(a.type) ? 'dry' : ''}">${esc(AP_LABEL[a.type] || a.type)}</span>${a.brandName ? `<span class="tag info">${esc(a.brandName)}</span>` : ''}</div><small style="color:var(--mute)">${esc(apAgo(a.at))}</small></div>
    <div style="margin-top:6px"><b>${esc(a.title)}</b></div>
    ${stageStrip(a.stage)}
    ${previewHtml(a)}
    <div class="row" style="margin-top:10px;align-items:flex-start">
      <textarea data-ap="note" data-id="${esc(a.id)}" rows="1" maxlength="500" placeholder="Ghi chú / lý do (không bắt buộc — lý do từ chối giúp AI học)" style="flex:1;min-width:200px">${esc(APV.notes[a.id] || '')}</textarea>
      <button class="pri" data-ap="approve" data-id="${esc(a.id)}" ${apBlocked(a) || APV.busy ? 'disabled' : ''}>Duyệt</button>
      <button class="danger" data-ap="reject" data-id="${esc(a.id)}" ${APV.busy ? 'disabled' : ''}>Từ chối</button></div></div>`;
}

function queueHtml() {
  const list = apList();
  const allIds = list.filter((a) => !apBlocked(a)).map((a) => a.id);
  const bar = APV.sel.size ? `<div class="card" style="position:sticky;top:60px;z-index:15;border-color:var(--brand)"><div class="row" style="justify-content:space-between"><b>Đã chọn ${APV.sel.size} mục</b><span class="row"><button class="pri" data-ap="bulk-approve" ${APV.busy ? 'disabled' : ''}>Duyệt ${APV.sel.size} mục</button><button class="danger" data-ap="bulk-reject" ${APV.busy ? 'disabled' : ''}>Từ chối ${APV.sel.size} mục</button><button data-ap="clear">Bỏ chọn</button></span></div></div>` : '';
  const counts = Object.fromEntries(AP_GROUPS.map(([k]) => [k, S.approvals.filter((a) => !k || AP_GROUP[a.type] === k).length]));
  return `<div class="toolbar noprint"><div class="seg">${AP_GROUPS.map(([k, l]) => `<button class="${APV.type === k ? 'on' : ''}" data-ap="type" data-p="${k}">${l} (${counts[k]})</button>`).join('')}</div>
    <select data-ap="brand" aria-label="Thương hiệu"><option value="">Mọi thương hiệu</option>${S.brands.map((b) => `<option value="${esc(b.id)}" ${APV.brand === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
    <input class="grow" type="search" id="apSearch" placeholder="Tìm trong tiêu đề, nội dung…" value="${esc(APV.q)}" aria-label="Tìm">
    ${allIds.length ? `<label class="f" style="margin:0"><input type="checkbox" data-ap="all" ${allIds.every((i) => APV.sel.has(i)) ? 'checked' : ''}> Chọn tất cả (${allIds.length})</label>` : ''}</div>
    ${bar}${list.length ? list.map(cardHtml).join('') : `<div class="card"><div class="state"><b>${S.approvals.length ? 'Không có mục nào khớp bộ lọc' : 'Không có việc nào chờ duyệt'}</b>${S.approvals.length ? 'Thử bỏ bớt bộ lọc.' : 'Khi agent soạn bài, đề xuất tăng ngân sách hay trả lời bình luận, mục sẽ xuất hiện ở đây.'}</div></div>`}`;
}

function historyRows() {
  const q = APV.q.trim().toLowerCase();
  return (S.approvalHistory || []).filter((h) => (!APV.type || AP_GROUP[h.type] === APV.type) && (!APV.brand || h.brand === APV.brand)
    && (!APV.hStatus || (APV.hStatus === 'rejected' ? h.status === 'rejected' : h.status === 'approved')) && (!q || `${h.title} ${h.note}`.toLowerCase().includes(q)));
}
function historyHtml() {
  const rows = historyRows();
  const per = 15, pages = Math.max(1, Math.ceil(rows.length / per));
  if (APV.hPage > pages) APV.hPage = pages;
  const slice = rows.slice((APV.hPage - 1) * per, APV.hPage * per);
  return `<div class="toolbar noprint"><div class="seg">${AP_GROUPS.map(([k, l]) => `<button class="${APV.type === k ? 'on' : ''}" data-ap="type" data-p="${k}">${l}</button>`).join('')}</div>
    <select data-ap="hstatus" aria-label="Kết quả"><option value="">Mọi kết quả</option><option value="approved" ${APV.hStatus === 'approved' ? 'selected' : ''}>Đã duyệt</option><option value="rejected" ${APV.hStatus === 'rejected' ? 'selected' : ''}>Từ chối</option></select>
    <select data-ap="brand" aria-label="Thương hiệu"><option value="">Mọi thương hiệu</option>${S.brands.map((b) => `<option value="${esc(b.id)}" ${APV.brand === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
    <input class="grow" type="search" id="apSearch" placeholder="Tìm trong tiêu đề, ghi chú…" value="${esc(APV.q)}" aria-label="Tìm"><button data-ap="csv">⬇ Xuất CSV</button></div>
    <div class="tablewrap"><table class="tbl"><thead><tr><th>Quyết định lúc</th><th>Loại</th><th>Mục</th><th>Thương hiệu</th><th>Kết quả</th><th>Người duyệt</th><th>Ghi chú</th></tr></thead><tbody>${
      slice.map((h) => { const st = AP_STAGE[h.stage] || ['', h.stage]; return `<tr><td style="white-space:nowrap">${esc(apWhen(h.decidedAt || h.at))}</td><td>${esc(AP_LABEL[h.type] || h.type)}</td><td><b>${esc(h.title)}</b></td><td>${esc(h.brandName || '—')}</td><td><span class="tag ${st[0]}">${esc(st[1])}</span></td><td>${esc(h.decidedBy || '—')}</td><td>${esc(h.note || '')}</td></tr>`; }).join('')
      || `<tr><td colspan="7"><div class="state"><b>Chưa có lịch sử</b>Các mục đã duyệt hoặc từ chối sẽ nằm ở đây.</div></td></tr>`}</tbody></table></div>
    <div class="pager"><span>${rows.length} mục (hiện 120 mục gần nhất)</span><span class="row"><button class="sm" data-ap="hpage" data-p="${APV.hPage - 1}" ${APV.hPage <= 1 ? 'disabled' : ''}>‹ Trước</button> Trang ${APV.hPage}/${pages} <button class="sm" data-ap="hpage" data-p="${APV.hPage + 1}" ${APV.hPage >= pages ? 'disabled' : ''}>Sau ›</button></span></div>`;
}

function pageApprovals() {
  const pend = S.approvals.length;
  return `<h1>Duyệt & Phê duyệt</h1><p class="sub">Mọi việc tăng chi tiêu, đăng bài, trả lời khách đều cần Sếp bấm duyệt. ${S.settings.dryRun ? '<span class="tag dry">Đang chạy thử</span> Duyệt xong chỉ ghi nhận, chưa tác động ra ngoài.' : ''}</p>
  <div class="seg" style="margin-bottom:12px"><button class="${APV.tab === 'pending' ? 'on' : ''}" data-ap="tab" data-p="pending">Chờ duyệt (${pend})</button><button class="${APV.tab === 'history' ? 'on' : ''}" data-ap="tab" data-p="history">Lịch sử (${(S.approvalHistory || []).length})</button></div>
  <div id="apBody">${APV.tab === 'pending' ? queueHtml() : historyHtml()}</div>`;
}
function apRepaint() { const el = document.getElementById('apBody'); if (el) el.innerHTML = APV.tab === 'pending' ? queueHtml() : historyHtml(); }

async function apDecide(ids, action) {
  const items = ids.map((id) => S.approvals.find((a) => a.id === id)).filter(Boolean);
  if (!items.length) return;
  const spend = items.some((a) => AP_SPEND.has(a.type));
  const verb = action === 'approve' ? 'Duyệt' : 'Từ chối';
  if (items.length > 1 || (action === 'approve' && spend)) {
    const list = `<ul style="margin:8px 0;padding-left:18px;max-height:200px;overflow:auto">${items.slice(0, 12).map((a) => `<li>${esc(a.title)}</li>`).join('')}${items.length > 12 ? `<li>… và ${items.length - 12} mục khác</li>` : ''}</ul>`;
    const ok = await confirmBox({ title: `${verb} ${items.length} mục?`, body: list + (action === 'approve' ? dryNote() : '<p class="sub">Các mục này sẽ bị bỏ qua.</p>'), ok: `${verb} ${items.length} mục`, danger: action === 'reject' });
    if (!ok) return;
  }
  APV.busy = true; apRepaint();
  for (const a of items) { const el = document.getElementById('ap_' + a.id); if (el) { el.style.opacity = '.55'; el.style.pointerEvents = 'none'; } }
  toast(`${action === 'approve' ? 'Đang duyệt' : 'Đang từ chối'} ${items.length} mục… (mục tạo quảng cáo thật cần vài giây vì phải gọi Facebook)`);
  try {
    if (items.length === 1) {
      S = await call('POST', `/api/approvals/${encodeURIComponent(items[0].id)}/${action}`, { note: APV.notes[items[0].id] || '' });
      toast(action === 'approve' ? 'Đã duyệt' : 'Đã từ chối');
    } else {
      const note = items.map((a) => APV.notes[a.id]).find(Boolean) || '';
      const r = await call('POST', '/api/approvals/bulk', { action, ids: items.map((a) => a.id), note });
      S = r.state;
      const bad = r.results.filter((x) => !x.ok);
      toast(bad.length ? `${r.results.length - bad.length}/${r.results.length} mục thành công. Lỗi: ${bad[0].error}` : `Đã ${action === 'approve' ? 'duyệt' : 'từ chối'} ${r.results.length} mục`);
    }
    for (const a of items) { APV.sel.delete(a.id); delete APV.notes[a.id]; }
  } catch (e) { toast(e.message); }
  APV.busy = false;
  render();
}

function apCsv() {
  const rows = historyRows();
  if (!rows.length) return toast('Không có dòng nào để xuất');
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Quyết định lúc', 'Loại', 'Mục', 'Thương hiệu', 'Kết quả', 'Người duyệt', 'Ghi chú'].map(q).join(',')].concat(rows.map((h) => [apWhen(h.decidedAt || h.at), AP_LABEL[h.type] || h.type, h.title, h.brandName, (AP_STAGE[h.stage] || ['', h.stage])[1], h.decidedBy, h.note].map(q).join(',')));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = `lich-su-duyet-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`Đã xuất ${rows.length} mục`);
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-ap]');
  if (!t || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') return;
  const k = t.dataset.ap, d = t.dataset;
  if (k === 'tab') { APV.tab = d.p; APV.q = ''; render(); }
  else if (k === 'type') { APV.type = d.p; APV.hPage = 1; render(); }
  else if (k === 'approve' || k === 'reject') apDecide([d.id], k);
  else if (k === 'bulk-approve') apDecide([...APV.sel], 'approve');
  else if (k === 'bulk-reject') apDecide([...APV.sel], 'reject');
  else if (k === 'clear') { APV.sel.clear(); apRepaint(); }
  else if (k === 'hpage') { APV.hPage = Math.max(1, Number(d.p)); apRepaint(); }
  else if (k === 'csv') apCsv();
});
document.addEventListener('change', (e) => {
  const t = e.target, k = t.dataset.ap;
  if (!k) return;
  if (k === 'pick') { t.checked ? APV.sel.add(t.dataset.id) : APV.sel.delete(t.dataset.id); apRepaint(); }
  else if (k === 'all') { const ids = apList().filter((a) => !apBlocked(a)).map((a) => a.id); ids.forEach((i) => (t.checked ? APV.sel.add(i) : APV.sel.delete(i))); apRepaint(); }
  else if (k === 'brand') { APV.brand = t.value; APV.hPage = 1; render(); }
  else if (k === 'hstatus') { APV.hStatus = t.value; APV.hPage = 1; render(); }
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'apSearch') { APV.q = t.value; APV.hPage = 1; apRepaint(); }
  else if (t.dataset.ap === 'note') APV.notes[t.dataset.id] = t.value;
});
