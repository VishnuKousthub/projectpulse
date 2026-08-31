@echo off
title ProjectPulse Server
cd /d "%~dp0"
echo Starting ProjectPulse on http://127.0.0.1:8000 ...
start http://127.0.0.1:8000
.venv\Scripts\python.exe -m app.main
pause
