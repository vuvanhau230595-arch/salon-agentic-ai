<#
  Đổi video sang chuẩn mà Facebook Reels / TikTok ít phải nén lại nhất, trước khi đưa vào Thư viện Media hoặc Google Drive.
  Chạy trên máy tính (VPS quá yếu để đổi video).

  Chuẩn ra: H.264 High, 30 khung/giây, tối đa 1080x1920 (không phóng to video nhỏ), chất lượng cao (CRF 17,
  tối đa 12 Mbps), âm thanh AAC 192 kbps 48 kHz, "faststart" để tải lên nhanh. File gốc giữ nguyên.
  Kết quả nằm trong thư mục con "chuan-fb-tiktok" cạnh file gốc, cùng tên, đuôi .mp4.

  Cách dùng:
    - Kéo thả video (hoặc cả thư mục) vào file chuan-hoa-video.bat, hoặc
    - .\tools\chuan-hoa-video.ps1 "D:\Video\a.mp4" "D:\Video\thu-muc"
    - Thêm -LamNet để làm nét nhẹ (hợp với video hơi mềm, vd. bản "quality_restoration").
    - Thêm -GhiDe để đổi lại cả file đã có trong "chuan-fb-tiktok".
#>
param(
  [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)][string[]]$Paths,
  [switch]$LamNet,
  [switch]$GhiDe
)
$ErrorActionPreference = 'Stop'
foreach ($t in 'ffmpeg', 'ffprobe') {
  if (-not (Get-Command $t -ErrorAction SilentlyContinue)) { throw "Chưa có $t. Cài bằng: winget install Gyan.FFmpeg (rồi mở lại cửa sổ)." }
}

# ffmpeg ghi tiến độ ra stderr: không coi là lỗi (PowerShell 5.1 biến stderr thành lỗi khi đặt 'Stop')
$ErrorActionPreference = 'Continue'

$exts = '.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi'
$files = foreach ($p in $Paths) {
  if (Test-Path -LiteralPath $p -PathType Container) {
    Get-ChildItem -LiteralPath $p -File | Where-Object { $exts -contains $_.Extension.ToLower() }
  } elseif (Test-Path -LiteralPath $p) { Get-Item -LiteralPath $p }
  else { Write-Warning "Không thấy: $p" }
}
$files = @($files | Where-Object { $_.Directory.Name -ne 'chuan-fb-tiktok' })
if (-not $files.Count) { Write-Host 'Không có video nào để đổi.'; exit 0 }

$ok = 0; $skip = 0; $fail = 0
foreach ($f in $files) {
  $outDir = Join-Path $f.DirectoryName 'chuan-fb-tiktok'
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  $out = Join-Path $outDir ($f.BaseName + '.mp4')
  if ((Test-Path -LiteralPath $out) -and -not $GhiDe) { Write-Host "Bỏ qua (đã có): $($f.Name)"; $skip++; continue }

  # Kích thước sau khi xoay: video dọc tối đa 1080x1920, ngang tối đa 1920x1080, không phóng to
  $dim = (& ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x $f.FullName) -split 'x'
  if ($dim.Count -lt 2) { Write-Warning "Không đọc được video: $($f.Name)"; $fail++; continue }
  $w = [int]$dim[0]; $h = [int]$dim[1]
  $boxW = if ($w -le $h) { 1080 } else { 1920 }
  $boxH = if ($w -le $h) { 1920 } else { 1080 }
  $vf = "scale='min($boxW,iw)':'min($boxH,ih)':force_original_aspect_ratio=decrease:flags=lanczos,scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30"
  if ($LamNet) { $vf += ',unsharp=5:5:0.45:5:5:0' }

  Write-Host "Đang đổi: $($f.Name) ($($w)x$($h))..." -ForegroundColor Cyan
  $tmp = "$out.dang-doi.mp4"
  & ffmpeg -v error -stats -y -i $f.FullName -map 0:v:0 -map '0:a:0?' -vf $vf `
    -c:v libx264 -preset slow -crf 17 -maxrate 12M -bufsize 24M -profile:v high -level 4.2 -pix_fmt yuv420p `
    -color_primaries bt709 -color_trc bt709 -colorspace bt709 `
    -c:a aac -b:a 192k -ar 48000 -movflags +faststart $tmp
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $tmp)) {
    Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
    Write-Warning "Lỗi khi đổi: $($f.Name)"; $fail++; continue
  }
  Move-Item -LiteralPath $tmp -Destination $out -Force
  $mb = [math]::Round((Get-Item -LiteralPath $out).Length / 1MB, 1)
  Write-Host "  Xong: chuan-fb-tiktok\$($f.BaseName).mp4 ($mb MB)" -ForegroundColor Green
  $ok++
}
Write-Host "`nĐã đổi $ok video, bỏ qua $skip, lỗi $fail. Dùng các file trong thư mục 'chuan-fb-tiktok' để đưa vào Thư viện Media / Google Drive." -ForegroundColor Green
