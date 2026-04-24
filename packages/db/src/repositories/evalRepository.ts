import type { DatabaseClient } from "./types";

export type CreateEvalRunInput = {
  projectId: string;
  taskExecutionId?: string | null;
  status: string;
  inputHash?: string | null;
};

export type UpdateEvalRunInput = {
  status?: string;
  aggregateScore?: number | null;
  threshold?: number | null;
  verdict?: string | null;
  finishedAt?: Date | null;
};

export type CreateEvalResultInput = {
  evalRunId: string;
  dimension: string;
  score: number;
  threshold: number;
  verdict: string;
  evaluatorType: string;
  modelName?: string | null;
  promptVersion?: string | null;
  reasoning: string;
  evidenceJson?: string | null;
};

export async function createEvalRun(db: DatabaseClient, input: CreateEvalRunInput) {
  return db.evalRun.create({
    data: {
      projectId: input.projectId,
      taskExecutionId: input.taskExecutionId ?? null,
      status: input.status,
      inputHash: input.inputHash ?? null,
    },
  });
}

export async function createEvalResult(db: DatabaseClient, input: CreateEvalResultInput) {
  return db.evalResult.create({
    data: {
      evalRunId: input.evalRunId,
      dimension: input.dimension,
      score: input.score,
      threshold: input.threshold,
      verdict: input.verdict,
      evaluatorType: input.evaluatorType,
      modelName: input.modelName ?? null,
      promptVersion: input.promptVersion ?? null,
      reasoning: input.reasoning,
      evidenceJson: input.evidenceJson ?? null,
    },
  });
}

export async function updateEvalRun(db: DatabaseClient, id: string, input: UpdateEvalRunInput) {
  return db.evalRun.update({
    where: { id },
    data: {
      ...(input.status !== undefined && { status: input.status }),
      ...(input.aggregateScore !== undefined && { aggregateScore: input.aggregateScore }),
      ...(input.threshold !== undefined && { threshold: input.threshold }),
      ...(input.verdict !== undefined && { verdict: input.verdict }),
      ...(input.finishedAt !== undefined && { finishedAt: input.finishedAt }),
    },
  });
}

export async function listEvalRuns(db: DatabaseClient, taskExecutionId: string) {
  return db.evalRun.findMany({
    where: { taskExecutionId },
    include: { results: { orderBy: [{ createdAt: "asc" }] } },
    orderBy: [{ createdAt: "desc" }],
  });
}

export async function getEvalRunDetail(db: DatabaseClient, id: string) {
  return db.evalRun.findUnique({
    where: { id },
    include: { results: { orderBy: [{ createdAt: "asc" }] } },
  });
}

export async function getLatestCompletedEvalRun(db: DatabaseClient, taskExecutionId: string, inputHash: string) {
  return db.evalRun.findFirst({
    where: { taskExecutionId, inputHash, status: "completed" },
    include: { results: { orderBy: [{ createdAt: "asc" }] } },
    orderBy: [{ createdAt: "desc" }],
  });
}
