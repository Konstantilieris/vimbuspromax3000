import { spawnSync } from "node:child_process";
import type { PrismaClient } from "@vimbuspromax3000/db/client";
import { getTaskExecutionDetail } from "@vimbuspromax3000/db/repositories";

export const TASKGOBLIN_PATCH_SERVER_NAME = "taskgoblin-patch";
export const APPLY_PATCH_TOOL_NAME = "apply_patch";

export const APPLY_PATCH_INPUT_SCHEMA = {
  type: "object",
  properties: {
    patch: {
      type: "string",
      description: "Unified diff content to apply to the execution worktree.",
    },
    taskExecutionId: {
      type: "string",
      description: "Identifier of the task execution that owns the worktree.",
    },
  },
  required: ["patch"],
  additionalProperties: false,
} as const;

export type ApplyPatchInput = {
  patch: string;
  taskExecutionId?: string;
};

export type ApplyPatchSuccess = {
  ok: true;
  summary: {
    hunkCount: number;
    files: string[];
  };
};

export type ApplyPatchFailure = {
  ok: false;
  code: ApplyPatchErrorCode;
  message: string;
};

export type ApplyPatchResult = ApplyPatchSuccess | ApplyPatchFailure;

export type ApplyPatchErrorCode =
  | "INVALID_ARGUMENTS"
  | "EMPTY_PATCH"
  | "EXECUTION_REQUIRED"
  | "EXECUTION_NOT_FOUND"
  | "NOT_GIT_REPOSITORY"
  | "BRANCH_MISMATCH"
  | "BASE_BRANCH_MUTATION_BLOCKED"
  | "PATCH_PARSE_FAILED"
  | "PATCH_APPLY_FAILED"
  | "GIT_COMMAND_FAILED";

export class ApplyPatchError extends Error {
  constructor(
    message: string,
    public readonly code: ApplyPatchErrorCode,
  ) {
    super(message);
    this.name = "ApplyPatchError";
  }
}

const GIT_TIMEOUT_MS = 30_000;

export type PatchWrapper = {
  readonly serverName: typeof TASKGOBLIN_PATCH_SERVER_NAME;
  readonly toolName: typeof APPLY_PATCH_TOOL_NAME;
  applyPatch(input: ApplyPatchInput): Promise<ApplyPatchResult>;
};

