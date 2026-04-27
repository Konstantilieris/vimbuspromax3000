import type { TestRunStatus } from "@vimbuspromax3000/shared";
import type { DatabaseClient } from "./types";

/**
 * VIM-31 — phase tag persisted on each {@link TestRun} row.
 *
 * - `pre_red` runs against the empty / pre-edit branch state. The TDD
 *   invariant says no logic test may pass here; if one does, the run aborts.
 * - `post_green` runs after the agent loop applies its edits. Failures here
 *   feed VIM-30's existing retry path.
 */
export type TestRunPhase = "pre_red" | "post_green";

export type CreateTestRunInput = {
  taskExecutionId: string;
  verificationItemId?: string | null;
  command: string;
  status: TestRunStatus;
  exitCode?: number | null;
  stdoutPath?: string | null;
  stderrPath?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  /**
   * VIM-31 — monotonically increasing iteration index (1-based) for the TDD
   * red/green loop. Each iteration writes one row per phase. Defaults to 1
   * to preserve the prior single-shot semantics for existing callers.
   */
  iterationIndex?: number;
  /** VIM-31 — see {@link TestRunPhase}. Defaults to `post_green`. */
  phase?: TestRunPhase;
};

export type ListTestRunsInput = {
  taskExecutionId: string;
  iterationIndex?: number;
  phase?: TestRunPhase;
};

export type UpdateTestRunInput = {
  status?: TestRunStatus;
  exitCode?: number | null;
  stdoutPath?: string | null;
  stderrPath?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
};

export async function createTestRun(db: DatabaseClient, input: CreateTestRunInput) {
  return db.testRun.create({
    data: {
      taskExecutionId: input.taskExecutionId,
      verificationItemId: input.verificationItemId ?? null,
      command: input.command,
      status: input.status,
      exitCode: input.exitCode ?? null,
      stdoutPath: input.stdoutPath ?? null,
      stderrPath: input.stderrPath ?? null,
      startedAt: input.startedAt ?? null,
      finishedAt: input.finishedAt ?? null,
      iterationIndex: input.iterationIndex ?? 1,
      phase: input.phase ?? "post_green",
    },
  });
}

export async function getTestRun(db: DatabaseClient, id: string) {
  return db.testRun.findUnique({
    where: { id },
    include: {
      verificationItem: true,
    },
  });
}

export async function listTestRuns(db: DatabaseClient, input: ListTestRunsInput) {
  return db.testRun.findMany({
    where: {
      taskExecutionId: input.taskExecutionId,
      ...(typeof input.iterationIndex === "number"
        ? { iterationIndex: input.iterationIndex }
        : {}),
      ...(input.phase ? { phase: input.phase } : {}),
    },
    include: {
      verificationItem: true,
    },
    orderBy: [{ createdAt: "asc" }],
  });
}

export async function updateTestRun(db: DatabaseClient, id: string, input: UpdateTestRunInput) {
  return db.testRun.update({
    where: { id },
    data: {
      status: input.status,
      exitCode: input.exitCode,
      stdoutPath: input.stdoutPath,
      stderrPath: input.stderrPath,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
    },
  });
}
