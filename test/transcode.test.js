// Tự chuyển video H.265 → H.264: dùng ffmpeg THẬT nếu máy có (tạo clip H.265 ngắn), cộng các tình huống lỗi bằng công cụ giả.
// Kiểm tra: giữ tên + ngày sửa, giữ bản gốc (trừ file nạp từ Drive), không đụng video H.264, lỗi không làm hỏng file gốc,
// không thử lại vô hạn, ổ đĩa đầy thì chờ, thiếu ffmpeg báo 1 lần, tải lên tự chuyển, phân quyền.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-transcode-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
process.env.MEDIA_DIR = path.join(tmp, 'media');
delete process.env.APP_PASSWORD;
delete process.env.META_ACCESS_TOKEN;
delete process.env.TRANSCODE_RESERVE_MB;

const { load } = require('../src/db');
const media = require('../src/media');
const tc = require('../src/transcode');
const authz = require('../src/authz');
const { server } = require('../src/server');

const HAVE_FFMPEG = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout?.includes('libx265') && spawnSync('ffprobe', ['-version']).status === 0;
const dir = (b) => path.join(process.env.MEDIA_DIR, b);
const codec = (f) => spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout.trim();
function clip(file, vcodec) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=180x320:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '2',
    '-c:v', vcodec, ...(vcodec === 'libx265' ? ['-tag:v', 'hvc1', '-x265-params', 'log-level=error'] : []), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file]);
  if (r.status !== 0) throw new Error('không tạo được clip thử: ' + r.stderr);
}
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom', 'latin1'), Buffer.alloc(16)]);
const tinfo = (b, n) => ((load().mediaInfo || {})[`${b}/${n}`] || {}).transcode;
let base;
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });

