// Đọc thông số video mp4/mov từ phần đầu file (không cần ffmpeg): độ phân giải, thời lượng, bitrate.
// Chỉ đọc các "hộp" nhỏ (moov/mvhd/tkhd), không nạp cả video vào bộ nhớ.
const fs = require('node:fs');

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl']);

function read(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const out = { size, width: 0, height: 0, durationSec: 0, kbps: 0 };
    const at = (pos, len) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, pos); return b; };

    const walk = (start, end) => {
      let pos = start;
      while (pos + 8 <= end) {
        const h = at(pos, 16);
        let sz = h.readUInt32BE(0);
        const type = h.toString('latin1', 4, 8);
        let hdr = 8;
        if (sz === 1) { sz = Number(h.readBigUInt64BE(8)); hdr = 16; }
        else if (sz === 0) sz = end - pos;
        if (sz < hdr || pos + sz > end + 8) break;
        if (CONTAINERS.has(type)) walk(pos + hdr, pos + sz);
        else if (type === 'mvhd') {
          const b = at(pos + hdr, 32);
          const v = b[0];
          const ts = v === 1 ? b.readUInt32BE(20) : b.readUInt32BE(12);
          const du = v === 1 ? Number(b.readBigUInt64BE(24)) : b.readUInt32BE(16);
          if (ts) out.durationSec = du / ts;
        } else if (type === 'tkhd' && !out.width) {
          const b = at(pos + hdr, 96);
          const v = b[0];
          const m = v === 1 ? 52 : 40;          // ma trận xoay
          const w = b.readUInt32BE(v === 1 ? 88 : 76) / 65536;
          const hh = b.readUInt32BE(v === 1 ? 92 : 80) / 65536;
          if (w > 0 && hh > 0) {
            const a = b.readInt32BE(m);
            const rotated = a === 0;            // xoay 90°/270°: đổi chiều rộng/cao
            out.width = Math.round(rotated ? hh : w);
            out.height = Math.round(rotated ? w : hh);
          }
        }
        pos += sz;
      }
    };
    walk(0, size);
    out.kbps = out.durationSec ? Math.round((size * 8) / out.durationSec / 1000) : 0;
    return out;
  } finally {
    fs.closeSync(fd);
  }
}

// Có nhớ tạm theo (đường dẫn, kích thước, thời gian sửa) để không đọc lại mỗi lần
const cache = new Map();
function info(file) {
  const st = fs.statSync(file);
  const k = `${file}|${st.size}|${st.mtimeMs}`;
  if (!cache.has(k)) cache.set(k, read(file));
  return cache.get(k);
}

module.exports = { read, info };
