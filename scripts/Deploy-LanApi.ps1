#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root "publish\desktop\FOT-POS-Server"
$dst = Join-Path ${env:ProgramFiles} "FOT POS Server"
$apiSrc = Join-Path $src "Api"
$apiDst = Join-Path $dst "Api"

if (-not (Test-Path (Join-Path $apiSrc "FOT.Pos.Api.exe"))) {
    throw "Published API not found: $apiSrc"
}
if (-not (Test-Path $dst)) {
    throw "FOT POS Server is not installed at $dst — run FOT-POS-Server-Setup.exe first"
}

Write-Host "Updating FOT POS API 2.2.2 on this PC..." -ForegroundColor Cyan
Get-Process -Name "FOT.Pos.Api" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

robocopy $apiSrc $apiDst /E /IS /IT /R:2 /W:1 /NFL /NDL /NP
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with $LASTEXITCODE" }

Copy-Item (Join-Path $src "Install-WindowsService.ps1") (Join-Path $dst "Install-WindowsService.ps1") -Force
Copy-Item (Join-Path $src "Uninstall-WindowsService.ps1") (Join-Path $dst "Uninstall-WindowsService.ps1") -Force

& (Join-Path $dst "Install-WindowsService.ps1") -Upgrade

if (-not (Get-NetFirewallRule -DisplayName "FOT POS API (TCP 5000)" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "FOT POS API (TCP 5000)" -Direction Inbound -LocalPort 5000 -Protocol TCP -Action Allow | Out-Null
}
if (-not (Get-NetFirewallRule -DisplayName "FOT POS LAN Discovery (UDP 49500)" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "FOT POS LAN Discovery (UDP 49500)" -Direction Inbound -LocalPort 49500 -Protocol UDP -Action Allow | Out-Null
}

$deadline = (Get-Date).AddSeconds(40)
$ok = $false
while ((Get-Date) -lt $deadline) {
    try {
        $r = Invoke-WebRequest "http://127.0.0.1:5000/health" -UseBasicParsing -TimeoutSec 3
        if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch { Start-Sleep -Seconds 1 }
}

Write-Host ""
if ($ok) {
    $info = Invoke-RestMethod "http://127.0.0.1:5000/api/server/info"
    Write-Host "SUCCESS — API 2.2.2 is live." -ForegroundColor Green
    Write-Host ("  Host: " + $info.hostName)
    Write-Host ("  LAN:  " + (($info.lanAddresses | ForEach-Object { "http://${_}:5000" }) -join "  "))
    Write-Host ("  Admin UI hosted: " + $info.adminUiHosted)
} else {
    Write-Warning "Service updated but /health did not respond yet. Check ProgramData\FOT.Pos\logs"
}
