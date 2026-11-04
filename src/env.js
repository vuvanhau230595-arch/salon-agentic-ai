// Đọc .env thủ công (không dùng thư viện ngoài)
const fs = require('node:fs');
const path = require('node:path');
// Chạy kiểm thử (node --test): không đọc .env thật để test không gọi AI/Meta thật và không tốn tiền
if (!process.env.NODE_TEST_CONTEXT) try {
  const txt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch {}
