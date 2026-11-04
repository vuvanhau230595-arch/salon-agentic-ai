// Đường API của trợ lý ảo.
//  Công khai (không cần đăng nhập, cho widget trên website salon): POST /api/assistant/chat, POST /api/assistant/lead, GET /widget/chat.js.
//    Chỉ trả lời bằng mẫu câu cố định (không gọi AI, không tốn tiền), giới hạn số lần gọi theo IP, chỉ cho web của salon nhúng (CORS).
//  Cần đăng nhập: POST /api/assistant/boss (trợ lý cho Sếp), POST /api/assistant/test (thử trợ lý tư vấn trong app).
const fs = require('node:fs');
const path = require('node:path');
const { load, save, uid } = require('./db');
const assistant = require('./assistant');

const WIDGET = path.join(__dirname, '..', 'public', 'widget-chat.js');
const PUBLIC_PATHS = new Set(['/api/assistant/chat', '/api/assistant/lead', '/widget/chat.js']);
const isPublic = (p) => PUBLIC_PATHS.has(p);

// Website nào được nhúng widget: tên miền của salon (và localhost để thử). Thêm bằng ASSISTANT_ORIGINS="https://a.vn,https://b.vn".
function allowedOrigin(origin) {
  if (!origin) return '';
  const extra = String(process.env.ASSISTANT_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  let host;
  try { host = new URL(origin).hostname; } catch { return ''; }
  const ok = /(^|\.)theonehairsalon\.vn$/.test(host) || /(^|\.)darkhair\.vn$/.test(host) || host === 'localhost' || host === '127.0.0.1' || extra.includes(origin);
  return ok ? origin : '';
}

// Giới hạn: mỗi IP 30 lượt / phút (đủ cho người thật, chặn quét phá)
const hits = new Map();
function limited(ip, max = 30) {
  const now = Date.now();
  const h = hits.get(ip) || { n: 0, since: now };
  if (now - h.since > 60e3) { h.n = 0; h.since = now; }
  h.n++;
  hits.set(ip, h);
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v.since > 60e3) hits.delete(k);
  return h.n > max;
}

const readJson = (req) => new Promise((resolve, reject) => {
  let s = '';
  req.on('data', (d) => { s += d; if (s.length > 64e3) req.destroy(); });
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
  req.on('error', reject);
});
const cleanHistory = (h) => (Array.isArray(h) ? h : []).slice(-20).map((x) => ({ from: x && x.from === 'salon' ? 'salon' : 'customer', text: String((x && x.text) || '').slice(0, 500) })).filter((x) => x.text.trim());

function sendJson(res, code, body, origin) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (origin) { headers['access-control-allow-origin'] = origin; headers.vary = 'Origin'; }
  res.writeHead(code, headers);
  res.end(JSON.stringify(body));
}

