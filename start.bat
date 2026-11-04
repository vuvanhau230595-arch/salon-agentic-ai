@echo off
cd /d "%~dp0"
title Salon Agentic AI
start "" http://127.0.0.1:3950
node src\server.js
pause
