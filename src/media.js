// Thư viện media: ảnh/video Sếp bỏ vào media/<thương hiệu>/ để agent tự lấy ghép bài.
// Hệ thống file là nguồn sự thật; app chỉ đọc, không xóa/sửa file của Sếp. Thư mục ảo và thẻ (tag) chỉ là dữ liệu của app, không động tới file.
const fs = require('node:fs');
const path = require('node:path');
const { load, save } = require('./db');

const IMG = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const VID = new Set(['.mp4', '.mov']);
const LIMIT = { image: 30 * 1024 * 1024, video: 1024 * 1024 * 1024 };
const MAX_IMAGES_PER_POST = 10;

const root = () => path.resolve(process.env.MEDIA_DIR || path.join(__dirname, '..', 'media'));
const kindOf = (name) => {
  const e = path.extname(name).toLowerCase();
  return IMG.has(e) ? 'image' : VID.has(e) ? 'video' : null;
};
const key = (brand, name) => `${brand}/${name}`;

// Tên file an toàn: không có dấu phân cách thư mục, không bắt đầu bằng dấu chấm
function safeName(name) {
  const n = path.basename(String(name || '')).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
  if (!n || n.startsWith('.')) throw new Error('Tên file không hợp lệ');
  if (!kindOf(n)) throw new Error('Chỉ nhận ảnh (jpg, png, webp) và video (mp4, mov)');
  return n;
}

function brandIds() { return Object.keys(require('./planner').brands()); }
function checkBrand(brand) { if (!brandIds().includes(brand)) throw new Error('Thương hiệu không tồn tại'); }
const dirOf = (brand) => path.join(root(), brand);

function ensureDirs() {
  for (const b of brandIds()) fs.mkdirSync(dirOf(b), { recursive: true });
}

// Số lần mỗi file đã/đang được dùng: bài chờ duyệt trong kế hoạch + bài đã lên lịch/đã đăng
function usage() {
  const db = load();
  const m = new Map();
  const bump = (brand, name) => m.set(key(brand, name), (m.get(key(brand, name)) || 0) + 1);
  for (const pl of db.plans) for (const it of pl.items) if (it.status === 'pending') for (const f of it.media || []) bump(pl.brand, f.name);
  for (const p of db.posts) if (['scheduled', 'published', 'awaiting_manual', 'external_scheduled'].includes(p.status)) for (const f of p.media || []) bump(p.brand, f.name);
  return m;
}

// Lần dùng gần nhất/sắp tới của từng file: bài trong lịch (đã đăng, sẽ đăng…) hoặc bài trong kế hoạch chờ duyệt
function lastUses(brand) {
  const db = load();
  const m = new Map();
  const put = (name, u) => { const cur = m.get(name); if (!cur || new Date(u.at) > new Date(cur.at)) m.set(name, u); };
  for (const p of db.posts) if (p.brand === brand && ['scheduled', 'published', 'awaiting_manual', 'external_scheduled', 'pending', 'failed'].includes(p.status)) for (const f of p.media || []) put(f.name, { status: p.status, at: p.scheduledAt, topic: p.topic || '', channel: p.channel, id: p.id });
  for (const pl of db.plans) if (pl.brand === brand) for (const it of pl.items) if (it.status === 'pending') for (const f of it.media || []) put(f.name, { status: 'plan', at: it.at, topic: it.topic || '', channel: pl.channel, id: pl.id });
  return m;
}

function list(brand, { includeArchived = true } = {}) {
  checkBrand(brand);
  let entries = [];
  try { entries = fs.readdirSync(dirOf(brand), { withFileTypes: true }); } catch { return []; }
  const uses = usage();
  const last = lastUses(brand);
  const db = load();
  const notes = db.mediaNotes || {};
  const out = [];
  for (const e of entries) {
    if (!e.isFile() || e.name.startsWith('.')) continue;
    const type = kindOf(e.name);
    if (!type) continue;
    const full = path.join(dirOf(brand), e.name);
    const st = fs.statSync(full);
    const k = key(brand, e.name);
    let info = null;
    if (type === 'video') { try { info = require('./mp4info').info(full); } catch { /* file lạ: bỏ qua thông số */ } }
    const mi = (db.mediaInfo || {})[k] || {};
    if (mi.archived && !includeArchived) continue;
    out.push({ brand, name: e.name, type, size: st.size, mtime: st.mtimeMs, uses: uses.get(k) || 0, note: notes[k] || '', meta: db.mediaMeta[k] || null, consent: !!db.mediaConsent[k], info, folder: mi.folder || '', tags: mi.tags || [], title: mi.title || '', excluded: !!mi.excluded, archived: !!mi.archived, transcode: mi.transcode ? { status: mi.transcode.status, error: mi.transcode.error || '', at: mi.transcode.at, before: mi.transcode.before, after: mi.transcode.after, backup: mi.transcode.backup } : null, lastUse: last.get(e.name) || null });
  }
  // dùng ít nhất trước, cùng số lần thì file cũ hơn trước (xếp hàng theo thứ tự bỏ vào)
  return out.sort((a, b) => a.uses - b.uses || a.mtime - b.mtime || a.name.localeCompare(b.name));
}

