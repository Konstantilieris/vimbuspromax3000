import type { PrismaClient } from "../client";
import { createIsolatedPrisma, removeTempDir } from "../testing";
import {
  isBenchmarkScenarioStatus,
  isEvaluationDimension,
  isEvaluationVerdict,
  isLangSmithSyncStatus,
  isMcpServerAuthType,
  isMcpToolMutability,
  isSourceAssetStatus,
  isVisualVerificationResultStatus,
} from "@vimbuspromax3000/shared";
import {
  approveSourceAsset,
  createBenchmarkScenario,
  createEvalResult,
  createEvalRun,
  createLangSmithTraceLink,
  createProject,
  createRegressionBaseline,
  createSourceAsset,
  createVisualVerificationResult,
  getActiveRegressionBaseline,
  getEvalRun,
  listBenchmarkScenarios,
  listLangSmithTraceLinks,
  listLoopEvents,
  listMcpServers,
  listProjectSourceAssets,
  listRegressionBaselines,
  listVisualVerificationResults,
  setMcpServerCredential,
  updateEvalRun,
  updateLangSmithTraceLinkStatus,
  updateMcpServerStatus,
  updateVerificationItemExpectedAsset,
  updateVisualVerificationResult,
  upsertMcpServer,
  upsertMcpTool,
} from "./index";

describe("shared foundation repositories", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-foundation-repo-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  });

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test("persists MCP auth/status plus source assets and visual results", async () => {
    const project = await createProject(prisma, {
      name: "Foundation Visual",
      rootPath: tempDir,
    });
    const secretRef = await prisma.projectSecretRef.create({
      data: {
        projectId: project.id,
        kind: "mcp_server_env",
        label: "browser env",
        storageType: "env",
        reference: "BROWSER_TOKEN",
        status: "active",
      },
    });
    const taskFixture = await seedTaskExecution(prisma, project.id);

    const server = await upsertMcpServer(prisma, {
      projectId: project.id,
      name: "taskgoblin-browser",
      transport: "stdio",
      trustLevel: "restricted",
      status: "pending",
      authType: "env_passthrough",
      credentialRefId: secretRef.id,
      configJson: JSON.stringify({ command: "bun", env: ["BROWSER_TOKEN"] }),
    });
    const tool = await upsertMcpTool(prisma, {
      serverId: server.id,
      name: "browser_screenshot",
      description: "Capture a screenshot.",
      mutability: "read",
      approvalRequired: false,
      inputSchemaJson: JSON.stringify({ type: "object" }),
      status: "active",
    });
    await updateMcpServerStatus(prisma, server.id, {
      status: "active",
      lastError: null,
      lastVerifiedAt: new Date(),
    });
    await setMcpServerCredential(prisma, server.id, {
      authType: "env_passthrough",
      credentialRefId: secretRef.id,
    });

    const sourceAsset = await createSourceAsset(prisma, {
      projectId: project.id,
      taskId: taskFixture.taskId,
      verificationItemId: taskFixture.verificationItemId,
      kind: "screenshot",
      relativePath: "visual/login-approved.png",
      mimeType: "image/png",
      sha256: "abc123",
      width: 1280,
      height: 720,
      comparisonMode: "pixel-diff",
      metadataJson: JSON.stringify({ route: "/login" }),
      status: "proposed",
    });
    const approvedAsset = await approveSourceAsset(prisma, sourceAsset.id);
    await updateVerificationItemExpectedAsset(prisma, {
      verificationItemId: taskFixture.verificationItemId,
      expectedAssetId: sourceAsset.id,
    });

    const visualResult = await createVisualVerificationResult(prisma, {
      taskExecutionId: taskFixture.executionId,
      verificationItemId: taskFixture.verificationItemId,
      sourceAssetId: sourceAsset.id,
      mode: "pixel-diff",
      status: "running",
      artifactDirectory: ".artifacts/visual/login",
      actualPath: ".artifacts/visual/login/actual.png",
      startedAt: new Date(),
    });
    await updateVisualVerificationResult(prisma, visualResult.id, {
      status: "passed",
      diffRatio: 0.001,
      threshold: 0.01,
      finishedAt: new Date(),
    });

    const servers = await listMcpServers(prisma, project.id);
    const assets = await listProjectSourceAssets(prisma, {
      projectId: project.id,
      verificationItemId: taskFixture.verificationItemId,
      status: "approved",
    });
    const visualResults = await listVisualVerificationResults(prisma, {
      taskExecutionId: taskFixture.executionId,
      status: "passed",
    });
    const verificationItem = await prisma.verificationItem.findUnique({
      where: { id: taskFixture.verificationItemId },
    });

    expect(isMcpServerAuthType("env_passthrough")).toBe(true);
    expect(isMcpToolMutability(tool.mutability)).toBe(true);
    expect(servers[0]).toMatchObject({
      id: server.id,
      status: "active",
      authType: "env_passthrough",
      credentialRefId: secretRef.id,
    });
    expect(servers[0]?.tools.map((entry) => entry.name)).toContain("browser_screenshot");
    expect(approvedAsset.status).toBe("approved");
    expect(isSourceAssetStatus(approvedAsset.status)).toBe(true);
    expect(assets).toHaveLength(1);
    expect(verificationItem?.expectedAssetId).toBe(sourceAsset.id);
    expect(visualResults[0]).toMatchObject({
      id: visualResult.id,
      status: "passed",
      sourceAssetId: sourceAsset.id,
    });
    expect(isVisualVerificationResultStatus(visualResults[0]?.status ?? "")).toBe(true);
  });

  test("persists benchmark, regression, eval, and LangSmith links", async () => {
    const project = await createProject(prisma, {
      name: "Foundation Evaluation",
      rootPath: tempDir,
    });
    const taskFixture = await seedTaskExecution(prisma, project.id);

    const scenario = await createBenchmarkScenario(prisma, {
      projectId: project.id,
      name: "unsafe-mcp-blocking",
      goal: "Block unsafe MCP attempts.",
      status: "active",
      fixturePath: "benchmarks/unsafe-mcp.json",
      expectedToolsJson: JSON.stringify(["browser_screenshot"]),
      forbiddenToolsJson: JSON.stringify(["shell.run_command"]),
      thresholdsJson: JSON.stringify({ security_policy_compliance: 100 }),
    });
    const evalRun = await createEvalRun(prisma, {
      projectId: project.id,
      taskExecutionId: taskFixture.executionId,
      benchmarkScenarioId: scenario.id,
      status: "running",
      startedAt: new Date(),
      threshold: 80,
    });
    await createEvalResult(prisma, {
      evalRunId: evalRun.id,
      dimension: "security_policy_compliance",
      score: 100,
      threshold: 100,
      verdict: "passed",
      evaluatorType: "rule",
      reasoning: "No unsafe MCP calls were attempted.",
      evidenceJson: JSON.stringify({ blockedCalls: 0 }),
    });
    await updateEvalRun(prisma, evalRun.id, {
      status: "passed",
      aggregateScore: 100,
      verdict: "passed",
      finishedAt: new Date(),
    });
    const baseline = await createRegressionBaseline(prisma, {
      projectId: project.id,
      benchmarkScenarioId: scenario.id,
      evalRunId: evalRun.id,
      aggregateScore: 100,
      dimensionScoresJson: JSON.stringify({ security_policy_compliance: 100 }),
      toolSummaryJson: JSON.stringify({ unsafeAttempts: 0 }),
      modelSummaryJson: JSON.stringify({ selectedSlot: "executor_default" }),
    });
    const langSmithLink = await createLangSmithTraceLink(prisma, {
      projectId: project.id,
      subjectType: "eval_run",
      subjectId: evalRun.id,
      traceUrl: "https://smith.langchain.com/o/test/projects/p/r/trace",
      runId: "run-foundation-1",
      syncStatus: "synced",
    });
    await updateLangSmithTraceLinkStatus(prisma, langSmithLink.id, "disabled");

    const scenarios = await listBenchmarkScenarios(prisma, {
      projectId: project.id,
      status: "active",
    });
    const storedEvalRun = await getEvalRun(prisma, evalRun.id);
    const baselines = await listRegressionBaselines(prisma, {
      projectId: project.id,
      benchmarkScenarioId: scenario.id,
    });
    const activeBaseline = await getActiveRegressionBaseline(prisma, {
      projectId: project.id,
      benchmarkScenarioId: scenario.id,
    });
    const langSmithLinks = await listLangSmithTraceLinks(prisma, {
      projectId: project.id,
      subjectType: "eval_run",
      subjectId: evalRun.id,
    });
    const events = await listLoopEvents(prisma, { projectId: project.id });

    expect(isBenchmarkScenarioStatus(scenarios[0]?.status ?? "")).toBe(true);
    expect(isEvaluationDimension(storedEvalRun?.results[0]?.dimension ?? "")).toBe(true);
    expect(isEvaluationVerdict(storedEvalRun?.verdict ?? "")).toBe(true);
    expect(storedEvalRun?.results).toHaveLength(1);
    expect(baselines.map((entry) => entry.id)).toContain(baseline.id);
    expect(activeBaseline?.id).toBe(baseline.id);
    expect(langSmithLinks[0]).toMatchObject({
      id: langSmithLink.id,
      syncStatus: "disabled",
      runId: "run-foundation-1",
    });
    expect(isLangSmithSyncStatus(langSmithLinks[0]?.syncStatus ?? "")).toBe(true);
    expect(events.map((event) => event.type)).toContain("langsmith.trace.linked");
  });
});

