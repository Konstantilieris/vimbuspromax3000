import type { DatabaseClient } from "./types";

export type BenchmarkDimensionScoreSnapshot = {
  dimension: string;
  score: number;
  hardFail: boolean;
  passThreshold?: number;
  passed?: boolean;
  weight?: number;
};

export type BenchmarkScenarioDefinition = {
  id: string;
  name: string;
  goal: string;
  expectedTools: string[];
  forbiddenTools: string[];
  expectedVerificationItems: string[];
  passThreshold?: number;
  aggregateWarnThreshold?: number;
  dimensions?: Record<string, { passThreshold?: number; hardFail?: boolean; weight?: number }>;
};

export type BenchmarkRunResultSnapshot = {
  scenarioId: string;
  runId: string;
  aggregateScore: number;
  verdict: string;
  dimensionScores: BenchmarkDimensionScoreSnapshot[];
  toolSequenceSummary: string[];
  verificationSummary?: unknown;
  unsafeMcpAttempts?: unknown;
  retryCount?: number;
  modelCost?: number;
  metadata?: Record<string, unknown>;
};

export type RegressionBaselineSnapshot = {
  id: string;
  scenarioId: string;
  runId: string;
  aggregateScore: number;
  dimensionScores: BenchmarkDimensionScoreSnapshot[];
  toolSequenceSummary?: string[];
  verificationSummary?: unknown;
  unsafeMcpAttempts?: unknown;
  retryCount?: number;
  modelCost?: number;
  acceptedAt: Date;
};

export type RegressionComparisonSnapshot = {
  scenarioId: string;
  baselineRunId: string;
  candidateRunId: string;
  status: "passed" | "blocked";
  aggregateDelta: number;
  blockers: unknown[];
  warnings: unknown[];
};

export type BenchmarkScenarioThresholds = {
  passThreshold?: number;
  aggregateWarnThreshold?: number;
  expectedVerificationItems?: string[];
  dimensions?: Record<string, { passThreshold?: number; hardFail?: boolean; weight?: number }>;
};

export async function createBenchmarkScenario(
  db: DatabaseClient,
  input: {
    projectId: string;
    name: string;
    goal: string;
    status?: string;
    fixturePath?: string | null;
    expectedTools?: readonly string[];
    expectedToolsJson?: string | null;
    forbiddenTools?: readonly string[];
    forbiddenToolsJson?: string | null;
    expectedVerificationItems?: readonly string[];
    passThreshold?: number;
    aggregateWarnThreshold?: number;
    dimensions?: BenchmarkScenarioThresholds["dimensions"];
    thresholdsJson?: string | null;
  },
) {
  return db.benchmarkScenario.create({
    data: {
      projectId: input.projectId,
      name: input.name,
      goal: input.goal,
      status: input.status ?? "active",
      fixturePath: input.fixturePath ?? null,
      expectedToolsJson: input.expectedToolsJson ?? stringifyOptional(input.expectedTools),
      forbiddenToolsJson: input.forbiddenToolsJson ?? stringifyOptional(input.forbiddenTools),
      thresholdsJson:
        input.thresholdsJson ??
        stringifyOptional(buildThresholds({
          expectedVerificationItems: input.expectedVerificationItems,
          passThreshold: input.passThreshold,
          aggregateWarnThreshold: input.aggregateWarnThreshold,
          dimensions: input.dimensions,
        })),
    },
  });
}

export async function upsertBenchmarkScenario(
  db: DatabaseClient,
  input: Parameters<typeof createBenchmarkScenario>[1],
) {
  return db.benchmarkScenario.upsert({
    where: {
      projectId_name: {
        projectId: input.projectId,
        name: input.name,
      },
    },
    update: {
      goal: input.goal,
      status: input.status ?? "active",
      fixturePath: input.fixturePath ?? null,
      expectedToolsJson: input.expectedToolsJson ?? stringifyOptional(input.expectedTools),
      forbiddenToolsJson: input.forbiddenToolsJson ?? stringifyOptional(input.forbiddenTools),
      thresholdsJson:
        input.thresholdsJson ??
        stringifyOptional(buildThresholds({
          expectedVerificationItems: input.expectedVerificationItems,
          passThreshold: input.passThreshold,
          aggregateWarnThreshold: input.aggregateWarnThreshold,
          dimensions: input.dimensions,
        })),
    },
    create: {
      projectId: input.projectId,
      name: input.name,
      goal: input.goal,
      status: input.status ?? "active",
      fixturePath: input.fixturePath ?? null,
      expectedToolsJson: input.expectedToolsJson ?? stringifyOptional(input.expectedTools),
      forbiddenToolsJson: input.forbiddenToolsJson ?? stringifyOptional(input.forbiddenTools),
      thresholdsJson:
        input.thresholdsJson ??
        stringifyOptional(buildThresholds({
          expectedVerificationItems: input.expectedVerificationItems,
          passThreshold: input.passThreshold,
          aggregateWarnThreshold: input.aggregateWarnThreshold,
          dimensions: input.dimensions,
        })),
    },
  });
}

