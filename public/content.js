// Dây chuyền nội dung (8 agent): hộp điểm kiểm tra chất lượng (QC), viết lại / chấm lại bài, dữ liệu động thương hiệu (có xác nhận + hiệu lực),
// trạng thái 8 agent và thống kê nội dung. Mọi số liệu lấy từ backend (/api/content/*), không có số liệu giả.
// Nạp sau agents.js (dùng chung call, toast, render, S, esc, confirmBox).
const CT = { pipe: null, ana: null, anaMonth: '', anaBrand: '', facts: {}, factsBrand: '', busy: new Set(), editing: new Set(), err: '' };
const CT_ST = { ok: ['on', 'Đạt'], needs_work: ['dry', 'Cần sửa'], needs_info: ['off', 'Cần bổ sung dữ liệu'] };
const CT_LV = { block: ['off', 'LỖI NẶNG'], warn: ['dry', 'Cảnh báo'], info: ['', 'Nhắc'] };
const CT_FACT_ST = { current: ['on', 'Đang hiệu lực'], unverified: ['dry', 'Chưa xác nhận'], expired: ['off', 'Hết hạn'], upcoming: ['info', 'Chưa tới ngày'], missing: ['', 'Chưa nhập'] };
const ctWhen = (t) => (t ? new Date(t).toLocaleString('vi-VN') : '—');

// ---------- Hộp điểm QC (dùng ở Duyệt, Lịch đăng, Kế hoạch tháng) ----------
function qcBox(qc) {
  if (!qc) return '';
  const [cls, label] = CT_ST[qc.status] || ['', qc.status];
  const col = qc.score >= 85 ? 'var(--ok)' : qc.score >= 60 ? 'var(--brand)' : 'var(--bad)';
  const issues = (qc.issues || []).filter((i) => i.level !== 'info' || qc.status !== 'ok');
  return `<div style="margin-top:8px;border:1px solid var(--line);border-radius:var(--r-sm);padding:8px 10px">
    <div class="row" style="gap:8px;align-items:center"><b style="font-size:18px;color:${col};white-space:nowrap">${qc.score}<span style="font-size:12px;color:var(--mute);font-weight:400">/100</span></b>
      <span class="tag ${cls}">${esc(label)}</span>${qc.attempts ? `<small style="color:var(--mute)">AI đã viết lại ${qc.attempts} lần</small>` : ''}${qc.mode === 'template' ? '<span class="tag">Bài mẫu</span>' : ''}</div>
    ${(qc.needsInfo || []).map((n) => `<div style="margin:4px 0"><span class="tag off">Thiếu dữ liệu</span> <small>${esc(n)}</small></div>`).join('')}
    ${issues.map((i) => { const [c, l] = CT_LV[i.level] || ['', i.level]; return `<div style="margin:3px 0"><span class="tag ${c}">${l}</span> <small>${esc(i.msg)}</small></div>`; }).join('')}
    ${!issues.length && !(qc.needsInfo || []).length ? '<small style="color:var(--mute)">Không có vấn đề được phát hiện.</small>' : ''}</div>`;
}
// Nút thao tác cho bài lẻ (postId) hoặc bài trong kế hoạch (planId.itemId)
function qcActions(kind, id) {
  const busy = CT.busy.has(id);
  const k = kind === 'plan' ? 'p' : '';
  return `<div class="row noprint" style="margin-top:6px;gap:6px"><button class="sm" data-ct="${k}qc" data-id="${esc(id)}" ${busy ? 'disabled' : ''}>Kiểm tra lại</button><button class="sm" data-ct="${k}rewrite" data-id="${esc(id)}" ${busy ? 'disabled' : ''}>${busy ? 'Đang viết lại…' : '✦ Yêu cầu AI viết lại'}</button>${kind === 'post' ? `<button class="sm" data-ct="edit" data-id="${esc(id)}">✎ Sửa nội dung</button>` : ''}</div>
    ${kind === 'post' && CT.editing.has(id) ? `<div style="margin-top:6px"><textarea id="ctEd_${esc(id)}" rows="8" style="width:100%">${esc(ctPostText(id))}</textarea><div class="row" style="margin-top:4px"><button class="pri sm" data-ct="save" data-id="${esc(id)}">Lưu bài</button><button class="sm" data-ct="cancel" data-id="${esc(id)}">Huỷ</button></div></div>` : ''}`;
}
const ctPostText = (postId) => { const a = (S.approvals || []).find((x) => x.postId === postId); return a && a.preview ? a.preview.text : ''; };

