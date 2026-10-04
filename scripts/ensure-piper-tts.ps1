# Downloads Piper TTS + Arabic voice into desktop/tts for offline cashier speech.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$ttsDir = Join-Path $root "desktop\tts"
$piperExe = Join-Path $ttsDir "piper.exe"
$modelOnnx = Join-Path $ttsDir "ar_JO-kareem-medium.onnx"
$modelJson = Join-Path $ttsDir "ar_JO-kareem-medium.onnx.json"
$espeakData = Join-Path $ttsDir "espeak-ng-data"

New-Item -ItemType Directory -Path $ttsDir -Force | Out-Null

if ((Test-Path $piperExe) -and (Test-Path $modelOnnx) -and (Test-Path $modelJson) -and (Test-Path $espeakData)) {
    Write-Host "Piper TTS already present at $ttsDir" -ForegroundColor DarkCyan
    return
}

Write-Host "Fetching Piper TTS (offline Arabic voice)..." -ForegroundColor Cyan

$zipUrl = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip"
$zipPath = Join-Path $env:TEMP "piper_windows_amd64.zip"
$extractDir = Join-Path $env:TEMP "piper_windows_amd64_extract"

if ((-not (Test-Path $piperExe)) -or (-not (Test-Path $espeakData))) {
    if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue }
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
    $inner = Get-ChildItem $extractDir -Directory | Select-Object -First 1
    $source = if ($inner) { $inner.FullName } else { $extractDir }
    Get-ChildItem $source -File | ForEach-Object {
        Copy-Item $_.FullName (Join-Path $ttsDir $_.Name) -Force
    }
    $espeakSrc = Join-Path $source "espeak-ng-data"
    if (Test-Path $espeakSrc) {
        if (Test-Path $espeakData) { Remove-Item $espeakData -Recurse -Force -ErrorAction SilentlyContinue }
        Copy-Item $espeakSrc $espeakData -Recurse -Force
    }
    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
    Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue
}

$voiceBase = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/ar/ar_JO/kareem/medium"
if (-not (Test-Path $modelOnnx)) {
    Invoke-WebRequest -Uri "$voiceBase/ar_JO-kareem-medium.onnx" -OutFile $modelOnnx -UseBasicParsing
}
if (-not (Test-Path $modelJson)) {
    Invoke-WebRequest -Uri "$voiceBase/ar_JO-kareem-medium.onnx.json" -OutFile $modelJson -UseBasicParsing
}

if (-not (Test-Path $piperExe)) { throw "piper.exe missing after download" }
if (-not (Test-Path $modelOnnx)) { throw "Arabic voice model missing after download" }
if (-not (Test-Path $espeakData)) { throw "espeak-ng-data missing; Piper cannot speak without it" }

Write-Host "Piper TTS ready: $ttsDir" -ForegroundColor Green
