import type { TestRunStatus } from "@vimbuspromax3000/shared";
import type { DatabaseClient } from "./types";

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
};

export type ListTestRunsInput = {
  taskExecutionId: string;
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
