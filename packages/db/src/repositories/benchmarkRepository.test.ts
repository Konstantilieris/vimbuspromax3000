import type { PrismaClient } from "../client";
import { createIsolatedPrisma, removeTempDir } from "../testing";
import {
  createBenchmarkScenario,
  createProject,
  createRegressionBaselineFromRunResult,
  createRegressionComparisonSnapshot,
  deleteBenchmarkScenario,
  getActiveRegressionBaselineSnapshot,
  getBenchmarkScenarioDefinition,
  listBenchmarkMcpToolCalls,
  listBenchmarkScenarioDefinitions,
  listRegressionBaselineSnapshots,
  persistBenchmarkEvalRunResult,
  updateBenchmarkScenario,
} from "./index";

describe("benchmark repositories", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-benchmark-repo-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  });

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test("creates, lists, updates, reads, and deletes benchmark scenario definitions", async () => {
    const project = await createProject(prisma, {
      name: "Benchmark Scenario Project",
      rootPath: tempDir,
    });
    const scenario = await createBenchmarkScenario(prisma, {
      projectId: project.id,
      name: "planner happy path",
      goal: "Score deterministic planner behavior.",
      expectedTools: ["planner.createPlan"],
      forbiddenTools: ["shell.rm-rf"],
      expectedVerificationItems: ["unit tests"],
      passThreshold: 80,
      dimensions: {
        outcome_correctness: { passThreshold: 90, hardFail: true, weight: 2 },
      },
    });

    await updateBenchmarkScenario(prisma, scenario.id, {
      expectedTools: ["planner.createPlan", "browser.verify"],
      aggregateWarnThreshold: 70,
    });

    const definition = await getBenchmarkScenarioDefinition(prisma, scenario.id);
    const listed = await listBenchmarkScenarioDefinitions(prisma, {
      projectId: project.id,
      status: "active",
    });

    expect(definition).toMatchObject({
      id: scenario.id,
      expectedTools: ["planner.createPlan", "browser.verify"],
      forbiddenTools: ["shell.rm-rf"],
      expectedVerificationItems: ["unit tests"],
      passThreshold: 80,
      aggregateWarnThreshold: 70,
    });
    expect(listed.map((item) => item.id)).toContain(scenario.id);

    await deleteBenchmarkScenario(prisma, scenario.id);
    await expect(getBenchmarkScenarioDefinition(prisma, scenario.id)).resolves.toBeNull();
  });

  test("persists rule-based benchmark runs to EvalRun/EvalResult and creates baseline snapshots", async () => {
    const project = await createProject(prisma, {
      name: "Benchmark Eval Project",
      rootPath: tempDir,
    });
    const scenario = await createBenchmarkScenario(prisma, {
      projectId: project.id,
      name: "evaluation backing",
      goal: "Persist deterministic scoring output.",
    });
    const result = buildBenchmarkRunResult(scenario.id, "eval-run-1");

    const evalRun = await persistBenchmarkEvalRunResult(prisma, {
      projectId: project.id,
      threshold: 80,
      result,
    });
    await createRegressionBaselineFromRunResult(prisma, {
      projectId: project.id,
      benchmarkScenarioId: scenario.id,
      result,
    });

    const baseline = await getActiveRegressionBaselineSnapshot(prisma, {
      projectId: project.id,
      benchmarkScenarioId: scenario.id,
    });

    expect(evalRun.id).toBe("eval-run-1");
    expect(evalRun.results).toHaveLength(2);
    expect(baseline).toMatchObject({
      scenarioId: scenario.id,
      runId: "eval-run-1",
      aggregateScore: 90,
      retryCount: 0,
      modelCost: 1,
    });
  });

  test("stores regression comparison snapshots and lists benchmark MCP tool calls in chronological order", async () => {
    const project = await createProject(prisma, {
      name: "Benchmark Comparison Project",
      rootPath: tempDir,
    });
    const scenario = await createBenchmarkScenario(prisma, {
      projectId: project.id,
      name: "comparison backing",
      goal: "Persist regression comparison output.",
    });
    const candidate = buildBenchmarkRunResult(scenario.id, "candidate-run");

    await createRegressionComparisonSnapshot(prisma, {
      projectId: project.id,
      benchmarkScenarioId: scenario.id,
      candidate,
      comparison: {
        scenarioId: scenario.id,
        baselineRunId: "baseline-run",
        candidateRunId: candidate.runId,
        status: "passed",
        aggregateDelta: 1,
        blockers: [],
        warnings: [],
      },
    });
    await prisma.mcpToolCall.create({
      data: {
        projectId: project.id,
        serverName: "planner",
        toolName: "planner.createPlan",
        status: "succeeded",
        mutability: "read",
      },
    });
    await prisma.mcpToolCall.create({
      data: {
        projectId: project.id,
        serverName: "shell",
        toolName: "shell.touch",
        status: "succeeded",
        mutability: "write",
      },
    });

    const comparisonSnapshots = await listRegressionBaselineSnapshots(prisma, {
      projectId: project.id,
      benchmarkScenarioId: scenario.id,
      status: "passed",
    });
    const calls = await listBenchmarkMcpToolCalls(prisma, {
      projectId: project.id,
    });

    expect(comparisonSnapshots).toHaveLength(1);
    expect(comparisonSnapshots[0]?.runId).toBe(candidate.runId);
    expect(calls.map((call) => call.toolName)).toEqual(["planner.createPlan", "shell.touch"]);
  });
});

function buildBenchmarkRunResult(scenarioId: string, runId: string) {
  return {
    scenarioId,
    runId,
    aggregateScore: 90,
    verdict: "passed",
    dimensionScores: [
      {
        dimension: "outcome_correctness",
        score: 100,
        passThreshold: 85,
        hardFail: true,
        passed: true,
        weight: 1.5,
      },
      {
        dimension: "security_policy_compliance",
        score: 100,
        passThreshold: 100,
        hardFail: true,
        passed: true,
        weight: 1.5,
      },
    ],
    toolSequenceSummary: ["planner.createPlan"],
    verificationSummary: {
      total: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      blocked: 0,
      missingExpectedItems: [],
      allRequiredPassed: true,
    },
    unsafeMcpAttempts: [],
    retryCount: 0,
    modelCost: 1,
    metadata: {},
  };
}
