# Builds a USB-ready NebulaWebService package + optional Inno Setup installer.
param(
    [string]$SourcePath = "${env:ProgramFiles(x86)}\NebulaWebService"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$packageRoot = Join-Path $root "publish\nebula-package"
$serviceDest = Join-Path $packageRoot "NebulaWebService"
$installerOut = Join-Path $root "publish\installers"

function Find-InnoCompiler {
    $candidates = @(
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
        "${env:LOCALAPPDATA}\Programs\Inno Setup 6\ISCC.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return $c }
    }
    return $null
}

if (-not (Test-Path (Join-Path $SourcePath "webservice.jar"))) {
    $alt = "F:\NebulaWebService"
    if (Test-Path (Join-Path $alt "webservice.jar")) { $SourcePath = $alt }
    else { throw "NebulaWebService source not found. Pass -SourcePath or install to Program Files (x86)." }
}

Write-Host "Building NebulaWebService package from: $SourcePath" -ForegroundColor Cyan

if (Test-Path $packageRoot) { Remove-Item $packageRoot -Recurse -Force }
New-Item -ItemType Directory -Path $serviceDest -Force | Out-Null

robocopy $SourcePath $serviceDest /MIR /XD tmp /XF *.log /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed" }

Copy-Item (Join-Path $PSScriptRoot "Install-NebulaWebService.ps1") $packageRoot -Force
Copy-Item (Join-Path $PSScriptRoot "Install-NebulaWebService.bat") $packageRoot -Force

$readme = @"
FOT POS — NebulaWebService (ماستر كارد / PAX)
=============================================

1) وصّل جهاز PAX A910S بـ USB
2) شغّل تطبيق Qi Card على الجهاز
3) انقر مرتين: Install-NebulaWebService.bat
4) بعد النجاح افتح FOT POS وجرب ماستر كارد F10

الإعدادات في نقطة البيع:
  mpos_service  = localhost:9092
  mpos_com_port = COM4 (يُكتشف تلقائياً)

الخدمة تبدأ تلقائياً مع ويندوز باسم: NebulaWebService
"@
Set-Content (Join-Path $packageRoot "README.txt") $readme -Encoding UTF8

Write-Host "Package ready: $packageRoot" -ForegroundColor Green

$iscc = Find-InnoCompiler
if ($iscc) {
    New-Item -ItemType Directory -Path $installerOut -Force | Out-Null
    & $iscc (Join-Path $root "installer\NebulaWebService.iss")
    if ($LASTEXITCODE -ne 0) { throw "Inno Setup compile failed" }
    Write-Host "Installer: $installerOut\NebulaWebService-Setup.exe" -ForegroundColor Green
} else {
    Write-Warning "Inno Setup not found. USB package only: publish\nebula-package"
}
