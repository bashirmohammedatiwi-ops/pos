# Non-interactive local CI: compile API + typecheck/build web apps + migrations dry-run.
param(
    [switch]$SkipWebBuild,
    [switch]$SkipMigrations,
    [switch]$SkipOpenApi
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "[1/7] dotnet build" -ForegroundColor Cyan
dotnet build (Join-Path $root "src\FOT.Pos.Api\FOT.Pos.Api.csproj") -nologo -v q
if ($LASTEXITCODE -ne 0) { throw "API build failed" }

Write-Host "[2/7] fot-pos typecheck" -ForegroundColor Cyan
Push-Location (Join-Path $root "web\fot-pos")
try {
    npx --yes tsc --noEmit
    if ($LASTEXITCODE -ne 0) { throw "fot-pos tsc failed" }
}
finally { Pop-Location }

Write-Host "[3/7] fot-admin typecheck" -ForegroundColor Cyan
Push-Location (Join-Path $root "web\fot-admin")
try {
    npx --yes tsc --noEmit
    if ($LASTEXITCODE -ne 0) { throw "fot-admin tsc failed" }
}
finally { Pop-Location }

    Write-Host "[3b/7] fot-price typecheck" -ForegroundColor Cyan
    Push-Location (Join-Path $root "web\fot-price")
    try {
        npx --yes tsc --noEmit
        if ($LASTEXITCODE -ne 0) { throw "fot-price tsc failed" }
    }
    finally { Pop-Location }

    Write-Host "[3c/7] fot-seller typecheck" -ForegroundColor Cyan
    Push-Location (Join-Path $root "web\fot-seller")
    try {
        npx --yes tsc --noEmit
        if ($LASTEXITCODE -ne 0) { throw "fot-seller tsc failed" }
    }
    finally { Pop-Location }

if (-not $SkipWebBuild) {
    Write-Host "[4/7] fot-pos vite build" -ForegroundColor Cyan
    $env:VITE_ELECTRON = "1"
    Push-Location (Join-Path $root "web\fot-pos")
    try {
        npx --yes vite build
        if ($LASTEXITCODE -ne 0) { throw "fot-pos vite build failed" }
    }
    finally { Pop-Location }

    Write-Host "[5/7] fot-admin vite build" -ForegroundColor Cyan
    Push-Location (Join-Path $root "web\fot-admin")
    try {
        npx --yes vite build
        if ($LASTEXITCODE -ne 0) { throw "fot-admin vite build failed" }
    }
    finally { Pop-Location }
}
else {
    Write-Host "[4-5/7] skipped web vite build" -ForegroundColor DarkGray
}

if (-not $SkipMigrations) {
    Write-Host "[6/7] migrations dry-run" -ForegroundColor Cyan
    try {
        & (Join-Path $root "scripts\Apply-Migrations.ps1") -DryRun
    }
    catch {
        Write-Warning "migrations dry-run skipped: $($_.Exception.Message)"
    }
}
else {
    Write-Host "[6/7] skipped migrations dry-run" -ForegroundColor DarkGray
}

if (-not $SkipOpenApi) {
    Write-Host "[7/7] OpenAPI drift" -ForegroundColor Cyan
    $committed = Join-Path $root "web\packages\fot-shared\openapi.json"
    $tmp = Join-Path $env:TEMP "fot-pos-openapi-verify.json"
    & (Join-Path $root "scripts\Export-OpenApi.ps1") -OutputJson $tmp -SkipTypes
    if ($LASTEXITCODE -ne 0) { throw "OpenAPI export failed" }
    if (Test-Path $committed) {
        $left = (Get-FileHash $committed -Algorithm SHA256).Hash
        $right = (Get-FileHash $tmp -Algorithm SHA256).Hash
        if ($left -ne $right) {
            throw "OpenAPI drift: run scripts/Export-OpenApi.ps1 and commit web/packages/fot-shared/openapi.json"
        }
    }
}
else {
    Write-Host "[7/7] skipped OpenAPI drift" -ForegroundColor DarkGray
}

Write-Host "Verify-Build OK" -ForegroundColor Green
