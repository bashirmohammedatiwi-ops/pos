#Requires -RunAsAdministrator

<#

.SYNOPSIS

  Installs or upgrades FOT POS as a Windows Service.

#>

param(

    [switch]$Upgrade,

    [string]$InstallDir = ""

)

$ErrorActionPreference = "Stop"

$ServiceName = "FOTPOSServer"

$DisplayName = "FOT POS Server"

if (-not $InstallDir) {

    $InstallDir = Split-Path -Parent $MyInvocation.MyCommand.Path

}

$ApiExe = Join-Path $InstallDir "Api\FOT.Pos.Api.exe"



if (-not (Test-Path $ApiExe)) {

    Write-Error "FOT.Pos.Api.exe not found: $ApiExe"

}



$label = if ($Upgrade) { "Updating" } else { "Installing" }

Write-Host "$label $DisplayName..." -ForegroundColor Cyan

Write-Host "  Path: $ApiExe"



$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue

if ($existing) {

    Write-Host "Stopping existing service..." -ForegroundColor Yellow

    Stop-Service $ServiceName -Force -ErrorAction SilentlyContinue

    if ($Upgrade) {

        Write-Host "Applying upgrade to Windows Service..." -ForegroundColor Yellow

        sc.exe config $ServiceName binPath= "`"$ApiExe`"" | Out-Null

    } else {

        sc.exe delete $ServiceName | Out-Null

        Start-Sleep -Seconds 2

        $existing = $null

    }

}



if (-not $existing) {

    New-Service -Name $ServiceName -BinaryPathName "`"$ApiExe`"" -DisplayName $DisplayName -StartupType Automatic | Out-Null

    sc.exe description $ServiceName "FOT POS API - SQL, Edari sync, LAN port 5000" | Out-Null

    sc.exe failure $ServiceName reset= 86400 actions= restart/60000/restart/60000/restart/60000 | Out-Null

    sc.exe failureflag $ServiceName 1 | Out-Null

    sc.exe config $ServiceName obj= "LocalSystem" | Out-Null

}



function Ensure-FwRule([string]$Name, [int]$Port, [string]$Protocol) {
    if (-not (Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $Name -Direction Inbound -LocalPort $Port -Protocol $Protocol -Action Allow | Out-Null
        Write-Host "Firewall rule added: $Protocol $Port" -ForegroundColor Green
    }
}

Ensure-FwRule "FOT POS API (TCP 5000)" 5000 "TCP"
Ensure-FwRule "FOT POS LAN Discovery (UDP 49500)" 49500 "UDP"

function Ensure-FwProgram([string]$Name, [string]$Program) {
    if (-not (Test-Path $Program)) { return }
    if (-not (Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $Name -Direction Inbound -Program $Program -Action Allow -Profile Any | Out-Null
        Write-Host "Firewall rule added: $Name" -ForegroundColor Green
    }
}

Ensure-FwProgram "FOT POS API Exe" $ApiExe
Ensure-FwProgram "FOT POS Server App" (Join-Path $InstallDir "FOT POS Server.exe")



$trayExe = Join-Path $InstallDir "FOT POS Server.exe"

if (Test-Path $trayExe) {

    $trayCmd = "`"$trayExe`" --background"

    New-ItemProperty -Path "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "FOTPOSServerTray" -Value $trayCmd -PropertyType String -Force | Out-Null

    Write-Host "Tray icon will start at sign-in (no window)." -ForegroundColor Green

}



$alreadyUp = $false

try {

    $health = Invoke-WebRequest -Uri "http://localhost:5000/health" -UseBasicParsing -TimeoutSec 3

    $alreadyUp = $health.StatusCode -eq 200

} catch { }



if ($alreadyUp) {

    Write-Host "API is already listening on port 5000. The service takes over at the next boot." -ForegroundColor DarkYellow

} else {

    Write-Host "Starting service..." -ForegroundColor Yellow

    Start-Service $ServiceName -ErrorAction SilentlyContinue

}

Set-Service $ServiceName -StartupType Automatic
sc.exe config $ServiceName start= auto | Out-Null
schtasks.exe /Create /TN "FOTPOSServerBoot" /TR "sc.exe start FOTPOSServer" /SC ONSTART /RU SYSTEM /RL HIGHEST /F | Out-Null



$deadline = (Get-Date).AddSeconds(45)

$ok = $false

while ((Get-Date) -lt $deadline) {

    try {

        $r = Invoke-WebRequest -Uri "http://localhost:5000/health" -UseBasicParsing -TimeoutSec 3

        if ($r.StatusCode -eq 200) { $ok = $true; break }

    } catch { Start-Sleep -Seconds 1 }

}



Write-Host ""

if ($ok) {

    $done = if ($Upgrade) { "UPDATED" } else { "INSTALLED" }

    Write-Host "SUCCESS — FOT POS Server $done and running." -ForegroundColor Green

    Write-Host "  Starts automatically when Windows boots."

    $lan = @()
    try {
        $lan = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
            Where-Object { $_.AddressFamily -eq 'InterNetwork' } |
            ForEach-Object { "http://$($_):5000" }
    } catch { }
    if ($lan.Count -gt 0) {
        Write-Host ("  LAN: " + ($lan -join "  "))
    } else {
        Write-Host "  LAN: http://<this-pc-ip>:5000"
    }

    Write-Host "  Logs: $env:ProgramData\FOT.Pos\logs\"

} else {

    Write-Warning "Service registered but health check failed. Check logs in ProgramData\FOT.Pos\logs\"

}

