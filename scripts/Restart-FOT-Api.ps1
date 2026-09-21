# Stops duplicate FOT POS API processes and deploys the latest published API build.
param(
    [string]$Source = (Join-Path (Split-Path $PSScriptRoot -Parent) "publish\desktop\FOT-POS-Server\Api"),
    [string[]]$Targets = @(
        "C:\Program Files\FOT POS Server\Api",
        "C:\Program Files\FOT POS\Server\Api"
    )
)

$ErrorActionPreference = "Stop"

$apiExe = Join-Path $Source "FOT.Pos.Api.exe"
$srcInfra = Join-Path $Source "FOT.Pos.Infrastructure.dll"
if (-not (Test-Path $apiExe)) {
    throw "Published API not found at $Source"
}

Write-Host "Stopping FOT POS services and processes..." -ForegroundColor Cyan
foreach ($n in @('FOT.Pos.Api', 'FOT POS Server', 'FOT.Pos.Server')) {
    Get-Process -Name $n -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
foreach ($svc in @('FOTPOSServer', 'FOT POS Server')) {
    $s = Get-Service -Name $svc -ErrorAction SilentlyContinue
    if ($s -and $s.Status -eq 'Running') {
        Stop-Service -Name $svc -Force -ErrorAction SilentlyContinue
    }
}
Start-Sleep -Seconds 5

for ($i = 0; $i -lt 5; $i++) {
    $portPid = (Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
    if (-not $portPid) { break }
    Write-Host "Killing process $portPid on port 5000" -ForegroundColor Yellow
    Stop-Process -Id $portPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

$srcHash = (Get-FileHash $srcInfra -Algorithm SHA256).Hash
foreach ($Target in $Targets) {
    Write-Host "Deploying API to $Target" -ForegroundColor Cyan
    New-Item -ItemType Directory -Path $Target -Force | Out-Null
    $rc = 0
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        robocopy $Source $Target /MIR /R:2 /W:2 /NFL /NDL /NJH /NJS /NP | Out-Null
        $rc = $LASTEXITCODE
        if ($rc -ge 8) {
            Start-Sleep -Seconds 2
            continue
        }
        $destInfra = Join-Path $Target "FOT.Pos.Infrastructure.dll"
        if ((Test-Path $destInfra) -and ((Get-FileHash $destInfra -Algorithm SHA256).Hash -eq $srcHash)) {
            break
        }
        Write-Host "  Retry $attempt - DLL not updated yet" -ForegroundColor Yellow
        Start-Sleep -Seconds 2
    }
    if ($rc -ge 8) { throw "robocopy failed for $Target with exit code $rc" }
    $destHash = (Get-FileHash (Join-Path $Target "FOT.Pos.Infrastructure.dll") -Algorithm SHA256).Hash
    if ($destHash -ne $srcHash) {
        Write-Warning "Deploy verify failed for $Target (hash mismatch). Run this script as Administrator."
    }
}

$primary = $Targets[0]

Write-Host "Starting API from $primary ..." -ForegroundColor Cyan
Start-Process -FilePath (Join-Path $primary "FOT.Pos.Api.exe") -WorkingDirectory $primary -WindowStyle Hidden
Start-Sleep -Seconds 6

$ver = (Get-Item (Join-Path $primary "FOT.Pos.Api.exe")).VersionInfo.ProductVersion
Write-Host "Deployed API version: $ver" -ForegroundColor Green
try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:5000/health" -TimeoutSec 15
    Write-Host "Health OK: $($health.status) schema=$($health.schemaVersion) bundled=$($health.bundledSchemaVersion)" -ForegroundColor Green
    if ($health.bundledSchemaVersion -lt 39) {
        Write-Warning "Running API is older than v2.2.8 (bundled schema $($health.bundledSchemaVersion)). Re-run as Administrator."
    }
} catch {
    Write-Warning ("Health check failed: " + $_.Exception.Message)
}
