// Thùng rác của Thư viện Media: "xoá" = chuyển file sang media/.trash/<thương hiệu>/ (khôi phục được).
// Chỉ "Xoá hẳn" (quyền quản trị dữ liệu) hoặc dọn tự động sau TRASH_DAYS ngày mới thực sự xoá file khỏi máy chủ.
const fs = require('node:fs');
const path = require('node:path');
const { load, save } = require('./db');
const media = require('./media');
const engine = require('./engine');

const TRASH_DAYS = 30;
const MAX_BATCH = 200;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const key = (brand, name) => `${brand}/${name}`;
const trashDir = (brand) => path.join(media.root(), '.trash', brand);
const checkBrand = (brand) => { try { media.list(brand); } catch (e) { throw bad(e.message, 404); } };
const log = (text, extra) => engine.log('media', text, { by: 'Sếp', ...extra });
const rows = () => { const db = load(); db.mediaTrash = Array.isArray(db.mediaTrash) ? db.mediaTrash : []; return db.mediaTrash; };
const fileOf = (t) => path.join(trashDir(t.brand), `${t.id}__${t.name}`);

// Danh sách file trong thùng rác của 1 thương hiệu (mới xoá trước), kèm số ngày còn lại trước khi dọn tự động
function list(brand) {
  checkBrand(brand);
  const now = Date.now();
  return rows().filter((t) => t.brand === brand).map((t) => ({ ...t, exists: fs.existsSync(fileOf(t)), daysLeft: Math.max(0, TRASH_DAYS - Math.floor((now - new Date(t.at)) / 864e5)) }))
    .sort((a, b) => new Date(b.at) - new Date(a.at));
}

// Chuyển file vào thùng rác. File đang gắn vào bài sắp đăng/chờ duyệt thì phải force (giao diện hỏi lại).
function toTrash(brand, names, { force = false } = {}) {
  checkBrand(brand);
  const want = [...new Set((Array.isArray(names) ? names : []).map(String))];
  if (!want.length) throw bad('Chọn ít nhất 1 file');
  if (want.length > MAX_BATCH) throw bad(`Tối đa ${MAX_BATCH} file mỗi lần`);
  const lib = new Map(media.list(brand).map((f) => [f.name, f]));
  const miss = want.find((n) => !lib.has(n));
  if (miss) throw bad(`Không thấy file "${miss}" trong thư viện`, 404);
  const inUse = want.filter((n) => lib.get(n).uses > 0);
  if (inUse.length && !force) throw bad(`${inUse.length} file đang gắn vào bài sắp đăng hoặc chờ duyệt (${inUse.slice(0, 3).join(', ')}${inUse.length > 3 ? '…' : ''}) — bài đó sẽ thiếu file. Gỡ khỏi bài trước, hoặc xác nhận xoá luôn.`, 409);
  fs.mkdirSync(trashDir(brand), { recursive: true });
  const db = load();
  const trash = rows();
  const moved = [];
  for (const n of want) {
    const src = media.resolve(brand, n);
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    fs.renameSync(src, path.join(trashDir(brand), `${id}__${n}`));
    const f = lib.get(n), k = key(brand, n);
    trash.push({ id, brand, name: n, type: f.type, size: f.size, at: new Date().toISOString(), uses: f.uses, info: (db.mediaInfo || {})[k] || null, note: (db.mediaNotes || {})[k] || '', meta: db.mediaMeta[k] || null, consent: !!db.mediaConsent[k] });
    if (db.mediaInfo) delete db.mediaInfo[k];
    if (db.mediaNotes) delete db.mediaNotes[k];
    delete db.mediaMeta[k];
    delete db.mediaConsent[k];
    moved.push(n);
  }
  log(`Sếp xoá ${moved.length} file vào thùng rác (${brand}): ${moved.slice(0, 5).join(', ')}${moved.length > 5 ? '…' : ''}${inUse.length ? ` — ${inUse.length} file đang gắn vào bài` : ''}`, { brand, field: 'media', after: `thùng rác (+${moved.length}), tự dọn sau ${TRASH_DAYS} ngày` });
  save();
  return moved;
}