// Chọn media cho n bài. Loại ưu tiên theo kiểu nội dung; hết media chưa dùng thì quay vòng file ít dùng nhất.
function assign(brand, planType, n, channel) {
  // File Sếp đã "không cho agent dùng" hoặc đã lưu trữ thì không tự lấy (vẫn gắn tay được)
  // + chỉ lấy file từ đúng thư mục Drive của kênh (thư mục TikTok chỉ cho TikTok...) — xem drive.mediaFilter
  const forChannel = require('./drive').mediaFilter(brand, channel);
  const files = list(brand).filter((f) => !f.excluded && !f.archived && forChannel(f));
  if (!files.length) return Array.from({ length: n }, () => []);
  // Reel, TikTok và YouTube chỉ nhận video
  const want = planType === 'reel' || channel === 'tiktok' || channel === 'youtube' ? ['video'] : ['image', 'video'];
  let pool = files.filter((f) => f.type === want[0]);
  if (!pool.length && want[1]) pool = files.filter((f) => f.type === want[1]);
  if (!pool.length) return Array.from({ length: n }, () => []);
  const local = new Map(pool.map((f) => [f.name, f.uses]));
  const out = [];
  for (let i = 0; i < n; i++) {
    const best = [...pool].sort((a, b) => local.get(a.name) - local.get(b.name) || a.mtime - b.mtime)[0];
    local.set(best.name, local.get(best.name) + 1);
    out.push([{ name: best.name, type: best.type }]);
  }
  return out;
}

// Kiểm tra bộ media gắn vào 1 bài: file có thật, hoặc ≤10 ảnh, hoặc đúng 1 video
function validateSet(brand, names) {
  const files = new Map(list(brand).map((f) => [f.name, f]));
  const set = [];
  for (const nm of names) {
    const f = files.get(nm);
    if (!f) throw new Error(`Không thấy file "${nm}" trong thư viện`);
    set.push({ name: f.name, type: f.type });
  }
  const vids = set.filter((s) => s.type === 'video').length;
  if (vids > 1 || (vids === 1 && set.length > 1)) throw new Error('Mỗi bài chỉ gắn 1 video, hoặc nhiều ảnh — không trộn');
  if (set.length > MAX_IMAGES_PER_POST) throw new Error(`Tối đa ${MAX_IMAGES_PER_POST} ảnh cho 1 bài`);
  return set;
}

// Đường dẫn tuyệt đối của 1 file trong thư viện (chặn ../)
function resolve(brand, name) {
  checkBrand(brand);
  const n = safeName(name);
  const p = path.join(dirOf(brand), n);
  if (path.dirname(p) !== dirOf(brand)) throw new Error('Đường dẫn không hợp lệ');
  if (!fs.existsSync(p)) throw new Error(`Không thấy file "${n}"`);
  return p;
}

// Chuẩn bị chỗ ghi 1 file upload; trả về { dest, tmp, limit }. Nơi gọi ghi vào tmp rồi gọi commitUpload.
function prepareUpload(brand, rawName) {
  checkBrand(brand);
  const name = safeName(rawName);
  fs.mkdirSync(dirOf(brand), { recursive: true });
  let final = name;
  // không ghi đè file đang có
  for (let i = 1; fs.existsSync(path.join(dirOf(brand), final)); i++) {
    const e = path.extname(name);
    final = `${path.basename(name, e)}-${i}${e}`;
  }
  return { name: final, dest: path.join(dirOf(brand), final), tmp: path.join(dirOf(brand), `.upload-${Date.now()}-${final}`), limit: LIMIT[kindOf(name)] };
}

function setNote(brand, name, note) {
  checkBrand(brand);
  const db = load();
  db.mediaNotes = db.mediaNotes || {};
  const t = String(note || '').trim().slice(0, 300);
  if (t) db.mediaNotes[key(brand, name)] = t; else delete db.mediaNotes[key(brand, name)];
  save();
}

// Gợi ý nội dung file cho AI: ghi chú của Sếp, không có thì lấy từ tên file
function hint(brand, f) {
  const db = load();
  const note = (db.mediaNotes || {})[key(brand, f.name)];
  const meta = (db.mediaMeta || {})[key(brand, f.name)];
  const fromName = path.basename(f.name, path.extname(f.name)).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return note || (meta && meta.summary) || fromName;
}

// Sếp xác nhận người trong file đã đồng ý đăng công khai (dùng cho cảnh báo quyền hình ảnh)
function setConsent(brand, name, value) {
  checkBrand(brand);
  resolve(brand, name);
  const db = load();
  if (value) db.mediaConsent[key(brand, name)] = true; else delete db.mediaConsent[key(brand, name)];
  save();
}

// Thông tin từng file gắn vào 1 bài, đưa cho bộ kiểm tra tuân thủ. File đã xóa/thiếu thì trả thông tin tối thiểu.
function facts(brand, set) {
  const db = load();
  return (set || []).map((m) => {
    const k = key(brand, m.name);
    let info = null;
    if (m.type === 'video') { try { info = require('./mp4info').info(resolve(brand, m.name)); } catch { /* thiếu file */ } }
    return { name: m.name, type: m.type, info, meta: db.mediaMeta[k] || null, consent: !!db.mediaConsent[k], note: (db.mediaNotes || {})[k] || '' };
  });
}

// Tóm tắt cho giao diện (không đọc ghi chú/uses chi tiết)
function summary() {
  const out = {};
  for (const b of brandIds()) {
    try { out[b] = list(b).map((f) => ({ name: f.name, type: f.type, uses: f.uses })); } catch { out[b] = []; }
  }
  return out;
}

module.exports = { root, ensureDirs, list, assign, validateSet, resolve, prepareUpload, setNote, setConsent, facts, hint, summary, safeName, kindOf, LIMIT, MAX_IMAGES_PER_POST };
