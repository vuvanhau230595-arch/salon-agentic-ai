# Video ít cảnh sạch (phụ đề Trung gần hết video) nhưng quay 60-120fps: lấy hết cảnh sạch,
# mở bằng tóc thành phẩm, làm chậm đều (slow-motion thật, không lặp khung) cho đủ ≥15 giây.
# Dùng: python -I edit_slow.py <video> <ocr.json> <nhạc.mp3> <giây bắt đầu nhạc> <file ra> [độ dài đích]
import sys, json, subprocess

vid, ocrf, music, mstart, out = sys.argv[1:6]
want = float(sys.argv[6]) if len(sys.argv) > 6 else 15.5
mstart = float(mstart)
o = json.load(open(ocrf, encoding='utf-8'))
dur, S = o['dur'], o['samples']
p = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate',
                    '-of', 'csv=p=0', vid], capture_output=True, text=True)
a, b = p.stdout.strip().split('/')
fps = float(a) / float(b)

def bad(s):
    return sum(x['n'] for x in s['boxes']) >= 2
badt = [s['t'] for s in S if bad(s)]
step = 1 / 3
clean, cur = [], None
for s in S:
    if not any(abs(s['t'] - t) <= 0.55 for t in badt):
        cur = [max(0, s['t'] - step / 2), s['t'] + step / 2] if cur is None else [cur[0], s['t'] + step / 2]
    else:
        if cur: clean.append(cur)
        cur = None
if cur: clean.append(cur)
clean = [[x + (0.15 if x > 0 else 0), min(dur, y) - (0.15 if y < dur - 0.2 else 0)] for x, y in clean]
clean = [c for c in clean if c[1] - c[0] >= 0.8]
tot = sum(y - x for x, y in clean)
maxslow = min(3.0, max(1.12, fps / 30))  # không chậm quá số khung thật có; 30fps chỉ cho chậm nhẹ 1.12x
hook_len = min(1.0, clean[-1][1] - clean[-1][0]) if clean else 0
if not clean or (tot + hook_len) * maxslow < 15:
    print('BO', round(tot, 1), 'fps', fps)
    sys.exit(2)
la, lb = clean[-1]
hook = [max(la, lb - 2.4), max(la, lb - 2.4) + hook_len]
segs = [hook] + clean
length0 = sum(y - x for x, y in segs)
slow = max(1.0, min(maxslow, want / length0))
length = length0 * slow

parts = []
for i, (x, y) in enumerate(segs):
    parts.append(f'[0:v]trim={x:.3f}:{y:.3f},setpts={slow:.4f}*(PTS-STARTPTS),'
                 f'scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,fps=30,setsar=1[v{i}]')
n = len(segs)
fc = ';'.join(parts) + ';' + ''.join(f'[v{i}]' for i in range(n)) + \
     f'concat=n={n}:v=1:a=0,eq=contrast=1.05:saturation=1.08:brightness=0.01,unsharp=5:5:0.4[v];' \
     f'[1:a]atrim={mstart:.2f}:{mstart + length:.2f},asetpts=PTS-STARTPTS,afade=t=in:d=0.4,' \
     f'afade=t=out:st={max(0, length - 1.2):.2f}:d=1.2,loudnorm=I=-14:TP=-1.5[a]'
cmd = ['ffmpeg', '-v', 'error', '-y', '-i', vid, '-i', music, '-filter_complex', fc, '-map', '[v]', '-map', '[a]',
       '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
       '-movflags', '+faststart', '-t', f'{length:.3f}', out]
r = subprocess.run(cmd, capture_output=True, text=True, errors='ignore')
if r.returncode:
    print('LOI', r.stderr[-400:]); sys.exit(1)
print('OK', round(length, 1), 'canh', n, f'cham {slow:.2f}x', 'sach', round(tot, 1))
