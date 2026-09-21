# Reverse tunnel: shop API :5000 -> VPS 127.0.0.1:5000
# Docker on the VPS reaches it via deploy/shop-proxy (port 15000) or host.docker.internal.
param(
    [Parameter(Mandatory = $true)][string]$VpsUser,
    [string]$VpsHost = "187.124.23.65",
    [int]$ShopPort = 5000
)

$ErrorActionPreference = "Stop"

Write-Host "1) Checking shop API on this PC (http://127.0.0.1:$ShopPort)..." -ForegroundColor Cyan
$up = $false
try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $iar = $tcp.BeginConnect("127.0.0.1", $ShopPort, $null, $null)
    $up = $iar.AsyncWaitHandle.WaitOne(2500, $false) -and $tcp.Connected
    $tcp.Close()
} catch { $up = $false }
if (-not $up) {
    Write-Host "خادم نقطة البيع غير شغّال على المنفذ $ShopPort. شغّل FOT POS Server ثم أعد تشغيل هذا الأمر." -ForegroundColor Red
    exit 1
}

$target = "${VpsUser}@${VpsHost}"
Write-Host "2) Opening tunnel $ShopPort on this PC -> ${target}:127.0.0.1:$ShopPort" -ForegroundColor Cyan
Write-Host "Leave this window open. If it closes, seller web on the VPS will show the shop-down error." -ForegroundColor DarkCyan

$sshArgs = @(
    "-N",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=4",
    "-o", "ExitOnForwardFailure=yes",
    "-R", "127.0.0.1:${ShopPort}:127.0.0.1:${ShopPort}",
    $target
)

while ($true) {
    ssh @sshArgs
    Write-Host "Tunnel dropped. Reconnecting in 5 seconds..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
}
