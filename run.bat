@echo off
echo ==========================================
echo   Starting ProjectPulse Workspace Server  
echo ==========================================
cd /d %~dp0

if not exist ".venv\Scripts\python.exe" (
    echo [*] Creating virtual environment...
    python -m venv .venv
    echo [*] Installing dependencies...
    .venv\Scripts\pip.exe install -r requirements.txt
)

echo [*] Initializing Database & Demo Data...
.venv\Scripts\python.exe -m app.seed

echo.
echo ==========================================================
echo   ProjectPulse is LIVE at: http://127.0.0.1:8000
echo   Open your browser to start managing projects!
echo ==========================================================
echo Press Ctrl+C to stop the server.
echo.

.venv\Scripts\python.exe -m app.main
