// "Mắt" cho agent: nhờ Gemini xem ảnh/video trong Thư viện Media và ghi lại nội dung
// (loại dịch vụ, có before/after không, màu tóc, có bao nhiêu người hiện mặt, watermark, lời nói).
// Claude không xem được video nên agent dùng kết quả này để viết bài đúng với file và để kiểm tra tuân thủ.
// Cần GEMINI_API_KEY trong .env. Gói miễn phí giới hạn số lần/ngày: hết hạn mức thì dừng và báo rõ.
const fs = require('node:fs');
const path = require('node:path');
const { load, save } = require('./db');
const media = require('./media');

const BASE = 'https://generativelanguage.googleapis.com';
const INLINE_MAX = 15 * 1024 * 1024;
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mov': 'video/quicktime' };
const KINDS = ['nhuom', 'cat', 'uon', 'phuc_hoi', 'tong_hop', 'khac'];

const enabled = () => !!process.env.GEMINI_API_KEY;
const model = () => process.env.GEMINI_MODEL || 'gemini-flash-latest';

const PROMPT = `Bạn xem một {LOAI} của salon tóc. Trả về JSON thuần (không giải thích) với các trường:
{"summary":"1-2 câu tiếng Việt mô tả nội dung, không bịa chi tiết không thấy",
"kind":"nhuom|cat|uon|phuc_hoi|tong_hop|khac",
"beforeAfter":true/false (có cảnh TRƯỚC khi làm tóc không),
"colorBefore":"màu tóc trước hoặc rỗng","colorAfter":"màu tóc sau hoặc rỗng",
"faces":số người nhìn rõ mặt,
"watermark":"chữ/logo cố định trên hình (tên nền tảng khác như TikTok/Douyin nếu có), rỗng nếu không",
"speech":"lời nói chính (tóm tắt) hoặc rỗng","hasMusic":true/false,
"concerns":["điểm có thể gây vấn đề khi đăng: trang phục hở, chữ thô tục, số điện thoại/mã QR trên hình, nhiều người hiện mặt..."]}`;

async function gfetch(url, init = {}) {
  const r = await fetch(url, { ...init, headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, ...(init.headers || {}) } });
  return r;
}

function friendly(status, body) {
  const msg = (body && body.error && body.error.message) || '';
  if (status === 429) return 'Gemini báo hết hạn mức (gói miễn phí giới hạn số lần mỗi ngày) — thử lại sau hoặc nâng gói';
  if (status === 503) return 'Gemini đang quá tải — thử lại sau ít phút';
  if (status === 400 && /API key/i.test(msg)) return 'GEMINI_API_KEY không hợp lệ';
  if (status === 401 || status === 403) return 'Gemini từ chối khóa API (kiểm tra GEMINI_API_KEY và quyền)';
  return `Gemini lỗi ${status}: ${msg.slice(0, 160)}`;
}

async function uploadFile(file, mime) {
  const size = fs.statSync(file).size;
  const start = await gfetch(`${BASE}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(size), 'X-Goog-Upload-Header-Content-Type': mime, 'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: path.basename(file) } }),
  });
  if (!start.ok) throw new Error(friendly(start.status, await start.json().catch(() => ({}))));
  const url = start.headers.get('x-goog-upload-url');
  if (!url) throw new Error('Gemini không trả địa chỉ tải lên');
  const up = await fetch(url, { method: 'POST', headers: { 'Content-Length': String(size), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' }, body: await fs.openAsBlob(file) });
  let info = (await up.json()).file;
  for (let i = 0; info && info.state === 'PROCESSING' && i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    info = await (await gfetch(`${BASE}/v1beta/${info.name}`)).json();
  }
  if (!info || info.state !== 'ACTIVE') throw new Error('Gemini xử lý file không thành công');
  return { file_data: { mime_type: mime, file_uri: info.uri } };
}

async function filePart(file) {
  const mime = MIME[path.extname(file).toLowerCase()];
  if (fs.statSync(file).size > INLINE_MAX) return uploadFile(file, mime);
  return { inline_data: { mime_type: mime, data: fs.readFileSync(file).toString('base64') } };
}

const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
function clean(j) {
  return {
    summary: str(j.summary, 300),
    kind: KINDS.includes(j.kind) ? j.kind : 'khac',
    beforeAfter: !!j.beforeAfter,
    colorBefore: str(j.colorBefore, 60),
    colorAfter: str(j.colorAfter, 60),
    faces: Math.max(0, Math.min(50, Math.round(Number(j.faces) || 0))),
    watermark: str(j.watermark, 80),
    speech: str(j.speech, 200),
    hasMusic: !!j.hasMusic,
    concerns: (Array.isArray(j.concerns) ? j.concerns : []).map((c) => str(c, 120)).filter(Boolean).slice(0, 6),
  };
}

// Phân tích 1 file, lưu vào db.mediaMeta
async function analyze(brand, name) {
  if (!enabled()) throw new Error('Chưa có GEMINI_API_KEY trong .env — thêm khóa Gemini để agent xem được ảnh/video');
  const file = media.resolve(brand, name);
  const kind = media.kindOf(name);
  const part = await filePart(file);
  const r = await gfetch(`${BASE}/v1beta/models/${model()}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [part, { text: PROMPT.replace('{LOAI}', kind === 'video' ? 'video' : 'ảnh') }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(friendly(r.status, body));
  const raw = ((((body.candidates || [])[0] || {}).content || {}).parts || []).map((p) => p.text || '').join('');
  let j;
  try { j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); }
  catch { throw new Error('Gemini trả kết quả không đọc được — thử lại'); }
  const meta = { ...clean(j), at: new Date().toISOString(), model: model() };
  const db = load();
  db.mediaMeta[`${brand}/${name}`] = meta;
  save();
  return meta;
}

// Phân tích mọi file chưa có kết quả; gặp hết hạn mức/quá tải thì dừng ngay, không thử tiếp
async function analyzeMissing(brand, limit = 20) {
  const todo = media.list(brand).filter((f) => !f.meta).slice(0, limit);
  const out = { done: 0, failed: [], stopped: '' };
  for (const f of todo) {
    try { await analyze(brand, f.name); out.done++; }
    catch (e) {
      out.failed.push(`${f.name}: ${e.message}`);
      if (/hạn mức|quá tải|khóa API|GEMINI_API_KEY/.test(e.message)) { out.stopped = e.message; break; }
    }
  }
  return out;
}

module.exports = { enabled, analyze, analyzeMissing, clean };
