$ErrorActionPreference = "Stop"

$packageRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$workspaceRoot = Resolve-Path (Join-Path $packageRoot "..\..")
$prisma = Join-Path $workspaceRoot "node_modules\.bin\prisma.exe"
$sqliteSchema = Join-Path $packageRoot "prisma\schema.prisma"
$postgresSchema = & (Join-Path $PSScriptRoot "generate-postgres-schema.ps1") -PrintPath

Push-Location $packageRoot
try {
  & $prisma generate --schema $sqliteSchema
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  & $prisma generate --schema $postgresSchema
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
