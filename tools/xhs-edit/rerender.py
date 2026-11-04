# Dựng lại một số video theo đúng bài nhạc/đoạn nhạc đã gán trong ket-qua.json.
# Dùng: python -I rerender.py <số thứ tự...> [nocrop]
import sys, json, subprocess
sys.stdout.reconfigure(encoding='utf-8')
OUT = 'downloads/the-one-xhs-edit-2026-10-29'
LIB = 'C:/Users/Admin/AppData/Local/CapCut/User Data/Cache/music/'
nums = {int(a) for a in sys.argv[1:] if a.isdigit()}
extra = ['nocrop'] if 'nocrop' in sys.argv else []
src = open('tools/xhs-edit/run.py', encoding='utf-8').read()
POOL = eval(src[src.index('POOL = {') + 7:src.index('}\ninfo') + 1])
name2f = {v: k for k, v in POOL.items()}
info = json.load(open('work/xhs-edit/nhac.json'))
for n, vid, res, song, st in json.load(open(f'{OUT}/ket-qua.json', encoding='utf-8')):
    if n not in nums or not song:
        continue
    f = name2f[song]
    r = subprocess.run([sys.executable, '-I', 'tools/xhs-edit/edit.py', f'downloads/xhs-shanghai-junyi-2026-10-29/goc/{vid}.mp4',
                        f'work/xhs-edit/ocr/{vid}.json', LIB + f, str(info[f]['bpm']), str(st),
                        f'{OUT}/TheOne_XHS_{n:02d}.mp4'] + extra, capture_output=True, text=True, errors='ignore')
    print(n, (r.stdout or r.stderr[-300:]).strip(), flush=True)
