# Dựng lại 1 video tóc: bỏ cảnh có chữ Trung (hoặc cắt dải chữ), mở bằng tóc thành phẩm,
# cắt theo nhịp nhạc, chỉnh màu nhẹ, ghép nhạc CapCut.
# Dùng: python -I edit.py <video> <ocr.json> <nhạc.mp3> <bpm> <giây bắt đầu nhạc> <file ra>
import sys, json, subprocess, re

vid, ocrf, music, bpm, mstart, out = sys.argv[1:7]
bpm, mstart = float(bpm), float(mstart)
o = json.load(open(ocrf, encoding='utf-8'))
dur, W, H = o['dur'], o['w'], o['h']
S = o['samples']

def bad(s):
    return sum(b['n'] for b in s['boxes'] if b['n'] >= 1) >= 2

# 1) Chữ chỉ nằm ở dải trên/dưới thì cắt dải đó (phóng to) thay vì bỏ cảnh
boxes = [b for s in S if bad(s) for b in s['boxes']]
top = max([b['y1'] for b in boxes if b['y1'] <= 0.3] or [0])
bot = min([b['y0'] for b in boxes if b['y0'] >= 0.7] or [1])
mid = [b for b in boxes if b['y1'] > 0.3 and b['y0'] < 0.7]
crop = None
nocrop = len(sys.argv) > 7 and sys.argv[7] == 'nocrop'
blur = None  # 'blur': giữ nguyên khung, làm mờ dải phụ đề (không phóng)
if boxes and len(sys.argv) > 7 and sys.argv[7] == 'blur':
    blur = (max(0, min(b['y0'] for b in boxes) - 0.012), min(1, max(b['y1'] for b in boxes) + 0.012))
    S = [dict(s, boxes=[]) for s in S]
    nocrop = True
if boxes and not mid and (top + (1 - bot)) <= 0.32 and not nocrop:
    crop = (top + 0.01 if top else 0, bot - 0.01 if bot < 1 else 1)
    S = [dict(s, boxes=[]) for s in S]

# 2) Các khoảng sạch (không chữ)
step = 1 / 3
badt = [s['t'] for s in S if bad(s) or (s['boxes'] and any(abs(s['t'] - u['t']) < 0.7 and bad(u) for u in S))]
def dirty(s):  # cách chỗ có chữ dưới 0.55 giây cũng coi là bẩn (phụ đề hiện từng chữ)
    return any(abs(s['t'] - t) <= 0.55 for t in badt)
clean = []
cur = None
for s in S:
    if not dirty(s):
        if cur is None:
            cur = [max(0, s['t'] - step / 2), s['t'] + step / 2]
        else:
            cur[1] = s['t'] + step / 2
    else:
        if cur:
            clean.append(cur)
        cur = None
if cur:
    clean.append(cur)
clean = [[a + (0.15 if a > 0 else 0), min(dur, b) - (0.15 if b < dur - 0.2 else 0)] for a, b in clean]
clean = [c for c in clean if c[1] - c[0] >= 0.8]
total_clean = sum(b - a for a, b in clean)
if total_clean < 9:
    print('BO', round(total_clean, 1))
    sys.exit(2)

# 3) Điểm chuyển cảnh
r = subprocess.run(['ffmpeg', '-v', 'info', '-i', vid, '-an', '-vf', 'scale=270:-2,select=gt(scene\\,0.28),showinfo',
                    '-f', 'null', '-'], capture_output=True, text=True, errors='ignore')
cuts = [float(m) for m in re.findall(r'pts_time:([\d.]+)', r.stderr)]

shots = []
for a, b in clean:
    pts = [a] + [c for c in cuts if a + 0.4 < c < b - 0.4] + [b]
    for i in range(len(pts) - 1):
        if pts[i + 1] - pts[i] >= 0.6:
            shots.append([pts[i], pts[i + 1]])

beat = 60 / bpm
def fit(L):  # độ dài cảnh = bội số nhịp, 1.0–2.6 giây
    k = max(1, int(min(L, 2.6) / beat))
    while k * beat > 2.6:
        k -= 1
    while k * beat < 1.0 and (k + 1) * beat <= L:
        k += 1
    return k * beat

