/* Khung chat tư vấn cho website salon. Nhúng vào trang web:
   <script src="https://agent.theonehairsalon.vn/widget/chat.js" data-brand="the_one" defer></script>
   Trợ lý trả lời theo mẫu của salon (giá theo size, ưu đãi, địa chỉ...). Khách muốn đặt lịch thì để lại tên + SĐT, nhân viên gọi lại. */
(function () {
  if (window.__salonChat) return; window.__salonChat = true;
  var s = document.currentScript; var base = (s && s.src ? new URL(s.src).origin : location.origin);
  var brand = (s && s.dataset.brand) || 'the_one';
  var title = (s && s.dataset.title) || 'The One Hair Salon';
  var hist = []; var open = false; var busy = false;
  var css = '.sc-btn{position:fixed;right:18px;bottom:18px;z-index:99998;background:#C46A3A;color:#fff;border:0;border-radius:999px;padding:12px 18px;font:600 15px/1 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer}'
    + '.sc-box{position:fixed;right:18px;bottom:76px;z-index:99999;width:340px;max-width:calc(100vw - 36px);height:480px;max-height:calc(100vh - 110px);background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden;font:14px/1.45 system-ui,sans-serif;color:#222}'
    + '.sc-box.on{display:flex}.sc-hd{background:#171717;color:#fff;padding:12px 14px;font-weight:600;display:flex;justify-content:space-between;align-items:center}.sc-hd small{display:block;font-weight:400;opacity:.75;font-size:12px}'
    + '.sc-x{background:none;border:0;color:#fff;font-size:20px;cursor:pointer}.sc-log{flex:1;overflow:auto;padding:12px;background:#F7F8FA}.sc-m{max-width:85%;margin:6px 0;padding:8px 11px;border-radius:12px;white-space:pre-wrap;word-break:break-word}'
    + '.sc-m.b{background:#fff;border:1px solid #e6e6e6;border-bottom-left-radius:4px}.sc-m.u{background:#C46A3A;color:#fff;margin-left:auto;border-bottom-right-radius:4px}.sc-m a{color:inherit}'
    + '.sc-in{display:flex;gap:6px;padding:10px;border-top:1px solid #eee;background:#fff}.sc-in input{flex:1;border:1px solid #ddd;border-radius:10px;padding:9px 11px;font:inherit}.sc-in button{background:#171717;color:#fff;border:0;border-radius:10px;padding:0 14px;font:inherit;cursor:pointer}'
    + '.sc-lead{background:#fff;border:1px solid #e6e6e6;border-radius:12px;padding:10px;margin:6px 0}.sc-lead input{width:100%;box-sizing:border-box;margin:4px 0;border:1px solid #ddd;border-radius:8px;padding:8px;font:inherit}.sc-lead button{width:100%;background:#C46A3A;color:#fff;border:0;border-radius:8px;padding:9px;font:inherit;cursor:pointer;margin-top:4px}'
    + '@media (max-width:480px){.sc-box{right:8px;left:8px;width:auto;max-width:none;bottom:70px}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  var btn = document.createElement('button'); btn.className = 'sc-btn'; btn.type = 'button'; btn.textContent = '💬 Tư vấn & đặt lịch';
  var box = document.createElement('div'); box.className = 'sc-box';
  box.innerHTML = '<div class="sc-hd"><div>' + esc(title) + '<small>Trợ lý tư vấn · trả lời ngay</small></div><button class="sc-x" type="button" aria-label="Đóng">×</button></div><div class="sc-log"></div><div class="sc-in"><input type="text" placeholder="Nhắn tin, ví dụ: giá nhuộm tóc dài?" maxlength="500"><button type="button">Gửi</button></div>';
  document.body.appendChild(btn); document.body.appendChild(box);
  var log = box.querySelector('.sc-log'), input = box.querySelector('input'), send = box.querySelector('.sc-in button');
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function linkify(t) { return esc(t).replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>'); }
  function add(who, text) { var d = document.createElement('div'); d.className = 'sc-m ' + (who === 'u' ? 'u' : 'b'); d.innerHTML = linkify(text); log.appendChild(d); log.scrollTop = log.scrollHeight; return d; }
  function leadForm(note) {
    var d = document.createElement('div'); d.className = 'sc-lead';
    d.innerHTML = '<div>' + esc(note || 'Để nhân viên chốt lịch cho mình, bạn để lại thông tin nhé:') + '</div><input name="name" placeholder="Tên của bạn"><input name="phone" placeholder="Số điện thoại" inputmode="tel"><input name="note" placeholder="Dịch vụ / giờ mong muốn (không bắt buộc)"><button type="button">Gửi cho salon</button>';
    d.querySelector('button').onclick = function () {
      var name = d.querySelector('[name=name]').value.trim(), phone = d.querySelector('[name=phone]').value.trim(), note2 = d.querySelector('[name=note]').value.trim();
      if (!/^(\+?84|0)\d{8,10}$/.test(phone.replace(/[\s.]/g, ''))) { alert('Bạn kiểm tra lại số điện thoại giúp mình nhé'); return; }
      fetch(base + '/api/assistant/lead', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brand: brand, name: name, phone: phone, note: note2, history: hist.slice(-12), page: location.href }) })
        .then(function (r) { return r.json(); }).then(function () { d.remove(); add('b', 'Dạ em đã nhận thông tin rồi ạ ❤️ Nhân viên bên em sẽ gọi lại cho mình sớm nhất để chốt lịch nha 🥰'); })
        .catch(function () { alert('Gửi chưa được, bạn thử lại hoặc gọi hotline 0398 638 656'); });
    };
    log.appendChild(d); log.scrollTop = log.scrollHeight;
  }
  function ask(text) {
    if (!text || busy) return; busy = true; add('u', text); hist.push({ from: 'customer', text: text }); input.value = '';
    var typing = add('b', '…');
    fetch(base + '/api/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brand: brand, history: hist.slice(-20) }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        typing.remove();
        if (j.error) { add('b', 'Hệ thống đang bận, bạn gọi hotline 0398 638 656 hoặc nhắn Messenger giúp mình nhé.'); return; }
        add('b', j.text); hist.push({ from: 'salon', text: j.text });
        if (j.handoff || j.notify) leadForm(j.handoff ? 'Câu này để nhân viên tư vấn kỹ cho mình nhé. Bạn để lại thông tin, bên mình gọi lại ngay:' : 'Để giữ chỗ và ưu đãi đặt lịch trước, bạn để lại thông tin giúp mình nhé:');
      })
      .catch(function () { typing.remove(); add('b', 'Mạng đang chập chờn, bạn thử lại giúp mình nhé.'); })
      .then(function () { busy = false; });
  }
  btn.onclick = function () { open = !open; box.classList.toggle('on', open); if (open && !hist.length) { ask('xin chào'); } if (open) input.focus(); };
  box.querySelector('.sc-x').onclick = function () { open = false; box.classList.remove('on'); };
  send.onclick = function () { ask(input.value.trim()); };
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); ask(input.value.trim()); } });
})();
