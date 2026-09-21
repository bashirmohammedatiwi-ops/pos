# Build the Android price-checker APK from the standalone kiosk page.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$standalone = Join-Path $root "web\fot-price\standalone\index.html"
$androidDir = Join-Path $root "android\price-checker"
$assets = Join-Path $androidDir "app\src\main\assets\www"
$outDir = Join-Path $root "publish\price-checker"

if (-not (Test-Path $standalone)) { throw "standalone kiosk page is missing" }
if (Test-Path $assets) { Remove-Item $assets -Recurse -Force }
New-Item -ItemType Directory -Path $assets -Force | Out-Null
Copy-Item $standalone (Join-Path $assets "index.html") -Force
Write-Host "  Copied standalone kiosk into Android assets" -ForegroundColor DarkCyan

New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$sdk = $env:ANDROID_HOME
if (-not $sdk) { $sdk = $env:ANDROID_SDK_ROOT }
if (-not $sdk) { $sdk = "C:\Users\Future of Technology\AppData\Local\Android\Sdk" }
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
if (-not $env:JAVA_HOME) { $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr" }

$gradlew = Join-Path $androidDir "gradlew.bat"
if (-not (Test-Path $gradlew)) {
    Write-Host "Gradle wrapper missing." -ForegroundColor Yellow
    exit 0
}

Write-Host "Assembling APK..." -ForegroundColor Cyan
Push-Location $androidDir
try {
    & $gradlew assembleRelease --no-daemon
    if ($LASTEXITCODE -ne 0) { throw "Gradle assembleRelease failed" }
}
finally { Pop-Location }

$apk = Get-ChildItem (Join-Path $androidDir "app\build\outputs\apk") -Recurse -Filter "*.apk" | Select-Object -First 1
if ($apk) {
    Copy-Item $apk.FullName (Join-Path $outDir "FOT-Price.apk") -Force
    Copy-Item $apk.FullName (Join-Path $outDir "FOT-Price-Checker.apk") -Force
    if (Test-Path (Join-Path $outDir "FOT-Price.zip")) { Remove-Item (Join-Path $outDir "FOT-Price.zip") -Force }
    Compress-Archive -Path (Join-Path $outDir "FOT-Price.apk") -DestinationPath (Join-Path $outDir "FOT-Price.zip") -Force
    Write-Host ("APK: {0}" -f (Join-Path $outDir "FOT-Price.apk")) -ForegroundColor Green
}
