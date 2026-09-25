# Shop PC connects OUT to the VPS (no SSH user/key).
param(
    [string]$VpsHost = "187.124.23.65",
    [int]$TunnelPort = 4704,
    [int]$ShopPort = 5000,
    [string]$Auth = "fot:e7Kq9mN2pL4xW8vR"
)

$ErrorActionPreference = "Stop"
$project = Join-Path $PSScriptRoot "..\tools\Fot.ShopTunnel\Fot.ShopTunnel.csproj"
$out = Join-Path $env:ProgramData "FOT.Pos\tunnel"
$exe = Join-Path $out "Fot.ShopTunnel.exe"
if (-not (Test-Path $exe)) {
    dotnet publish $project -c Release -o $out --nologo -v q
}
$running = Get-CimInstance Win32_Process -Filter "Name='Fot.ShopTunnel.exe'" -ErrorAction SilentlyContinue
if ($running) { exit 0 }
Start-Process -FilePath $exe -WindowStyle Hidden -ArgumentList @(
    "--host", $VpsHost, "--tunnel", "$TunnelPort", "--shop", "$ShopPort", "--auth", $Auth, "--workers", "8"
)
