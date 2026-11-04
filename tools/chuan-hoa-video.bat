@echo off
rem Keo tha video (hoac thu muc) vao file nay de doi sang chuan Facebook/TikTok.
rem Ket qua nam trong thu muc con "chuan-fb-tiktok" canh file goc.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0chuan-hoa-video.ps1" %*
echo.
pause
