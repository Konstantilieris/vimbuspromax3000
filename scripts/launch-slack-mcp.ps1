$ErrorActionPreference = 'Stop'

# Load SLACK_* vars from project .env.local if they aren't already in the process env.
$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot '.env.local'

if (([string]::IsNullOrWhiteSpace($env:SLACK_BOT_TOKEN) -or [string]::IsNullOrWhiteSpace($env:SLACK_TEAM_ID)) -and (Test-Path -LiteralPath $envFile)) {
  Get-Content -LiteralPath $envFile | ForEach-Object {
    if ($_ -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$') {
      $key = $Matches[1]
      $value = $Matches[2]
      if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($key, 'Process'))) {
        [Environment]::SetEnvironmentVariable($key, $value, 'Process')
      }
    }
  }
}

if ([string]::IsNullOrWhiteSpace($env:SLACK_BOT_TOKEN) -or [string]::IsNullOrWhiteSpace($env:SLACK_TEAM_ID)) {
  throw 'Slack MCP missing SLACK_BOT_TOKEN/SLACK_TEAM_ID. Export them in your shell or set them in .env.local.'
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if ($null -eq $nodeCommand) {
  $nodeCommand = Get-Command node -ErrorAction Stop
}

$candidateRoots = @(
  (Join-Path $env:USERPROFILE '.codex\mcp-servers\server-slack\node_modules\@modelcontextprotocol\server-slack\dist\index.js'),
  (Join-Path $env:APPDATA 'npm\node_modules\@modelcontextprotocol\server-slack\dist\index.js')
)

$serverPath = $candidateRoots | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $serverPath) {
  $npxCache = Join-Path $env:LOCALAPPDATA 'npm-cache\_npx'
  if (Test-Path -LiteralPath $npxCache) {
    $serverPath = Get-ChildItem -LiteralPath $npxCache -Directory -ErrorAction SilentlyContinue |
      ForEach-Object { Join-Path $_.FullName 'node_modules\@modelcontextprotocol\server-slack\dist\index.js' } |
      Where-Object { Test-Path -LiteralPath $_ } |
      Sort-Object { (Get-Item -LiteralPath $_).LastWriteTime } -Descending |
      Select-Object -First 1
  }
}

if ($serverPath) {
  & $nodeCommand.Source $serverPath
  exit $LASTEXITCODE
}

$npxCommand = Get-Command npx.cmd -ErrorAction SilentlyContinue
if ($null -eq $npxCommand) {
  $npxCommand = Get-Command npx -ErrorAction Stop
}

Write-Error 'Could not find a cached Slack MCP server. Falling back to npx, which may hang on this Windows setup.'
& $npxCommand.Source '-y' '@modelcontextprotocol/server-slack'
exit $LASTEXITCODE
