# Shop PC connects OUT to the VPS (no SSH user/key).
param(
    [string]$VpsHost = "187.124.23.65",
    [int]$TunnelPort = 4704,
    [int]$ShopPort = 5000,
    [string]$Auth = "fot:e7Kq9mN2pL4xW8vR"
)

$ErrorActionPreference = "Stop"
$project = Join-Path $PSScriptRoot "..\tools\Fot.ShopTunnel\Fot.ShopTunnel.csproj"

function Test-LocalPort([int]$Port) {
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $iar = $tcp.BeginConnect("127.0.0.1", $Port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(2500, $false) -and $tcp.Connected
        $tcp.Close()
        return $ok
    } catch {
        return $false
    }
}

Write-Host "[1] Checking shop API on this PC..." -ForegroundColor Cyan
if (-not (Test-LocalPort $ShopPort)) {
    Write-Host "FOT POS Server is not running on port $ShopPort. Start it, then run this again." -ForegroundColor Red
    exit 1
}
Write-Host "    Shop API is up at 127.0.0.1:$ShopPort" -ForegroundColor Green
Write-Host "[2] Connecting shop to ${VpsHost}:$TunnelPort" -ForegroundColor Cyan
Write-Host "    Leave this window open. Closing it brings back the shop-down error." -ForegroundColor DarkCyan

dotnet run --project $project -c Release --no-launch-profile -- `
    --host $VpsHost --tunnel $TunnelPort --shop $ShopPort --auth $Auth --workers 8
