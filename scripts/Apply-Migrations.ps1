# Applies database/migrations/*.sql in numeric order and records them in schema_migrations.
param(
    [string]$ConnectionString = "",
    [string]$Server = "localhost\FOTSQLSERVER",
    [string]$Database = "FOT_POS_V2",
    [switch]$DryRun,
    [switch]$Stamp,
    [int]$Through = -1
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$migrationsDir = Join-Path $root "database\migrations"

if (-not $ConnectionString) {
    $appsettings = Join-Path $root "src\FOT.Pos.Api\appsettings.json"
    if (Test-Path $appsettings) {
        $json = Get-Content $appsettings -Raw | ConvertFrom-Json
        $ConnectionString = [string]$json.ConnectionStrings.Default
    }
}
if (-not $ConnectionString) {
    $ConnectionString = "Server=$Server;Database=$Database;Trusted_Connection=True;TrustServerCertificate=True;"
}

function Get-SqlConnection {
    Add-Type -AssemblyName System.Data
    $conn = New-Object System.Data.SqlClient.SqlConnection $ConnectionString
    $conn.Open()
    return $conn
}

function Invoke-SqlBatches([System.Data.SqlClient.SqlConnection]$Conn, [string]$Sql) {
    $batches = [regex]::Split($Sql, '(?im)^\s*GO\s*$')
    foreach ($batch in $batches) {
        $text = $batch.Trim()
        if (-not $text) { continue }
        $cmd = $Conn.CreateCommand()
        $cmd.CommandTimeout = 120
        $cmd.CommandText = $text
        [void]$cmd.ExecuteNonQuery()
    }
}

function Test-SchemaTable([System.Data.SqlClient.SqlConnection]$Conn) {
    $cmd = $Conn.CreateCommand()
    $cmd.CommandText = "SELECT CASE WHEN OBJECT_ID(N'dbo.schema_migrations', N'U') IS NULL THEN 0 ELSE 1 END"
    return [int]$cmd.ExecuteScalar() -eq 1
}

function Get-AppliedVersions([System.Data.SqlClient.SqlConnection]$Conn) {
    $applied = @{}
    $cmd = $Conn.CreateCommand()
    $cmd.CommandText = "SELECT version, name FROM schema_migrations"
    $reader = $cmd.ExecuteReader()
    while ($reader.Read()) { $applied[[int]$reader.GetInt32(0)] = $reader.GetString(1) }
    $reader.Close()
    return $applied
}

$conn = Get-SqlConnection
try {
    Write-Host "$(if ($DryRun) { 'Dry-run' } else { 'Applying' }) migrations on $ConnectionString" -ForegroundColor Cyan

    $files = Get-ChildItem $migrationsDir -Filter "*.sql" |
        Where-Object { $_.Name -match '^(\d+)_' } |
        Sort-Object { [int]([regex]::Match($_.Name, '^(\d+)').Groups[1].Value) }

    if ($DryRun) {
        $applied = @{}
        if (Test-SchemaTable $conn) {
            $applied = Get-AppliedVersions $conn
        }
        $pending = 0
        foreach ($file in $files) {
            $version = [int]([regex]::Match($file.Name, '^(\d+)').Groups[1].Value)
            if ($applied.ContainsKey($version)) {
                Write-Host ("  skip {0}" -f $file.Name) -ForegroundColor DarkGray
            }
            else {
                Write-Host ("  pending {0}" -f $file.Name) -ForegroundColor Yellow
                $pending++
            }
        }
        Write-Host ("Dry-run OK. {0} pending migration(s)." -f $pending) -ForegroundColor Green
        return
    }

    if ($Stamp) {
        Invoke-SqlBatches $conn (Get-Content (Join-Path $migrationsDir "000_schema_migrations.sql") -Raw)
        $applied = Get-AppliedVersions $conn
        $stamped = 0
        foreach ($file in $files) {
            $version = [int]([regex]::Match($file.Name, '^(\d+)').Groups[1].Value)
            if ($Through -ge 0 -and $version -gt $Through) { continue }
            if ($applied.ContainsKey($version)) {
                Write-Host ("  skip {0}" -f $file.Name) -ForegroundColor DarkGray
                continue
            }
            $insert = $conn.CreateCommand()
            $insert.CommandText = "INSERT INTO schema_migrations (version, name) VALUES (@v, @n)"
            [void]$insert.Parameters.AddWithValue("@v", $version)
            [void]$insert.Parameters.AddWithValue("@n", $file.Name)
            [void]$insert.ExecuteNonQuery()
            Write-Host ("  stamp {0}" -f $file.Name) -ForegroundColor Cyan
            $stamped++
        }
        Write-Host ("Stamped {0} migration(s) without running SQL." -f $stamped) -ForegroundColor Green
        return
    }

    Invoke-SqlBatches $conn (Get-Content (Join-Path $migrationsDir "000_schema_migrations.sql") -Raw)
    $applied = Get-AppliedVersions $conn
    if (-not $applied.ContainsKey(0)) {
        $insert0 = $conn.CreateCommand()
        $insert0.CommandText = "INSERT INTO schema_migrations (version, name) VALUES (0, @n)"
        [void]$insert0.Parameters.AddWithValue("@n", "000_schema_migrations.sql")
        [void]$insert0.ExecuteNonQuery()
        $applied[0] = "000_schema_migrations.sql"
        Write-Host "  apply 000_schema_migrations.sql" -ForegroundColor Yellow
    }

    $ran = 0
    foreach ($file in $files) {
        $version = [int]([regex]::Match($file.Name, '^(\d+)').Groups[1].Value)
        if ($version -eq 0 -or $applied.ContainsKey($version)) {
            Write-Host ("  skip {0}" -f $file.Name) -ForegroundColor DarkGray
            continue
        }
        Write-Host ("  apply {0}" -f $file.Name) -ForegroundColor Yellow
        Invoke-SqlBatches $conn (Get-Content $file.FullName -Raw)
        $insert = $conn.CreateCommand()
        $insert.CommandText = "INSERT INTO schema_migrations (version, name) VALUES (@v, @n)"
        [void]$insert.Parameters.AddWithValue("@v", $version)
        [void]$insert.Parameters.AddWithValue("@n", $file.Name)
        [void]$insert.ExecuteNonQuery()
        $ran++
    }

    Write-Host ("Done. Applied {0} new migration(s)." -f $ran) -ForegroundColor Green
}
finally {
    $conn.Close()
}
