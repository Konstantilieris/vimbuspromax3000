import type { DatabaseClient } from "./types";

export type BenchmarkEvalDimensionScore = {
  dimension: string;
  score: number;
  passThreshold: number;
  hardFail: boolean;
  passed: boolean;
  weight: number;
};

export type BenchmarkEvalRunResult = {
  scenarioId: string;
  runId: string;
  aggregateScore: number;
  verdict: string;
  dimensionScores: BenchmarkEvalDimensionScore[];
  toolSequenceSummary: string[];
  verificationSummary: unknown;
  unsafeMcpAttempts: unknown;
  retryCount: number;
  modelCost: number;
  metadata: Record<string, unknown>;
};

export async function createEvalRun(
  db: DatabaseClient,
  input: {
    id?: string;
    projectId: string;
    taskExecutionId?: string | null;
    benchmarkScenarioId?: string | null;
    status?: string;
    aggregateScore?: number | null;
    threshold?: number | null;
    verdict?: string | null;
    inputHash?: string | null;
    startedAt?: Date | null;
    finishedAt?: Date | null;
  },
) {
  return db.evalRun.create({
    data: {
      id: input.id,
      projectId: input.projectId,
      taskExecutionId: input.taskExecutionId ?? null,
      benchmarkScenarioId: input.benchmarkScenarioId ?? null,
      status: input.status ?? "queued",
      aggregateScore: input.aggregateScore ?? null,
      threshold: input.threshold ?? null,
      verdict: input.verdict ?? null,
      inputHash: input.inputHash ?? null,
      startedAt: input.startedAt ?? null,
      finishedAt: input.finishedAt ?? null,
    },
  });
}

export async function updateEvalRun(
  db: DatabaseClient,
  id: string,
  input: {
    status?: string;
    aggregateScore?: number | null;
    threshold?: number | null;
    verdict?: string | null;
    finishedAt?: Date | null;
  },
) {
  return db.evalRun.update({
    where: { id },
    data: input,
    include: { results: true },
  });
}

export async function getEvalRun(db: DatabaseClient, id: string) {
  return db.evalRun.findUnique({
    where: { id },
    include: { results: true },
  });
}

export async function listEvalRuns(
  db: DatabaseClient,
  input: { projectId: string; benchmarkScenarioId?: string; taskExecutionId?: string },
) {
  return db.evalRun.findMany({
    where: {
      projectId: input.projectId,
      benchmarkScenarioId: input.benchmarkScenarioId,
      taskExecutionId: input.taskExecutionId,
    },
    include: { results: true },
    orderBy: [{ createdAt: "desc" }],
  });
}

export async function listEvalRunsForExecution(db: DatabaseClient, taskExecutionId: string) {
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

export async function getLatestCompletedEvalRun(
  db: DatabaseClient,
  taskExecutionId: string,
  inputHash: string,
) {
  return db.evalRun.findFirst({
    where: { taskExecutionId, inputHash, status: "completed" },
    include: { results: { orderBy: [{ createdAt: "asc" }] } },
    orderBy: [{ createdAt: "desc" }],
  });
}

export async function createEvalResult(
  db: DatabaseClient,
  input: {
    evalRunId: string;
    dimension: string;
    score: number;
    threshold: number;
    verdict: string;
    evaluatorType?: string;
    modelName?: string | null;
    promptVersion?: string | null;
    reasoning: string;
    evidenceJson?: string | null;
  },
) {
  return db.evalResult.create({
    data: {
      evalRunId: input.evalRunId,
      dimension: input.dimension,
      score: input.score,
      threshold: input.threshold,
      verdict: input.verdict,
      evaluatorType: input.evaluatorType ?? "rule",
      modelName: input.modelName ?? null,
      promptVersion: input.promptVersion ?? null,
      reasoning: input.reasoning,
      evidenceJson: input.evidenceJson ?? null,
    },
  });
}

export async function listEvalResults(db: DatabaseClient, evalRunId: string) {
  return db.evalResult.findMany({
    where: { evalRunId },
    orderBy: [{ dimension: "asc" }],
  });
}

export async function persistBenchmarkEvalRunResult(
  db: DatabaseClient,
  input: {
    projectId: string;
    taskExecutionId?: string | null;
    inputHash?: string | null;
    threshold?: number | null;
    startedAt?: Date | null;
    finishedAt?: Date | null;
    result: BenchmarkEvalRunResult;
  },
) {
  const threshold = input.threshold ?? null;
  const evalRun = await createEvalRun(db, {
    id: input.result.runId,
    projectId: input.projectId,
    taskExecutionId: input.taskExecutionId ?? null,
    benchmarkScenarioId: input.result.scenarioId,
    status: toEvaluationStatus(input.result.verdict),
    aggregateScore: toStoredScore(input.result.aggregateScore),
    threshold: threshold === null ? null : toStoredScore(threshold),
    verdict: input.result.verdict,
    inputHash: input.inputHash ?? null,
    startedAt: input.startedAt ?? null,
    finishedAt: input.finishedAt ?? new Date(),
  });

  const results = [];

  for (const dimensionScore of input.result.dimensionScores) {
    const result = await createEvalResult(db, {
      evalRunId: evalRun.id,
      dimension: dimensionScore.dimension,
      score: toStoredScore(dimensionScore.score),
      threshold: toStoredScore(dimensionScore.passThreshold),
      verdict: dimensionScore.passed ? "passed" : "failed",
      evaluatorType: "rule",
      reasoning: buildRuleReasoning(dimensionScore),
      evidenceJson: JSON.stringify({
        dimensionScore,
        toolSequenceSummary: input.result.toolSequenceSummary,
        verificationSummary: input.result.verificationSummary,
        unsafeMcpAttempts: input.result.unsafeMcpAttempts,
        retryCount: input.result.retryCount,
        modelCost: input.result.modelCost,
        metadata: input.result.metadata,
      }),
    });

    results.push(result);
  }

  return {
    ...evalRun,
    results,
  };
}

function buildRuleReasoning(score: BenchmarkEvalDimensionScore) {
  const outcome = score.passed ? "passed" : "failed";
  const hardFail = score.hardFail ? " hard-fail" : "";

  return `Rule-based${hardFail} dimension ${outcome}: ${score.score}/${score.passThreshold}.`;
}

function toEvaluationStatus(verdict: string) {
  return verdict === "blocked" ? "failed" : verdict;
}

function toStoredScore(score: number) {
  return Math.round(score);
}
