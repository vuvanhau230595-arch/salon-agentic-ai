<#
  Lưu token Meta lên VPS một cách an toàn (không hiện token, không để trong lịch sử lệnh).

  Cách dùng:   .\deploy\set-token.ps1
  Script hỏi token (ô nhập ẩn), gửi qua kênh SSH (đầu vào chuẩn, không nằm trong dòng lệnh),
  ghi vào /opt/salon-agentic-ai/.env rồi khởi động lại dịch vụ.
#>
param(
  [string]$Server = '45.252.250.64',
  [string]$User = 'root',
  [int]$Port = 22,
  [string]$EnvFile = '/opt/salon-agentic-ai/.env',   # chỉ đổi khi thử nghiệm
  [switch]$FromClipboard   # lấy token từ bộ nhớ sao chép (khi cửa sổ không dán được vào ô nhập ẩn)
)
$ErrorActionPreference = 'Stop'

if ($FromClipboard) {
  # Sao chép token trên Facebook rồi chạy:  .\deploy\set-token.ps1 -FromClipboard
  $token = ((Get-Clipboard -Raw) | Out-String).Trim()
  if (-not $token) { throw 'Bộ nhớ sao chép đang trống. Hãy bấm "sao chép" token trên Facebook rồi chạy lại.' }
} else {
  $secure = Read-Host 'Dán token Meta vào đây (ô nhập ẩn, bấm Enter khi xong)' -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  $token = $token.Trim()
}

# Chỉ chữ và số, đủ dài: an toàn để đặt trong dấu nháy đơn của bash
if ($token -notmatch '^[A-Za-z0-9]{60,600}$') {
  throw 'Chuỗi vừa dán không giống token Meta (chỉ gồm chữ và số, khá dài). Kiểm tra lại: không có dấu cách, dấu ngoặc hay chữ META_ACCESS_TOKEN= ở đầu.'
}

$body = @'
F="$FILE"
[ -f "$F" ] || { echo "Chua cai app tren VPS (khong thay $F)"; exit 1; }
if grep -q '^META_ACCESS_TOKEN=' "$F"; then
  sed -i "s|^META_ACCESS_TOKEN=.*|META_ACCESS_TOKEN=$T|" "$F"
else
  printf '\nMETA_ACCESS_TOKEN=%s\n' "$T" >> "$F"
fi
if [ "$F" = /opt/salon-agentic-ai/.env ]; then
  chown root:salonagent "$F"; chmod 640 "$F"
  systemctl restart salon-agentic-ai
  sleep 2
  if systemctl is-active --quiet salon-agentic-ai; then
    echo "OK: da luu token (an) va khoi dong lai dich vu."
  else
    echo "LOI: dich vu khong chay sau khi luu token"; journalctl -u salon-agentic-ai -n 15 --no-pager; exit 1
  fi
else
  echo "OK (che do thu nghiem, khong khoi dong lai dich vu)."
fi
'@ -replace "`r", ''

# Dòng đầu gán biến (token + đường dẫn), phần sau là lệnh. Tất cả đi qua stdin của ssh.
$payload = "T='$token'`nFILE='$EnvFile'`n$body"
# tr -d '\015' bỏ ký tự xuống dòng kiểu Windows mà PowerShell thêm vào
$payload | & ssh.exe -p $Port "$User@$Server" "tr -d '\015\357\273\277' | bash -s"
$code = $LASTEXITCODE
$token = $null; $payload = $null
if ($code -ne 0) { throw 'Lưu token thất bại — đọc thông báo phía trên.' }
if ($FromClipboard) { Set-Clipboard -Value ' '; Write-Host 'Đã xóa token khỏi bộ nhớ sao chép.' }
Write-Host "`nXong. Mở app (đường hầm SSH) → Cài đặt → 'Kiểm tra kết nối Meta' để kiểm tra." -ForegroundColor Green
