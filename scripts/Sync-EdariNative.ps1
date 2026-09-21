#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Copies NexusDB ADO provider + connector DLLs into a FOT POS API folder.
.DESCRIPTION
  Fixes "NexusDB.ADOProvider.dll / AdoServerConnectorV4_64.dll not found" for installed servers.
#>
$ErrorActionPreference = "Stop"

param(
    [string]$ApiDir = "C:\Program Files\FOT POS\Server\Api"
)

function Find-SourceNativeDir {
    param([string]$Root)
    $candidates = @(
        (Join-Path $Root "publish\desktop\FOT-POS-Server\Api\Edari\Native"),
        (Join-Path $Root "src\FOT.Pos.Infrastructure\bin\Release\net9.0\Edari\Native"),
        (Join-Path $Root "src\FOT.Pos.Infrastructure\Edari\Native"),
        "D:\Future of Technology\EdariNX\Win_Net",
        "D:\FOT POS\Dashboard\Services\FOTPOSService",
        "D:\FOTLabel\FOTLabel"
    )
    foreach ($dir in $candidates) {
        $provider = Join-Path $dir "NexusDB.ADOProvider.dll"
        if (Test-Path $provider) { return $dir }
    }
    throw "Could not locate NexusDB.ADOProvider.dll in known folders."
}

if (-not (Test-Path $ApiDir)) {
    throw "API folder not found: $ApiDir"
}

$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root "src"))) {
    throw "Run this script from the FOT POS repository (expected sibling src folder)."
}

$sourceDir = Find-SourceNativeDir -Root $root
$nativeDir = Join-Path $ApiDir "Edari\Native"
New-Item -ItemType Directory -Path $nativeDir -Force | Out-Null

$files = @(
    "NexusDB.ADOProvider.dll",
    "ADOServerConnectorV4_64.dll",
    "ADOServerConnectorV4.dll"
)

Write-Host "Source: $sourceDir" -ForegroundColor Cyan
Write-Host "Target: $ApiDir" -ForegroundColor Cyan

foreach ($name in $files) {
    $src = Join-Path $sourceDir $name
    if (-not (Test-Path $src)) { continue }
    Copy-Item $src (Join-Path $nativeDir $name) -Force
}

$connector64 = Join-Path $nativeDir "ADOServerConnectorV4_64.dll"
if (Test-Path $connector64) {
    Copy-Item $connector64 (Join-Path $ApiDir "AdoServerConnectorV4_64.dll") -Force
    Copy-Item $connector64 (Join-Path $ApiDir "ADOServerConnectorV4_64.dll") -Force
}

$provider = Join-Path $nativeDir "NexusDB.ADOProvider.dll"
if (Test-Path $provider) {
    Copy-Item $provider (Join-Path $ApiDir "NexusDB.ADOProvider.dll") -Force
}

Write-Host "Edari native binaries synced." -ForegroundColor Green
Write-Host "Restart FOT POS Server / FOTPOSServer Windows service, then test Edari connection." -ForegroundColor Yellow
