// Trang "Trả lời nhanh": dán tin khách nhắn, agent soạn bản tiếng Trung + dịch Việt, Sếp duyệt rồi tự gửi.
const RP = { msg: '', size: '', people: '', lang: '', service: '', intent: '', rate: '', res: null, info: null, err: '' };
try { RP.rate = localStorage.getItem('rpRate') || ''; } catch { /* bỏ qua */ }

async function rpInfo() {
  try { RP.info = await call('GET', `/api/replies/info?rate=${encodeURIComponent(RP.rate || '')}&people=${encodeURIComponent(RP.people || 1)}`); } catch (e) { RP.err = e.message; }
  const el = document.getElementById('rpPrices'); if (el) el.innerHTML = rpPrices();
}

function rpFlags(fl) {
  return fl.length ? `<div style="margin-top:8px">${fl.map((f) => `<div style="margin:2px 0"><span class="tag dry">Lưu ý</span> <small>${esc(f)}</small></div>`).join('')}</div>` : '';
}

function rpOut() {
  const r = RP.res;
  if (RP.err) return `<div class="card"><p style="color:var(--bad);margin:0">${esc(RP.err)}</p></div>`;
  if (!r) return '<div class="card"><div class="empty">Dán tin khách nhắn rồi bấm "Soạn trả lời".</div></div>';
  const box = (label, text, id, rows) => `<div style="margin:10px 0"><div class="row" style="justify-content:space-between"><b>${label}</b>${id === 'rp_zh' ? '<button type="button" data-rp="copy" data-id="rp_zh">Sao chép bản tiếng Trung</button>' : '<button type="button" data-rp="copy" data-id="rp_vi">Sao chép</button>'}</div><textarea id="${id}" ${id === 'rp_zh' ? '' : 'readonly'} rows="${rows}" style="width:100%">${esc(text)}</textarea></div>`;
  const det = [r.intent.label, r.serviceLabel || null, r.size ? 'size ' + r.size : null, r.people > 1 ? r.people + ' người' : null, `¥1 = ${r.rate.toLocaleString('vi-VN')}đ`].filter(Boolean);
  return `<div class="card"><div class="row" style="gap:6px;flex-wrap:wrap"><span class="tag ${r.needsHuman ? 'off' : 'on'}">${esc(r.intent.label)}</span>${det.slice(1).map((d) => `<span class="tag">${esc(d)}</span>`).join('')}</div>
    ${r.lang === 'vi' ? box('Gửi cho khách (tiếng Việt, sửa được trước khi sao chép)', r.vi, 'rp_zh', 10).replace('Sao chép bản tiếng Trung', 'Sao chép') : box('Gửi cho khách (tiếng Trung, sửa được trước khi sao chép)', r.zh, 'rp_zh', 8) + box('Bản dịch tiếng Việt (để Sếp hiểu)', r.vi, 'rp_vi', 6)}${rpFlags(r.flags)}
    <p class="sub" style="margin:10px 0 0">Agent không tự gửi tin. Sao chép rồi dán vào khung nhắn của khách trên nền tảng.</p></div>`;
}

function rpPrices() {
  const i = RP.info;
  if (!i) return '<div class="empty">Đang tải bảng giá…</div>';
  const cell = (s) => (s.vnd == null ? '—' : `${s.vnd.toLocaleString('vi-VN')}đ <small style="color:var(--mute)">~¥${s.cny}</small>`);
  return `<p class="sub" style="margin:0 0 8px">Giá đã gồm ưu đãi tháng 10 (đến ${esc(i.promoEnd)})${i.promoActive ? '' : ' — <b style="color:var(--bad)">ĐÃ HẾT HẠN, kiểm tra bảng giá mới</b>'} · số người: ${esc(RP.people || 1)}</p>
    <div style="overflow:auto"><table><tr><th>Dịch vụ</th><th>Ngắn</th><th>Ngang vai</th><th>Dài</th><th>Giảm</th></tr>${i.prices.map((p) => `<tr><td>${esc(p.vi)}<br><small style="color:var(--mute)">${esc(p.zh)}</small></td>${p.sizes.map((s) => `<td>${cell(s)}</td>`).join('')}<td>${p.discountPct}%</td></tr>`).join('')}</table></div>`;
}

