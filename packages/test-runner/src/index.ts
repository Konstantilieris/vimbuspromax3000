import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@vimbuspromax3000/db/client";
import {
  appendLoopEvent,
  createPatchReview,
  createTestRun,
  getExecutionVerificationRunContext,
  getLatestPatchReview,
  getTaskExecutionDetail,
  listTestRuns,
  persistVisualVerificationResult,
  setTaskStatus,
  updatePatchReview,
  updateTaskBranch,
  updateTaskExecution,
  updateTestRun,
} from "@vimbuspromax3000/db";

export type TestRunnerEligibilityErrorCode =
  | "NO_APPROVED_VERIFICATION_ITEMS"
  | "UNSUPPORTED_VERIFICATION_ITEMS";

export type TestRunnerEligibilityItem = {
  id: string;
  kind: string;
  title: string;
};

export class TestRunnerEligibilityError extends Error {
  readonly code: TestRunnerEligibilityErrorCode;
  readonly items: TestRunnerEligibilityItem[];
  readonly statusCode = 422;

  constructor(input: {
    code: TestRunnerEligibilityErrorCode;
    message: string;
    items: TestRunnerEligibilityItem[];
  }) {
    super(input.message);
    this.name = "TestRunnerEligibilityError";
    this.code = input.code;
    this.items = input.items;
  }
}

export function isTestRunnerEligibilityError(error: unknown): error is TestRunnerEligibilityError {
  return error instanceof TestRunnerEligibilityError;
}

export type TestRunnerService = {
  runExecutionVerification(input: { executionId: string }): Promise<Awaited<ReturnType<typeof listTestRuns>>>;
  listExecutionTestRuns(executionId: string): Promise<Awaited<ReturnType<typeof listTestRuns>>>;
};

type CommandRunnerInput = {
  command: string;
  rootPath: string;
  executionId: string;
  verificationItemId: string;
  orderIndex: number;
};

type CommandRunnerResult = {
  artifactDirectory: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  stdoutPath: string;
  stderrPath: string;
};

type ExecutionVerificationContext = NonNullable<Awaited<ReturnType<typeof getExecutionVerificationRunContext>>>;
type VerificationRunItem = NonNullable<ExecutionVerificationContext["latestApprovedVerificationPlan"]>["items"][number];