export async function listBenchmarkScenarios(
  db: DatabaseClient,
  input: { projectId: string; status?: string },
) {
  return db.benchmarkScenario.findMany({
    where: {
      projectId: input.projectId,
      status: input.status,
    },
    orderBy: [{ name: "asc" }],
  });
}

export async function listBenchmarkScenarioDefinitions(
  db: DatabaseClient,
  input: { projectId: string; status?: string },
): Promise<BenchmarkScenarioDefinition[]> {
  const scenarios = await listBenchmarkScenarios(db, input);

  return scenarios.map(toBenchmarkScenarioDefinition);
}

export async function getBenchmarkScenario(db: DatabaseClient, id: string) {
  return db.benchmarkScenario.findUnique({
    where: { id },
  });
}

export async function getBenchmarkScenarioDefinition(
  db: DatabaseClient,
  id: string,
): Promise<BenchmarkScenarioDefinition | null> {
  const scenario = await getBenchmarkScenario(db, id);

  return scenario ? toBenchmarkScenarioDefinition(scenario) : null;
}

export async function getBenchmarkScenarioByName(
  db: DatabaseClient,
  input: { projectId: string; name: string },
) {
  return db.benchmarkScenario.findUnique({
    where: {
      projectId_name: {
        projectId: input.projectId,
        name: input.name,
      },
    },
  });
}

export async function updateBenchmarkScenario(
  db: DatabaseClient,
  id: string,
  input: {
    name?: string;
    goal?: string;
    status?: string;
    fixturePath?: string | null;
    expectedTools?: readonly string[];
    expectedToolsJson?: string | null;
    forbiddenTools?: readonly string[];
    forbiddenToolsJson?: string | null;
    expectedVerificationItems?: readonly string[];
    passThreshold?: number;
    aggregateWarnThreshold?: number;
    dimensions?: BenchmarkScenarioThresholds["dimensions"];
    thresholdsJson?: string | null;
  },
) {
  const current = await getBenchmarkScenario(db, id);
  const thresholdsJson =
    input.thresholdsJson !== undefined
      ? input.thresholdsJson
      : buildUpdatedThresholdsJson(current?.thresholdsJson ?? null, {
          expectedVerificationItems: input.expectedVerificationItems,
          passThreshold: input.passThreshold,
          aggregateWarnThreshold: input.aggregateWarnThreshold,
          dimensions: input.dimensions,
        });

  return db.benchmarkScenario.update({
    where: { id },
    data: {
      name: input.name,
      goal: input.goal,
      status: input.status,
      fixturePath: input.fixturePath,
      expectedToolsJson:
        input.expectedToolsJson !== undefined ? input.expectedToolsJson : stringifyForUpdate(input.expectedTools),
      forbiddenToolsJson:
        input.forbiddenToolsJson !== undefined ? input.forbiddenToolsJson : stringifyForUpdate(input.forbiddenTools),
      thresholdsJson,
    },
  });
}

export async function deleteBenchmarkScenario(db: DatabaseClient, id: string) {
  return db.benchmarkScenario.delete({
    where: { id },
  });
}

export async function createRegressionBaseline(
  db: DatabaseClient,
  input: {
    projectId: string;
    benchmarkScenarioId: string;
    evalRunId: string;
    status?: string;
    aggregateScore: number;
    dimensionScoresJson: string;
    toolSummaryJson?: string | null;
    modelSummaryJson?: string | null;
  },
) {
  return db.regressionBaseline.create({
    data: {
      projectId: input.projectId,
      benchmarkScenarioId: input.benchmarkScenarioId,
      evalRunId: input.evalRunId,
      status: input.status ?? "baseline",
      aggregateScore: input.aggregateScore,
      dimensionScoresJson: input.dimensionScoresJson,
      toolSummaryJson: input.toolSummaryJson ?? null,
      modelSummaryJson: input.modelSummaryJson ?? null,
    },
  });
}

