// Chuẩn bị ảnh cho Instagram: Instagram chỉ nhận JPG, tỉ lệ khung từ 4:5 (dọc) tới 1.91:1 (ngang), tối đa 8MB.
// Ảnh PNG/WebP (ảnh AI thường là PNG) hoặc khung ngoài khoảng đó (vd. 3:4) được đổi bằng ffmpeg thành 1 bản JPG
// riêng trong data/ig-cache/<thương hiệu>/ — file gốc trong thư viện giữ nguyên.
//  - Chất lượng: JPG mức cao (q 2 ≈ 95%), giữ đủ màu (4:4:4), không thu nhỏ ảnh; nền trong suốt → nền trắng.
//  - Khung dọc hơn 4:5: cắt bớt chiều cao, cắt 1/4 phía trên + 3/4 phía dưới (giữ phần đầu/tóc).
//  - Khung ngang hơn 1.91:1: cắt bớt 2 bên đều nhau.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const MIN_RATIO = 0.8;
const MAX_RATIO = 1.91;
const MAX_BYTES = 8 * 1024 * 1024;
const JPEG = new Set(['.jpg', '.jpeg']);
const KEEP_DAYS = 3;

const bin = (name) => process.env[name === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH'] || name;
const cacheRoot = () => path.join(path.dirname(process.env.DB_FILE || path.join(__dirname, '..', 'data', 'db.json')), 'ig-cache');
const cacheDir = (brand) => path.join(cacheRoot(), brand);

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(bin(cmd), args, { timeout: 60e3, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && err.code === 'ENOENT') return reject(new Error('Máy chủ chưa cài ffmpeg nên chưa đổi được ảnh sang JPG cho Instagram (apt-get install -y ffmpeg)'));
      if (err) return reject(new Error(`Không đổi được ảnh sang JPG: ${String(stderr || err.message).trim().split('\n').pop().slice(0, 200)}`));
      resolve(String(stdout));
    });
  });
}

async function size(file) {
  const out = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file]);
  const m = /(\d+)x(\d+)/.exec(out);
  if (!m) throw new Error('Không đọc được kích thước ảnh');
  return { w: Number(m[1]), h: Number(m[2]) };
}

// Vùng cắt để khung nằm trong khoảng Instagram nhận (null = không cần cắt)
function cropFor(w, h) {
  const r = w / h;
  const even = (n) => Math.max(2, Math.floor(n / 2) * 2);
  if (r < MIN_RATIO) {
    const ch = Math.min(h, even(w / MIN_RATIO));
    return { w, h: ch, x: 0, y: Math.round((h - ch) / 4) };
  }
  if (r > MAX_RATIO) {
    const cw = Math.min(w, even(h * MAX_RATIO));
    return { w: cw, h, x: Math.round((w - cw) / 2), y: 0 };
  }
  return null;
}

function cleanOld(dir) {
  const cutoff = Date.now() - KEEP_DAYS * 864e5;
  for (const f of fs.readdirSync(dir)) {
    try { if (fs.statSync(path.join(dir, f)).mtimeMs < cutoff) fs.rmSync(path.join(dir, f), { force: true }); } catch { /* bỏ qua */ }
  }
}

// Trả về null nếu ảnh dùng nguyên được; ngược lại tạo (hoặc dùng lại) bản JPG và trả về { name, path, cropped }.
async function prepare(brand, file) {
  const { w, h } = await size(file);
  const crop = cropFor(w, h);
  if (JPEG.has(path.extname(file).toLowerCase()) && !crop && fs.statSync(file).size <= MAX_BYTES) return null;
  const st = fs.statSync(file);
  const id = crypto.createHash('sha1').update(`${path.basename(file)}|${st.size}|${st.mtimeMs}|v1`).digest('hex').slice(0, 16);
  const dir = cacheDir(brand);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${id}.jpg`;
  const out = path.join(dir, name);
  if (fs.existsSync(out)) { fs.utimesSync(out, new Date(), new Date()); return { name, path: out, cropped: !!crop }; }
  cleanOld(dir);
  const cw = crop ? crop.w : w;
  const ch = crop ? crop.h : h;
  const cut = crop ? `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},` : '';
  // Nền trắng dưới ảnh (ảnh PNG trong suốt không bị đen), rồi xuất JPG chất lượng cao
  const graph = `color=c=white:s=${cw}x${ch}[bg];[0:v]${cut}format=rgba[fg];[bg][fg]overlay=shortest=1,format=yuvj444p`;
  const tmp = `${out}.tmp.jpg`;
  for (const q of ['2', '4', '6']) {
    await run('ffmpeg', ['-v', 'error', '-y', '-i', file, '-filter_complex', graph, '-frames:v', '1', '-c:v', 'mjpeg', '-q:v', q, tmp]);
    if (fs.statSync(tmp).size <= MAX_BYTES) break;
  }
  if (fs.statSync(tmp).size > MAX_BYTES) { fs.rmSync(tmp, { force: true }); throw new Error('Ảnh quá lớn, đổi sang JPG vẫn hơn 8MB — giảm kích thước ảnh'); }
  fs.renameSync(tmp, out);
  return { name, path: out, cropped: !!crop };
}

// Đường dẫn bản JPG đã đổi (cho link công khai); tên phải đúng dạng mã băm, không đi ra ngoài thư mục
function resolveCached(brand, name) {
  if (!/^[a-z0-9_]+$/.test(String(brand)) || !/^[0-9a-f]{16}\.jpg$/.test(String(name))) throw new Error('Không tìm thấy');
  const p = path.join(cacheDir(brand), name);
  if (!fs.existsSync(p)) throw new Error('Không tìm thấy');
  return p;
}

module.exports = { prepare, resolveCached, cropFor, MIN_RATIO, MAX_RATIO };