export function createTestRunnerService(options: {
  prisma: PrismaClient;
  commandRunner?: (input: CommandRunnerInput) => CommandRunnerResult;
}): TestRunnerService {
  const prisma = options.prisma;
  const commandRunner = options.commandRunner ?? runCapturedCommand;

  return {
    async listExecutionTestRuns(executionId) {
      await requireExecutionContext(prisma, executionId);
      return listTestRuns(prisma, {
        taskExecutionId: executionId,
      });
    },

    async runExecutionVerification(input) {
      const execution = await requireExecutionVerificationContext(prisma, input.executionId);
      const project = execution.task.epic.project;
      const branch = execution.branch;
      const verificationPlan = execution.latestApprovedVerificationPlan;

      if (!verificationPlan) {
        throw new Error(`Execution ${execution.id} does not have an approved verification plan.`);
      }

      if (!["implementing", "verifying"].includes(execution.status)) {
        throw new Error(`Execution ${execution.id} is not in a runnable state for verification.`);
      }

      if (!["executing", "testing"].includes(execution.task.status)) {
        throw new Error(`Task ${execution.task.id} is not in a runnable state for verification.`);
      }

      const items = verificationPlan.items;

      if (items.length === 0) {
        throw new TestRunnerEligibilityError({
          code: "NO_APPROVED_VERIFICATION_ITEMS",
          message: "This execution has no approved verification items to run.",
          items: [],
        });
      }

      const unsupportedItems = items
        .filter((item) => !hasExecutableCommand(item.command) && !isVisualVerificationDispatchItem(item))
        .map((item) => ({
          id: item.id,
          kind: item.kind,
          title: item.title,
        }));

      if (unsupportedItems.length > 0) {
        throw new TestRunnerEligibilityError({
          code: "UNSUPPORTED_VERIFICATION_ITEMS",
          message: "This execution contains approved verification items that cannot be run by the command runner.",
          items: unsupportedItems,
        });
      }

      assertGitRepository(project.rootPath);
      assertCurrentBranch(project.rootPath, branch.name, project.baseBranch);

      await prisma.$transaction(async (tx) => {
        await setTaskStatus(tx, execution.task.id, "testing");
        await updateTaskExecution(tx, execution.id, {
          status: "verifying",
        });
      });

      let hasFailure = false;

      for (const item of items) {
        if (!hasExecutableCommand(item.command)) {
          const result = await runVisualVerificationItem({
            prisma,
            execution,
            project,
            item,
          });

          if (result.status !== "passed") {
            hasFailure = true;
          }

          continue;
        }

        const command = item.command?.trim() ?? "";
        const startedAt = new Date();
        const testRun = await prisma.$transaction(async (tx) => {
          const created = await createTestRun(tx, {
            taskExecutionId: execution.id,
            verificationItemId: item.id,
            command,
            status: "running",
            startedAt,
          });

          await tx.verificationItem.update({
            where: { id: item.id },
            data: {
              status: "running",
            },
          });

          await appendLoopEvent(tx, {
            projectId: project.id,
            taskExecutionId: execution.id,
            type: "test.started",
            payload: {
              taskId: execution.task.id,
              verificationItemId: item.id,
              testRunId: created.id,
              command,
            },
          });

          return created;
        });

        const result = commandRunner({
          command,
          rootPath: project.rootPath,
          executionId: execution.id,
          verificationItemId: item.id,
          orderIndex: item.orderIndex,
        });
        const finishedAt = new Date();
        const testStatus = result.exitCode === 0 ? "passed" : "failed";
        const itemStatus = result.exitCode === 0 ? "green" : "failed";

        if (result.exitCode !== 0) {
          hasFailure = true;
        }

        await prisma.$transaction(async (tx) => {
          await updateTestRun(tx, testRun.id, {
            status: testStatus,
            exitCode: result.exitCode,
            stdoutPath: result.stdoutPath,
            stderrPath: result.stderrPath,
            finishedAt,
          });

          await tx.verificationItem.update({
            where: { id: item.id },
            data: {
              status: itemStatus,
            },
          });

          if (result.stdout.trim().length > 0) {
            await appendLoopEvent(tx, {
              projectId: project.id,
              taskExecutionId: execution.id,
              type: "test.stdout",
              payload: {
                taskId: execution.task.id,
                verificationItemId: item.id,
                testRunId: testRun.id,
                path: result.stdoutPath,
                chunk: result.stdout,
              },
            });
          }

          if (result.stderr.trim().length > 0) {
            await appendLoopEvent(tx, {
              projectId: project.id,
              taskExecutionId: execution.id,
              type: "test.stderr",
              payload: {
                taskId: execution.task.id,
                verificationItemId: item.id,
                testRunId: testRun.id,
                path: result.stderrPath,
                chunk: result.stderr,
              },
            });
          }

          await appendLoopEvent(tx, {
            projectId: project.id,
            taskExecutionId: execution.id,
            type: "test.finished",
            payload: {
              taskId: execution.task.id,
              verificationItemId: item.id,
              testRunId: testRun.id,
              exitCode: result.exitCode,
              status: testStatus,
            },
          });
        });

        writeTestRunMetaFile({
          artifactDirectory: result.artifactDirectory,
          executionId: execution.id,
          verificationItemId: item.id,
          orderIndex: item.orderIndex,
          kind: item.kind,
          title: item.title,
          command,
          startedAt,
          finishedAt,
          exitCode: result.exitCode,
          status: testStatus,
        });
      }

      if (hasFailure) {
        await prisma.$transaction(async (tx) => {
          await updateTaskExecution(tx, execution.id, {
            status: "failed",
            finishedAt: new Date(),
          });
          await setTaskStatus(tx, execution.task.id, "failed");
          await appendLoopEvent(tx, {
            projectId: project.id,
            taskExecutionId: execution.id,
            type: "task.failed",
            payload: {
              taskId: execution.task.id,
              reason: "Verification failed.",
            },
          });
        });

        return listTestRuns(prisma, {
          taskExecutionId: execution.id,
        });
      }

      const patchMetadata = collectPatchMetadata(project.rootPath, project.baseBranch, execution.id);
      const verifiedAt = new Date();

      await prisma.$transaction(async (tx) => {
        await updateTaskBranch(tx, branch.id, {
          state: "verified",
          currentHead: getHeadCommit(project.rootPath),
          lastVerifiedAt: verifiedAt,
        });
        await updateTaskExecution(tx, execution.id, {
          status: "patch_ready",
        });
        await setTaskStatus(tx, execution.task.id, "awaiting_patch_approval");

        const existingPatchReview = await getLatestPatchReview(tx, execution.id);

        if (existingPatchReview) {
          await updatePatchReview(tx, existingPatchReview.id, {
            status: "ready",
            diffPath: patchMetadata.diffPath,
            summary: patchMetadata.summary,
          });
        } else {
          await createPatchReview(tx, {
            taskExecutionId: execution.id,
            status: "ready",
            diffPath: patchMetadata.diffPath,
            summary: patchMetadata.summary,
          });
        }

        await appendLoopEvent(tx, {
          projectId: project.id,
          taskExecutionId: execution.id,
          type: "patch.ready",
          payload: {
            taskId: execution.task.id,
            branchName: branch.name,
            diffPath: patchMetadata.diffPath,
            summary: patchMetadata.summary,
          },
        });
      });

      return listTestRuns(prisma, {
        taskExecutionId: execution.id,
      });
    },
  };
}

