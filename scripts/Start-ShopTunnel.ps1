# Shop PC connects OUT to the VPS (no SSH user/key).
# VPS chisel server on :4704 reverse-forwards shop API :5000.
param(
    [string]$VpsHost = "187.124.23.65",
    [int]$TunnelPort = 4704,
    [int]$ShopPort = 5000,
    [string]$Auth = "fot:e7Kq9mN2pL4xW8vR"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$tools = Join-Path $PSScriptRoot "tools"
$chisel = Join-Path $tools "chisel.exe"
$version = "1.12.0"
$url = "https://github.com/jpillora/chisel/releases/download/v$version/chisel_${version}_windows_amd64.zip"

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

if (-not (Test-Path $chisel)) {
    Write-Host "[2] Downloading tunnel client..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path $tools | Out-Null
    $zip = Join-Path $tools "chisel.zip"
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
    Expand-Archive -Path $zip -DestinationPath $tools -Force
    Remove-Item $zip -Force
    if (-not (Test-Path $chisel)) {
        $found = Get-ChildItem $tools -Recurse -Filter "chisel*.exe" | Select-Object -First 1
        if ($found) { Copy-Item $found.FullName $chisel -Force }
    }
    if (-not (Test-Path $chisel)) {
        Write-Host "Failed to download the tunnel client." -ForegroundColor Red
        exit 1
    }
}

Write-Host "[3] Connecting shop to ${VpsHost}:$TunnelPort" -ForegroundColor Cyan
Write-Host "    Leave this window open. Closing it brings back the shop-down error." -ForegroundColor DarkCyan

$server = "${VpsHost}:${TunnelPort}"
$remote = "R:0.0.0.0:${ShopPort}:127.0.0.1:${ShopPort}"
while ($true) {
    & $chisel client --auth $Auth --keepalive 25s --max-retry-count 0 $server $remote
    Write-Host "Tunnel dropped. Reconnecting in 5 seconds..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
}