export async function createRegressionBaselineFromRunResult(
  db: DatabaseClient,
  input: {
    projectId: string;
    benchmarkScenarioId: string;
    result: BenchmarkRunResultSnapshot;
    status?: string;
  },
) {
  return createRegressionBaseline(db, {
    projectId: input.projectId,
    benchmarkScenarioId: input.benchmarkScenarioId,
    evalRunId: input.result.runId,
    status: input.status ?? "baseline",
    aggregateScore: toStoredScore(input.result.aggregateScore),
    dimensionScoresJson: JSON.stringify(input.result.dimensionScores),
    toolSummaryJson: JSON.stringify({
      toolSequenceSummary: input.result.toolSequenceSummary,
      verificationSummary: input.result.verificationSummary,
      unsafeMcpAttempts: input.result.unsafeMcpAttempts,
    }),
    modelSummaryJson: JSON.stringify({
      retryCount: input.result.retryCount ?? 0,
      modelCost: input.result.modelCost ?? 0,
      metadata: input.result.metadata ?? {},
    }),
  });
}

export async function listRegressionBaselines(
  db: DatabaseClient,
  input: { projectId: string; benchmarkScenarioId?: string; status?: string },
) {
  return db.regressionBaseline.findMany({
    where: {
      projectId: input.projectId,
      benchmarkScenarioId: input.benchmarkScenarioId,
      status: input.status,
    },
    orderBy: [{ acceptedAt: "desc" }],
  });
}

export async function listRegressionBaselineSnapshots(
  db: DatabaseClient,
  input: { projectId: string; benchmarkScenarioId?: string; status?: string },
): Promise<RegressionBaselineSnapshot[]> {
  const baselines = await listRegressionBaselines(db, input);

  return baselines.map(toRegressionBaselineSnapshot);
}

export async function getActiveRegressionBaseline(
  db: DatabaseClient,
  input: { projectId: string; benchmarkScenarioId: string },
) {
  return db.regressionBaseline.findFirst({
    where: {
      projectId: input.projectId,
      benchmarkScenarioId: input.benchmarkScenarioId,
      status: "baseline",
    },
    orderBy: [{ acceptedAt: "desc" }],
  });
}

export async function getActiveRegressionBaselineSnapshot(
  db: DatabaseClient,
  input: { projectId: string; benchmarkScenarioId: string },
): Promise<RegressionBaselineSnapshot | null> {
  const baseline = await getActiveRegressionBaseline(db, input);

  return baseline ? toRegressionBaselineSnapshot(baseline) : null;
}

export async function createRegressionComparisonSnapshot(
  db: DatabaseClient,
  input: {
    projectId: string;
    benchmarkScenarioId: string;
    comparison: RegressionComparisonSnapshot;
    candidate: BenchmarkRunResultSnapshot;
  },
) {
  return createRegressionBaseline(db, {
    projectId: input.projectId,
    benchmarkScenarioId: input.benchmarkScenarioId,
    evalRunId: input.comparison.candidateRunId,
    status: input.comparison.status,
    aggregateScore: toStoredScore(input.candidate.aggregateScore),
    dimensionScoresJson: JSON.stringify(input.candidate.dimensionScores),
    toolSummaryJson: JSON.stringify({
      toolSequenceSummary: input.candidate.toolSequenceSummary,
      unsafeMcpAttempts: input.candidate.unsafeMcpAttempts,
    }),
    modelSummaryJson: JSON.stringify({
      comparison: input.comparison,
      retryCount: input.candidate.retryCount ?? 0,
      modelCost: input.candidate.modelCost ?? 0,
      metadata: input.candidate.metadata ?? {},
    }),
  });
}

export async function listBenchmarkMcpToolCalls(
  db: DatabaseClient,
  input: { projectId: string; taskExecutionId?: string; status?: string; limit?: number },
) {
  return db.mcpToolCall.findMany({
    where: {
      projectId: input.projectId,
      taskExecutionId: input.taskExecutionId,
      status: input.status,
    },
    orderBy: [{ createdAt: "asc" }],
    take: input.limit ?? 500,
  });
}

