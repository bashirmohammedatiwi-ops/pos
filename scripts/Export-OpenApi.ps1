# Builds the API and writes swagger.json + generated TS types into packages/fot-shared.
param(
    [string]$OutputJson = "",
    [switch]$SkipTypes
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$apiProj = Join-Path $root "src\FOT.Pos.Api\FOT.Pos.Api.csproj"
$outDir = Join-Path $root "web\packages\fot-shared"
$swaggerJson = if ($OutputJson) { $OutputJson } else { Join-Path $outDir "openapi.json" }
$typesFile = Join-Path $outDir "src\openapi.d.ts"

Write-Host "Building API..." -ForegroundColor Cyan
dotnet build $apiProj -c Release -nologo -v q
if ($LASTEXITCODE -ne 0) { throw "API build failed" }

Write-Host "Exporting swagger.json..." -ForegroundColor Cyan
$env:FOT_SKIP_STARTUP_DB = "1"
$env:ASPNETCORE_ENVIRONMENT = "Development"
$dir = Split-Path -Parent $swaggerJson
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
dotnet run --project $apiProj -c Release --no-build --no-launch-profile -- --export-openapi $swaggerJson
if ($LASTEXITCODE -ne 0) { throw "OpenAPI export failed" }
if (-not (Test-Path $swaggerJson)) { throw "openapi.json was not written" }

if (-not $SkipTypes) {
    Write-Host "Generating TypeScript types..." -ForegroundColor Cyan
    Push-Location $outDir
    try {
        npx --yes openapi-typescript@7.4.4 $swaggerJson -o $typesFile
        if ($LASTEXITCODE -ne 0) { throw "openapi-typescript failed" }
    }
    finally { Pop-Location }
    Write-Host "Wrote $typesFile" -ForegroundColor Green
}

Write-Host "Wrote $swaggerJson" -ForegroundColor Green
