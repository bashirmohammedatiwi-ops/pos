@echo off
chcp 65001 >nul
cd /d "%~dp0"
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo طلب صلاحيات المسؤول...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"\"%~dp0Install-NebulaWebService.ps1\"\"'"
    exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-NebulaWebService.ps1"
echo.
pause