export function createPatchWrapper(options: { prisma: PrismaClient }): PatchWrapper {
  const { prisma } = options;

  return {
    serverName: TASKGOBLIN_PATCH_SERVER_NAME,
    toolName: APPLY_PATCH_TOOL_NAME,
    async applyPatch(input) {
      try {
        const args = parseApplyPatchInput(input);

        if (!args.taskExecutionId) {
          throw new ApplyPatchError(
            "apply_patch requires a taskExecutionId to resolve the worktree.",
            "EXECUTION_REQUIRED",
          );
        }

        const execution = await getTaskExecutionDetail(prisma, args.taskExecutionId);

        if (!execution) {
          throw new ApplyPatchError(
            `Execution ${args.taskExecutionId} was not found.`,
            "EXECUTION_NOT_FOUND",
          );
        }

        const project = execution.task.epic.project;
        const rootPath = project.rootPath;
        const baseBranch = project.baseBranch;
        const expectedBranch = execution.branch.name;

        assertGitCurrentBranch(rootPath, expectedBranch, baseBranch);

        const summary = parsePatchSummary(args.patch);

        applyUnifiedDiff(rootPath, args.patch);

        return {
          ok: true,
          summary,
        };
      } catch (error) {
        if (error instanceof ApplyPatchError) {
          return {
            ok: false,
            code: error.code,
            message: error.message,
          };
        }

        return {
          ok: false,
          code: "PATCH_APPLY_FAILED",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

function parseApplyPatchInput(input: unknown): ApplyPatchInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ApplyPatchError("apply_patch arguments must be an object.", "INVALID_ARGUMENTS");
  }

  const record = input as Record<string, unknown>;
  const patch = record.patch;

  if (typeof patch !== "string") {
    throw new ApplyPatchError("apply_patch patch must be a string.", "INVALID_ARGUMENTS");
  }

  if (patch.trim().length === 0) {
    throw new ApplyPatchError("apply_patch requires a non-empty patch.", "EMPTY_PATCH");
  }

  const taskExecutionId = record.taskExecutionId;

  if (taskExecutionId !== undefined && typeof taskExecutionId !== "string") {
    throw new ApplyPatchError(
      "apply_patch taskExecutionId must be a string.",
      "INVALID_ARGUMENTS",
    );
  }

  return {
    patch,
    taskExecutionId: typeof taskExecutionId === "string" ? taskExecutionId : undefined,
  };
}

export function parsePatchSummary(patch: string): { hunkCount: number; files: string[] } {
  const files = new Set<string>();
  let hunkCount = 0;
  let parsedAnyHeader = false;

  for (const rawLine of patch.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");

    if (line.startsWith("diff --git ")) {
      parsedAnyHeader = true;
      const parts = line.split(/\s+/);
      addPatchPath(files, parts[2]);
      addPatchPath(files, parts[3]);
      continue;
    }

    if (line.startsWith("+++ ")) {
      parsedAnyHeader = true;
      addPatchPath(files, line.slice(4).trim().split(/\s+/)[0]);
      continue;
    }

    if (line.startsWith("--- ")) {
      parsedAnyHeader = true;
      addPatchPath(files, line.slice(4).trim().split(/\s+/)[0]);
      continue;
    }

    if (line.startsWith("@@")) {
      hunkCount += 1;
    }
  }

  if (!parsedAnyHeader) {
    throw new ApplyPatchError(
      "apply_patch could not parse a unified diff header from the patch.",
      "PATCH_PARSE_FAILED",
    );
  }

  if (files.size === 0) {
    throw new ApplyPatchError(
      "apply_patch could not identify any files in the patch.",
      "PATCH_PARSE_FAILED",
    );
  }

  return {
    hunkCount,
    files: Array.from(files).sort(),
  };
}

function addPatchPath(files: Set<string>, value: string | undefined) {
  if (!value) {
    return;
  }

  if (value === "/dev/null") {
    return;
  }

  const unquoted = value.replace(/^"|"$/g, "");
  const stripped = unquoted.startsWith("a/") || unquoted.startsWith("b/") ? unquoted.slice(2) : unquoted;
  const normalized = stripped.replace(/\\/g, "/").trim();

  if (normalized.length === 0) {
    return;
  }

  files.add(normalized);
}

function assertGitCurrentBranch(rootPath: string, expectedBranch: string, baseBranch: string) {
  const inside = runGit(rootPath, ["rev-parse", "--is-inside-work-tree"]);

  if (inside.stdout.trim() !== "true") {
    throw new ApplyPatchError(
      `Project root ${rootPath} is not a git repository.`,
      "NOT_GIT_REPOSITORY",
    );
  }

  const currentBranch = runGit(rootPath, ["branch", "--show-current"]).stdout.trim();

  if (currentBranch === baseBranch) {
    throw new ApplyPatchError(
      `apply_patch cannot run directly on the base branch ${baseBranch}.`,
      "BASE_BRANCH_MUTATION_BLOCKED",
    );
  }

  if (currentBranch !== expectedBranch) {
    throw new ApplyPatchError(
      `apply_patch must run on ${expectedBranch}, but the current branch is ${currentBranch}.`,
      "BRANCH_MISMATCH",
    );
  }
}

function applyUnifiedDiff(rootPath: string, patch: string) {
  const normalized = patch.endsWith("\n") ? patch : `${patch}\n`;

  const check = spawnSync("git", ["apply", "--check", "--3way", "--whitespace=nowarn"], {
    cwd: rootPath,
    input: normalized,
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
  });

  if (check.error) {
    throw new ApplyPatchError(
      `git apply --check failed to start: ${check.error.message}`,
      "GIT_COMMAND_FAILED",
    );
  }

  if (check.status !== 0) {
    throw new ApplyPatchError(
      formatGitFailure("git apply --check", check.stdout, check.stderr),
      "PATCH_APPLY_FAILED",
    );
  }

  const apply = spawnSync("git", ["apply", "--3way", "--whitespace=nowarn"], {
    cwd: rootPath,
    input: normalized,
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
  });

  if (apply.error) {
    throw new ApplyPatchError(
      `git apply failed to start: ${apply.error.message}`,
      "GIT_COMMAND_FAILED",
    );
  }

  if (apply.status !== 0) {
    throw new ApplyPatchError(
      formatGitFailure("git apply", apply.stdout, apply.stderr),
      "PATCH_APPLY_FAILED",
    );
  }
}

function runGit(rootPath: string, args: string[]) {
  const result = spawnSync("git", args, {
    cwd: rootPath,
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
  });

  if (result.error) {
    throw new ApplyPatchError(
      `git ${args.join(" ")} failed to start: ${result.error.message}`,
      "GIT_COMMAND_FAILED",
    );
  }

  if (result.status !== 0) {
    throw new ApplyPatchError(
      formatGitFailure(`git ${args.join(" ")}`, result.stdout, result.stderr),
      "GIT_COMMAND_FAILED",
    );
  }

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function formatGitFailure(command: string, stdout: string | null, stderr: string | null) {
  const combined = [stdout, stderr]
    .filter((value): value is string => Boolean(value && value.trim().length > 0))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const detail = combined.length === 0 ? "no output" : combined;
  return `${command} failed: ${detail}`;
}
