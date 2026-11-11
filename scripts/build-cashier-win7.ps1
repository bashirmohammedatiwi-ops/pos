# FOT POS - cashier installer for Windows 7 (32-bit, also runs on 64-bit Windows 7).
#
# The normal cashier uses a current Electron, which needs Windows 10. Electron 22 is the last
# release that still runs on Windows 7/8, so this builds the same app on Electron 22 in a separate
# staging folder (desktop\win7-build) and leaves the normal build untouched.
#
# Differences from the normal cashier:
#   - Electron 22 (Chromium 108, Node 16); the local catalog uses better-sqlite3 (node:sqlite does not exist there)
#   - Tailwind's oklch() colours are rewritten as hex (Chromium 108 cannot read oklch)
#   - no spoken salesman name (the Piper voice engine is 64-bit and needs Windows 10)
#
# Output: publish\installers\<version>-win7\FOT-POS-Cashier-Setup-Win7-32bit.exe

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$desktop = Join-Path $root 'desktop'
$stage = Join-Path $desktop 'win7-build'
$electronVersion = '22.3.27'
$sqliteVersion = '9.6.0'

$version = (Get-Content (Join-Path $desktop 'package.json') -Raw | ConvertFrom-Json).version
Write-Host "FOT POS cashier for Windows 7 - version $version (Electron $electronVersion, ia32)" -ForegroundColor Cyan

Write-Host '[1/5] Cashier UI build...' -ForegroundColor Yellow
Push-Location $desktop
try { npm run build:pos; if ($LASTEXITCODE -ne 0) { throw 'Cashier UI build failed' } }
finally { Pop-Location }

Write-Host '[2/5] Staging folder...' -ForegroundColor Yellow
New-Item -ItemType Directory -Force $stage | Out-Null
foreach ($sub in @('electron', 'fot-pos', 'roles')) {
    $p = Join-Path $stage $sub
    if (Test-Path $p) { Remove-Item $p -Recurse -Force }
}
Copy-Item (Join-Path $desktop 'electron') (Join-Path $stage 'electron') -Recurse
Copy-Item (Join-Path $desktop 'roles') (Join-Path $stage 'roles') -Recurse
Copy-Item (Join-Path $root 'web\fot-pos\dist') (Join-Path $stage 'fot-pos') -Recurse

$css = @(Get-ChildItem (Join-Path $stage 'fot-pos\assets') -Filter '*.css' | ForEach-Object { $_.FullName })
node (Join-Path $root 'scripts\tools\oklch-to-hex.mjs') @css
if ($LASTEXITCODE -ne 0) { throw 'oklch conversion failed' }

$pkg = [ordered]@{
    name = 'fot-pos-cashier-win7'
    version = $version
    private = $true
    description = 'FOT POS Cashier for Windows 7'
    main = 'electron/main.cjs'
    author = 'Future of Technology'
    dependencies = [ordered]@{ 'better-sqlite3' = $sqliteVersion }
    devDependencies = [ordered]@{ electron = $electronVersion; 'electron-builder' = '^26.0.12' }
}
$pkgJson = $pkg | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText((Join-Path $stage 'package.json'), $pkgJson, (New-Object Text.UTF8Encoding $false))

$builder = Get-Content (Join-Path $desktop 'builder\cashier.json') -Raw | ConvertFrom-Json
$builder.directories.output = 'dist'
$builder.files = @('electron/**/*', 'package.json', 'node_modules/**/*')
$builder.extraResources = @(
    [ordered]@{ from = 'roles/pos.txt'; to = 'fot-role.txt' },
    [ordered]@{ from = 'fot-pos'; to = 'fot-pos' }
)
$builder.win.target = @([ordered]@{ target = 'nsis'; arch = @('ia32') })
$builder.win.artifactName = 'FOT-POS-Cashier-Setup-Win7-32bit.${ext}'
$builder.nsis.artifactName = 'FOT-POS-Cashier-Setup-Win7-32bit.exe'
$builder | Add-Member -NotePropertyName electronVersion -NotePropertyValue $electronVersion -Force
$builder | Add-Member -NotePropertyName npmRebuild -NotePropertyValue $false -Force
$builder | Add-Member -NotePropertyName asarUnpack -NotePropertyValue @('node_modules/better-sqlite3/**/*') -Force
[IO.File]::WriteAllText((Join-Path $stage 'builder.json'), ($builder | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding $false))

Write-Host '[3/5] Packages (Electron 22 + better-sqlite3 for ia32)...' -ForegroundColor Yellow
Push-Location $stage
try {
    npm install --no-audit --no-fund --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
    # Electron's own install script downloads the host binary; the packager fetches ia32 itself.
    # better-sqlite3 must be the Electron 22 / ia32 build, not the build for this machine's Node.
    Push-Location (Join-Path $stage 'node_modules\better-sqlite3')
    try {
        npx --yes prebuild-install --runtime electron --target $electronVersion --arch ia32 --platform win32 --verbose
        if ($LASTEXITCODE -ne 0) { throw 'better-sqlite3 prebuilt download failed' }
    }
    finally { Pop-Location }

    Write-Host '[4/5] Installer...' -ForegroundColor Yellow
    if (Test-Path 'dist') { Remove-Item 'dist' -Recurse -Force }
    npx electron-builder --win nsis --ia32 --config builder.json
    if ($LASTEXITCODE -ne 0) { throw 'Installer build failed' }
}
finally { Pop-Location }

Write-Host '[5/5] Copy to publish\installers...' -ForegroundColor Yellow
$out = Join-Path $root "publish\installers\$version-win7"
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item (Join-Path $stage 'dist\FOT-POS-Cashier-Setup-Win7-32bit.exe') $out -Force
Get-ChildItem $out -Filter '*.exe' | ForEach-Object { '{0}  {1:N1} MB' -f $_.FullName, ($_.Length / 1MB) }