async function runVisualVerificationItem(input: {
  prisma: PrismaClient;
  execution: ExecutionVerificationContext;
  project: ExecutionVerificationContext["task"]["epic"]["project"];
  item: VerificationRunItem;
}) {
  const startedAt = new Date();
  const mode = resolveVisualVerificationMode(input.item);
  const sourceAsset = await resolveVisualSourceAsset(
    input.prisma,
    input.project.id,
    input.execution.task.id,
    input.item,
  );
  const finishedAt = new Date();
  const status = sourceAsset.usable ? "passed" : "blocked";
  const itemStatus = status === "passed" ? "green" : "failed";
  const summary = sourceAsset.usable
    ? "Approved visual source-of-truth evidence is available."
    : sourceAsset.reason;
  const metadata = {
    kind: input.item.kind,
    title: input.item.title,
    expectedAssetId: input.item.expectedAssetId,
    sourceAsset: sourceAsset.asset
      ? {
          id: sourceAsset.asset.id,
          relativePath: sourceAsset.asset.relativePath,
          status: sourceAsset.asset.status,
          sha256: sourceAsset.asset.sha256,
          mimeType: sourceAsset.asset.mimeType,
        }
      : null,
  };

  await input.prisma.$transaction(async (tx) => {
    await tx.verificationItem.update({
      where: { id: input.item.id },
      data: {
        status: "running",
      },
    });

    await appendLoopEvent(tx, {
      projectId: input.project.id,
      taskExecutionId: input.execution.id,
      type: "visual.started",
      payload: {
        taskId: input.execution.task.id,
        verificationItemId: input.item.id,
        mode,
        sourceAssetId: sourceAsset.asset?.id ?? null,
        expectedAssetId: input.item.expectedAssetId ?? null,
      },
    });

    const result = await persistVisualVerificationResult(tx, {
      taskExecutionId: input.execution.id,
      verificationItemId: input.item.id,
      sourceAssetId: sourceAsset.asset?.id ?? null,
      mode,
      status,
      summary,
      sha256: sourceAsset.asset?.sha256 ?? null,
      metadata,
      startedAt,
      finishedAt,
    });

    await tx.verificationItem.update({
      where: { id: input.item.id },
      data: {
        status: itemStatus,
      },
    });

    await appendLoopEvent(tx, {
      projectId: input.project.id,
      taskExecutionId: input.execution.id,
      type: "visual.finished",
      payload: {
        taskId: input.execution.task.id,
        verificationItemId: input.item.id,
        visualVerificationResultId: result.id,
        mode,
        status,
        sourceAssetId: sourceAsset.asset?.id ?? null,
        expectedAssetId: input.item.expectedAssetId ?? null,
        summary,
      },
    });
  });

  return {
    status,
  };
}

