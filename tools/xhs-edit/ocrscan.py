# Quét chữ Trung trong video: 3 khung/giây, ghi hộp chữ ra JSON.
# Dùng: python -I ocrscan.py <thư mục video> <thư mục ra> [chỉ số bắt đầu] [bước]
import sys, os, json, re, cv2
from rapidocr_onnxruntime import RapidOCR

src, out = sys.argv[1], sys.argv[2]
start = int(sys.argv[3]) if len(sys.argv) > 3 else 0
step = int(sys.argv[4]) if len(sys.argv) > 4 else 1
os.makedirs(out, exist_ok=True)
han = re.compile(r'[一-鿿]')
ocr = RapidOCR()
files = sorted(f for f in os.listdir(src) if f.endswith('.mp4'))[start::step]
for f in files:
    dst = os.path.join(out, f[:-4] + '.json')
    if os.path.exists(dst):
        continue
    cap = cv2.VideoCapture(os.path.join(src, f))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    W = cap.get(cv2.CAP_PROP_FRAME_WIDTH); H = cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
    samples = []
    t = 0.0
    while t * fps < n:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(t * fps))
        ok, img = cap.read()
        if not ok:
            break
        s = 540 / img.shape[1]
        small = cv2.resize(img, None, fx=s, fy=s)
        res, _ = ocr(small)
        boxes = []
        for box, text, conf in (res or []):
            k = len(han.findall(text))
            if k >= 1 and conf > 0.5:
                ys = [p[1] / s / H for p in box]; xs = [p[0] / s / W for p in box]
                boxes.append({'t': text, 'n': k, 'y0': min(ys), 'y1': max(ys), 'x0': min(xs), 'x1': max(xs)})
        samples.append({'t': round(t, 2), 'han': sum(b['n'] for b in boxes), 'boxes': boxes})
        t += 1 / 3
    cap.release()
    json.dump({'file': f, 'fps': fps, 'dur': n / fps, 'w': W, 'h': H, 'samples': samples},
              open(dst, 'w', encoding='utf-8'), ensure_ascii=False)
    print('xong', f, len(samples), flush=True)
