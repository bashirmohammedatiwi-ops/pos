#Requires -RunAsAdministrator

<#
.SYNOPSIS
  Installs NebulaWebService (PAX / MasterCard middleware on port 9092).

.DESCRIPTION
  Copies the service files (unless -SkipCopy), auto-detects the PAX A910 USB
  data port (VID_2FB8 MI_00), updates application.properties, registers the
  Windows service, and starts it automatically on boot.

.PARAMETER SourceDir
  Folder that contains webservice.jar (USB package or build output).

.PARAMETER TargetDir
  Installation folder. Defaults to Program Files (x86)\NebulaWebService.

.PARAMETER ComPort
  Override COM port (e.g. COM4). When omitted, PAX is auto-detected.

.PARAMETER SkipCopy
  Use when files are already in TargetDir (e.g. Inno Setup post-install).
#>

param(
    [string]$SourceDir,
    [string]$TargetDir = "${env:ProgramFiles(x86)}\NebulaWebService",
    [string]$ComPort,
    [switch]$SkipCopy
)

$ErrorActionPreference = "Stop"
$ServiceName = "NebulaWebService"

function Get-PaxDataComPort {
    $usb = "HKLM:\SYSTEM\CurrentControlSet\Enum\USB"
    if (-not (Test-Path $usb)) { return $null }

    foreach ($vidKey in Get-ChildItem $usb -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -match "VID_2FB8" }) {
        foreach ($inst in Get-ChildItem $vidKey.PSPath -ErrorAction SilentlyContinue) {
            if ($inst.PSChildName -notmatch "MI_00") { continue }
            $paramPath = Join-Path $inst.PSPath "Device Parameters"
            if (-not (Test-Path $paramPath)) { continue }
            $port = (Get-ItemProperty $paramPath -ErrorAction SilentlyContinue).PortName
            if ($port) { return [string]$port }
        }
    }

    foreach ($vidKey in Get-ChildItem $usb -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -match "VID_2FB8" }) {
        foreach ($inst in Get-ChildItem $vidKey.PSPath -ErrorAction SilentlyContinue) {
            $paramPath = Join-Path $inst.PSPath "Device Parameters"
            if (-not (Test-Path $paramPath)) { continue }
            $port = (Get-ItemProperty $paramPath -ErrorAction SilentlyContinue).PortName
            if ($port) { return [string]$port }
        }
    }

    return $null
}

function Set-ComPortInProperties {
    param([string]$Path, [string]$Port)
    $content = Get-Content $Path -Raw -Encoding UTF8
    if ($content -match "device\.defaultPortname\s*=") {
        $content = $content -replace "device\.defaultPortname\s*=.*", "device.defaultPortname=$Port"
    } else {
        $content += "`ndevice.defaultPortname=$Port`n"
    }
    Set-Content -Path $Path -Value $content.TrimEnd() + "`n" -Encoding UTF8 -NoNewline
}

function Test-NebulaSource {
    param([string]$Dir)
    Test-Path (Join-Path $Dir "webservice.jar") -and
    (Test-Path (Join-Path $Dir "webservice64.exe") -or Test-Path (Join-Path $Dir "webservice32.exe"))
}

# Resolve source folder when launched from USB / scripts package.
if (-not $SourceDir) {
    $candidates = @(
        (Join-Path $PSScriptRoot "NebulaWebService"),
        (Join-Path $PSScriptRoot "..\publish\nebula-package\NebulaWebService"),
        "F:\NebulaWebService",
        "${env:ProgramFiles(x86)}\NebulaWebService"
    )
    foreach ($c in $candidates) {
        if (Test-NebulaSource $c) { $SourceDir = $c; break }
    }
}

Write-Host ""
Write-Host "=== FOT POS — NebulaWebService installer ===" -ForegroundColor Cyan
Write-Host "  Target: $TargetDir"

if (-not $SkipCopy) {
    if (-not $SourceDir -or -not (Test-NebulaSource $SourceDir)) {
        throw "NebulaWebService source not found. Place this script next to a NebulaWebService folder or pass -SourceDir."
    }
    Write-Host "  Source: $SourceDir" -ForegroundColor Gray
    if (-not (Test-Path $TargetDir)) {
        New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
    }
    Write-Host "Copying files..." -ForegroundColor Yellow
    robocopy $SourceDir $TargetDir /MIR /XD tmp /XF *.log /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }
} elseif (-not (Test-NebulaSource $TargetDir)) {
    throw "NebulaWebService files missing in $TargetDir"
}

if (-not $ComPort) {
    $ComPort = Get-PaxDataComPort
}
if (-not $ComPort) {
    $ComPort = "COM4"
    Write-Warning "PAX not detected — defaulting to COM4. Connect the device and re-run, or pass -ComPort."
} else {
    Write-Host "  PAX COM port: $ComPort" -ForegroundColor Green
}

$propsPath = Join-Path $TargetDir "application.properties"
if (-not (Test-Path $propsPath)) {
    @"
serverSocket.host=0.0.0.0
server.port=9092
device.defaultPortname=$ComPort
client.replyAddress=http://localhost:9999
Logger.level=INFO
spring.mvc.pathmatch.matching-strategy=ANT_PATH_MATCHER
spring.devtools.restart.enabled=false
"@ | Set-Content $propsPath -Encoding UTF8
} else {
    Set-ComPortInProperties -Path $propsPath -Port $ComPort
}

Push-Location $TargetDir
try {
    $wrapper = if ([Environment]::Is64BitOperatingSystem) { "webservice64.exe" } else { "webservice32.exe" }
    if (-not (Test-Path $wrapper)) { throw "$wrapper not found in $TargetDir" }

    $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "Stopping existing service..." -ForegroundColor Yellow
        Stop-Service $ServiceName -Force -ErrorAction SilentlyContinue
        & ".\$wrapper" uninstall | Out-Null
        Start-Sleep -Seconds 2
    }

    Write-Host "Registering Windows service..." -ForegroundColor Yellow
    & ".\$wrapper" install | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "$wrapper install failed" }

    Set-Service $ServiceName -StartupType Automatic
    Write-Host "Starting service..." -ForegroundColor Yellow
    Start-Service $ServiceName
} finally {
    Pop-Location
}

Start-Sleep -Seconds 3

$listening = Get-NetTCPConnection -LocalPort 9092 -State Listen -ErrorAction SilentlyContinue
$health = $null
try {
    $health = (Invoke-WebRequest "http://localhost:9092/isConnected" -UseBasicParsing -TimeoutSec 8).Content
} catch {
    $health = $_.Exception.Message
}

Write-Host ""
if ($listening) {
    Write-Host "SUCCESS — NebulaWebService is running on port 9092." -ForegroundColor Green
    Write-Host "  Service : $ServiceName (Automatic)"
    Write-Host "  Folder  : $TargetDir"
    Write-Host "  COM     : $ComPort"
    Write-Host "  Health  : $health"
    Write-Host ""
    Write-Host "In FOT POS set: mpos_service=localhost:9092  mpos_com_port=$ComPort"
} else {
    Write-Warning "Service installed but port 9092 is not listening. Check $TargetDir\webservice64.out.log"
}
