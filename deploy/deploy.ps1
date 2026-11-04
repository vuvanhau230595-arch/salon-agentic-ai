<#
  Đưa Salon Agentic AI lên VPS (chạy trên máy Windows của bạn, trong PowerShell).

  Ví dụ:
    .\deploy\deploy.ps1 -Server 45.252.250.64 -Domain agent.theonehairsalon.vn

  - Script chỉ gói MÃ NGUỒN. Không gửi data/, media/, .env (nên không đè dữ liệu và khóa API trên VPS).
  - Cần ssh/scp của Windows 10+ (có sẵn). Mật khẩu/khóa SSH bạn tự nhập khi được hỏi.
  - Chạy lại để cập nhật phiên bản mới: dữ liệu và .env trên VPS được giữ nguyên.
#>
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [string]$User = 'root',
  [string]$Domain = '',
  [int]$Port = 22
)
$ErrorActionPreference = 'Stop'

foreach ($tool in 'tar', 'ssh', 'scp') {
  if (-not (Get-Command "$tool.exe" -ErrorAction SilentlyContinue)) { throw "Không tìm thấy $tool.exe — bật 'OpenSSH Client' trong Windows Optional Features." }
}
if ($Domain -and $Domain -notmatch '^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$') { throw "Tên miền không hợp lệ: $Domain" }

$root = Split-Path $PSScriptRoot -Parent
$tgz = Join-Path $env:TEMP 'salon-agentic-ai.tgz'
if (Test-Path $tgz) { Remove-Item $tgz -Force }

Write-Host "==> Đóng gói mã nguồn..." -ForegroundColor Cyan
& tar.exe -czf $tgz -C $root --exclude=data --exclude=media --exclude=.env --exclude=node_modules --exclude=test --exclude=.claude --exclude='*.log' src public deploy package.json README.md HUONG-DAN-META.md HUONG-DAN-VPS.md HUONG-DAN-TIKTOK.md HUONG-DAN-DRIVE.md .env.example
if ($LASTEXITCODE -ne 0) { throw 'Đóng gói thất bại.' }
Write-Host ("    {0:N0} KB" -f ((Get-Item $tgz).Length / 1KB))

$target = "$User@$Server"
Write-Host "==> Gửi lên $target (nhập mật khẩu SSH nếu được hỏi)..." -ForegroundColor Cyan
& scp.exe -P $Port $tgz "${target}:/tmp/salon-agentic-ai.tgz"
if ($LASTEXITCODE -ne 0) { throw 'Gửi file thất bại.' }

Write-Host "==> Cài đặt trên VPS..." -ForegroundColor Cyan
$remote = "mkdir -p /opt/salon-agentic-ai && tar -xzf /tmp/salon-agentic-ai.tgz -C /opt/salon-agentic-ai && rm -f /tmp/salon-agentic-ai.tgz && sed -i 's/\r$//' /opt/salon-agentic-ai/deploy/*.sh && bash /opt/salon-agentic-ai/deploy/setup-vps.sh $Domain"
& ssh.exe -p $Port $target $remote
if ($LASTEXITCODE -ne 0) { throw 'Cài đặt trên VPS báo lỗi — đọc thông báo phía trên.' }

Write-Host "`nHoàn tất." -ForegroundColor Green