function pageReplies() {
  if (!RP.info) rpInfo();
  const sel = (id, opts, cur) => `<select id="${id}" data-rp="field">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const intents = (RP.info ? RP.info.intents : []).map((i) => [i.id, i.label]);
  return `<h1>Trả lời nhanh</h1><p class="sub">Khách nhắn riêng bằng tiếng Trung/Anh/Việt: dán tin vào đây, agent soạn câu trả lời tiếng Trung kèm bản dịch Việt và điền giá theo size. Sếp duyệt rồi tự gửi.</p>
  <div class="card"><label for="rp_msg"><b>Tin khách nhắn</b></label><textarea id="rp_msg" rows="4" style="width:100%" placeholder="VD: 你好，染粉色头发多少钱？我是长发  ·  hoặc: Cho em xin giá nhuộm ombre, tóc dài qua ngực">${esc(RP.msg)}</textarea>
    <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:8px">
      <label>Size ${sel('rp_size', [['', 'Tự nhận diện'], ['S', 'Ngắn (S)'], ['M', 'Ngang vai (M)'], ['L', 'Dài (L)']], RP.size)}</label>
      <label>Số người ${sel('rp_people', [['', 'Tự nhận diện'], ['1', '1'], ['2', '2'], ['3', '3 trở lên']], RP.people)}</label>
      <label>Trả lời bằng ${sel('rp_lang', [['', 'Tự nhận diện'], ['vi', 'Tiếng Việt'], ['zh', 'Tiếng Trung']], RP.lang)}</label>
      <label>Loại câu trả lời ${sel('rp_intent', [['', 'Tự nhận diện'], ...intents], RP.intent)}</label>
      <label>Tỷ giá (đ/¥) <input id="rp_rate" type="number" min="1000" step="10" value="${esc(RP.rate)}" placeholder="3650" style="width:90px" data-rp="field"></label>
      <button type="button" class="pri" data-rp="draft">Soạn trả lời</button></div></div>
  <div id="rpOut">${rpOut()}</div>
  <div class="card"><h2 style="margin-top:0">Bảng giá đang dùng</h2><div id="rpPrices">${rpPrices()}</div></div>`;
}

function rpRead() {
  RP.msg = ($('#rp_msg') || {}).value || '';
  RP.size = ($('#rp_size') || {}).value || '';
  RP.people = ($('#rp_people') || {}).value || '';
  RP.intent = ($('#rp_intent') || {}).value || '';
  RP.lang = ($('#rp_lang') || {}).value || '';
  RP.rate = ($('#rp_rate') || {}).value || '';
  try { localStorage.setItem('rpRate', RP.rate); } catch { /* bỏ qua */ }
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-rp]');
  if (!b || b.dataset.rp === 'field') return;
  if (b.dataset.rp === 'copy') {
    const el = document.getElementById(b.dataset.id);
    try { await navigator.clipboard.writeText(el ? el.value : ''); toast('Đã sao chép'); } catch { toast('Trình duyệt không cho sao chép — chọn chữ rồi bấm Ctrl+C'); }
    return;
  }
  if (b.dataset.rp === 'draft') {
    rpRead();
    b.disabled = true;
    try {
      RP.err = '';
      RP.res = await call('POST', '/api/replies/draft', { message: RP.msg, size: RP.size || undefined, people: Number(RP.people) || undefined, lang: RP.lang || undefined, intent: RP.intent || undefined, rate: Number(RP.rate) || undefined, brand: 'the_one' });
    } catch (er) { RP.err = er.message; RP.res = null; }
    const out = document.getElementById('rpOut'); if (out) out.innerHTML = rpOut();
    b.disabled = false;
  }
});
document.addEventListener('change', (e) => {
  if (!e.target.closest || !e.target.closest('[data-rp="field"]')) return;
  rpRead();
  if (e.target.id === 'rp_people' || e.target.id === 'rp_rate') rpInfo();
});
