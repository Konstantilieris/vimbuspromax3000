#!/usr/bin/env bun
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://taskgoblin:taskgoblin@127.0.0.1:55432/taskgoblin?schema=public";

const repoRoot = process.cwd();
const dbPackageRoot = resolve(repoRoot, "packages", "db");
const isWindows = process.platform === "win32";
const prismaBin = resolve(repoRoot, "node_modules", ".bin", isWindows ? "prisma.exe" : "prisma");
const vitestBin = resolve(repoRoot, "node_modules", ".bin", isWindows ? "vitest.exe" : "vitest");
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

let composedUp = false;
try {
  run("docker", ["compose", "up", "-d", "--wait", "postgres"]);
  composedUp = true;
  run("bun", ["--filter", "@vimbuspromax3000/db", "db:generate"]);
  run(prismaBin, ["db", "push", "--schema", postgresSchema], {
    cwd: dbPackageRoot,
    env: { DATABASE_URL },
  });
  run(vitestBin, ["run", "packages/db/src/postgres.smoke.test.ts"], { env: { DATABASE_URL } });
} finally {
  if (composedUp) {
    spawnSync("docker", ["compose", "down"], { stdio: "inherit", cwd: repoRoot });
  }
}
