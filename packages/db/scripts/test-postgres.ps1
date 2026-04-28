param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $VitestArgs
)

$ErrorActionPreference = "Stop"

$packageRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$workspaceRoot = Resolve-Path (Join-Path $packageRoot "..\..")
$prisma = Join-Path $workspaceRoot "node_modules\.bin\prisma.exe"
$vitest = Join-Path $workspaceRoot "node_modules\.bin\vitest.exe"
$generatedRoot = Join-Path $packageRoot "prisma\.generated"
$postgresSchema = & (Join-Path $PSScriptRoot "generate-postgres-schema.ps1") -PrintPath
$testFile = Join-Path $generatedRoot "postgres-smoke.test.ts"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker is required for test:vitest:postgres because it starts an ephemeral Postgres container."
}

$containerName = "taskgoblin-postgres-test-$PID-$(Get-Random)"
$port = Get-Random -Minimum 20000 -Maximum 45000
$databaseUrl = "postgres://taskgoblin:taskgoblin@127.0.0.1:$port/taskgoblin?schema=public"

Push-Location $packageRoot
try {
  & docker run --rm -d --name $containerName `
    -e POSTGRES_USER=taskgoblin `
    -e POSTGRES_PASSWORD=taskgoblin `
    -e POSTGRES_DB=taskgoblin `
    -p "127.0.0.1:$port`:5432" `
    postgres:16-alpine | Out-Null

  $ready = $false
  for ($attempt = 0; $attempt -lt 45; $attempt++) {
    & docker exec $containerName pg_isready -U taskgoblin -d taskgoblin | Out-Null
    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      break
    }

    Start-Sleep -Seconds 1
  }

  if (-not $ready) {
    throw "Postgres container did not become ready within 45 seconds."
  }

  $env:DATABASE_URL = $databaseUrl

  & (Join-Path $PSScriptRoot "generate-clients.ps1")
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  & $prisma db push --schema $postgresSchema
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  @'
import { afterAll, describe, expect, test } from "vitest";
import { createPrismaClient, getDatabaseProvider } from "../../src/client";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for the Postgres smoke test.");
}

const prisma = createPrismaClient(databaseUrl);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Postgres Prisma client compatibility", () => {
  test("postgres URLs select the Postgres path and preserve *Json as JSON text", async () => {
    expect(getDatabaseProvider(databaseUrl)).toBe("postgresql");

    const project = await prisma.project.create({
      data: {
        name: "Postgres smoke",
        rootPath: "/tmp/taskgoblin-postgres-smoke",
      },
    });

    const event = await prisma.loopEvent.create({
      data: {
        projectId: project.id,
        type: "planner.started",
        payloadJson: JSON.stringify({ nested: { ok: true } }),
      },
    });

    const epic = await prisma.epic.create({
      data: {
        projectId: project.id,
        key: "PG-SMOKE",
        title: "Postgres JSON compatibility",
        goal: "Verify JSON text compatibility",
        status: "planned",
        orderIndex: 0,
        acceptanceJson: JSON.stringify([{ label: "json parsed by Postgres adapter" }]),
        risksJson: JSON.stringify({ risk: "low" }),
      },
    });

    expect(JSON.parse(event.payloadJson)).toEqual({ nested: { ok: true } });
    expect(JSON.parse(epic.acceptanceJson ?? "null")).toEqual([{ label: "json parsed by Postgres adapter" }]);
    expect(JSON.parse(epic.risksJson ?? "null")).toEqual({ risk: "low" });
  });
});
'@ | Set-Content -Path $testFile -Encoding utf8

  Push-Location $workspaceRoot
  try {
    & $vitest run $testFile @VitestArgs
    exit $LASTEXITCODE
  } finally {
    Pop-Location
  }
} finally {
  Remove-Item -Force -ErrorAction SilentlyContinue $testFile
  & docker rm -f $containerName | Out-Null
  Pop-Location
}
