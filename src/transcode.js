// Tự chuyển video H.265 (HEVC) sang H.264 để xem được trên mọi trình duyệt (Chrome/Edge trên Windows, Android không phát HEVC → khung đen).
// - Giữ NGUYÊN tên file và ngày sửa → bài/kế hoạch đã gắn file không bị hỏng, thứ tự thư viện không đổi.
// - Bản gốc H.265: file nạp từ Google Drive thì bản gốc vẫn còn trên Drive (không lưu thêm, ổ đĩa máy chủ nhỏ);
//   file tải lên / chép tay thì giữ ở media/.goc-hevc/<thương hiệu>/ (không tự xoá).
// - Mỗi lần 1 video, ưu tiên CPU thấp (máy chủ 1 CPU chạy chung POS), chỉ chạy khi ổ đĩa còn đủ chỗ.
// - Chỉ chạy khi máy chủ thật gọi start() (test tự bật với công cụ giả) — không tự chạy ngầm trong các test khác.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { load, save } = require('./db');
const media = require('./media');

const FFMPEG = () => process.env.FFMPEG_BIN || 'ffmpeg';
const FFPROBE = () => process.env.FFPROBE_BIN || 'ffprobe';
const MB = 1048576;
const DISK_RESERVE = () => (Number(process.env.TRANSCODE_RESERVE_MB) || 300) * MB; // chừa lại cho hệ thống, POS, sao lưu
const key = (brand, name) => `${brand}/${name}`;
const brandIds = () => Object.keys(require('./planner').brands());
const brandName = (id) => (require('./planner').brands()[id] || {}).name || id;
const log = (kind, text, extra = {}) => require('./engine').log(kind, text, { by: 'Hệ thống', rule: 'transcode', ...extra });

// ----- Công cụ ffprobe / ffmpeg (test thay bằng bản giả qua setTools) -----
function run(bin, args, { timeoutMs = 0, low = false } = {}) {
  return new Promise((resolve, reject) => {
    let out = '', err = '';
    let child;
    try { child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); } catch (e) { return reject(e); }
    if (low) { try { os.setPriority(child.pid, 15); } catch { /* không đổi được ưu tiên thì vẫn chạy */ } }
    const t = timeoutMs ? setTimeout(() => { child.kill('SIGKILL'); err += '\nquá thời gian'; }, timeoutMs) : null;
    child.stdout.on('data', (d) => { out += d; if (out.length > 2e6) out = out.slice(-1e6); });
    child.stderr.on('data', (d) => { err += d; if (err.length > 2e5) err = err.slice(-1e5); });
    child.on('error', (e) => { if (t) clearTimeout(t); reject(e); });
    child.on('close', (code) => { if (t) clearTimeout(t); if (code === 0) resolve(out); else reject(Object.assign(new Error((err.trim().split('\n').pop() || `mã lỗi ${code}`).slice(0, 300)), { code })); });
  });
}

