@echo off
title Stop ProjectPulse Background Server
cd /d "%~dp0"
echo Stopping ProjectPulse on port 8000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do (
    taskkill /F /PID %%a 2>nul
)
echo ProjectPulse server stopped.
pause