# 4) Kết cấu: hook 1 nhịp-ish tóc thành phẩm → quá trình → reveal cuối
la, lb = clean[-1]
rev_len = min(lb - la, max(5.0, 8 * beat))
reveal = [lb - rev_len, lb]
hook = [max(la, lb - 2.6), max(la, lb - 2.6) + min(1.2, lb - la)]
body_pool = []
for a, b in shots:
    if b <= reveal[0] + 0.05:
        L = fit(b - a)
        if b - a >= L:
            m = a + (b - a - L) / 2
            body_pool.append([m, m + L])
    elif a < reveal[0] - 1.0:
        L = fit(reveal[0] - a)
        if reveal[0] - a >= L:
            body_pool.append([reveal[0] - L, reveal[0]])
target_body = 22 - rev_len - (hook[1] - hook[0])
body, acc = [], 0
if body_pool:
    tot = sum(b - a for a, b in body_pool)
    if tot <= target_body:
        body = body_pool
    else:  # lấy đều theo thời gian
        n = len(body_pool)
        avg = tot / n
        k = max(1, int(target_body / avg))
        idx = sorted({round(i * (n - 1) / max(1, k - 1)) for i in range(k)})
        body = [body_pool[i] for i in idx]
segs = [hook] + body + [reveal]
length = sum(b - a for a, b in segs)
if length < 15:  # kéo dài reveal nếu thiếu (TikTok cần ≥15s)
    extra = 15 - length
    reveal[0] = max(la, reveal[0] - extra)
    segs[-1] = reveal
    length = sum(b - a for a, b in segs)
slow = 1.0
if length < 15:  # vẫn thiếu: làm chậm cảnh khoe tóc cuối (tối đa 2 lần)
    rl = segs[-1][1] - segs[-1][0]
    slow = min(2.0, (15 - (length - rl)) / rl)
    length = length - rl + rl * slow
    if length < 13:
        print('BO', round(length, 1))
        sys.exit(2)

# 5) Render
vf_crop = ''
if crop:
    y0, y1 = crop
    hh = y1 - y0
    vf_crop = f'crop=iw*{hh:.4f}:ih*{hh:.4f}:iw*{(1 - hh) / 2:.4f}:ih*{y0:.4f},'
parts, inputs = [], []
hh = (crop[1] - crop[0]) if crop else 1.0
zoom = max(1080 / (W * hh), 1920 / (H * hh))
pre = 'hqdn3d=1.5:1.5:3:3,' if zoom > 1.3 else ''
sharp = 'unsharp=7:7:1.0:5:5:0.0' if zoom > 1.3 else ('unsharp=5:5:0.7' if zoom > 1.05 else 'unsharp=5:5:0.4')
for i, (a, b) in enumerate(segs):
    sp = f'setpts={slow:.3f}*(PTS-STARTPTS)' if i == len(segs) - 1 and slow > 1 else 'setpts=PTS-STARTPTS'
    parts.append(f'[0:v]trim={a:.3f}:{b:.3f},{sp},{vf_crop}'
                 f'{pre}scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,fps=30,setsar=1[v{i}]')
n = len(segs)
post = f'eq=contrast=1.05:saturation=1.08:brightness=0.01,{sharp}'
if blur:
    by, bh = int(1920 * blur[0]) // 2 * 2, int(1920 * (blur[1] - blur[0])) // 2 * 2
    post += f',split[base][bb];[bb]crop=1080:{bh}:0:{by},gblur=sigma=28,gblur=sigma=28[bl];[base][bl]overlay=0:{by}'
fc = ';'.join(parts) + ';' + ''.join(f'[v{i}]' for i in range(n)) + \
     f'concat=n={n}:v=1:a=0,{post}[v];' \
     f'[1:a]atrim={mstart:.2f}:{mstart + length:.2f},asetpts=PTS-STARTPTS,afade=t=in:d=0.4,' \
     f'afade=t=out:st={max(0, length - 1.2):.2f}:d=1.2,loudnorm=I=-14:TP=-1.5[a]'
cmd = ['ffmpeg', '-v', 'error', '-y', '-i', vid, '-i', music, '-filter_complex', fc, '-map', '[v]', '-map', '[a]',
       '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
       '-movflags', '+faststart', '-t', f'{length:.3f}', out]
p = subprocess.run(cmd, capture_output=True, text=True, errors='ignore')
if p.returncode:
    print("LOI", p.stderr[:900])
    sys.exit(1)
print('OK', round(length, 1), 'canh', n, 'cat-dai' if crop else 'bo-canh-chu', 'sach', round(total_clean, 1))
