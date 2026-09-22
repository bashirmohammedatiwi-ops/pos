# FOT POS — publish three Electron installers (server / admin / cashier)
param(
    [switch]$KeepRunning
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "publish\desktop"
$installerOut = Join-Path $root "publish\installers"
$serverDir = Join-Path $out "FOT-POS-Server"
$pubArgs = @(
    "-c", "Release",
    "-r", "win-x64",
    "--self-contained", "true",
    "-p:PublishReadyToRun=true",
    "-p:IncludeNativeLibrariesForSelfExtract=true",
    "--nologo"
)

function Write-Utf8([string]$Path, [string]$Content) {
    $utf8 = New-Object System.Text.UTF8Encoding $true
    [System.IO.File]::WriteAllText($Path, $Content, $utf8)
}

function Ensure-PublishDirectory([string]$Path) {
    if (Test-Path $Path) {
        try {
            Remove-Item $Path -Recurse -Force -ErrorAction Stop
        }
        catch {
            Write-Host ("  Note: could not clear {0} (in use) - publishing over existing files." -f $Path) -ForegroundColor DarkYellow
        }
    }
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
}

function Get-ProductVersion {
    $props = Join-Path $root "Directory.Build.props"
    if (-not (Test-Path $props)) { return "2.2.1" }
    $xml = [xml](Get-Content $props -Raw)
    $ver = $xml.Project.PropertyGroup.Version
    if (-not $ver) { return "2.2.1" }
    return $ver
}

Write-Host "Building FOT POS Electron installers (self-contained API + 3 setups)..." -ForegroundColor Cyan
$productVersion = Get-ProductVersion
Write-Host "Product version: $productVersion" -ForegroundColor DarkCyan
Write-Host ""

Write-Host "Running Verify-Build before publish..." -ForegroundColor Cyan
& (Join-Path $root "scripts\Verify-Build.ps1") -SkipMigrations -SkipOpenApi
if ($LASTEXITCODE -ne 0) { throw "Verify-Build failed; publish aborted" }
Write-Host ""

function Stop-FotPosProcesses {
    $names = @(
        'FOT.Pos.Api', 'FOT.Pos.Server', 'FOT.Pos.Admin', 'FOT.Pos.Client', 'FOT.Pos.Admin.Remote',
        'FOT POS', 'FOT POS Server', 'FOT POS Admin', 'FOT POS Cashier'
    )
    foreach ($n in $names) {
        Get-Process -Name $n -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    }
    try { Stop-Service -Name FOTPOSServer -Force -ErrorAction SilentlyContinue } catch {}
    Start-Sleep -Seconds 2
}

if ($KeepRunning) {
    Write-Host "Keeping the live shop server running (no process/service stop)." -ForegroundColor DarkYellow
} else {
    Stop-FotPosProcesses
}

foreach ($dir in @($serverDir, $installerOut)) {
    Ensure-PublishDirectory $dir
}

function Ensure-EdariNativeBinaries([string]$ApiDir) {
    $nativeDir = Join-Path $ApiDir "Edari\Native"
    New-Item -ItemType Directory -Path $nativeDir -Force | Out-Null

    $sourceDirs = @(
        (Join-Path $root "src\FOT.Pos.Infrastructure\bin\Release\net9.0\Edari\Native"),
        (Join-Path $root "src\FOT.Pos.Infrastructure\Edari\Native"),
        "D:\Future of Technology\EdariNX\Win_Net",
        "D:\FOT POS\Dashboard\Services\FOTPOSService",
        "D:\FOTLabel\FOTLabel"
    )

    $required = @(
        "NexusDB.ADOProvider.dll",
        "ADOServerConnectorV4_64.dll",
        "ADOServerConnectorV4.dll"
    )

    foreach ($name in $required) {
        $dest = Join-Path $nativeDir $name
        foreach ($dir in $sourceDirs) {
            $src = Join-Path $dir $name
            if (-not (Test-Path $src)) { continue }
            Copy-Item $src $dest -Force
            break
        }
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
}

Write-Host "[1/4] API (for server installer)..." -ForegroundColor Yellow
$apiOut = Join-Path $serverDir "Api"
dotnet publish (Join-Path $root "src\FOT.Pos.Api\FOT.Pos.Api.csproj") @pubArgs -o $apiOut
if ($LASTEXITCODE -ne 0) { throw "API publish failed" }
Ensure-EdariNativeBinaries $apiOut
Copy-Item (Join-Path $root "scripts\Install-WindowsService.ps1") (Join-Path $serverDir "Install-WindowsService.ps1") -Force
Copy-Item (Join-Path $root "scripts\Uninstall-WindowsService.ps1") (Join-Path $serverDir "Uninstall-WindowsService.ps1") -Force

Write-Host "[2/4] Electron cashier installer..." -ForegroundColor Yellow
$desktopDir = Join-Path $root "desktop"
if (-not (Test-Path (Join-Path $desktopDir "package.json"))) {
    throw "desktop\package.json was not found"
}

Push-Location $desktopDir
try {
    if (-not (Test-Path "node_modules")) { npm install }
    npm run build:admin
    if ($LASTEXITCODE -ne 0) { throw "Admin UI build failed" }
    $adminUi = Join-Path $root "web\fot-admin\dist"
    if (Test-Path (Join-Path $adminUi "index.html")) {
        $www = Join-Path $apiOut "wwwroot"
        if (Test-Path $www) { Remove-Item $www -Recurse -Force }
        Copy-Item $adminUi $www -Recurse -Force
        Write-Host "  Admin UI copied to API wwwroot for LAN browser access" -ForegroundColor DarkCyan
        $pricePage = Join-Path $root "web\fot-price\standalone\index.html"
        if (Test-Path $pricePage) {
            $priceWww = Join-Path $www "price"
            New-Item -ItemType Directory -Path $priceWww -Force | Out-Null
            Copy-Item $pricePage (Join-Path $priceWww "index.html") -Force
            Write-Host "  Price checker UI copied to API wwwroot/price" -ForegroundColor DarkCyan
        }
    }
    npm run build:pos
    if ($LASTEXITCODE -ne 0) { throw "Cashier UI build failed" }

    npm run dist:cashier
    if ($LASTEXITCODE -ne 0) { throw "Cashier installer build failed" }

    Write-Host "[3/4] Electron admin installer..." -ForegroundColor Yellow
    npm run dist:admin
    if ($LASTEXITCODE -ne 0) { throw "Admin installer build failed" }

    Write-Host "[4/4] Electron server installer (API + admin)..." -ForegroundColor Yellow
    npm run dist:server
    if ($LASTEXITCODE -ne 0) { throw "Server installer build failed" }

    foreach ($sub in @("cashier", "admin", "server")) {
        $dir = Join-Path $desktopDir "dist-out73\$sub"
        if (Test-Path $dir) {
            Get-ChildItem $dir -Filter "FOT-POS-*-Setup.exe" | Copy-Item -Destination $installerOut -Force
        }
    }
}
finally {
    Pop-Location
}

Write-Utf8 (Join-Path $installerOut "README-AR.txt") @"
FOT POS — ملفات التثبيت (الإصدار $productVersion)
=====================================

ثلاثة ملفات منفصلة. ثبّت ما يناسب الجهاز فقط.

1) الحاسبة الرئيسية (الخادم + لوحة التحكم)
   FOT-POS-Server-Setup.exe
   يثبت خدمة Windows FOTPOSServer + API على المنفذ 5000 + برنامج الإدارة.
   المتطلبات: SQL Server + Edari
   من أي جهاز على الشبكة يمكن فتح لوحة التحكم في المتصفح:
   http://IP-الحاسبة-الرئيسية:5000

2) أجهزة الإدارة الإضافية
   FOT-POS-Admin-Setup.exe
   لوحة التحكم فقط. عند الدخول اضغط «بحث عن الخادم على الشبكة»
   أو الصق: http://IP-الحاسبة-الرئيسية:5000

3) أجهزة الكاشير
   FOT-POS-Cashier-Setup.exe
   نقطة البيع فقط. نفس عنوان API، أو بحث تلقائي على الشبكة.
   إن بعت من الحاسبة الرئيسية أيضاً: ثبّت هذا الملف عليها بعد ملف الخادم.

إذا كان البرنامج مثبتاً مسبقاً، يعرض المعالج تحديثاً ويحافظ على الإعدادات.
"@

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Green
Write-Host "Installers: $installerOut"
Get-ChildItem $installerOut -Filter "*.exe" | ForEach-Object {
    Write-Host ("  {0}  ({1:N1} MB)" -f $_.Name, ($_.Length / 1MB))
}
