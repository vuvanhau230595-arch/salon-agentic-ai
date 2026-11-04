<#
  Lưu một khóa bí mật vào .env trên VPS (không hiện khóa, không nằm trong dòng lệnh).

  Ví dụ (sao chép khóa trước, rồi chạy):
    .\deploy\set-secret.ps1 -Name TIKTOK_CLIENT_SECRET -FromClipboard
    .\deploy\set-secret.ps1 -Name TIKTOK_CLIENT_KEY    -FromClipboard
  Hoặc không có -FromClipboard thì script hỏi bằng ô nhập ẩn.
  Xong script khởi động lại dịch vụ. Với -FromClipboard, khóa được xóa khỏi bộ nhớ sao chép.
#>
param(
  [Parameter(Mandatory = $true)][string]$Name,
  [string]$Server = '45.252.250.64',
  [string]$User = 'root',
  [int]$Port = 22,
  [string]$EnvFile = '/opt/salon-agentic-ai/.env',   # chỉ đổi khi thử nghiệm
  [switch]$FromClipboard
)
$ErrorActionPreference = 'Stop'

# Chỉ cho phép đặt các khóa mà app biết, tránh đặt nhầm biến (đặc biệt không đụng APP_PASSWORD, META_ACCESS_TOKEN: đã có script riêng)
$allowed = @('TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY')
if ($allowed -notcontains $Name) { throw "Tên khóa không được hỗ trợ: $Name. Cho phép: $($allowed -join ', ')" }

if ($FromClipboard) {
  $value = ((Get-Clipboard -Raw) | Out-String).Trim()
  if (-not $value) { throw 'Bộ nhớ sao chép đang trống. Hãy sao chép khóa rồi chạy lại.' }
} else {
  $secure = Read-Host "Nhập giá trị cho $Name (ô nhập ẩn, bấm Enter khi xong)" -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $value = [Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  $value = $value.Trim()
}

# Chỉ chữ, số và . _ ~ - : an toàn để đặt trong dấu nháy đơn của bash và trong file .env
if ($value -notmatch '^[A-Za-z0-9._~-]{8,600}$') {
  throw 'Giá trị không hợp lệ: cần 8–600 ký tự, chỉ gồm chữ, số và . _ ~ - (không dấu cách, không dấu ngoặc, không có tên biến ở đầu).'
}

$body = @'
F="$FILE"
[ -f "$F" ] || { echo "Chua cai app tren VPS (khong thay $F)"; exit 1; }
if grep -q "^${NAME}=" "$F"; then
  sed -i "s|^${NAME}=.*|${NAME}=${V}|" "$F"
else
  printf '\n%s=%s\n' "$NAME" "$V" >> "$F"
fi
if [ "$F" = /opt/salon-agentic-ai/.env ]; then
  chown root:salonagent "$F"; chmod 640 "$F"
  systemctl restart salon-agentic-ai
  sleep 2
  if systemctl is-active --quiet salon-agentic-ai; then
    echo "OK: da luu $NAME (an) va khoi dong lai dich vu."
  else
    echo "LOI: dich vu khong chay sau khi luu"; journalctl -u salon-agentic-ai -n 15 --no-pager; exit 1
  fi
else
  echo "OK (che do thu nghiem, khong khoi dong lai dich vu)."
fi
'@ -replace "`r", ''

$payload = "NAME='$Name'`nV='$value'`nFILE='$EnvFile'`n$body"
$payload | & ssh.exe -p $Port "$User@$Server" "tr -d '\015\357\273\277' | bash -s"
$code = $LASTEXITCODE
$value = $null; $payload = $null
if ($code -ne 0) { throw 'Lưu thất bại — đọc thông báo phía trên.' }
if ($FromClipboard) { Set-Clipboard -Value ' '; Write-Host 'Đã xóa khỏi bộ nhớ sao chép.' }
Write-Host "`nXong." -ForegroundColor Green
