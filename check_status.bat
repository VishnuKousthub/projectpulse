@echo off
title ProjectPulse Status
cd /d "%~dp0"
echo ========================================
echo   ProjectPulse Service Health Check
echo ========================================
echo.
netstat -aon | findstr :8000 | findstr LISTENING >nul
if %ERRORLEVEL% EQU 0 (
    echo [ACTIVE] ProjectPulse is RUNNING LIVE!
    echo.
    echo -> Local PC URL:  http://localhost:8000
    for /f "tokens=2 delims=:" %%i in ('ipconfig ^| findstr /i "IPv4"') do (
        echo -> Wi-Fi / LAN:   http:%%i:8000
    )
) else (
    echo [STOPPED] ProjectPulse is not currently running.
    echo Double-click start_server.bat or run start_background_hidden.vbs to start it.
)
echo.
echo ========================================
pause