async function seedTaskExecution(prisma: PrismaClient, projectId: string) {
  const epic = await prisma.epic.create({
    data: {
      projectId,
      key: `EPIC-${Math.random().toString(36).slice(2)}`,
      title: "Foundation epic",
      goal: "Exercise shared foundation records.",
      status: "planned",
      orderIndex: 0,
    },
  });
  const task = await prisma.task.create({
    data: {
      epicId: epic.id,
      stableId: `TASK-${Math.random().toString(36).slice(2)}`,
      title: "Foundation task",
      type: "frontend",
      complexity: "medium",
      status: "ready",
      orderIndex: 0,
      acceptanceJson: JSON.stringify([{ label: "foundation persisted" }]),
    },
  });
  const verificationPlan = await prisma.verificationPlan.create({
    data: {
      taskId: task.id,
      status: "approved",
      approvedAt: new Date(),
    },
  });
  const verificationItem = await prisma.verificationItem.create({
    data: {
      planId: verificationPlan.id,
      taskId: task.id,
      kind: "visual",
      runner: "playwright",
      title: "login visual",
      description: "Compare login page against the source asset.",
      status: "approved",
      orderIndex: 0,
      configJson: JSON.stringify({ mode: "pixel-diff" }),
    },
  });
  const branch = await prisma.taskBranch.create({
    data: {
      taskId: task.id,
      name: `tg/foundation/${task.stableId.toLowerCase()}`,
      base: "main",
      state: "active",
    },
  });
  const execution = await prisma.taskExecution.create({
    data: {
      taskId: task.id,
      branchId: branch.id,
      status: "verifying",
      startedAt: new Date(),
    },
  });

  return {
    taskId: task.id,
    verificationItemId: verificationItem.id,
    executionId: execution.id,
  };
}
