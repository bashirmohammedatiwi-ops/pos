# بناء تطبيق «ديما الفريق» لأندرويد (APK موقّع):
#   ويب الموظفين -> mobile/www ، ويب المدراء -> mobile/www/manager ، ثم Capacitor + Gradle.
# الاستخدام: powershell -File scripts/build-team-app.ps1 -Version 1.0.0 [-ApiBase http://187.124.23.65:4700] [-Push]
param(
    [string]$Version = "1.0.0",
    [string]$ApiBase = "http://187.124.23.65:4700",
    [switch]$Push
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$mobile = Join-Path $root "mobile"
$androidDir = Join-Path $mobile "android"
$www = Join-Path $mobile "www"
$outDir = Join-Path $root "publish\team-app"

if ($Version -notmatch '^(\d+)\.(\d+)\.(\d+)$') { throw "Version must look like 1.2.3" }
$versionCode = [int]$Matches[1] * 10000 + [int]$Matches[2] * 100 + [int]$Matches[3]

# الإشعارات تحتاج google-services.json من Firebase
$googleServices = Join-Path $androidDir "app\google-services.json"
if ($Push -and -not (Test-Path $googleServices)) { throw "Push requested but mobile\android\app\google-services.json is missing" }

$env:VITE_API_BASE = $ApiBase
$env:VITE_APP_VERSION = $Version
$env:VITE_PUSH = $(if ($Push) { "1" } else { "0" })

Write-Host "Building staff app (phone design)..." -ForegroundColor Cyan
Push-Location (Join-Path $root "web\fot-seller")
try {
    & npx tsc -b
    if ($LASTEXITCODE -ne 0) { throw "fot-seller typecheck failed" }
    # VITE_TARGET=app: نقطة دخول وتصميم تطبيق الهاتف (src/app) بدل واجهة الويب
    $env:VITE_TARGET = "app"
    & npx vite build --base ./ --outDir $www --emptyOutDir
    if ($LASTEXITCODE -ne 0) { throw "fot-seller build failed" }
}
finally {
    Remove-Item Env:VITE_TARGET -ErrorAction SilentlyContinue
    Pop-Location
}

Write-Host "Building manager web..." -ForegroundColor Cyan
Push-Location (Join-Path $root "web\fot-manager")
try {
    & npx tsc -b
    if ($LASTEXITCODE -ne 0) { throw "fot-manager typecheck failed" }
    & npx vite build --base ./ --outDir (Join-Path $www "manager") --emptyOutDir
    if ($LASTEXITCODE -ne 0) { throw "fot-manager build failed" }
}
finally { Pop-Location }

$sdk = $env:ANDROID_HOME
if (-not $sdk) { $sdk = $env:ANDROID_SDK_ROOT }
if (-not $sdk) { $sdk = "C:\Users\Future of Technology\AppData\Local\Android\Sdk" }
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
if (-not $env:JAVA_HOME) { $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr" }
# JDK 21 على ويندوز: قناة الاتصال الداخلية تفشل في مجلد TEMP المختصر (Unable to establish loopback connection)
$env:JAVA_TOOL_OPTIONS = "-Djdk.net.unixdomain.tmpdir=C:\Users\Public"

Write-Host "Syncing Capacitor..." -ForegroundColor Cyan
Push-Location $mobile
try {
    if (-not (Test-Path (Join-Path $mobile "node_modules"))) { & npm install --no-audit --no-fund }
    & npx cap sync android
    if ($LASTEXITCODE -ne 0) { throw "cap sync failed" }
}
finally { Pop-Location }

# مفتاح توقيع الإصدار: يُنشأ مرة واحدة ويجب حفظ نسخة منه (بدونه لا يمكن تحديث التطبيق على الهواتف)
$keystoreProps = Join-Path $androidDir "keystore.properties"
$keystore = Join-Path $androidDir "deema-team-release.jks"
if (-not (Test-Path $keystoreProps)) {
    $secret = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")).Substring(0, 32)
    $keytool = Join-Path $env:JAVA_HOME "bin\keytool.exe"
    & $keytool -genkeypair -v -keystore $keystore -alias deema-team -keyalg RSA -keysize 2048 -validity 10000 `
        -storepass $secret -keypass $secret -dname "CN=Deema Al Hayat Team, O=Deema Al Hayat, C=IQ"
    if ($LASTEXITCODE -ne 0) { throw "keytool failed" }
    @(
        "storeFile=deema-team-release.jks",
        "storePassword=$secret",
        "keyAlias=deema-team",
        "keyPassword=$secret"
    ) | Set-Content -Path $keystoreProps -Encoding ascii
    Write-Host "Created release keystore: $keystore  (BACK IT UP with keystore.properties)" -ForegroundColor Yellow
}

Write-Host "Assembling APK $Version ($versionCode)..." -ForegroundColor Cyan
Push-Location $androidDir
try {
    & .\gradlew.bat assembleRelease --no-daemon "-PteamVersionCode=$versionCode" "-PteamVersionName=$Version"
    if ($LASTEXITCODE -ne 0) { throw "Gradle assembleRelease failed" }
}
finally { Pop-Location }

$apk = Get-ChildItem (Join-Path $androidDir "app\build\outputs\apk\release") -Filter "*.apk" | Select-Object -First 1
if (-not $apk) { throw "APK not found" }
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$target = Join-Path $outDir "DeemaTeam-$Version.apk"
Copy-Item $apk.FullName $target -Force
Copy-Item $apk.FullName (Join-Path $outDir "DeemaTeam.apk") -Force
Write-Host ("APK: {0}" -f $target) -ForegroundColor Green
