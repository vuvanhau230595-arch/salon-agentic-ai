# Dựng cả loạt: gán nhạc trend (xoay vòng, đổi đoạn khi lặp bài), gọi edit.py, ghi danh sách.
# Dùng: python -I run.py <thư mục video> <thư mục ocr> <nhac.json> <thư mục ra> <danh-sach nguồn>
import sys, os, json, subprocess
sys.stdout.reconfigure(encoding='utf-8')
vdir, odir, nj, out, ds = sys.argv[1:6]
LIB = r'C:/Users/Admin/AppData/Local/CapCut/User Data/Cache/music'
POOL = {  # bài trend trong thư viện Thương mại CapCut
    'f5189d848058fbb99199f0a0d39e5746.mp3': 'Trend TikTok 29/10 #1',
    'fe1013729c82725d9570d2255c27a973.mp3': 'Dj tiktok Dari Yang Muda X Gue tau JJ viral',
    '7634b25e1797da87bb62d70fc183cfa8.mp3': 'Trend Alay',
    '1c20d913d979318a94b308b478b8f745.mp3': 'Trend TikTok 29/10 #2',
    '25b5c7b85fff1e8c942e6004ad267aea.mp3': 'Pretty (Sped Up)',
    '1b3c932d123ec170e6977e34b4b8f182.mp3': 'Vietnam Trend (bản dài)',
    '10052262f5ca2bfec5cc3305b7a6a248.mp3': 'rewrite',
    '63c65f4ab024c3c77f338c270bce478e.mp3': 'Trend TikTok 29/10 #3',
    '4447b29959efe58ac311f39f7848bebe.mp3': 'Ibiza Aura',
    '8c58988323f3d0e1ff8a183cf2cbe76f.mp3': 'Không Buông',
    'd447c626f6f16c10db90da4331445c9b.mp3': 'Funk It Up',
    '0e96624ff36edf10ca56231e0c4d9936.mp3': 'Trend TikTok 29/10 #4',
    '4fc8a59f71d4b75fc5fc16f5268dccec.mp3': 'Vietnam Trend',
    '8bc54a5ff478020e8ebfc6a42656db39.mp3': 'Nếu ta ngược lối',
    '210f2cccea2d9ef4f3782768be7119eb.mp3': 'Holiday',
    '6a72006e011f726c9c76fef76efb865a.mp3': 'Sợ phải kết thúc',
    '84b80baa4f7835601c9c8bbf375d595d.mp3': 'Trend TikTok 29/10 #5',
    '8159e8fe12cb8444a1aa86cb85b4df76.mp3': 'Tình Yêu Đầy Sắc Màu',
    '680a5e111c1be0f6acf9e609a288d71e.mp3': 'Dance the 80s',
    '5ec020c7e03263acc74800c7386efd03.mp3': 'Môn Đăng Hộ Đối',
    'a6971eabcf7cef4e6b6cf91858a22f68.mp3': 'Tại hai ta không môn đăng hộ đối',
    'b2bafec578d76a16a869855312074d93.mp3': 'Funky House Party',
    'dac75457c07a00c57c17bd5458a29333.mp3': 'Con Đò Lỡ Bước',
    '62bc5906e27c4d3cf53aa951c54a012d.mp3': 'Trend TikTok 29/10 #6',
}
info = json.load(open(nj))
titles = {}
for line in open(ds, encoding='utf-8'):
    p = line.split(' ', 2)
    if len(p) == 3 and len(p[0]) == 24:
        titles[p[0]] = p[2].strip()
ids = list(titles)
os.makedirs(out, exist_ok=True)
pool = [f for f in POOL if f in info]
use = {f: 0 for f in pool}
rows = []
k = 0
for n, vid in enumerate(ids, 1):
    dst = os.path.join(out, f'TheOne_XHS_{n:02d}.mp4')
    ocr = os.path.join(odir, vid + '.json')
    if not os.path.exists(ocr):
        rows.append((n, vid, 'CHUA QUET', '', ''))
        continue
    f = pool[k % len(pool)]; k += 1
    m = info[f]
    # lần dùng thứ i của bài: đổi đoạn (đoạn hay nhất, rồi lùi/tiến 20s)
    i = use[f]; use[f] += 1
    st = m['best_start'] + [0, -18, 18, -36][i % 4]
    st = max(3, min(st, m['dur'] - 24))
    if os.path.exists(dst):
        rows.append((n, vid, 'DA CO', POOL[f], st)); continue
    r = subprocess.run([sys.executable, '-I', os.path.join(os.path.dirname(__file__), 'edit.py'),
                        os.path.join(vdir, vid + '.mp4'), ocr, os.path.join(LIB, f), str(m['bpm']), str(st), dst],
                       capture_output=True, text=True, errors='ignore')
    res = (r.stdout.strip() or r.stderr.strip()[-200:])
    rows.append((n, vid, res, POOL[f], st))
    print(n, vid, res, POOL[f], st, flush=True)
with open(os.path.join(out, 'ket-qua.json'), 'w', encoding='utf-8') as fp:
    json.dump(rows, fp, ensure_ascii=False, indent=1)
