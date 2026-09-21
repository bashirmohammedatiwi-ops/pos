@echo off
chcp 65001 >nul
title نفق نقطة البيع
cd /d "%~dp0\.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-ShopTunnel.ps1"
echo.
echo أُغلق النفق. اضغط أي مفتاح لإغلاق النافذة.
pause >nul
