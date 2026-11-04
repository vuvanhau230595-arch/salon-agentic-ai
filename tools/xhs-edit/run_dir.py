# Dựng cả thư mục video đã tải (tên <số>-<mã>.mp4, bản gốc trong goc/, OCR trong ocr/).
# Gán nhạc trend xoay vòng, dựng từ bản gốc cho nét, ghi danh-sach.txt.
# Dùng: python -I run_dir.py <thư mục> <tiền tố tên> <nhac.json> [lệch bài]
import sys, os, json, subprocess, ast
sys.stdout.reconfigure(encoding='utf-8')
# lấy kho nhạc POOL/LIB từ run.py (không import vì run.py chạy ngay khi nạp)
_src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'run.py'), encoding='utf-8').read()
_g = {n.targets[0].id: ast.literal_eval(n.value) for n in ast.parse(_src).body
      if isinstance(n, ast.Assign) and getattr(n.targets[0], 'id', '') in ('POOL', 'LIB')}
POOL, LIB = _g['POOL'], _g['LIB']

d, prefix, nj = sys.argv[1:4]
off = int(sys.argv[4]) if len(sys.argv) > 4 else 0
info = json.load(open(nj))
pool = [f for f in POOL if f in info]
out = os.path.join(d, 'edit')
os.makedirs(out, exist_ok=True)
files = sorted(f for f in os.listdir(d) if f.endswith('.mp4'))
rows = []
for n, f in enumerate(files, 1):
    name = f[:-4]
    ocr = os.path.join(d, 'ocr', name + '.json')
    src = os.path.join(d, 'goc', f)
    if not os.path.exists(src):
        src = os.path.join(d, f)
    # OCR quét trên bản 1080p: đổi kích thước về bản gốc để edit.py tính đúng độ phóng
    o = json.load(open(ocr, encoding='utf-8'))
    p = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
                        '-of', 'csv=p=0', src], capture_output=True, text=True)
    w, h = map(int, p.stdout.strip().split(',')[:2])
    o['w'], o['h'] = w, h
    ocr2 = os.path.join(d, 'ocr', name + '.goc.json')
    json.dump(o, open(ocr2, 'w', encoding='utf-8'), ensure_ascii=False)
    i = off + n - 1
    song = pool[i % len(pool)]
    m = info[song]
    st = m['best_start'] + [0, -18, 18, -36][(i // len(pool)) % 4]
    st = max(3, min(st, m['dur'] - 24))
    dst = os.path.join(out, f'{prefix}_{n:02d}.mp4')
    r = subprocess.run([sys.executable, '-I', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'edit.py'),
                        src, ocr2, os.path.join(LIB, song), str(m['bpm']), str(st), dst],
                       capture_output=True, text=True, errors='ignore')
    res = (r.stdout.strip() or r.stderr.strip()[-200:])
    rows.append(f'{prefix}_{n:02d}  nguồn {f} ({w}x{h})  nhạc: {POOL[song]} từ {st}s  →  {res}')
    print(rows[-1], flush=True)
open(os.path.join(out, 'danh-sach.txt'), 'w', encoding='utf-8').write('\n'.join(rows) + '\n')
