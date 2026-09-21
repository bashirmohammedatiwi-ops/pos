# Shop PC connects OUT to the VPS (no SSH user/key).
# VPS chisel server on :4704 reverse-forwards shop API :5000.
param(
    [string]$VpsHost = "187.124.23.65",
    [int]$TunnelPort = 4704,
    [int]$ShopPort = 5000,
    [string]$Auth = "fot:e7Kq9mN2pL4xW8vR"
)

$ErrorActionPreference = "Stop"
$tools = Join-Path $PSScriptRoot "tools"
$chisel = Join-Path $tools "chisel.exe"
$version = "1.11.3"
$url = "https://github.com/jpillora/chisel/releases/download/v$version/chisel_${version}_windows_amd64.gz"

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

Write-Host "1) فحص واجهة نقطة البيع على هذا الجهاز..." -ForegroundColor Cyan
if (-not (Test-LocalPort $ShopPort)) {
    Write-Host "خادم نقطة البيع غير شغّال على المنفذ $ShopPort. شغّل FOT POS Server ثم أعد المحاولة." -ForegroundColor Red
    exit 1
}
Write-Host "   واجهة المحل تعمل على 127.0.0.1:$ShopPort" -ForegroundColor Green

if (-not (Test-Path $chisel)) {
    Write-Host "2) تنزيل برنامج النفق..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path $tools | Out-Null
    $gz = Join-Path $tools "chisel.gz"
    Invoke-WebRequest -Uri $url -OutFile $gz -UseBasicParsing
    $in = [IO.File]::OpenRead($gz)
    $gzip = New-Object IO.Compression.GzipStream($in, [IO.Compression.CompressionMode]::Decompress)
    $out = [IO.File]::Create($chisel)
    $gzip.CopyTo($out)
    $out.Close(); $gzip.Close(); $in.Close()
    Remove-Item $gz -Force
}

Write-Host "3) ربط المحل بالسيرفر ${VpsHost}:$TunnelPort" -ForegroundColor Cyan
Write-Host "اترك هذه النافذة مفتوحة. إغلاقها يعيد رسالة تعذر الاتصال." -ForegroundColor DarkCyan

$server = "${VpsHost}:${TunnelPort}"
$remote = "R:0.0.0.0:${ShopPort}:127.0.0.1:${ShopPort}"
while ($true) {
    & $chisel client --auth $Auth --keepalive 25s --max-retry-count 0 $server $remote
    Write-Host "انقطع النفق — إعادة بعد 5 ثوان..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
}