// Trả về true nếu đã xử lý
async function handlePublic(req, res, url, clientIp) {
  const p = url.pathname;
  if (!isPublic(p)) return false;
  const origin = allowedOrigin(req.headers.origin);
  if (p === '/widget/chat.js') {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return true; }
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=600', 'access-control-allow-origin': '*' });
    if (req.method === 'HEAD') { res.end(); return true; }
    fs.createReadStream(WIDGET).pipe(res);
    return true;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(origin ? 204 : 403, origin ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600', vary: 'Origin' } : {});
    res.end();
    return true;
  }
  if (req.method !== 'POST') { sendJson(res, 405, { error: 'Chỉ nhận POST' }, origin); return true; }
  if (req.headers.origin && !origin) { sendJson(res, 403, { error: 'Trang web này chưa được phép dùng trợ lý' }, ''); return true; }
  if (limited(clientIp)) { sendJson(res, 429, { error: 'Bạn thao tác hơi nhanh, chờ một chút rồi thử lại nhé' }, origin); return true; }
  let b;
  try { b = await readJson(req); } catch { sendJson(res, 400, { error: 'Dữ liệu không hợp lệ' }, origin); return true; }
  const planner = require('./planner');
  const brands = planner.brands();
  const brand = brands[b.brand] ? brands[b.brand] : brands.the_one;
  if (p === '/api/assistant/chat') {
    const history = cleanHistory(b.history);
    const r = assistant.converse(history, { brand });
    if (!r) { sendJson(res, 400, { error: 'Chưa có tin nhắn của khách' }, origin); return true; }
    sendJson(res, 200, { text: r.text, intent: r.intent.label, handoff: r.handoff, notify: r.notify, lang: r.lang }, origin);
    return true;
  }
  // /api/assistant/lead — khách để lại tên + SĐT
  const phone = String(b.phone || '').replace(/[\s.-]/g, '').slice(0, 15);
  if (!/^(\+?84|0)\d{8,10}$/.test(phone)) { sendJson(res, 400, { error: 'Số điện thoại chưa đúng' }, origin); return true; }
  const name = String(b.name || 'Khách').trim().slice(0, 60) || 'Khách';
  const note = String(b.note || '').trim().slice(0, 300);
  const db = load();
  const recent = db.leads.find((l) => l.phone === phone && Date.now() - new Date(l.at).getTime() < 3600e3);
  if (recent) { sendJson(res, 200, { ok: true, dup: true }, origin); return true; } // cùng SĐT trong 1 giờ: không tạo trùng
  const lead = { id: uid('ld'), at: new Date().toISOString(), brand: brand.id, name, phone, note, page: String(b.page || '').slice(0, 200), history: cleanHistory(b.history).slice(-8) };
  db.leads.unshift(lead);
  db.leads.length = Math.min(db.leads.length, 200);
  db.approvals.unshift({
    id: uid('p'), type: 'lead', key: lead.id, status: 'pending', at: lead.at,
    title: `${name} để lại SĐT trên website (${brand.name})${note ? `: "${note.slice(0, 60)}"` : ''}`,
    detail: `SĐT: ${phone}${note ? `\nMong muốn: ${note}` : ''}${lead.history.length ? `\nKhách đã hỏi: ${lead.history.filter((h) => h.from === 'customer').map((h) => `"${h.text.slice(0, 80)}"`).join(' · ')}` : ''}\nBấm Duyệt sau khi đã gọi/nhắn cho khách.`,
    payload: { brand: brand.id, leadId: lead.id, name, phone, note },
  });
  require('./engine').log('propose', `Khách ${name} để lại SĐT trên website (${brand.name}) — nhân viên gọi lại`, { rule: 'assistant', brand: brand.id });
  save();
  sendJson(res, 200, { ok: true }, origin);
  return true;
}

// Đã đăng nhập. Trả về true nếu đã xử lý.
async function handleApi(req, res, url, { readBody, send }) {
  const p = url.pathname;
  if (!p.startsWith('/api/assistant/')) return false;
  if (req.method !== 'POST') { send(res, 405, { error: 'Chỉ nhận POST' }); return true; }
  const b = await readBody(req);
  if (p === '/api/assistant/boss') {
    try { send(res, 200, await assistant.boss(String(b.question || ''), req.user)); }
    catch (e) { send(res, 400, { error: e.message }); }
    return true;
  }
  if (p === '/api/assistant/test') {
    const brands = require('./planner').brands();
    const r = assistant.converse(cleanHistory(b.history), { brand: brands[b.brand] || brands.the_one });
    send(res, 200, r ? { text: r.text, intent: r.intent.label, auto: r.auto, handoff: r.handoff, notify: r.notify, reason: r.reason, flags: r.flags, state: r.state } : { error: 'Chưa có tin của khách' });
    return true;
  }
  send(res, 404, { error: 'Không tìm thấy' });
  return true;
}

// Cài đặt trợ lý nhắn tin (POST /api/settings { assistant: {...} })
function applySettings(b, d) {
  if (!b.assistant || typeof b.assistant !== 'object') return;
  const a = d.settings.assistant;
  if (b.assistant.on !== undefined) a.on = !!b.assistant.on;
  if (b.assistant.auto !== undefined) a.auto = !!b.assistant.auto;
  if (b.assistant.brands && typeof b.assistant.brands === 'object') for (const [k, v] of Object.entries(b.assistant.brands)) if (k in a.brands) a.brands[k] = !!v;
}

module.exports = { isPublic, handlePublic, handleApi, applySettings, allowedOrigin, limited, cleanHistory };
