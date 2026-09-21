@echo off
cd /d "%~dp0"
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting Administrator privileges...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"\"%~dp0Install-WindowsService.ps1\"\"'"
    exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-WindowsService.ps1"
pause
