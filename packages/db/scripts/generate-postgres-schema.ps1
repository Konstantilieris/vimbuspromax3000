param(
  [switch] $PrintPath
)

$ErrorActionPreference = "Stop"

$packageRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$sourceSchemaPath = Join-Path $packageRoot "prisma\schema.prisma"
$generatedRoot = Join-Path $packageRoot "prisma\.generated"
$postgresSchemaPath = Join-Path $generatedRoot "schema.postgres.prisma"

New-Item -ItemType Directory -Force -Path $generatedRoot | Out-Null

$schema = Get-Content -Raw $sourceSchemaPath
$schema = $schema -replace '(?m)^(\s*provider\s*=\s*)"sqlite"', '${1}"postgresql"'
$schema = $schema -replace '(?m)^(\s*output\s*=\s*)"\.\./src/generated/prisma"', '${1}"../../src/generated/prisma-postgres"'

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($postgresSchemaPath, $schema, $utf8NoBom)

if ($PrintPath) {
  Write-Output $postgresSchemaPath
}
