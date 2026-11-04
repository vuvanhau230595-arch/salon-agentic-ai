<#
  Đổi mật khẩu đăng nhập app trên VPS (không hiện mật khẩu, không nằm trong dòng lệnh).

  Cách dùng:   .\deploy\set-password.ps1
  Hỏi mật khẩu mới 2 lần (ô nhập ẩn), gửi qua kênh SSH, ghi vào APP_PASSWORD trong
  /opt/salon-agentic-ai/.env rồi khởi động lại dịch vụ.

  Mật khẩu: 12–64 ký tự, chỉ gồm chữ, số và các ký tự . _ - ! @ (không dấu cách, không tiếng Việt có dấu).
#>
param(
  [string]$Server = '45.252.250.64',
  [string]$User = 'root',
  [int]$Port = 22,
  [string]$EnvFile = '/opt/salon-agentic-ai/.env'   # chỉ đổi khi thử nghiệm
)
$ErrorActionPreference = 'Stop'

function Read-Secret($prompt) {
  $s = Read-Host $prompt -AsSecureString
  $p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringAuto($p) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }
}

$pw1 = Read-Secret 'Mật khẩu mới (ô nhập ẩn, gõ xong bấm Enter)'
$pw2 = Read-Secret 'Gõ lại mật khẩu mới để xác nhận'
if ($pw1 -ne $pw2) { throw 'Hai lần gõ không giống nhau. Chạy lại script và gõ cẩn thận.' }
if ($pw1 -notmatch '^[A-Za-z0-9._!@-]{12,64}$') {
  throw 'Mật khẩu chưa hợp lệ: cần 12–64 ký tự, chỉ gồm chữ không dấu, số và các ký tự . _ - ! @ (không dấu cách).'
}
# Mật khẩu quá dễ đoán (chỉ 1 loại ký tự hoặc lặp một ký tự) thì từ chối
if ($pw1 -match '^(.)\1+$' -or $pw1 -match '^[0-9]+$' -or $pw1 -match '^[a-zA-Z]+$') {
  throw 'Mật khẩu quá dễ đoán. Hãy trộn chữ và số, hoặc ghép 3-4 từ dễ nhớ kèm số, ví dụ: tiem-toc-the-one-2026.'
}

$body = @'
F="$FILE"
[ -f "$F" ] || { echo "Chua cai app tren VPS (khong thay $F)"; exit 1; }
if grep -q '^APP_PASSWORD=' "$F"; then
  sed -i "s|^APP_PASSWORD=.*|APP_PASSWORD=$P|" "$F"
else
  printf '\nAPP_PASSWORD=%s\n' "$P" >> "$F"
fi
if [ "$F" = /opt/salon-agentic-ai/.env ]; then
  chown root:salonagent "$F"; chmod 640 "$F"
  systemctl restart salon-agentic-ai
  sleep 2
  if systemctl is-active --quiet salon-agentic-ai; then
    echo "OK: da doi mat khau (an) va khoi dong lai dich vu."
  else
    echo "LOI: dich vu khong chay sau khi doi mat khau"; journalctl -u salon-agentic-ai -n 15 --no-pager; exit 1
  fi
else
  echo "OK (che do thu nghiem, khong khoi dong lai dich vu)."
fi
'@ -replace "`r", ''

# Mật khẩu + đường dẫn + lệnh đều đi qua stdin của ssh; tr -d bỏ ký tự xuống dòng Windows (\015) và BOM (\357\273\277)
$payload = "P='$pw1'`nFILE='$EnvFile'`n$body"
$payload | & ssh.exe -p $Port "$User@$Server" "tr -d '\015\357\273\277' | bash -s"
$code = $LASTEXITCODE
$pw1 = $null; $pw2 = $null; $payload = $null
if ($code -ne 0) { throw 'Đổi mật khẩu thất bại — đọc thông báo phía trên.' }
Write-Host "`nXong. Đăng nhập lại ở https://agent.theonehairsalon.vn bằng mật khẩu mới (tên đăng nhập gõ gì cũng được)." -ForegroundColor Green
