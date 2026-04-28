import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
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
  type TestRunPhase,
} from "@vimbuspromax3000/db";
import {
  captureScreenshot,
  compareImages,
  navigateBrowser,
  runAxe,
  type ImageDiffResult,
} from "@vimbuspromax3000/verification";

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

/**
 * VIM-31 — abort code surfaced when {@link TestRunnerService.runExecutionVerificationIteration}
 * detects that a logic verification test passed during the `pre_red` phase
 * (i.e. against the empty / pre-edit branch state). The TDD invariant says
 * no logic test may be green on an empty branch — that would mean the test
 * is not actually exercising the not-yet-written behavior.
 */
export type TestRunnerIterationAbortCode = "tdd_invariant_violated";

/**
 * VIM-31 — result returned from one TDD iteration. Two TestRun rows persist
 * per iteration (one per phase) tagged with the supplied `iterationIndex`.
 *
 * - When `preRedAborted === true`, only the `pre_red` rows were written and
 *   `abortCode === 'tdd_invariant_violated'`. The agent loop should treat
 *   this as a planning bug, not a retryable failure.
 * - When `preRedAborted === false`, both phases ran. `hasFailure` reflects
 *   whether the `post_green` phase had any failed item — this is the signal
 *   the agent loop forwards to VIM-30's existing retry path.
 */
export type TestRunnerIterationResult = {
  iterationIndex: number;
  preRedAborted: boolean;
  abortCode?: TestRunnerIterationAbortCode;
  hasFailure: boolean;
  testRuns: Awaited<ReturnType<typeof listTestRuns>>;
};

export type TestRunnerService = {
  runExecutionVerification(input: { executionId: string }): Promise<Awaited<ReturnType<typeof listTestRuns>>>;
  /**
   * VIM-31 — TDD-aware entry point. Drives one iteration with two phases:
   * `pre_red` (against the empty / pre-edit branch state) and `post_green`
   * (after the agent loop has applied its edits). Persists exactly two
   * TestRun rows per command-backed item per iteration (one per phase).
   *
   * Only `logic`-kind items are evaluated against the TDD invariant.
   * Visual / evidence items run only during `post_green`.
   */
  runExecutionVerificationIteration(input: {
    executionId: string;
    iterationIndex: number;
  }): Promise<TestRunnerIterationResult>;
  listExecutionTestRuns(executionId: string): Promise<Awaited<ReturnType<typeof listTestRuns>>>;
};