const realTools = {
  async probe(file) {
    const j = JSON.parse(await run(FFPROBE(), ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name:format=duration', '-of', 'json', file], { timeoutMs: 60e3 }));
    const st = j.streams || [];
    const v = st.find((s) => s.codec_type === 'video');
    const a = st.find((s) => s.codec_type === 'audio');
    return { video: v ? v.codec_name : null, audio: a ? a.codec_name : null, duration: Number((j.format || {}).duration) || 0 };
  },
  async convert(src, out, info) {
    const mov = path.extname(src).toLowerCase() === '.mov';
    const args = ['-hide_banner', '-nostdin', '-y', '-threads', '1', '-i', src, // 1 luồng giải mã: máy chủ 1 CPU, ít RAM '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-maxrate', '12M', '-bufsize', '24M', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-threads', '1', '-x264-params', 'rc-lookahead=10',
      ...(info.audio === 'aac' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '160k']),
      '-movflags', '+faststart', '-map_metadata', '0', '-f', mov ? 'mov' : 'mp4', out];
    await run(FFMPEG(), args, { low: true, timeoutMs: Math.max(15 * 60e3, (info.duration || 60) * 30e3) });
  },
};
let tools = realTools;
const setTools = (t) => { tools = t ? { ...realTools, ...t } : realTools; };

// ----- Hàng đợi -----
let active = false;
const queue = [];
let worker = null;
const checked = new Map(); // đường dẫn → dấu (dung lượng|giờ sửa) đã xem: không phải HEVC hoặc đã chuyển xong
let toolsMissing = false;
const fpOf = (st) => `${st.size}|${Math.round(st.mtimeMs)}`;
const infoOf = (brand, name) => { const db = load(); db.mediaInfo = db.mediaInfo || {}; return (db.mediaInfo[key(brand, name)] = db.mediaInfo[key(brand, name)] || {}); };

function start() {
  active = true;
  const db = load();
  let dirty = false;
  for (const v of Object.values(db.mediaInfo || {})) if (v && v.transcode && ['running', 'waiting'].includes(v.transcode.status)) { delete v.transcode; dirty = true; }
  if (dirty) save();
  for (const b of brandIds()) {
    let names = [];
    try { names = fs.readdirSync(path.join(media.root(), b)); } catch { continue; }
    for (const n of names) if (n.startsWith('.h264-')) fs.rmSync(path.join(media.root(), b, n), { force: true });
  }
}
function stop() { active = false; }

// Thêm 1 file vào hàng đợi (sau khi tải lên / nạp Drive). Không phải video thì bỏ qua.
function enqueue(brand, name) {
  if (!active || media.kindOf(name) !== 'video') return;
  if (!queue.some((q) => q.brand === brand && q.name === name)) queue.push({ brand, name });
  kick();
}
// Quét cả thư viện: video chưa xem (mới chép tay, mới khôi phục, file đổi nội dung) vào hàng đợi
function sweep() {
  if (!active || toolsMissing) return 0;
  let n = 0;
  for (const b of brandIds()) {
    let files = [];
    try { files = media.list(b); } catch { continue; }
    for (const f of files) {
      if (f.type !== 'video') continue;
      const p = path.join(media.root(), b, f.name);
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (checked.get(p) === fpOf(st)) continue;
      const t = (load().mediaInfo || {})[key(b, f.name)];
      if (t && t.transcode && t.transcode.status === 'failed' && t.transcode.fp === fpOf(st)) continue; // lỗi với đúng file này: chờ Sếp bấm thử lại
      if (!queue.some((q) => q.brand === b && q.name === f.name)) { queue.push({ brand: b, name: f.name }); n++; }
    }
  }
  if (n) kick();
  return n;
}
function kick() {
  if (worker || !queue.length) return worker;
  worker = (async () => {
    try { while (queue.length && active && !toolsMissing) await processOne(queue.shift()); }
    finally { worker = null; }
  })();
  return worker;
}
const idle = async () => { while (worker) await worker; };

function freeBytes(dir) {
  try { const s = fs.statfsSync(dir); return Number(s.bavail) * Number(s.bsize); } catch { return Infinity; }
}
const fromDrive = (brand, name) => Object.values(((load().driveSync || {})[brand] || {}).files || {}).some((f) => f.name === name);

async function processOne({ brand, name }) {
  const dir = path.join(media.root(), brand);
  const src = path.join(dir, name);
  let st; try { st = fs.statSync(src); } catch { return; } // file đã bị xoá/đổi chỗ
  const fp = fpOf(st);
  if (checked.get(src) === fp) return;
  let info;
  try { info = await tools.probe(src); }
  catch (e) {
    if (e.code === 'ENOENT') { // không có ffprobe/ffmpeg trên máy: báo 1 lần rồi thôi
      toolsMissing = true;
      log('error', 'Máy chủ chưa cài ffmpeg nên chưa tự chuyển video H.265 sang H.264 được (cài: apt install ffmpeg)');
      save();
      return;
    }
    checked.set(src, fp); // file không đọc được bằng ffprobe: không phải việc của bộ chuyển mã
    return;
  }
  if (info.video !== 'hevc') { checked.set(src, fp); return; }
  const it = infoOf(brand, name);
  const need = st.size * 2 + DISK_RESERVE();
  if (freeBytes(dir) < need) {
    const msg = `Ổ đĩa máy chủ còn ít chỗ (cần khoảng ${Math.round(need / MB)}MB trống) — chưa chuyển video sang H.264, sẽ thử lại lượt sau`;
    if (!it.transcode || it.transcode.error !== msg) log('error', `"${name}" (${brandName(brand)}): ${msg}`, { brand });
    it.transcode = { status: 'waiting', from: 'hevc', error: msg, at: new Date().toISOString() };
    save();
    return; // không đánh dấu đã xem: lượt quét sau thử lại
  }
  it.transcode = { status: 'running', from: 'hevc', at: new Date().toISOString() };
  save();
  const tmp = path.join(dir, `.h264-${Date.now()}-${name}`);
  const t0 = Date.now();
  try {
    await tools.convert(src, tmp, info);
    const out = await tools.probe(tmp);
    const size = fs.statSync(tmp).size;
    if (out.video !== 'h264') throw new Error(`kết quả không phải H.264 (${out.video || 'không có hình'})`);
    if (!size) throw new Error('file kết quả rỗng');
    if (info.duration && Math.abs(out.duration - info.duration) > Math.max(1.5, info.duration * 0.02)) throw new Error(`thời lượng lệch (${out.duration.toFixed(1)}s so với ${info.duration.toFixed(1)}s)`);
    require('./media-lib').verifySignature(tmp, name);
    // File đổi trong lúc đang chuyển (Sếp ghi đè/chép lại) → bỏ kết quả, lượt sau làm lại với file mới
    const now = fs.statSync(src);
    if (fpOf(now) !== fp) { fs.rmSync(tmp, { force: true }); delete it.transcode; save(); return; }
    let backup = 'drive';
    if (!fromDrive(brand, name)) {
      const bdir = path.join(media.root(), '.goc-hevc', brand);
      fs.mkdirSync(bdir, { recursive: true });
      const ext = path.extname(name);
      let bn = name;
      for (let i = 1; fs.existsSync(path.join(bdir, bn)); i++) bn = `${path.basename(name, ext)}-${i}${ext}`;
      const bp = path.join(bdir, bn);
      try { fs.linkSync(src, bp); } catch { fs.copyFileSync(src, bp); } // liên kết cứng: không tốn thêm chỗ cho tới khi file chính được thay
      backup = path.relative(media.root(), bp).split(path.sep).join('/');
    }
    fs.renameSync(tmp, src); // thay nguyên tử: ai đang đọc file cũ vẫn đọc xong
    try { fs.utimesSync(src, st.atime, st.mtime); } catch { /* giữ ngày cũ không được thì thôi */ }
    checked.set(src, fpOf(fs.statSync(src)));
    it.transcode = { status: 'done', from: 'hevc', at: new Date().toISOString(), before: st.size, after: size, sec: Math.round((Date.now() - t0) / 1000), backup };
    log('media', `Đã chuyển video "${name}" (${brandName(brand)}) từ H.265 sang H.264 để xem được trên mọi trình duyệt (${Math.round(st.size / MB)}MB → ${Math.round(size / MB)}MB, ${it.transcode.sec}s). Bản gốc: ${backup === 'drive' ? 'vẫn còn trên Google Drive' : 'giữ ở media/' + backup}`, { brand });
    save();
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    if (e.code === 'ENOENT' && !fs.existsSync(src)) return;
    if (e.code === 'ENOENT') { toolsMissing = true; log('error', 'Máy chủ chưa cài ffmpeg nên chưa tự chuyển video H.265 sang H.264 được (cài: apt install ffmpeg)'); delete it.transcode; save(); return; }
    it.transcode = { status: 'failed', from: 'hevc', fp, error: e.message.slice(0, 300), at: new Date().toISOString() };
    log('error', `Không chuyển được video "${name}" (${brandName(brand)}) sang H.264: ${e.message.slice(0, 200)} — file gốc vẫn giữ nguyên`, { brand });
    save();
  }
}

// Sếp bấm "Thử lại": xoá dấu lỗi rồi đưa vào hàng đợi
function retry(brand, name) {
  media.resolve(brand, name);
  const it = infoOf(brand, name);
  if (it.transcode && it.transcode.status === 'running') throw Object.assign(new Error('Video đang được chuyển mã'), { status: 409 });
  delete it.transcode;
  checked.delete(path.join(media.root(), brand, name));
  toolsMissing = false;
  save();
  if (!active) throw Object.assign(new Error('Bộ chuyển mã chưa chạy trên máy này'), { status: 409 });
  enqueue(brand, name);
}

const status = () => ({ active, queued: queue.length, running: !!worker, toolsMissing });

module.exports = { start, stop, enqueue, sweep, idle, retry, status, setTools, _reset: () => { queue.length = 0; checked.clear(); toolsMissing = false; } };
