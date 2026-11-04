# Đo nhạc trong kho CapCut: độ dài, BPM, độ mạnh nhịp, đoạn hay nhất.
# Dùng: python -I nhac.py <thư mục mp3> <file json ra>
import sys, os, json, subprocess
import numpy as np

src, out = sys.argv[1], sys.argv[2]
SR = 11025
res = {}
for f in sorted(os.listdir(src)):
    if not f.endswith('.mp3'):
        continue
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', os.path.join(src, f), '-ac', '1', '-ar', str(SR),
                          '-f', 's16le', '-'], capture_output=True).stdout
    x = np.frombuffer(raw, np.int16).astype(np.float32) / 32768
    if len(x) < SR * 8:
        continue
    hop = 256
    n = len(x) // hop
    fr = x[:n * hop].reshape(n, hop)
    rms = np.sqrt((fr ** 2).mean(1) + 1e-9)
    # dòng năng lượng onset (chênh lệch log-RMS dương)
    lg = np.log(rms)
    on = np.maximum(0, np.diff(lg, prepend=lg[0]))
    on -= on.mean()
    fps = SR / hop
    ac = np.correlate(on, on, 'full')[len(on) - 1:]
    lo, hi = int(fps * 60 / 180), int(fps * 60 / 70)
    lag = lo + int(np.argmax(ac[lo:hi]))
    bpm = 60 * fps / lag
    beat_str = float(ac[lag] / (ac[0] + 1e-9))
    # độ to theo giây, đoạn 20s to nhất (bỏ 5s đầu)
    k = int(fps)
    sec = rms[:len(rms) // k * k].reshape(-1, k).mean(1)
    win = 20
    best, bt = -1, 5
    for t in range(5, max(6, len(sec) - win)):
        v = sec[t:t + win].mean()
        if v > best:
            best, bt = v, t
    res[f] = {'dur': round(len(x) / SR, 1), 'bpm': round(bpm, 1), 'beat': round(beat_str, 3),
              'loud': round(float(20 * np.log10(sec.mean() + 1e-9)), 1), 'best_start': bt}
    print(f, res[f], flush=True)
json.dump(res, open(out, 'w'), indent=1)
