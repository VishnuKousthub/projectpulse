@echo off
title Install ProjectPulse 24/7 Auto-Start
cd /d "%~dp0"
echo ========================================================
echo   Installing ProjectPulse 24/7 Background Auto-Start
echo ========================================================
echo.

set STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set VBS_TARGET=%STARTUP_DIR%\ProjectPulse_AutoStart.vbs

echo Set WshShell = CreateObject("WScript.Shell") > "%VBS_TARGET%"
echo WshShell.CurrentDirectory = "%~dp0" >> "%VBS_TARGET%"
echo WshShell.Run "cmd /c .venv\Scripts\python.exe -m app.main", 0, False >> "%VBS_TARGET%"

echo [*] Auto-start script created at:
echo     %VBS_TARGET%
echo.
echo [*] Starting ProjectPulse background service now...
wscript.exe "%VBS_TARGET%"

echo.
echo ========================================================
echo   SUCCESS! ProjectPulse is now configured for 24/7 Uptime.
echo   It will automatically start whenever your PC turns on.
echo   Local URL: http://localhost:8000
echo ========================================================
echo.
pause