type CommandRunnerInput = {
  command: string;
  rootPath: string;
  executionId: string;
  verificationItemId: string;
  orderIndex: number;
  /**
   * VIM-31 — optional phase tag. When omitted, the runner is invoked from
   * the legacy single-shot {@link TestRunnerService.runExecutionVerification}
   * path, which behaves like `post_green` for backward compatibility.
   */
  phase?: TestRunPhase;
  /**
   * VIM-31 — optional 1-based iteration index. Omitted for the legacy
   * single-shot path; populated by the TDD iteration entry point.
   */
  iterationIndex?: number;
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

type BrowserVerificationRunner = {
  navigate: typeof navigateBrowser;
  screenshot: typeof captureScreenshot;
  runAxe: typeof runAxe;
  compareImages: typeof compareImages;
};

const defaultBrowserVerificationRunner: BrowserVerificationRunner = {
  navigate: navigateBrowser,
  screenshot: captureScreenshot,
  runAxe,
  compareImages,
};

export function createTestRunnerService(options: {
  prisma: PrismaClient;
  commandRunner?: (input: CommandRunnerInput) => CommandRunnerResult;
  browserRunner?: BrowserVerificationRunner;
}): TestRunnerService {
  const prisma = options.prisma;
  const commandRunner = options.commandRunner ?? runCapturedCommand;
  const browserRunner = options.browserRunner ?? defaultBrowserVerificationRunner;

  return {
    async listExecutionTestRuns(executionId) {
      await requireExecutionContext(prisma, executionId);
      return listTestRuns(prisma, {
        taskExecutionId: executionId,
      });
    },

    async runExecutionVerificationIteration(input) {
      const execution = await requireExecutionVerificationContext(prisma, input.executionId);
      const project = execution.task.epic.project;
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
        .filter(
          (item) =>
            !hasExecutableCommand(item.command) &&
            !isVisualVerificationDispatchItem(item) &&
            !isA11yVerificationDispatchItem(item),
        )
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

      const iterationIndex = input.iterationIndex;

      // pre_red: only command-backed items participate. Visual items are
      // checked only in post_green because their result depends on the final
      // branch state — running them on an empty branch would just re-block.
      let preRedSawLogicPass = false;
      for (const item of items) {
        if (!hasExecutableCommand(item.command)) {
          continue;
        }

        const outcome = await runCommandItem({
          prisma,
          execution,
          project,
          item,
          phase: "pre_red",
          iterationIndex,
          commandRunner,
        });

        if (outcome.testStatus === "passed" && isLogicKind(item.kind)) {
          preRedSawLogicPass = true;
        }
      }

      if (preRedSawLogicPass) {
        // TDD invariant violation — abort the iteration without running
        // post_green. The agent loop should treat this as a planning bug.
        await prisma.$transaction(async (tx) => {
          await appendLoopEvent(tx, {
            projectId: project.id,
            taskExecutionId: execution.id,
            type: "task.failed",
            payload: {
              taskId: execution.task.id,
              code: "TDD_INVARIANT_VIOLATED",
              reason:
                "TDD invariant violation: a logic verification test passed during pre_red.",
              iterationIndex,
            },
          });
        });

        const aborted = await listTestRuns(prisma, {
          taskExecutionId: execution.id,
          iterationIndex,
        });

        return {
          iterationIndex,
          preRedAborted: true,
          abortCode: "tdd_invariant_violated",
          hasFailure: true,
          testRuns: aborted,
        };
      }

      // post_green: every item runs (command-backed + visual).
      let hasFailure = false;
      for (const item of items) {
        if (!hasExecutableCommand(item.command)) {
          const result = isA11yVerificationDispatchItem(item)
            ? await runA11yVerificationItem({
                prisma,
                execution,
                project,
                item,
                browserRunner,
              })
            : await runVisualVerificationItem({
                prisma,
                execution,
                project,
                item,
                browserRunner,
              });

          if (result.status !== "passed") {
            hasFailure = true;
          }

          continue;
        }

        const outcome = await runCommandItem({
          prisma,
          execution,
          project,
          item,
          phase: "post_green",
          iterationIndex,
          commandRunner,
        });

        if (outcome.testStatus !== "passed") {
          hasFailure = true;
        }
      }

      const completed = await listTestRuns(prisma, {
        taskExecutionId: execution.id,
        iterationIndex,
      });

      return {
        iterationIndex,
        preRedAborted: false,
        hasFailure,
        testRuns: completed,
      };
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
        .filter(
          (item) =>
            !hasExecutableCommand(item.command) &&
            !isVisualVerificationDispatchItem(item) &&
            !isA11yVerificationDispatchItem(item),
        )
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
          const result = isA11yVerificationDispatchItem(item)
            ? await runA11yVerificationItem({
                prisma,
                execution,
                project,
                item,
                browserRunner,
              })
            : await runVisualVerificationItem({
                prisma,
                execution,
                project,
                item,
                browserRunner,
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

/**
 * VIM-31 — runs one command-backed verification item for a single phase
 * (`pre_red` or `post_green`) within a TDD iteration. Persists the TestRun
 * row tagged with the supplied `phase` + `iterationIndex`, updates the
 * verification item status, emits the matching loop events, and writes the
 * deterministic meta.json artifact under
 * `.artifacts/executions/<id>/test-runs/<iter>-<phase>-<order>-<itemId>/`
 * so phase artifacts never overwrite each other.
 */
async function runCommandItem(input: {
  prisma: PrismaClient;
  execution: ExecutionVerificationContext;
  project: ExecutionVerificationContext["task"]["epic"]["project"];
  item: VerificationRunItem;
  phase: TestRunPhase;
  iterationIndex?: number;
  commandRunner: (input: CommandRunnerInput) => CommandRunnerResult;
}) {
  const command = input.item.command?.trim() ?? "";
  const startedAt = new Date();
  const phase = input.phase;
  const iterationIndex = input.iterationIndex;

  const testRun = await input.prisma.$transaction(async (tx) => {
    const created = await createTestRun(tx, {
      taskExecutionId: input.execution.id,
      verificationItemId: input.item.id,
      command,
      status: "running",
      startedAt,
      phase,
      ...(typeof iterationIndex === "number" ? { iterationIndex } : {}),
    });

    await tx.verificationItem.update({
      where: { id: input.item.id },
      data: {
        status: "running",
      },
    });

    await appendLoopEvent(tx, {
      projectId: input.project.id,
      taskExecutionId: input.execution.id,
      type: "test.started",
      payload: {
        taskId: input.execution.task.id,
        verificationItemId: input.item.id,
        testRunId: created.id,
        command,
        phase,
        iterationIndex: iterationIndex ?? null,
      },
    });

    return created;
  });

  const result = input.commandRunner({
    command,
    rootPath: input.project.rootPath,
    executionId: input.execution.id,
    verificationItemId: input.item.id,
    orderIndex: input.item.orderIndex,
    phase,
    ...(typeof iterationIndex === "number" ? { iterationIndex } : {}),
  });
  const finishedAt = new Date();
  const testStatus: "passed" | "failed" = result.exitCode === 0 ? "passed" : "failed";
  const itemStatus = result.exitCode === 0 ? "green" : "failed";

  await input.prisma.$transaction(async (tx) => {
    await updateTestRun(tx, testRun.id, {
      status: testStatus,
      exitCode: result.exitCode,
      stdoutPath: result.stdoutPath,
      stderrPath: result.stderrPath,
      finishedAt,
    });

    await tx.verificationItem.update({
      where: { id: input.item.id },
      data: {
        status: itemStatus,
      },
    });

    if (result.stdout.trim().length > 0) {
      await appendLoopEvent(tx, {
        projectId: input.project.id,
        taskExecutionId: input.execution.id,
        type: "test.stdout",
        payload: {
          taskId: input.execution.task.id,
          verificationItemId: input.item.id,
          testRunId: testRun.id,
          path: result.stdoutPath,
          chunk: result.stdout,
          phase,
          iterationIndex: iterationIndex ?? null,
        },
      });
    }

    if (result.stderr.trim().length > 0) {
      await appendLoopEvent(tx, {
        projectId: input.project.id,
        taskExecutionId: input.execution.id,
        type: "test.stderr",
        payload: {
          taskId: input.execution.task.id,
          verificationItemId: input.item.id,
          testRunId: testRun.id,
          path: result.stderrPath,
          chunk: result.stderr,
          phase,
          iterationIndex: iterationIndex ?? null,
        },
      });
    }

    await appendLoopEvent(tx, {
      projectId: input.project.id,
      taskExecutionId: input.execution.id,
      type: "test.finished",
      payload: {
        taskId: input.execution.task.id,
        verificationItemId: input.item.id,
        testRunId: testRun.id,
        exitCode: result.exitCode,
        status: testStatus,
        phase,
        iterationIndex: iterationIndex ?? null,
      },
    });
  });

  writeTestRunMetaFile({
    artifactDirectory: result.artifactDirectory,
    executionId: input.execution.id,
    verificationItemId: input.item.id,
    orderIndex: input.item.orderIndex,
    kind: input.item.kind,
    title: input.item.title,
    command,
    startedAt,
    finishedAt,
    exitCode: result.exitCode,
    status: testStatus,
  });

  return {
    testRunId: testRun.id,
    testStatus,
  };
}

/**
 * VIM-31 — `logic` is the only verification kind that participates in the
 * pre_red invariant check. Other kinds (visual, evidence, integration,
 * typecheck) are exempt because their pre_red semantics either don't apply
 * (visual asset checks need final state) or are out of scope for the TDD
 * red invariant.
 */
function isLogicKind(kind: string): boolean {
  return kind.trim().toLowerCase() === "logic";
}

async function runVisualVerificationItem(input: {
  prisma: PrismaClient;
  execution: ExecutionVerificationContext;
  project: ExecutionVerificationContext["task"]["epic"]["project"];
  item: VerificationRunItem;
  browserRunner: BrowserVerificationRunner;
}) {
  const startedAt = new Date();
  const mode = resolveVisualVerificationMode(input.item);
  const sourceAsset = await resolveVisualSourceAsset(
    input.prisma,
    input.project.id,
    input.execution.task.id,
    input.item,
  );

  const targetUrl = resolveBrowserTargetUrl(input.project.rootPath, input.item);
  if (sourceAsset.usable && sourceAsset.asset && targetUrl && isBrowserVisualMode(mode)) {
    return runBrowserVisualVerificationItem({
      ...input,
      sourceAsset: sourceAsset.asset,
      targetUrl,
      mode,
      startedAt,
    });
  }

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

async function runA11yVerificationItem(input: {
  prisma: PrismaClient;
  execution: ExecutionVerificationContext;
  project: ExecutionVerificationContext["task"]["epic"]["project"];
  item: VerificationRunItem;
  browserRunner: BrowserVerificationRunner;
}) {
  const startedAt = new Date();
  const targetUrl = resolveBrowserTargetUrl(input.project.rootPath, input.item);
  const command = targetUrl ? `taskgoblin-browser.run_axe ${targetUrl}` : "taskgoblin-browser.run_axe";
  const testRun = await input.prisma.$transaction(async (tx) => {
    const created = await createTestRun(tx, {
      taskExecutionId: input.execution.id,
      verificationItemId: input.item.id,
      command,
      status: "running",
      startedAt,
    });

    await tx.verificationItem.update({
      where: { id: input.item.id },
      data: { status: "running" },
    });

    await appendLoopEvent(tx, {
      projectId: input.project.id,
      taskExecutionId: input.execution.id,
      type: "test.started",
      payload: {
        taskId: input.execution.task.id,
        verificationItemId: input.item.id,
        testRunId: created.id,
        command,
        kind: "a11y",
      },
    });

    return created;
  });

  let evidence: Record<string, unknown>;
  let status: "passed" | "failed";
  let exitCode: number;

  if (!targetUrl) {
    evidence = {
      error: "A11y verification requires config.url, config.targetUrl, or route.",
    };
    status = "failed";
    exitCode = 1;
  } else {
    try {
      const result = await input.browserRunner.runAxe({
        url: targetUrl,
        viewport: resolveBrowserViewport(input.item),
        browserExecutablePath: resolveBrowserExecutablePath(input.item),
      });
      evidence = {
        url: result.url,
        violationCount: result.violationCount,
        violations: result.violations,
      };
      status = result.violationCount === 0 ? "passed" : "failed";
      exitCode = status === "passed" ? 0 : 1;
    } catch (error) {
      evidence = {
        url: targetUrl,
        error: error instanceof Error ? error.message : String(error),
      };
      status = "failed";
      exitCode = 1;
    }
  }

  const finishedAt = new Date();
  const itemStatus = status === "passed" ? "green" : "failed";

  await input.prisma.$transaction(async (tx) => {
    await updateTestRun(tx, testRun.id, {
      status,
      exitCode,
      evidenceJson: JSON.stringify(evidence),
      finishedAt,
    });

    await tx.verificationItem.update({
      where: { id: input.item.id },
      data: { status: itemStatus },
    });

    await appendLoopEvent(tx, {
      projectId: input.project.id,
      taskExecutionId: input.execution.id,
      type: "test.finished",
      payload: {
        taskId: input.execution.task.id,
        verificationItemId: input.item.id,
        testRunId: testRun.id,
        exitCode,
        status,
        kind: "a11y",
        violationCount: typeof evidence.violationCount === "number" ? evidence.violationCount : null,
      },
    });
  });

  return { status };
}

async function runBrowserVisualVerificationItem(input: {
  prisma: PrismaClient;
  execution: ExecutionVerificationContext;
  project: ExecutionVerificationContext["task"]["epic"]["project"];
  item: VerificationRunItem;
  browserRunner: BrowserVerificationRunner;
  sourceAsset: NonNullable<Awaited<ReturnType<typeof resolveVisualSourceAsset>>["asset"]>;
  targetUrl: string;
  mode: string;
  startedAt: Date;
}) {
  const artifactDirectory = buildBrowserArtifactDirectory({
    rootPath: input.project.rootPath,
    executionId: input.execution.id,
    orderIndex: input.item.orderIndex,
    verificationItemId: input.item.id,
    mode: input.mode,
  });
  mkdirSync(artifactDirectory, { recursive: true });

  const actualPath = normalizePath(join(artifactDirectory, "actual.png"));
  const diffPath = normalizePath(join(artifactDirectory, "diff.png"));
  const expectedPath = normalizePath(join(input.project.rootPath, input.sourceAsset.relativePath));
  const threshold = resolveVisualDiffThreshold(input.item);

  await input.prisma.$transaction(async (tx) => {
    await tx.verificationItem.update({
      where: { id: input.item.id },
      data: { status: "running" },
    });

    await appendLoopEvent(tx, {
      projectId: input.project.id,
      taskExecutionId: input.execution.id,
      type: "visual.started",
      payload: {
        taskId: input.execution.task.id,
        verificationItemId: input.item.id,
        mode: input.mode,
        sourceAssetId: input.sourceAsset.id,
        expectedAssetId: input.item.expectedAssetId ?? null,
        targetUrl: input.targetUrl,
      },
    });
  });

  let status: "passed" | "failed";
  let summary: string;
  let metadata: Record<string, unknown>;
  let compareResult: ImageDiffResult | null = null;

  try {
    const viewport = resolveBrowserViewport(input.item);
    const browserExecutablePath = resolveBrowserExecutablePath(input.item);
    const navigation = await input.browserRunner.navigate({
      url: input.targetUrl,
      viewport,
      browserExecutablePath,
    });

    await input.browserRunner.screenshot({
      url: input.targetUrl,
      outputPath: actualPath,
      viewport,
      fullPage: resolveFullPage(input.item),
      browserExecutablePath,
    });

    compareResult = await input.browserRunner.compareImages(actualPath, expectedPath, {
      threshold: resolvePixelmatchThreshold(input.item),
      diffOutputPath: diffPath,
    });
    const diffRatio = getImageDiffRatio(compareResult);
    status = compareResult.matched || diffRatio <= threshold ? "passed" : "failed";
    summary =
      status === "passed"
        ? "Browser screenshot matched the expected visual asset."
        : "Browser screenshot differed from the expected visual asset.";
    metadata = {
      targetUrl: input.targetUrl,
      navigation,
      expectedPath,
      actualPath,
      diffPath,
      compareResult,
      threshold,
      diffRatio,
    };
  } catch (error) {
    status = "failed";
    summary = error instanceof Error ? error.message : String(error);
    metadata = {
      targetUrl: input.targetUrl,
      expectedPath,
      actualPath,
      error: summary,
    };
  }

  const finishedAt = new Date();
  const itemStatus = status === "passed" ? "green" : "failed";
  const diffRatio = compareResult ? getImageDiffRatio(compareResult) : null;

  await input.prisma.$transaction(async (tx) => {
    const result = await persistVisualVerificationResult(tx, {
      taskExecutionId: input.execution.id,
      verificationItemId: input.item.id,
      sourceAssetId: input.sourceAsset.id,
      mode: input.mode,
      status,
      summary,
      artifactDirectory,
      actualPath,
      diffPath,
      sha256: fileSha256OrNull(actualPath),
      diffRatio,
      threshold,
      metadata,
      startedAt: input.startedAt,
      finishedAt,
    });

    await tx.verificationItem.update({
      where: { id: input.item.id },
      data: { status: itemStatus },
    });

    await appendLoopEvent(tx, {
      projectId: input.project.id,
      taskExecutionId: input.execution.id,
      type: "visual.finished",
      payload: {
        taskId: input.execution.task.id,
        verificationItemId: input.item.id,
        visualVerificationResultId: result.id,
        mode: input.mode,
        status,
        sourceAssetId: input.sourceAsset.id,
        expectedAssetId: input.item.expectedAssetId ?? null,
        targetUrl: input.targetUrl,
        diffRatio,
        threshold,
        summary,
      },
    });
  });

  return { status };
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

function isA11yVerificationDispatchItem(item: VerificationRunItem) {
  const kind = normalizeVisualToken(item.kind);
  const runner = normalizeVisualToken(item.runner);
  const config = parseJsonObject(item.configJson);
  const mode = normalizeVisualToken(stringFromUnknown(config.mode) ?? stringFromUnknown(config.a11yMode));

  return kind === "a11y" || kind === "accessibility" || runner === "axe" || mode === "axe";
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

function isBrowserVisualMode(mode: string) {
  return ["screenshot", "pixel-diff", "screenshot-diff", "visual-diff"].includes(normalizeVisualToken(mode));
}

function resolveBrowserTargetUrl(rootPath: string, item: VerificationRunItem) {
  const config = parseJsonObject(item.configJson);
  const raw =
    stringFromUnknown(config.url) ??
    stringFromUnknown(config.targetUrl) ??
    stringFromUnknown(config.href) ??
    stringFromUnknown(item.route);

  if (!raw) {
    return null;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    return raw;
  }

  const baseUrl = stringFromUnknown(config.baseUrl);
  if (baseUrl) {
    return new URL(raw, baseUrl).toString();
  }

  const relativePath = raw.replace(/^[/\\]+/, "");
  const absolutePath = isAbsolute(raw) ? raw : join(rootPath, relativePath);
  return pathToFileURL(absolutePath).toString();
}

function resolveBrowserViewport(item: VerificationRunItem) {
  const config = parseJsonObject(item.configJson);
  const viewport = config.viewport;

  if (!viewport || typeof viewport !== "object" || Array.isArray(viewport)) {
    return undefined;
  }

  const record = viewport as Record<string, unknown>;
  const width = numberFromUnknown(record.width);
  const height = numberFromUnknown(record.height);

  return width && height ? { width, height } : undefined;
}

function resolveBrowserExecutablePath(item: VerificationRunItem) {
  const config = parseJsonObject(item.configJson);
  return stringFromUnknown(config.browserExecutablePath) ?? undefined;
}

function resolveFullPage(item: VerificationRunItem) {
  const config = parseJsonObject(item.configJson);
  return config.fullPage === true;
}

function resolveVisualDiffThreshold(item: VerificationRunItem) {
  const config = parseJsonObject(item.configJson);
  return (
    numberFromUnknown(config.threshold) ??
    numberFromUnknown(config.diffThreshold) ??
    numberFromUnknown(config.maxDiffRatio) ??
    0.01
  );
}

function resolvePixelmatchThreshold(item: VerificationRunItem) {
  const config = parseJsonObject(item.configJson);
  return numberFromUnknown(config.pixelmatchThreshold) ?? 0.1;
}

function numberFromUnknown(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getImageDiffRatio(result: ImageDiffResult) {
  if ("diffPixels" in result) {
    return result.totalPixels === 0 ? 0 : result.diffPixels / result.totalPixels;
  }
  if (result.reason === "size-mismatch") {
    return 1;
  }
  return 1;
}

function buildBrowserArtifactDirectory(input: {
  rootPath: string;
  executionId: string;
  orderIndex: number;
  verificationItemId: string;
  mode: string;
}) {
  return join(
    input.rootPath,
    ".artifacts",
    "executions",
    input.executionId,
    "browser",
    `${input.orderIndex}-${input.verificationItemId}-${normalizeVisualToken(input.mode) || "browser"}`,
  );
}

function fileSha256OrNull(path: string) {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
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
