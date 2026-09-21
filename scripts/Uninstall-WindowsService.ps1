#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
$ServiceName = "FOTPOSServer"

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Host "Service not installed."
    exit 0
}

Stop-Service $ServiceName -Force -ErrorAction SilentlyContinue
sc.exe delete $ServiceName | Out-Null
schtasks.exe /Delete /TN "FOTPOSServerBoot" /F | Out-Null
Write-Host "FOT POS Server service removed." -ForegroundColor Green
