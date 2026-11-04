#!/bin/bash
# Đổi khoá Gemini của Salon POS (máy chủ) sang khoá trả phí trong .env của agent marketing.
# Khoá cũ (gói miễn phí) được lưu ở /opt/salon-pos/backup/gemini-key.txt.20261022-mienphi
set -e
cd "$(dirname "$0")"
T="$(mktemp)"
grep '^GEMINI_API_KEY=' .env | head -1 | cut -d= -f2- | tr -d '\r" \n' > "$T"
[ -s "$T" ] || { echo "Không thấy GEMINI_API_KEY trong .env"; rm -f "$T"; exit 1; }
ssh root@45.252.250.64 'cp -n /opt/salon-pos/data/gemini-key.txt /opt/salon-pos/backup/gemini-key.txt.20261022-mienphi'
scp -q "$T" root@45.252.250.64:/opt/salon-pos/data/gemini-key.txt
rm -f "$T"
ssh root@45.252.250.64 'chmod 600 /opt/salon-pos/data/gemini-key.txt'
echo "Xong: POS đã dùng khoá Gemini trả phí (không cần khởi động lại, máy chủ đọc khoá mỗi lần quét ảnh)."