async function ctRefresh() { S = await call('GET', '/api/state'); render(); }
async function ctRun(id, fn, okMsg) {
  CT.busy.add(id); render();
  try { await fn(); if (okMsg) toast(okMsg); } catch (e) { toast(e.message); }
  CT.busy.delete(id);
  try { await ctRefresh(); } catch { render(); }
}

// ---------- Tab "Dây chuyền nội dung" (8 agent) ----------
async function ctLoadPipe() {
  try { CT.pipe = await call('GET', '/api/content/pipeline'); CT.err = ''; } catch (e) { CT.err = e.message; }
  if (typeof agPaint === 'function') agPaint();
}
function agPipeline() {
  if (CT.err && !CT.pipe) return `<div class="card"><div class="state err"><b>Không tải được trạng thái</b>${esc(CT.err)}<br><button class="sm" data-ct="reload-pipe">Thử lại</button></div></div>`;
  if (!CT.pipe) { ctLoadPipe(); return '<div class="skel" style="height:240px"></div>'; }
  const d = CT.pipe;
  const lab = { ok: ['on', 'Hoạt động'], warn: ['dry', 'Cần cấu hình'], off: ['off', 'Tắt'] };
  return `<div class="alert" style="margin-bottom:12px"><b>Quy trình:</b> Lên lịch → đọc dữ liệu thương hiệu → chọn chủ đề → viết bài → kiểm tra chất lượng (dưới ${d.minScore} điểm viết lại, tối đa ${d.maxRewrites} lần) → bản nháp chờ duyệt → đến giờ kiểm tra lại → đăng → lưu mã bài → thống kê → học từ phản hồi.
    <br><b>Chế độ đăng:</b> ${d.dry ? '<span class="tag dry">CHẠY THỬ — chưa đăng thật</span>' : d.live ? '<span class="tag on">ĐĂNG THẬT</span>' : '<span class="tag">Chế độ mẫu</span>'} · <b>AI viết bài:</b> ${esc(d.aiMode.label)}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:14px;align-items:start">${d.agents.map((a, i) => { const [c, l] = lab[a.status] || ['', a.status]; return `<div class="card">
      <div class="row" style="justify-content:space-between;align-items:flex-start"><div><h2 style="margin:0">${i + 1}. ${esc(a.name)}</h2><small style="color:var(--mute)">${esc(a.role)}</small></div><span class="tag ${c}">${l}</span></div>
      <p style="margin:8px 0"><b>${esc(a.headline)}</b></p>
      <ul style="margin:0 0 6px;padding-left:18px;font-size:13px">${a.details.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      ${a.needs.length ? `<div class="alert danger" style="font-size:13px"><b>Cần Sếp cấu hình:</b><ul style="margin:4px 0 0;padding-left:18px">${a.needs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}</div>`; }).join('')}</div>`;
}

// ---------- Tab "Phân tích nội dung" ----------
async function ctLoadAna() {
  try {
    const qs = new URLSearchParams({ ...(CT.anaMonth ? { month: CT.anaMonth } : {}), ...(CT.anaBrand ? { brand: CT.anaBrand } : {}) });
    CT.ana = await call('GET', '/api/content/analytics?' + qs); CT.err = '';
  } catch (e) { CT.err = e.message; }
  if (typeof agPaint === 'function') agPaint();
}
function agAnalytics() {
  if (CT.err && !CT.ana) return `<div class="card"><div class="state err"><b>Không tải được thống kê</b>${esc(CT.err)}<br><button class="sm" data-ct="reload-ana">Thử lại</button></div></div>`;
  if (!CT.ana) { ctLoadAna(); return '<div class="skel" style="height:240px"></div>'; }
  const a = CT.ana, t = a.total;
  const k = (l, v, s = '') => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  const maxD = Math.max(1, ...a.byDay.map((x) => x.created));
  return `<div class="toolbar noprint"><input type="month" data-ct="ana-month" value="${esc(a.month)}" aria-label="Tháng"><select data-ct="ana-brand" aria-label="Thương hiệu"><option value="">Mọi thương hiệu</option>${S.brands.map((b) => `<option value="${esc(b.id)}" ${CT.anaBrand === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div>
    <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">${k('Bài trong tháng', t.total)}${k('Chờ duyệt', t.pending)}${k('Đã duyệt', t.approved)}${k('Từ chối', t.rejected)}${k('Đã đăng', t.published, 'có mã bài Facebook xác nhận')}${k('Lỗi đăng', t.failed)}</div>
    ${a.tips.length ? `<div class="card"><h2>Gợi ý cải thiện</h2><ul style="margin:0;padding-left:18px">${a.tips.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    <div class="card"><h2>Theo thương hiệu</h2><div class="tablewrap"><table class="tbl"><thead><tr><th>Thương hiệu</th><th class="num">Bài</th><th class="num">Chờ duyệt</th><th class="num">Đã duyệt</th><th class="num">Từ chối</th><th class="num">Đã đăng</th></tr></thead><tbody>${Object.values(a.byBrand).map((b) => `<tr><td><b>${esc(b.name)}</b></td><td class="num">${b.total}</td><td class="num">${b.pending}</td><td class="num">${b.approved}</td><td class="num">${b.rejected}</td><td class="num">${b.published}</td></tr>`).join('') || '<tr><td colspan="6"><div class="state"><b>Chưa có bài trong tháng này</b></div></td></tr>'}</tbody></table></div></div>
    <div class="card"><h2>Theo nhóm chủ đề</h2><div class="tablewrap"><table class="tbl"><thead><tr><th>Nhóm</th><th class="num">Bài</th><th class="num">Đã duyệt</th><th class="num">Từ chối</th><th class="num">Điểm QC TB</th></tr></thead><tbody>${a.categories.map((c) => `<tr><td>${esc(c.label)}</td><td class="num">${c.total}</td><td class="num">${c.approved}</td><td class="num">${c.rejected}</td><td class="num">${c.avgScore === null ? '—' : c.avgScore}</td></tr>`).join('') || '<tr><td colspan="5"><div class="state"><b>Chưa có dữ liệu</b></div></td></tr>'}</tbody></table></div></div>
    <div class="card"><h2>Theo ngày</h2>${a.byDay.length ? `<div style="display:flex;gap:3px;align-items:flex-end;height:90px">${a.byDay.map((x) => `<div title="${esc(x.date)}: ${x.created} bài, ${x.published} đã đăng" style="flex:1;min-width:4px;background:var(--brand);opacity:${x.published ? 1 : .35};height:${Math.max(6, (x.created / maxD) * 86)}px;border-radius:2px"></div>`).join('')}</div><small style="color:var(--mute)">Cột đậm = đã đăng, cột nhạt = chưa đăng</small>` : '<div class="state"><b>Chưa có bài</b></div>'}</div>
    <div class="alert"><b>Chỉ số Facebook (lượt xem, tương tác):</b> ${esc(a.metrics.reason)}</div>`;
}

// ---------- Dữ liệu động của thương hiệu (trang Thương hiệu & Kênh) ----------
function ctFactsPanel(brandId) {
  if (CT.factsBrand !== brandId) { CT.factsBrand = brandId; CT.facts = {}; }
  setTimeout(() => ctLoadFacts(brandId), 0);
  return `<div class="card" id="ctFacts"><h2>Dữ liệu động (dùng để viết bài)</h2><div class="skel" style="height:120px"></div></div>`;
}
async function ctLoadFacts(brandId) {
  const el = document.getElementById('ctFacts');
  try { const r = await call('GET', `/api/brands/${encodeURIComponent(brandId)}/facts`); CT.facts = r; if (el) el.innerHTML = ctFactsHtml(r); }
  catch (e) { if (el) el.innerHTML = `<h2>Dữ liệu động</h2><div class="state err">${esc(e.message)}</div>`; }
}
function ctFactsHtml(r) {
  return `<h2>Dữ liệu động (dùng để viết bài)</h2>
    <p class="sub">Chỉ dữ liệu <b>đã xác nhận</b> và <b>còn hiệu lực</b> mới được đưa vào bài. Sửa nội dung là phải xác nhận lại. Hotline, giá, ưu đãi không bao giờ do AI tự nghĩ ra.</p>
    ${r.facts.map((f) => { const [c, l] = CT_FACT_ST[f.state] || ['', f.state]; const multi = ['prices', 'promotions', 'warranty', 'hours'].includes(f.key);
      return `<div style="border-top:1px solid var(--line);padding:10px 0"><div class="row" style="justify-content:space-between"><b>${esc(f.label)}</b><span class="row" style="gap:6px"><span class="tag ${c}">${l}</span><small style="color:var(--mute)">v${f.version}${f.verifiedBy ? ` · ${esc(f.verifiedBy)} xác nhận ${esc(ctWhen(f.verifiedAt))}` : ''}</small></span></div>
        ${multi ? `<textarea data-ctf="${f.key}" data-k="value" rows="${f.key === 'prices' || f.key === 'promotions' ? 4 : 2}" style="width:100%;margin-top:6px" placeholder="${esc(f.hint)}">${esc(f.value)}</textarea>` : `<input type="text" data-ctf="${f.key}" data-k="value" value="${esc(f.value)}" placeholder="${esc(f.hint)}" style="width:100%;margin-top:6px">`}
        <div class="row" style="gap:8px;margin-top:6px;flex-wrap:wrap"><label class="f" style="margin:0">Hiệu lực từ <input type="date" data-ctf="${f.key}" data-k="validFrom" value="${esc(f.validFrom)}"></label><label class="f" style="margin:0">đến <input type="date" data-ctf="${f.key}" data-k="validTo" value="${esc(f.validTo)}"></label>
          <button class="sm" data-ct="fsave" data-key="${f.key}">Lưu (chưa xác nhận)</button><button class="pri sm" data-ct="fverify" data-key="${f.key}">Lưu và xác nhận</button>
          ${f.history.length > 1 ? `<details><summary style="cursor:pointer;color:var(--brand)">Lịch sử (${f.history.length})</summary><ul style="font-size:12px;margin:4px 0;padding-left:16px">${f.history.slice(0, 8).map((h) => `<li>v${h.version} · ${esc(ctWhen(h.at))} · ${esc(h.by)} · ${h.status === 'verified' ? 'đã xác nhận' : 'chưa xác nhận'} · ${esc(String(h.value).slice(0, 60))}</li>`).join('')}</ul></details>` : ''}</div></div>`; }).join('')}
    ${r.activePromos.length ? `<div class="alert" style="margin-top:8px"><b>Ưu đãi đang hiệu lực (kể cả từ Kế hoạch tháng):</b><ul style="margin:4px 0 0;padding-left:18px">${r.activePromos.map((p) => `<li>${esc(p.text)} <small>(đến ${esc(p.to)})</small></li>`).join('')}</ul></div>` : '<small style="color:var(--mute)">Chưa có ưu đãi nào đang hiệu lực — bài ưu đãi sẽ không được tạo.</small>'}`;
}
async function ctSaveFact(key, verified) {
  const box = document.getElementById('ctFacts');
  const get = (k) => { const el = box.querySelector(`[data-ctf="${key}"][data-k="${k}"]`); return el ? el.value : undefined; };
  try {
    await call('PUT', `/api/brands/${encodeURIComponent(CT.factsBrand)}/facts/${key}`, { value: get('value'), validFrom: get('validFrom'), validTo: get('validTo'), ...(verified ? { verified: true } : {}) });
    toast(verified ? 'Đã lưu và xác nhận' : 'Đã lưu — chưa xác nhận nên chưa dùng trong bài');
    ctLoadFacts(CT.factsBrand);
  } catch (e) { toast(e.message); }
}

// ---------- Thẻ tóm tắt cho Tổng quan ----------
function ctOverviewCard() {
  setTimeout(async () => {
    const el = document.getElementById('ctOv');
    if (!el) return;
    try { CT.pipe = await call('GET', '/api/content/pipeline'); const a = CT.pipe.agents; const q = a.find((x) => x.id === 'qc'), p = a.find((x) => x.id === 'publishing'), s = a.find((x) => x.id === 'scheduling');
      const needs = a.reduce((n, x) => n + x.needs.length, 0);
      el.innerHTML = `<h2>Dây chuyền nội dung</h2><ul style="margin:0;padding-left:18px;font-size:13px"><li>${esc(s.headline)}</li><li>${esc(q.headline)}</li><li>${esc(p.headline)}</li></ul>${needs ? `<small style="color:var(--bad)">${needs} việc cần cấu hình</small> · ` : ''}<a href="#agent" data-ct="goto-pipe">Xem 8 agent</a>`;
    } catch (e) { el.innerHTML = `<h2>Dây chuyền nội dung</h2><small style="color:var(--mute)">${esc(e.message)}</small>`; }
  }, 0);
  return '<div class="card" id="ctOv"><h2>Dây chuyền nội dung</h2><div class="skel" style="height:70px"></div></div>';
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-ct]');
  if (!t || ['SELECT', 'TEXTAREA', 'INPUT'].includes(t.tagName)) return;
  const k = t.dataset.ct, id = t.dataset.id;
  if (k === 'qc') ctRun(id, () => call('POST', `/api/posts/${encodeURIComponent(id)}/qc`), 'Đã chấm lại');
  else if (k === 'rewrite') {
    const ins = window.prompt('Yêu cầu thêm cho AI (có thể bỏ trống). Ví dụ: ngắn hơn, bớt emoji, nhấn mạnh dịch vụ nhuộm', '');
    if (ins === null) return;
    ctRun(id, () => call('POST', `/api/posts/${encodeURIComponent(id)}/rewrite`, { instruction: ins }), 'AI đã viết lại và chấm điểm');
  } else if (k === 'pqc' || k === 'prewrite') {
    const [pl, it] = id.split('.');
    if (k === 'pqc') ctRun(id, () => call('POST', `/api/plans/${encodeURIComponent(pl)}/items/${encodeURIComponent(it)}/qc`), 'Đã chấm lại');
    else { const ins = window.prompt('Yêu cầu thêm cho AI (có thể bỏ trống)', ''); if (ins === null) return; ctRun(id, () => call('POST', `/api/plans/${encodeURIComponent(pl)}/items/${encodeURIComponent(it)}/rewrite`, { instruction: ins }), 'AI đã viết lại và chấm điểm'); }
  } else if (k === 'edit') { CT.editing.add(id); render(); }
  else if (k === 'cancel') { CT.editing.delete(id); render(); }
  else if (k === 'save') {
    const el = document.getElementById('ctEd_' + id);
    ctRun(id, async () => { await call('PUT', `/api/posts/${encodeURIComponent(id)}`, { text: el.value }); CT.editing.delete(id); }, 'Đã lưu bài và chấm lại');
  } else if (k === 'fsave') ctSaveFact(t.dataset.key, false);
  else if (k === 'fverify') ctSaveFact(t.dataset.key, true);
  else if (k === 'reload-pipe') { CT.err = ''; CT.pipe = null; if (typeof agPaint === 'function') agPaint(); }
  else if (k === 'reload-ana') { CT.err = ''; CT.ana = null; if (typeof agPaint === 'function') agPaint(); }
  else if (k === 'goto-pipe') { if (typeof AG !== 'undefined') AG.tab = 'pipeline'; }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.ct === 'ana-month') { CT.anaMonth = t.value; CT.ana = null; ctLoadAna(); }
  else if (t.dataset.ct === 'ana-brand') { CT.anaBrand = t.value; CT.ana = null; ctLoadAna(); }
});
