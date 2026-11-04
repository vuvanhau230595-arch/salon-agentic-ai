// Thư viện Media (phần quản lý): kiểm tra file thật sự đúng định dạng (đọc "chữ ký" đầu file, không tin đuôi file), kích thước ảnh,
// thư mục ảo + thẻ (tag), lịch sử sử dụng, thao tác hàng loạt. KHÔNG xoá/sửa/đổi tên file thật — chỉ ghi dữ liệu của app (db).
const fs = require('node:fs');
const { load, save } = require('./db');
const media = require('./media');
const engine = require('./engine');
const trash = require('./media-trash');

const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
const key = (brand, name) => `${brand}/${name}`;
const MAX_FOLDERS = 40, MAX_TAGS_PER_FILE = 10, MAX_BATCH = 200;

// ----- Chữ ký file -----
function readHead(file, n = 64) {
  const fd = fs.openSync(file, 'r');
  try { const b = Buffer.alloc(n); const r = fs.readSync(fd, b, 0, n, 0); return b.subarray(0, r); } finally { fs.closeSync(fd); }
}
// Trả về loại thật của file theo nội dung: 'jpeg' | 'png' | 'webp' | 'mp4' | null
function sniff(head) {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (head.length >= 12 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (head.length >= 12 && head.toString('latin1', 4, 8) === 'ftyp') return 'mp4';
  return null;
}
const EXT_KIND = { '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.webp': 'webp', '.mp4': 'mp4', '.mov': 'mp4' };
// Ném lỗi nếu nội dung file không khớp đuôi (ví dụ file .exe đổi tên thành .jpg)
function verifySignature(file, name) {
  const ext = require('node:path').extname(name).toLowerCase();
  const want = EXT_KIND[ext];
  const got = sniff(readHead(file));
  if (!want) throw bad('Chỉ nhận ảnh (jpg, png, webp) và video (mp4, mov)');
  if (got !== want) throw bad(`File "${name}" không đúng định dạng: đuôi ${ext} nhưng nội dung ${got ? 'là ' + got.toUpperCase() : 'không phải ảnh/video hợp lệ'}`);
}

// ----- Kích thước ảnh (chỉ đọc đầu file) -----
function imageSize(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const buf = Buffer.alloc(Math.min(size, 256 * 1024));
      fs.readSync(fd, buf, 0, buf.length, 0);
      const k = sniff(buf);
      if (k === 'png' && buf.length >= 24) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
      if (k === 'webp') {
        const t = buf.toString('latin1', 12, 16);
        if (t === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
        if (t === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
        if (t === 'VP8L') { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
      }
      if (k === 'jpeg') {
        let i = 2;
        while (i + 9 < buf.length) {
          if (buf[i] !== 0xff) { i++; continue; }
          const m = buf[i + 1];
          if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
          i += 2 + buf.readUInt16BE(i + 2);
        }
      }
    } finally { fs.closeSync(fd); }
  } catch { /* file lạ: không có kích thước */ }
  return null;
}

// ----- Thẻ / thư mục -----
function normTag(t) {
  const v = String(t || '').trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 30);
  return v;
}
function normFolder(n) {
  const v = String(n ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (/[\\/:*?"<>|]/.test(v)) throw bad('Tên thư mục không được chứa \\ / : * ? " < > |');
  return v;
}
const info = (brand, name) => { const db = load(); db.mediaInfo = db.mediaInfo || {}; return (db.mediaInfo[key(brand, name)] = db.mediaInfo[key(brand, name)] || {}); };
const folderList = (brand) => { const db = load(); db.mediaFolders = db.mediaFolders || {}; return (db.mediaFolders[brand] = db.mediaFolders[brand] || []); };
function existing(brand, names) {
  const have = new Set(media.list(brand).map((f) => f.name));
  const out = [...new Set((Array.isArray(names) ? names : []).map(String))];
  if (!out.length) throw bad('Chọn ít nhất 1 file');
  if (out.length > MAX_BATCH) throw bad(`Tối đa ${MAX_BATCH} file mỗi lần`);
  const miss = out.find((n) => !have.has(n));
  if (miss) throw bad(`Không thấy file "${miss}" trong thư viện`, 404);
  return out;
}
const checkBrand = (brand) => { try { media.list(brand); } catch (e) { throw bad(e.message, 404); } };
const log = (text, extra) => engine.log('media', text, { by: 'Sếp', ...extra });

function createFolder(brand, name) {
  checkBrand(brand);
  const n = normFolder(name);
  if (!n) throw bad('Tên thư mục không được để trống');
  const list = folderList(brand);
  if (list.some((x) => x.toLowerCase() === n.toLowerCase())) throw bad('Thư mục này đã có');
  if (list.length >= MAX_FOLDERS) throw bad(`Tối đa ${MAX_FOLDERS} thư mục`);
  list.push(n);
  log(`Sếp tạo thư mục "${n}" trong thư viện ${brand}`, { brand });
  save();
  return n;
}
function renameFolder(brand, from, to) {
  checkBrand(brand);
  const list = folderList(brand), n = normFolder(to);
  const i = list.indexOf(from);
  if (i < 0) throw bad('Không thấy thư mục', 404);
  if (!n) throw bad('Tên thư mục không được để trống');
  if (list.some((x, j) => j !== i && x.toLowerCase() === n.toLowerCase())) throw bad('Đã có thư mục tên này');
  list[i] = n;
  const db = load();
  for (const [k, v] of Object.entries(db.mediaInfo || {})) if (k.startsWith(brand + '/') && v.folder === from) v.folder = n;
  log(`Sếp đổi tên thư mục "${from}" → "${n}" (${brand})`, { brand, field: 'folder', before: from, after: n });
  save();
}
// Xoá thư mục = chỉ bỏ nhãn thư mục; file vẫn còn nguyên, về "Chưa phân loại"
function deleteFolder(brand, name) {
  checkBrand(brand);
  const list = folderList(brand), i = list.indexOf(name);
  if (i < 0) throw bad('Không thấy thư mục', 404);
  list.splice(i, 1);
  let moved = 0;
  const db = load();
  for (const [k, v] of Object.entries(db.mediaInfo || {})) if (k.startsWith(brand + '/') && v.folder === name) { delete v.folder; moved++; }
  log(`Sếp xoá thư mục "${name}" (${brand}); ${moved} file về "Chưa phân loại" — file không bị xoá`, { brand });
  save();
  return moved;
}

// Thao tác hàng loạt: chuyển thư mục, thêm/bớt thẻ
function organize(brand, { names, folder, addTags, removeTags, excluded, archived, title }) {
  checkBrand(brand);
  const files = existing(brand, names);
  const flags = excluded !== undefined || archived !== undefined || title !== undefined;
  if (folder === undefined && !(addTags && addTags.length) && !(removeTags && removeTags.length) && !flags) throw bad('Không có thay đổi nào');
  if (title !== undefined && files.length !== 1) throw bad('Tên hiển thị chỉ đặt cho 1 file mỗi lần');
  let f = null;
  if (folder !== undefined && folder !== null && folder !== '') {
    f = normFolder(folder);
    if (!folderList(brand).includes(f)) throw bad('Thư mục chưa tồn tại — tạo thư mục trước', 404);
  }
  const add = [...new Set((addTags || []).map(normTag).filter(Boolean))], rem = new Set((removeTags || []).map(normTag).filter(Boolean));
  for (const n of files) {
    const it = info(brand, n);
    if (folder !== undefined) { if (f) it.folder = f; else delete it.folder; }
    if (add.length || rem.size) {
      const tags = [...new Set([...(it.tags || []).filter((t) => !rem.has(t)), ...add])];
      if (tags.length > MAX_TAGS_PER_FILE) throw bad(`Mỗi file tối đa ${MAX_TAGS_PER_FILE} thẻ ("${n}")`);
      if (tags.length) it.tags = tags; else delete it.tags;
    }
    // Cờ: không cho agent tự lấy (vẫn gắn tay được) / lưu trữ (ẩn khỏi thư viện, file thật vẫn còn) / tên hiển thị
    if (excluded !== undefined) { if (excluded) it.excluded = true; else delete it.excluded; }
    if (archived !== undefined) { if (archived) it.archived = true; else delete it.archived; }
    if (title !== undefined) { const t = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 80); if (t) it.title = t; else delete it.title; }
  }
  const what = [folder !== undefined ? `thư mục → ${f || 'Chưa phân loại'}` : '', add.length ? `thêm thẻ ${add.join(', ')}` : '', rem.size ? `bớt thẻ ${[...rem].join(', ')}` : '',
    excluded !== undefined ? (excluded ? 'không cho agent dùng' : 'cho agent dùng lại') : '', archived !== undefined ? (archived ? 'lưu trữ' : 'bỏ lưu trữ') : '', title !== undefined ? `tên hiển thị "${String(title || '').trim().slice(0, 40)}"` : ''].filter(Boolean).join('; ');
  log(`Sếp sắp xếp ${files.length} file (${brand}): ${what}`, { brand, field: 'media', after: what });
  save();
  return files.length;
}

// Lịch sử sử dụng 1 file: các bài (nháp/lịch/đã đăng...) và bài trong kế hoạch tháng đã dùng file này
function usageDetail(brand, name) {
  checkBrand(brand);
  media.resolve(brand, name);
  const db = load();
  const posts = db.posts.filter((p) => p.brand === brand && (p.media || []).some((m) => m.name === name))
    .map((p) => ({ kind: 'post', id: p.id, topic: p.topic || p.text.slice(0, 50), channel: p.channel, status: p.status, at: p.scheduledAt }))
    .sort((a, b) => new Date(b.at) - new Date(a.at));
  const plans = [];
  for (const pl of db.plans) if (pl.brand === brand) for (const it of pl.items) if ((it.media || []).some((m) => m.name === name) && it.status === 'pending') plans.push({ kind: 'plan', id: pl.id, topic: it.topic, channel: pl.channel, status: 'pending', at: it.at });
  return [...posts, ...plans];
}

// Toàn bộ thư viện 1 thương hiệu cho giao diện: file + thư mục (đếm) + thẻ (đếm) + tổng
const dimCache = new Map();
// Quảng cáo của từng file: quảng cáo thử đang chạy/đã xong (tiền + tin nhắn 7 ngày) và kế hoạch "Lên bài & chạy QC" còn chờ/lỗi
function adsByFile(brand) {
  const db = load();
  const out = new Map();
  const camp = new Map((db.campaigns || []).map((c) => [c.id, c]));
  const get = (name) => { if (!out.has(name)) out.set(name, { running: 0, done: 0, waiting: 0, error: 0, spend: 0, msgs: 0, lastError: '' }); return out.get(name); };
  const byPost = new Map();
  for (const t of db.adTests || []) if (t.brand === brand) (byPost.get(t.postId) || byPost.set(t.postId, []).get(t.postId)).push(t);
  for (const p of db.posts) {
    if (p.brand !== brand || !(p.media || []).length) continue;
    const tests = byPost.get(p.id) || [];
    if (!tests.length && !p.adPlan) continue;
    for (const m of p.media) {
      const a = get(m.name);
      for (const t of tests) {
        if (t.status === 'running') a.running++; else a.done++;
        const c = camp.get(t.campaignId);
        // "7 ngày" của Meta (last_7d) không gồm hôm nay → cộng thêm hôm nay, quảng cáo mới tạo không bị hiện 0đ
        a.spend += c ? c.d7.spend + ((c.today && c.today.spend) || 0) : (t.spend || 0);
        a.msgs += c ? c.d7.msgs + ((c.today && c.today.msgs) || 0) : (t.msgs || 0);
      }
      if (p.adPlan && ['waiting', 'creating'].includes(p.adPlan.status) && p.status !== 'rejected') a.waiting++;
      if (p.adPlan && p.adPlan.status === 'error') { a.error++; a.lastError = p.adPlan.error || ''; }
    }
  }
  return out;
}

function library(brand) {
  checkBrand(brand);
  const ads = adsByFile(brand);
  const files = media.list(brand).map((f) => {
    let dims = null;
    if (f.type === 'image') {
      const ck = `${brand}/${f.name}|${f.mtime}|${f.size}`;
      if (!dimCache.has(ck)) dimCache.set(ck, imageSize(media.resolve(brand, f.name)));
      dims = dimCache.get(ck);
    }
    return { ...f, dims, ads: ads.get(f.name) || null };
  });
  const folders = folderList(brand).map((n) => ({ name: n, count: files.filter((f) => f.folder === n).length }));
  const tags = {};
  for (const f of files) for (const t of f.tags) tags[t] = (tags[t] || 0) + 1;
  return {
    root: media.root(), files, folders, unassigned: files.filter((f) => !f.folder).length,
    tags: Object.entries(tags).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    totals: {
      files: files.length, images: files.filter((f) => f.type === 'image').length, videos: files.filter((f) => f.type === 'video').length, bytes: files.reduce((s, f) => s + f.size, 0),
      unused: files.filter((f) => !f.uses && !f.excluded && !f.archived).length, excluded: files.filter((f) => f.excluded).length, archived: files.filter((f) => f.archived).length,
      scheduled: files.filter((f) => f.lastUse && ['scheduled', 'plan', 'pending', 'awaiting_manual', 'external_scheduled'].includes(f.lastUse.status)).length,
      needConsent: files.filter((f) => f.meta && f.meta.faces && !f.consent).length,
    },
    limits: { image: media.LIMIT.image, video: media.LIMIT.video },
    trash: trash.summary(brand),
  };
}

async function handleApi(req, res, url, { readBody, send }) {
  const p = url.pathname;
  if (!p.startsWith('/api/media-lib')) return false;
  try {
    const q = url.searchParams;
    if (req.method === 'GET' && p === '/api/media-lib') return send(res, 200, library(q.get('brand'))), true;
    if (req.method === 'GET' && p === '/api/media-lib/usage') return send(res, 200, { usage: usageDetail(q.get('brand'), q.get('name')) }), true;
    if (req.method === 'POST' && p === '/api/media-lib/folders') {
      const b = await readBody(req);
      if (b.action === 'create') createFolder(b.brand, b.name);
      else if (b.action === 'rename') renameFolder(b.brand, b.name, b.to);
      else if (b.action === 'delete') deleteFolder(b.brand, b.name);
      else throw bad('action phải là create, rename hoặc delete');
      return send(res, 200, library(b.brand)), true;
    }
    if (req.method === 'GET' && p === '/api/media-lib/trash') return send(res, 200, { items: trash.list(q.get('brand')), days: trash.TRASH_DAYS }), true;
    if (req.method === 'POST' && p === '/api/media-lib/trash') {
      const b = await readBody(req);
      const moved = trash.toTrash(b.brand, b.names, { force: !!b.force });
      return send(res, 200, { moved, ...library(b.brand) }), true;
    }
    if (req.method === 'POST' && p === '/api/media-lib/restore') {
      const b = await readBody(req);
      const restored = trash.restore(b.brand, b.ids);
      return send(res, 200, { restored, ...library(b.brand) }), true;
    }
    if (req.method === 'POST' && p === '/api/media-lib/purge') {
      const b = await readBody(req);
      const gone = trash.purge(b.brand, b.ids === 'all' || b.ids === 'old' ? b.ids : b.ids);
      return send(res, 200, { gone, items: trash.list(b.brand) }), true;
    }
    if (req.method === 'POST' && p === '/api/media-lib/transcode') {
      const b = await readBody(req);
      checkBrand(b.brand);
      require('./transcode').retry(b.brand, String(b.name || ''));
      return send(res, 200, library(b.brand)), true;
    }
    if (req.method === 'POST' && p === '/api/media-lib/organize') {
      const b = await readBody(req);
      organize(b.brand, b);
      return send(res, 200, library(b.brand)), true;
    }
  } catch (e) { send(res, e.status || (/Thương hiệu không tồn tại|Không thấy file/.test(e.message) ? 404 : 400), { error: e.message }); return true; }
  return false;
}

module.exports = { verifySignature, sniff, imageSize, createFolder, renameFolder, deleteFolder, organize, usageDetail, library, normTag, handleApi };
