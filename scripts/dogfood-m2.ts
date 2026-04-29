#!/usr/bin/env bun
/**
 * VIM-49 — M2 dogfood orchestrator.
 *
 * Single-command entry for the M2 golden-path dogfood (per the AC):
 * brings docker-compose Postgres up, generates the Postgres Prisma client,
 * resets the schema, prepares a deterministic temp git repo for the
 * scenario's project rootPath, starts the API server in Postgres mode,
 * waits for /health, invokes the CLI dogfood scenario, then tears
 * everything down (including the API server) regardless of whether the
 * scenario passed or failed.
 *
 * Prereqs (the runbook documents these):
 *  - Docker (or docker-compatible) on PATH supporting `docker compose`.
 *  - Bun 1.3.13.
 *  - Optional: Playwright + a Chromium binary that the test-runner can
 *    drive when the dogfood reaches step 6 (visual/a11y verification).
 *
 * Environment overrides (all optional):
 *  - VIMBUS_DOGFOOD_RUN_ID   defaults to crypto.randomUUID()
 *  - VIMBUS_DOGFOOD_API_PORT defaults to 3000
 *  - VIMBUS_DOGFOOD_ROOT     defaults to /tmp/vimbus-m2-dogfood/<runId>
 *  - DATABASE_URL            defaults to the docker-compose Postgres URL
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const RUN_ID = process.env.VIMBUS_DOGFOOD_RUN_ID ?? crypto.randomUUID();
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://taskgoblin:taskgoblin@127.0.0.1:55432/taskgoblin?schema=public";
// Default to 3137 not 3000 because 3000 is the conventional dev port for
// many Node servers and frequently collides with a running app on the
// operator's machine. The collision was the failure mode the first
// end-to-end run hit. Any free port works; 3137 just rhymes with "VIM"
// loosely enough to remember.
const API_PORT = process.env.VIMBUS_DOGFOOD_API_PORT ?? "3137";
// Bind via 127.0.0.1 not "localhost" so the orchestrator's fetch path
// matches the docker-compose Postgres bind and dodges any Windows
// localhost-IPv6 quirk where Bun.serve binds IPv4 but `fetch` resolves
// localhost to ::1.
const API_URL = `http://127.0.0.1:${API_PORT}`;
const ROOT_PATH = process.env.VIMBUS_DOGFOOD_ROOT ?? `/tmp/vimbus-m2-dogfood/${RUN_ID}`;

const repoRoot = process.cwd();
const dbPackageRoot = resolve(repoRoot, "packages", "db");
const isWindows = process.platform === "win32";
const prismaBin = resolve(repoRoot, "node_modules", ".bin", isWindows ? "prisma.exe" : "prisma");
const postgresSchema = resolve(dbPackageRoot, "prisma", ".generated", "schema.postgres.prisma");

function run(
  cmd: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): void {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...(options.env ?? {}) },
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited with ${result.status ?? "null"}`);
  }
}

async function waitForHealth(url: string, timeoutMs = 120_000): Promise<void> {
  const start = Date.now();
  let lastError: unknown = undefined;
  let lastBody: unknown = undefined;
  let attempts = 0;
  while (Date.now() - start < timeoutMs) {
    attempts += 1;
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) {
        const body = (await response.json()) as { ok?: boolean; status?: string };
        lastBody = body;
        if (body.ok === true || body.status === "ok") return;
      } else {
        lastError = new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      lastError = error;
    }
    if (attempts % 10 === 0) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const detail =
        lastError instanceof Error
          ? lastError.message
          : lastBody !== undefined
            ? `unexpected body: ${JSON.stringify(lastBody)}`
            : "no response yet";
      console.log(`[dogfood] /health still polling (${elapsed}s, ${detail})`);
    }
    await sleep(500);
  }
  const tail = lastError instanceof Error ? `; last error: ${lastError.message}` : "";
  throw new Error(`API at ${url}/health did not become healthy within ${timeoutMs}ms${tail}.`);
}

function prepareTempRepo(rootPath: string, runId: string): void {
  if (existsSync(rootPath)) {
    rmSync(rootPath, { recursive: true, force: true });
  }
  mkdirSync(rootPath, { recursive: true });
  writeFileSync(resolve(rootPath, "README.md"), `# M2 Dogfood Workspace ${runId}\n`, "utf8");
  writeFileSync(resolve(rootPath, ".gitignore"), "node_modules/\n.artifacts/\n", "utf8");
  run("git", ["init"], { cwd: rootPath });
  run("git", ["config", "user.name", "TaskGoblin Dogfood"], { cwd: rootPath });
  run("git", ["config", "user.email", "dogfood@taskgoblin.local"], { cwd: rootPath });
  run("git", ["checkout", "-b", "main"], { cwd: rootPath });
  run("git", ["add", "."], { cwd: rootPath });
  run("git", ["commit", "-m", "initial"], { cwd: rootPath });
}

let composedUp = false;
let apiProcess: ChildProcess | undefined;

console.log(`[dogfood] runId=${RUN_ID}`);
console.log(`[dogfood] rootPath=${ROOT_PATH}`);
console.log(`[dogfood] apiUrl=${API_URL}`);

try {
  console.log("[dogfood] step a: docker compose up --wait postgres");
  run("docker", ["compose", "up", "-d", "--wait", "postgres"]);
  composedUp = true;

  console.log("[dogfood] step b: db:generate (sqlite + postgres clients)");
  run("bun", ["--filter", "@vimbuspromax3000/db", "db:generate"]);

  console.log("[dogfood] step c: prisma db push --force-reset (postgres schema)");
  run(prismaBin, ["db", "push", "--schema", postgresSchema, "--force-reset", "--accept-data-loss"], {
    cwd: dbPackageRoot,
    env: { DATABASE_URL },
  });

  console.log("[dogfood] step d: prepare deterministic temp git repo");
  prepareTempRepo(ROOT_PATH, RUN_ID);

  console.log("[dogfood] step e: start API in Postgres mode (background)");
  // Use `start` not `dev`: `dev` runs `bun --hot` which spends 30-60s
  // bootstrapping the file watcher (one warn per non-watched workspace
  // file) before /health responds. `start` is `bun run src/index.ts` —
  // no watch overhead, ready in a few seconds. We don't need hot reload
  // inside the orchestrator's lifetime.
  apiProcess = spawn("bun", ["--filter", "@vimbuspromax3000/api", "start"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL, PORT: API_PORT },
    stdio: "inherit",
  });

  console.log("[dogfood] step f: wait for /health");
  await waitForHealth(API_URL);

  console.log("[dogfood] step g: invoke CLI scenario");
  run(
    "bun",
    [
      "apps/cli/src/index.ts",
      "dogfood",
      `--api-url=${API_URL}`,
      `--database-url=${DATABASE_URL}`,
      `--run-id=${RUN_ID}`,
    ],
    { env: { DATABASE_URL } },
  );

  console.log(`[dogfood] scenario completed; bundle at .artifacts/m2/${RUN_ID}/`);
} finally {
  if (apiProcess && apiProcess.exitCode === null) {
    console.log("[dogfood] stopping API");
    apiProcess.kill("SIGTERM");
    // Give bun a beat to shut down cleanly before the docker-compose down
    // racing against a still-connected client trips a noisy disconnect log.
    await sleep(500);
    if (apiProcess.exitCode === null) {
      apiProcess.kill("SIGKILL");
    }
  }
  if (composedUp) {
    console.log("[dogfood] docker compose down");
    spawnSync("docker", ["compose", "down"], { stdio: "inherit", cwd: repoRoot });
  }
}