test('khởi động', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  media.ensureDirs();
  load().settings.paused = true;
});
test.after(() => { tc.stop(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('chưa start(): không chạy ngầm (các test khác và máy dev không bị chuyển mã bất ngờ)', async () => {
  fs.writeFileSync(path.join(dir('the_one'), 'x.mp4'), MP4);
  tc.enqueue('the_one', 'x.mp4');
  assert.strictEqual(tc.sweep(), 0);
  assert.deepStrictEqual(tc.status(), { active: false, queued: 0, running: false, toolsMissing: false });
  fs.rmSync(path.join(dir('the_one'), 'x.mp4'));
});

test('ffmpeg thật: H.265 → H.264 giữ tên + ngày sửa, giữ bản gốc ở .goc-hevc; video H.264 không bị đụng', { skip: !HAVE_FFMPEG && 'máy không có ffmpeg/libx265' }, async () => {
  const hevc = path.join(dir('the_one'), 'khach lan hevc.mp4');
  const avc = path.join(dir('the_one'), 'da-h264.mp4');
  clip(hevc, 'libx265');
  clip(avc, 'libx264');
  assert.strictEqual(codec(hevc), 'hevc');
  const old = new Date('2026-10-10T08:00:00Z');
  fs.utimesSync(hevc, old, old);
  const avcBefore = fs.statSync(avc);
  const hevcSize = fs.statSync(hevc).size;
  load().actions = [];
  tc.start();
  assert.ok(tc.sweep() >= 2);
  await tc.idle();
  assert.strictEqual(codec(hevc), 'h264', 'đã thành H.264');
  assert.strictEqual(Math.round(fs.statSync(hevc).mtimeMs / 1000), Math.round(old.getTime() / 1000), 'giữ ngày sửa cũ (thứ tự thư viện không đổi)');
  const bk = path.join(process.env.MEDIA_DIR, '.goc-hevc', 'the_one', 'khach lan hevc.mp4');
  assert.ok(fs.existsSync(bk), 'bản gốc giữ lại');
  assert.strictEqual(codec(bk), 'hevc');
  assert.strictEqual(fs.statSync(bk).size, hevcSize);
  const t = tinfo('the_one', 'khach lan hevc.mp4');
  assert.strictEqual(t.status, 'done');
  assert.strictEqual(t.backup, '.goc-hevc/the_one/khach lan hevc.mp4');
  assert.strictEqual(t.before, hevcSize);
  const a = fs.statSync(avc);
  assert.strictEqual(a.size, avcBefore.size); assert.strictEqual(a.mtimeMs, avcBefore.mtimeMs);
  assert.strictEqual(tinfo('the_one', 'da-h264.mp4'), undefined, 'H.264 không có dấu chuyển mã');
  assert.ok(load().actions.some((x) => x.kind === 'media' && /từ H\.265 sang H\.264.*giữ ở media\/\.goc-hevc/.test(x.text)));
  assert.ok(!fs.readdirSync(dir('the_one')).some((n) => n.startsWith('.h264-')), 'không để file tạm');
  // thư viện vẫn thấy đúng 1 file tên cũ (bản gốc ẩn, không hiện thêm)
  const lib = media.list('the_one').filter((f) => f.name.includes('hevc'));
  assert.deepStrictEqual(lib.map((f) => f.name), ['khach lan hevc.mp4']);
  assert.strictEqual(lib[0].transcode.status, 'done');
  // quét lại: không làm gì thêm
  assert.strictEqual(tc.sweep(), 0);
});

test('ffmpeg thật: file nạp từ Google Drive không lưu bản gốc (bản gốc còn trên Drive); .mov giữ đuôi .mov', { skip: !HAVE_FFMPEG && 'máy không có ffmpeg/libx265' }, async () => {
  const f = path.join(dir('dark_hair'), 'tu-drive.mov');
  clip(f, 'libx265');
  load().driveSync = { dark_hair: { folders: [], on: false, files: { abc: { name: 'tu-drive.mov', md5: 'x', at: '' } } } };
  tc.enqueue('dark_hair', 'tu-drive.mov');
  await tc.idle();
  assert.strictEqual(codec(f), 'h264');
  assert.strictEqual(tinfo('dark_hair', 'tu-drive.mov').backup, 'drive');
  assert.ok(!fs.existsSync(path.join(process.env.MEDIA_DIR, '.goc-hevc', 'dark_hair', 'tu-drive.mov')));
  assert.doesNotThrow(() => require('../src/media-lib').verifySignature(f, 'tu-drive.mov'));
});

test('ffmpeg thật: tải lên video H.265 qua /api/media/upload → tự chuyển ở nền', { skip: !HAVE_FFMPEG && 'máy không có ffmpeg/libx265' }, async () => {
  const src = path.join(tmp, 'up.mp4');
  clip(src, 'libx265');
  const r = await fetch(`${base}/api/media/upload?brand=mishang&name=${encodeURIComponent('tai len.mp4')}`, { method: 'POST', body: fs.readFileSync(src) });
  assert.strictEqual(r.status, 200);
  await tc.idle();
  assert.strictEqual(codec(path.join(dir('mishang'), 'tai len.mp4')), 'h264');
  assert.ok(fs.existsSync(path.join(process.env.MEDIA_DIR, '.goc-hevc', 'mishang', 'tai len.mp4')));
});

test('lỗi chuyển mã: file gốc giữ nguyên, không file tạm, không thử lại vô hạn; bấm Thử lại thì chạy lại', async () => {
  tc._reset();
  const name = 'loi.mp4', p = path.join(dir('the_one'), name);
  fs.writeFileSync(p, MP4);
  let converts = 0;
  tc.setTools({
    probe: async (f) => (path.basename(f) === name ? { video: 'hevc', audio: 'aac', duration: 2 } : { video: 'h264', audio: 'aac', duration: 2 }), // chỉ file thử là H.265
    convert: async (_s, out) => { converts++; fs.writeFileSync(out, 'dở dang'); throw new Error('Conversion failed!'); },
  });
  tc.start();
  load().actions = [];
  tc.enqueue('the_one', name);
  await tc.idle();
  assert.strictEqual(converts, 1);
  assert.deepStrictEqual(fs.readFileSync(p), MP4, 'file gốc không đổi');
  assert.ok(!fs.readdirSync(dir('the_one')).some((n) => n.startsWith('.h264-')));
  const t = tinfo('the_one', name);
  assert.strictEqual(t.status, 'failed');
  assert.match(t.error, /Conversion failed/);
  assert.strictEqual(load().actions.filter((a) => a.kind === 'error' && /Không chuyển được video "loi\.mp4"/.test(a.text)).length, 1);
  tc.sweep(); await tc.idle();
  assert.strictEqual(converts, 1, 'quét lại không thử lại file lỗi khi file chưa đổi');
  assert.strictEqual(media.list('the_one').find((f) => f.name === name).transcode.status, 'failed');
  // Thử lại qua API với công cụ chạy được
  tc.setTools({
    probe: async (f) => (path.basename(f).startsWith('.h264-') ? { video: 'h264', audio: 'aac', duration: 2 } : (fs.readFileSync(f).includes('H264OK') ? { video: 'h264', audio: 'aac', duration: 2 } : { video: 'hevc', audio: 'aac', duration: 2 })),
    convert: async (_s, out) => { converts++; fs.writeFileSync(out, Buffer.concat([MP4, Buffer.from('H264OK')])); },
  });
  const r = await post('/api/media-lib/transcode', { brand: 'the_one', name });
  assert.strictEqual(r.status, 200);
  await tc.idle();
  assert.strictEqual(converts, 2);
  assert.ok(fs.readFileSync(p).includes('H264OK'));
  assert.strictEqual(tinfo('the_one', name).status, 'done');
  assert.strictEqual((await post('/api/media-lib/transcode', { brand: 'the_one', name: 'khong-co.mp4' })).status, 404);
  // kết quả không phải H.264 / thời lượng lệch → lỗi, giữ gốc
  const n2 = 'lech.mp4', p2 = path.join(dir('the_one'), n2);
  fs.writeFileSync(p2, MP4);
  tc.setTools({ probe: async (f) => (path.basename(f).startsWith('.h264-') ? { video: 'h264', audio: 'aac', duration: 1 } : { video: 'hevc', audio: 'aac', duration: 30 }), convert: async (_s, out) => fs.writeFileSync(out, MP4) });
  tc.enqueue('the_one', n2); await tc.idle();
  assert.match(tinfo('the_one', n2).error, /thời lượng lệch/);
  assert.deepStrictEqual(fs.readFileSync(p2), MP4);
});

test('ổ đĩa thiếu chỗ: chờ, báo 1 lần, không đánh dấu đã xem (lượt sau thử lại)', async () => {
  tc._reset();
  let converts = 0;
  tc.setTools({ probe: async () => ({ video: 'hevc', audio: 'aac', duration: 2 }), convert: async () => { converts++; } });
  process.env.TRANSCODE_RESERVE_MB = String(1e9);
  fs.writeFileSync(path.join(dir('mishang'), 'day.mp4'), MP4);
  load().actions = [];
  tc.enqueue('mishang', 'day.mp4'); await tc.idle();
  tc.enqueue('mishang', 'day.mp4'); await tc.idle();
  assert.strictEqual(converts, 0);
  assert.strictEqual(tinfo('mishang', 'day.mp4').status, 'waiting');
  assert.strictEqual(load().actions.filter((a) => a.kind === 'error' && /Ổ đĩa máy chủ còn ít chỗ/.test(a.text)).length, 1, 'báo 1 lần');
  delete process.env.TRANSCODE_RESERVE_MB;
});

test('máy không có ffmpeg: báo 1 lần rồi dừng, không lặp mỗi lượt quét', async () => {
  tc._reset();
  tc.setTools({ probe: async () => { throw Object.assign(new Error('spawn ffprobe ENOENT'), { code: 'ENOENT' }); } });
  load().actions = [];
  tc.sweep(); await tc.idle();
  tc.sweep(); await tc.idle();
  assert.strictEqual(tc.status().toolsMissing, true);
  assert.strictEqual(load().actions.filter((a) => /chưa cài ffmpeg/.test(a.text)).length, 1);
  tc.setTools(null); tc._reset();
});

test('phân quyền: thử lại chuyển mã = content_write theo thương hiệu', () => {
  assert.deepStrictEqual(authz.classify('POST', '/api/media-lib/transcode', { brand: 'the_one', name: 'a.mp4' }), { perm: 'content_write', brands: ['the_one'] });
  assert.strictEqual(authz.check({ role: 'viewer', brands: [], name: 'V' }, 'POST', '/api/media-lib/transcode', { brand: 'the_one' }).status, 403);
});
