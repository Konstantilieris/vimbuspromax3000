import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export type PlaywrightStagingInput = {
  taskId: string;
  validationId: string;
  workspaceRoot?: string;
};

export type PlaywrightStagingPath = {
  absolutePath: string;
  relativePath: string;
};

export function getPlaywrightStagingPath(input: PlaywrightStagingInput): PlaywrightStagingPath {
  const workspaceRoot = resolve(input.workspaceRoot ?? process.cwd());
  const taskId = sanitizePathSegment(input.taskId, "taskId");
  const validationId = sanitizePathSegment(input.validationId, "validationId");
  const absolutePath = join(
    workspaceRoot,
    "apps",
    "api",
    ".artifacts",
    "staging",
    "playwright",
    taskId,
    `${validationId}.spec.ts`,
  );

  return {
    absolutePath,
    relativePath: relative(workspaceRoot, absolutePath).replace(/\\/g, "/"),
  };
}

export function writePlaywrightStagingFile(input: PlaywrightStagingInput & { code: string }): PlaywrightStagingPath {
  const stagingPath = getPlaywrightStagingPath(input);
  mkdirSync(dirname(stagingPath.absolutePath), { recursive: true });
  writeFileSync(stagingPath.absolutePath, input.code, "utf8");
  return stagingPath;
}

export function readPlaywrightStagingFile(input: PlaywrightStagingInput): string {
  return readFileSync(getPlaywrightStagingPath(input).absolutePath, "utf8");
}

export function removePlaywrightStagingFile(input: PlaywrightStagingInput): boolean {
  const stagingPath = getPlaywrightStagingPath(input);
  if (!existsSync(stagingPath.absolutePath)) {
    return false;
  }

  rmSync(stagingPath.absolutePath, { force: true });
  return true;
}

function sanitizePathSegment(value: string, fieldName: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error(`${fieldName} must be a safe path segment.`);
  }

  return value;
}