// Khôi phục: chuyển file về thư viện, trả lại thẻ/thư mục/ghi chú. Trùng tên với file đang có thì thêm hậu tố.
function restore(brand, ids) {
  checkBrand(brand);
  const want = [...new Set((Array.isArray(ids) ? ids : []).map(String))];
  if (!want.length) throw bad('Chọn ít nhất 1 file');
  const db = load();
  const trash = rows();
  const out = [];
  for (const id of want) {
    const i = trash.findIndex((t) => t.id === id && t.brand === brand);
    if (i < 0) throw bad('File không còn trong thùng rác', 404);
    const t = trash[i];
    const src = fileOf(t);
    if (!fs.existsSync(src)) { trash.splice(i, 1); throw bad(`File "${t.name}" không còn trên máy chủ (đã bị dọn)`, 404); }
    const dir = path.join(media.root(), brand);
    fs.mkdirSync(dir, { recursive: true });
    let name = t.name;
    const ext = path.extname(name);
    for (let n = 1; fs.existsSync(path.join(dir, name)); n++) name = `${path.basename(t.name, ext)}-khoiphuc-${n}${ext}`;
    fs.renameSync(src, path.join(dir, name));
    const k = key(brand, name);
    if (t.info) { db.mediaInfo = db.mediaInfo || {}; db.mediaInfo[k] = t.info; }
    if (t.note) { db.mediaNotes = db.mediaNotes || {}; db.mediaNotes[k] = t.note; }
    if (t.meta) db.mediaMeta[k] = t.meta;
    if (t.consent) db.mediaConsent[k] = true;
    trash.splice(i, 1);
    out.push(name);
  }
  log(`Sếp khôi phục ${out.length} file từ thùng rác (${brand}): ${out.slice(0, 5).join(', ')}`, { brand, field: 'media', after: 'khôi phục' });
  save();
  return out;
}

// Xoá hẳn khỏi máy chủ: ids cụ thể, 'all' (cả thùng rác của thương hiệu) hoặc 'old' (quá hạn TRASH_DAYS). Không khôi phục được.
function purge(brand, ids, { by = 'Sếp' } = {}) {
  checkBrand(brand);
  const trash = rows();
  const now = Date.now();
  let pick;
  if (ids === 'all') pick = trash.filter((t) => t.brand === brand);
  else if (ids === 'old') pick = trash.filter((t) => t.brand === brand && now - new Date(t.at) >= TRASH_DAYS * 864e5);
  else {
    const want = new Set((Array.isArray(ids) ? ids : []).map(String));
    if (!want.size) throw bad('Chọn ít nhất 1 file');
    pick = trash.filter((t) => t.brand === brand && want.has(t.id));
    if (pick.length !== want.size) throw bad('Có file không còn trong thùng rác', 404);
  }
  const gone = [];
  for (const t of pick) {
    try { fs.rmSync(fileOf(t), { force: true }); } catch (e) { throw bad(`Không xoá được "${t.name}": ${e.message}`, 500); }
    trash.splice(trash.indexOf(t), 1);
    gone.push(t.name);
  }
  if (gone.length) {
    engine.log('media', `${by === 'Sếp' ? 'Sếp xoá hẳn' : 'Tự dọn thùng rác'} ${gone.length} file (${brand}): ${gone.slice(0, 5).join(', ')}${gone.length > 5 ? '…' : ''}`, { by, brand, field: 'media', after: 'xoá hẳn khỏi máy chủ' });
    save();
  }
  return gone;
}

// Dọn tự động: file nằm trong thùng rác quá TRASH_DAYS ngày. Gọi mỗi lượt quét của engine; lỗi không làm hỏng lượt quét.
function purgeOld() {
  let n = 0;
  try {
    for (const b of [...new Set(rows().map((t) => t.brand))]) { try { n += purge(b, 'old', { by: 'agent' }).length; } catch { /* thương hiệu đã xoá: bỏ qua */ } }
  } catch { /* db hỏng: không dọn */ }
  return n;
}

function summary(brand) { const l = list(brand); return { count: l.length, bytes: l.reduce((s, t) => s + (t.size || 0), 0), days: TRASH_DAYS }; }

module.exports = { list, toTrash, restore, purge, purgeOld, summary, TRASH_DAYS };
