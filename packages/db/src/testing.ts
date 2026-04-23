import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createPrismaClient, type PrismaClient } from "./client";

export async function createIsolatedPrisma(prefix = "vimbus-db-") {
  const tempDir = mkdtempSync(join(tmpdir(), prefix));
  const dbPath = join(tempDir, "test.db").replace(/\\/g, "/");
  const prisma = createPrismaClient(`file:${dbPath}`);

  await applyMigrations(prisma);

  return { prisma, tempDir };
}

export async function applyMigrations(prisma: PrismaClient) {
  const migrationRoot = join(process.cwd(), "packages", "db", "prisma", "migrations");
  const migrationDirectories = readdirSync(migrationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const migrationDirectory of migrationDirectories) {
    const sql = readFileSync(join(migrationRoot, migrationDirectory, "migration.sql"), "utf8");

    for (const statement of splitSqlStatements(sql)) {
      await prisma.$executeRawUnsafe(statement);
    }
  }
}

export function removeTempDir(path: string) {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EPERM") {
      throw error;
    }
  }
}

export function initializeGitRepository(
  rootPath: string,
  options: {
    baseBranch?: string;
    initialFiles?: Record<string, string>;
  } = {},
) {
  const baseBranch = options.baseBranch ?? "main";
  const initialFiles = buildInitialFiles(options.initialFiles);

  runCommand("git", ["init"], rootPath);
  runCommand("git", ["config", "user.name", "TaskGoblin Test"], rootPath);
  runCommand("git", ["config", "user.email", "taskgoblin@example.com"], rootPath);
  runCommand("git", ["checkout", "-b", baseBranch], rootPath);

  for (const [relativePath, content] of Object.entries(initialFiles)) {
    writeProjectFile(rootPath, relativePath, content);
  }

  runCommand("git", ["add", "."], rootPath);
  runCommand("git", ["commit", "-m", "initial"], rootPath);
}

export function writeProjectFile(rootPath: string, relativePath: string, content: string) {
  const normalizedPath = relativePath.replace(/\//g, "\\");
  const absolutePath = join(rootPath, normalizedPath);
  const directory = dirname(absolutePath);

  mkdirSync(directory, { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
}

export function runCommand(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.trim() ?? "";
    const stdout = result.stdout?.trim() ?? "";
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}\n${[stdout, stderr].filter(Boolean).join("\n")}`.trim(),
    );
  }

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function buildInitialFiles(initialFiles: Record<string, string> | undefined) {
  const files = { ...(initialFiles ?? {}) };
  const gitignoreLines = new Set(
    [
      "node_modules/",
      "test.db",
      ".artifacts/",
      ".taskgoblin/",
      ...(files[".gitignore"]?.split(/\r?\n/) ?? []),
    ].filter(Boolean),
  );

  files[".gitignore"] = `${[...gitignoreLines].join("\n")}\n`;

  return files;
}

function splitSqlStatements(sql: string): string[] {
  return sql
    .replace(/^--.*$/gm, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
