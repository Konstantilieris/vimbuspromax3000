param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $PrismaArgs
)

$env:RUST_BACKTRACE = "1"
$env:RUST_LOG = "debug"

$prisma = Join-Path $PSScriptRoot "..\..\..\node_modules\.bin\prisma.exe"

& $prisma @PrismaArgs
exit $LASTEXITCODE
