# ProjectPulse Startup Script for PowerShell
$ErrorActionPreference = "Stop"
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Starting ProjectPulse Workspace Server  " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# Check if .venv exists
if (-not (Test-Path ".venv\Scripts\python.exe")) {
    Write-Host "[*] Creating virtual environment (.venv)..." -ForegroundColor Yellow
    python -m venv .venv
    Write-Host "[*] Installing dependencies..." -ForegroundColor Yellow
    .venv\Scripts\pip.exe install -r requirements.txt
}

Write-Host "[*] Initializing Database & Demo Data..." -ForegroundColor Yellow
.venv\Scripts\python.exe -m app.seed

$PORT = 8000
$HOST_ADDR = "127.0.0.1"
Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  ProjectPulse is LIVE at: http://$HOST_ADDR`:$PORT       " -ForegroundColor Green
Write-Host "  Open your browser to start managing projects!           " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop the server." -ForegroundColor Gray
Write-Host ""

.venv\Scripts\python.exe -m app.main
