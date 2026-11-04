// Trợ lý cho Sếp: nút nổi góc phải, hỏi bằng tiếng Việt thường ("hôm nay tiêu bao nhiêu", "có gì chờ duyệt", "tắt chiến dịch X").
// Trả lời từ số liệu thật của app (POST /api/assistant/boss); lệnh tốn tiền/ảnh hưởng hệ thống thì máy chủ kiểm tra quyền.
const AS = { open: false, busy: false, hist: [] };
const AS_HINTS = ['hôm nay tiêu bao nhiêu', '7 ngày tiêu bao nhiêu', 'có gì chờ duyệt', 'quảng cáo thử ra sao', 'bài nào sắp đăng', 'agent đang chạy không', 'lỗi gần đây', 'quét ngay'];

function asMount() {
  if (document.getElementById('asBtn')) return;
  const st = document.createElement('style');
  st.textContent = `#asBtn{position:fixed;right:16px;bottom:16px;z-index:60;background:var(--accent);color:#fff;border:0;border-radius:999px;padding:11px 16px;font:600 14px/1 inherit;box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer}
#asBox{position:fixed;right:16px;bottom:68px;z-index:61;width:360px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 100px);background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.3);display:none;flex-direction:column;overflow:hidden}
#asBox.on{display:flex}#asBox .hd{padding:10px 14px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center}#asBox .log{flex:1;overflow:auto;padding:12px}
#asBox .m{max-width:88%;margin:6px 0;padding:8px 11px;border-radius:12px;white-space:pre-wrap;word-break:break-word;font-size:14px}#asBox .m.b{background:var(--soft)}#asBox .m.u{background:var(--accent);color:#fff;margin-left:auto}
#asBox .hints{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 8px}#asBox .hints button{font-size:12px;padding:4px 8px}#asBox .in{display:flex;gap:6px;padding:10px;border-top:1px solid var(--line)}#asBox .in input{flex:1}
@media (max-width:480px){#asBox{right:8px;left:8px;width:auto;max-width:none;bottom:62px}}`;
  document.head.appendChild(st);
  const btn = document.createElement('button'); btn.id = 'asBtn'; btn.type = 'button'; btn.textContent = '✦ Trợ lý';
  const box = document.createElement('div'); box.id = 'asBox';
  box.innerHTML = `<div class="hd"><b>Trợ lý của Sếp</b><button class="sm" type="button" data-as="close">✕</button></div><div class="log" id="asLog"></div><div class="hints">${AS_HINTS.map((h) => `<button type="button" data-as="hint">${esc(h)}</button>`).join('')}</div><div class="in"><input id="asIn" type="text" placeholder="Hỏi hoặc ra lệnh…"><button class="pri" type="button" data-as="send">Gửi</button></div>`;
  document.body.appendChild(btn); document.body.appendChild(box);
  btn.onclick = () => { AS.open = !AS.open; box.classList.toggle('on', AS.open); if (AS.open) { if (!AS.hist.length) asAdd('b', 'Em đây ạ. Anh hỏi số liệu hoặc ra lệnh, ví dụ bấm các gợi ý bên dưới.'); document.getElementById('asIn').focus(); } };
  box.addEventListener('click', (e) => {
    const t = e.target.closest('[data-as]'); if (!t) return;
    if (t.dataset.as === 'close') { AS.open = false; box.classList.remove('on'); }
    else if (t.dataset.as === 'hint') asAsk(t.textContent);
    else if (t.dataset.as === 'send') asAsk(document.getElementById('asIn').value);
  });
  document.getElementById('asIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); asAsk(e.target.value); } });
}
function asAdd(who, text) {
  const log = document.getElementById('asLog'); if (!log) return null;
  const d = document.createElement('div'); d.className = `m ${who}`; d.textContent = text; log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
}
async function asAsk(text) {
  text = String(text || '').trim(); if (!text || AS.busy) return;
  const inp = document.getElementById('asIn'); if (inp) inp.value = '';
  AS.busy = true; AS.hist.push(text); asAdd('u', text);
  const wait = asAdd('b', '…');
  try {
    const r = await call('POST', '/api/assistant/boss', { question: text });
    wait.textContent = r.text;
    if (r.did) { try { S = await call('GET', '/api/state'); render(); } catch { /* bỏ qua */ } }
  } catch (e) { wait.textContent = e.message; }
  AS.busy = false;
}
document.addEventListener('DOMContentLoaded', asMount);
if (document.readyState !== 'loading') asMount();
