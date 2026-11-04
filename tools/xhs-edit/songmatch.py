# Tìm bài nhạc trong kho CapCut khớp với tiếng của các reel cũ (để biết tên bài).
# Dùng: python -I songmatch.py <thư mục mp3> <file reel...>  -> in "reel  bài  độ khớp  lệch(s)"
import sys, os, subprocess
import numpy as np

SR, HOP = 8000, 400  # 20 điểm/giây

def env(path, dur=None):
    cmd = ['ffmpeg', '-v', 'error', '-i', path] + (['-t', str(dur)] if dur else []) + \
          ['-vn', '-ac', '1', '-ar', str(SR), '-f', 's16le', '-']
    x = np.frombuffer(subprocess.run(cmd, capture_output=True).stdout, np.int16).astype(np.float32)
    n = len(x) // HOP
    e = np.log(np.sqrt((x[:n * HOP].reshape(n, HOP) ** 2).mean(1)) + 1)
    d = np.diff(e, prepend=e[:1])
    return (d - d.mean()) / (d.std() + 1e-9)

lib = sys.argv[1]
tracks = {f: env(os.path.join(lib, f)) for f in os.listdir(lib) if f.endswith('.mp3')}
for reel in sys.argv[2:]:
    r = env(reel)
    if len(r) < 100:
        continue
    best = (0, None, 0)
    for f, t in tracks.items():
        if len(t) < len(r):
            continue
        c = np.correlate(t, r, 'valid') / len(r)
        i = int(np.argmax(c))
        if c[i] > best[0]:
            best = (float(c[i]), f, i / 20)
    print(os.path.basename(reel), best[1], round(best[0], 3), best[2], flush=True)
