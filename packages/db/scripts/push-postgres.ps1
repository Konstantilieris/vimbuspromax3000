param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $PrismaArgs
)

$ErrorActionPreference = "Stop"

if (-not $env:DATABASE_URL -or $env:DATABASE_URL -notmatch '^postgres(?:ql)?://') {
  throw "DATABASE_URL must be a postgres:// or postgresql:// URL for db:push:postgres."
}

$packageRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$workspaceRoot = Resolve-Path (Join-Path $packageRoot "..\..")
$prisma = Join-Path $workspaceRoot "node_modules\.bin\prisma.exe"
$postgresSchema = & (Join-Path $PSScriptRoot "generate-postgres-schema.ps1") -PrintPath

Push-Location $packageRoot
try {
  & (Join-Path $PSScriptRoot "generate-clients.ps1")
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  & $prisma db push --schema $postgresSchema @PrismaArgs
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