function toBenchmarkScenarioDefinition(row: {
  id: string;
  name: string;
  goal: string;
  expectedToolsJson: string | null;
  forbiddenToolsJson: string | null;
  thresholdsJson: string | null;
}): BenchmarkScenarioDefinition {
  const thresholds = parseJsonObject<BenchmarkScenarioThresholds>(row.thresholdsJson);

  return {
    id: row.id,
    name: row.name,
    goal: row.goal,
    expectedTools: parseStringArray(row.expectedToolsJson),
    forbiddenTools: parseStringArray(row.forbiddenToolsJson),
    expectedVerificationItems: thresholds.expectedVerificationItems ?? [],
    passThreshold: thresholds.passThreshold,
    aggregateWarnThreshold: thresholds.aggregateWarnThreshold,
    dimensions: thresholds.dimensions,
  };
}

function toRegressionBaselineSnapshot(row: {
  id: string;
  benchmarkScenarioId: string;
  evalRunId: string;
  aggregateScore: number;
  dimensionScoresJson: string;
  toolSummaryJson: string | null;
  modelSummaryJson: string | null;
  acceptedAt: Date;
}): RegressionBaselineSnapshot {
  const toolSummary = parseJsonObject<{
    toolSequenceSummary?: string[];
    verificationSummary?: unknown;
    unsafeMcpAttempts?: unknown;
  }>(row.toolSummaryJson);
  const modelSummary = parseJsonObject<{
    retryCount?: number;
    modelCost?: number;
  }>(row.modelSummaryJson);

  return {
    id: row.id,
    scenarioId: row.benchmarkScenarioId,
    runId: row.evalRunId,
    aggregateScore: row.aggregateScore,
    dimensionScores: parseJsonArray<BenchmarkDimensionScoreSnapshot>(row.dimensionScoresJson),
    toolSequenceSummary: toolSummary.toolSequenceSummary,
    verificationSummary: toolSummary.verificationSummary,
    unsafeMcpAttempts: toolSummary.unsafeMcpAttempts,
    retryCount: modelSummary.retryCount,
    modelCost: modelSummary.modelCost,
    acceptedAt: row.acceptedAt,
  };
}

function buildThresholds(input: {
  expectedVerificationItems?: readonly string[];
  passThreshold?: number;
  aggregateWarnThreshold?: number;
  dimensions?: BenchmarkScenarioThresholds["dimensions"];
}): BenchmarkScenarioThresholds | undefined {
  const thresholds: BenchmarkScenarioThresholds = {};

  if (input.expectedVerificationItems !== undefined) {
    thresholds.expectedVerificationItems = [...input.expectedVerificationItems];
  }

  if (input.passThreshold !== undefined) {
    thresholds.passThreshold = input.passThreshold;
  }

  if (input.aggregateWarnThreshold !== undefined) {
    thresholds.aggregateWarnThreshold = input.aggregateWarnThreshold;
  }

  if (input.dimensions !== undefined) {
    thresholds.dimensions = input.dimensions;
  }

  return Object.keys(thresholds).length === 0 ? undefined : thresholds;
}

function stringifyOptional(value: unknown) {
  return value === undefined ? null : JSON.stringify(value);
}

function stringifyForUpdate(value: unknown) {
  return value === undefined ? undefined : JSON.stringify(value);
}

function buildUpdatedThresholdsJson(
  existingJson: string | null,
  input: {
    expectedVerificationItems?: readonly string[];
    passThreshold?: number;
    aggregateWarnThreshold?: number;
    dimensions?: BenchmarkScenarioThresholds["dimensions"];
  },
) {
  const patch = buildThresholds(input);

  if (!patch) {
    return undefined;
  }

  return JSON.stringify({
    ...parseJsonObject<BenchmarkScenarioThresholds>(existingJson),
    ...patch,
  });
}

function parseStringArray(json: string | null) {
  const parsed = parseJsonValue(json);

  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function parseJsonArray<T>(json: string | null) {
  const parsed = parseJsonValue(json);

  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

function parseJsonObject<T extends object>(json: string | null): Partial<T> {
  const parsed = parseJsonValue(json);

  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Partial<T>) : {};
}

function parseJsonValue(json: string | null): unknown {
  if (!json) {
    return null;
  }

  try {
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

function toStoredScore(score: number) {
  return Math.round(score);
}