function runCapturedCommand(input: CommandRunnerInput): CommandRunnerResult {
  const artifactDirectory = buildTestRunArtifactDirectory(input);

  mkdirSync(artifactDirectory, { recursive: true });

  const stdoutPath = normalizePath(join(artifactDirectory, "stdout.log"));
  const stderrPath = normalizePath(join(artifactDirectory, "stderr.log"));
  const shell = process.platform === "win32" ? "powershell" : "sh";
  const shellArgs =
    process.platform === "win32"
      ? ["-NoProfile", "-Command", input.command]
      : ["-lc", input.command];
  const result = spawnSync(shell, shellArgs, {
    cwd: input.rootPath,
    encoding: "utf8",
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  writeFileSync(stdoutPath, stdout, "utf8");
  writeFileSync(stderrPath, stderr, "utf8");

  return {
    artifactDirectory: normalizePath(artifactDirectory),
    exitCode: result.status ?? 1,
    stdout,
    stderr,
    stdoutPath,
    stderrPath,
  };
}

function collectPatchMetadata(rootPath: string, baseBranch: string, executionId: string) {
  const artifactDirectory = join(rootPath, ".taskgoblin", "artifacts", "executions", executionId, "patch");

  mkdirSync(artifactDirectory, { recursive: true });

  const diff = runGit(rootPath, ["diff", "--binary", baseBranch]).stdout;
  const summary = runGit(rootPath, ["diff", "--shortstat", baseBranch]).stdout.trim() || "No diff";
  const diffPath = normalizePath(join(artifactDirectory, "current.diff"));

  writeFileSync(diffPath, diff, "utf8");

  return {
    diffPath,
    summary,
  };
}

async function requireExecutionContext(prisma: PrismaClient, executionId: string) {
  const execution = await getTaskExecutionDetail(prisma, executionId);

  if (!execution) {
    throw new Error(`Task execution ${executionId} was not found.`);
  }

  return execution;
}

async function requireExecutionVerificationContext(prisma: PrismaClient, executionId: string) {
  const execution = await getExecutionVerificationRunContext(prisma, executionId);

  if (!execution) {
    throw new Error(`Task execution ${executionId} was not found.`);
  }

  return execution;
}

function hasExecutableCommand(command: string | null | undefined) {
  return typeof command === "string" && command.trim().length > 0;
}

function isVisualVerificationDispatchItem(item: VerificationRunItem) {
  const kind = normalizeVisualToken(item.kind);
  const mode = normalizeVisualToken(resolveVisualVerificationMode(item));

  return (
    ["visual", "pdf", "manual-evidence", "manual_evidence", "evidence"].includes(kind) ||
    ["screenshot", "pixel-diff", "layout-check", "pdf-render", "manual-evidence", "asset-presence"].includes(mode)
  );
}

function resolveVisualVerificationMode(item: VerificationRunItem) {
  const config = parseJsonObject(item.configJson);
  const configuredMode =
    stringFromUnknown(config.comparisonMode) ??
    stringFromUnknown(config.mode) ??
    stringFromUnknown(config.visualMode);

  if (configuredMode) {
    return configuredMode;
  }

  const kind = normalizeVisualToken(item.kind);

  if (kind === "pdf") {
    return "pdf-render";
  }
  if (kind === "manual-evidence" || kind === "manual_evidence" || kind === "evidence") {
    return "manual-evidence";
  }
  if (kind === "visual" && normalizeVisualToken(item.runner) === "playwright") {
    return "screenshot";
  }

  return "asset-presence";
}

async function resolveVisualSourceAsset(
  prisma: PrismaClient,
  projectId: string,
  taskId: string,
  item: VerificationRunItem,
) {
  if (item.expectedAssetId) {
    const expectedAsset = await prisma.sourceOfTruthAsset.findFirst({
      where: {
        id: item.expectedAssetId,
        projectId,
      },
    });

    if (!expectedAsset) {
      return {
        usable: false,
        reason: `Expected source asset ${item.expectedAssetId} was not found in this project.`,
        asset: null,
      };
    }

    if (expectedAsset.status !== "approved") {
      return {
        usable: false,
        reason: `Expected source asset ${expectedAsset.relativePath} requires approval before visual verification can pass.`,
        asset: expectedAsset,
      };
    }

    return {
      usable: true,
      reason: "Approved expected source asset is available.",
      asset: expectedAsset,
    };
  }

  const linkedAsset = await prisma.sourceOfTruthAsset.findFirst({
    where: {
      projectId,
      verificationItemId: item.id,
      status: "approved",
    },
    orderBy: [{ createdAt: "asc" }],
  });

  if (linkedAsset) {
    return {
      usable: true,
      reason: "Approved item-linked source asset is available.",
      asset: linkedAsset,
    };
  }

  const taskAsset = await prisma.sourceOfTruthAsset.findFirst({
    where: {
      projectId,
      taskId,
      status: "approved",
    },
    orderBy: [{ createdAt: "asc" }],
  });

  if (taskAsset) {
    return {
      usable: true,
      reason: "Approved task source asset is available.",
      asset: taskAsset,
    };
  }

  return {
    usable: false,
    reason: "No approved source-of-truth or evidence asset is linked to this verification item.",
    asset: null,
  };
}

function parseJsonObject(value: string | null | undefined) {
  if (!value) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(value);

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }

  return {};
}

function stringFromUnknown(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeVisualToken(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function buildTestRunArtifactDirectory(input: CommandRunnerInput) {
  return join(
    input.rootPath,
    ".artifacts",
    "executions",
    input.executionId,
    "test-runs",
    `${input.orderIndex}-${input.verificationItemId}`,
  );
}

function writeTestRunMetaFile(input: {
  artifactDirectory: string;
  executionId: string;
  verificationItemId: string;
  orderIndex: number;
  kind: string;
  title: string;
  command: string;
  startedAt: Date;
  finishedAt: Date;
  exitCode: number;
  status: "passed" | "failed";
}) {
  const metaPath = normalizePath(join(input.artifactDirectory, "meta.json"));
  const payload = {
    executionId: input.executionId,
    verificationItemId: input.verificationItemId,
    orderIndex: input.orderIndex,
    kind: input.kind,
    title: input.title,
    command: input.command,
    startedAt: input.startedAt.toISOString(),
    finishedAt: input.finishedAt.toISOString(),
    exitCode: input.exitCode,
    status: input.status,
  };

  writeFileSync(metaPath, JSON.stringify(payload, null, 2), "utf8");
}

function assertGitRepository(rootPath: string) {
  const result = runGit(rootPath, ["rev-parse", "--is-inside-work-tree"], true);

  if (result.status !== 0 || result.stdout.trim() !== "true") {
    throw new Error(`Project root ${rootPath} is not a git repository.`);
  }
}

function assertCurrentBranch(rootPath: string, expectedBranch: string, baseBranch: string) {
  const currentBranch = runGit(rootPath, ["branch", "--show-current"]).stdout.trim();

  if (currentBranch !== expectedBranch) {
    throw new Error(`Verification must run on ${expectedBranch}, but the current branch is ${currentBranch}.`);
  }

  if (currentBranch === baseBranch) {
    throw new Error(`Verification cannot run directly on the base branch ${baseBranch}.`);
  }
}

function getHeadCommit(rootPath: string) {
  return runGit(rootPath, ["rev-parse", "HEAD"]).stdout.trim();
}

function runGit(rootPath: string, args: string[], allowFailure = false) {
  const result = spawnSync("git", args, {
    cwd: rootPath,
    encoding: "utf8",
  });

  if (!allowFailure && result.status !== 0) {
    const stderr = result.stderr?.trim() ?? "";
    const stdout = result.stdout?.trim() ?? "";
    throw new Error(
      `git ${args.join(" ")} failed.\n${[stdout, stderr].filter(Boolean).join("\n")}`.trim(),
    );
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function normalizePath(path: string) {
  return path.replace(/\\/g, "/");
}
