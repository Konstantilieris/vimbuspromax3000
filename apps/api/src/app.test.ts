import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import app, { createApp, healthResponse } from "./app";
import {
  createIsolatedPrisma,
  initializeGitRepository,
  removeTempDir,
  runCommand,
  writeProjectFile,
} from "@vimbuspromax3000/db/testing";
import type { PrismaClient } from "@vimbuspromax3000/db/client";
import { createPlannerService } from "@vimbuspromax3000/planner";

describe("GET /health", () => {
  test("returns the stable health payload", async () => {
    const response = await app.fetch(new Request("http://localhost/health"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(healthResponse);
  });
});

describe("model registry API", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-api-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  });

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test("creates provider, model, assignment, and resolves the slot", async () => {
    const api = createApp({
      prisma,
      env: {
        VIMBUS_TEST_KEY: "present",
      },
    });
    const project = await prisma.project.create({
      data: {
        name: "Test Project",
        rootPath: tempDir,
        baseBranch: "main",
      },
    });

    const secretRef = await postJson(api, "/model-secret-refs", {
      projectId: project.id,
      label: "test api key",
      reference: "VIMBUS_TEST_KEY",
    });
    expect(secretRef.status).toBe(201);
    const secret = await secretRef.json();

    const providerRef = await postJson(api, "/model-providers", {
      projectId: project.id,
      key: "openai",
      label: "OpenAI",
      providerKind: "openai",
      authType: "api_key",
      secretRefId: secret.id,
      status: "active",
    });
    expect(providerRef.status).toBe(201);
    const provider = await providerRef.json();

    const modelRef = await postJson(api, "/models", {
      providerId: provider.id,
      name: "GPT Test",
      slug: "gpt-test",
      supportsTools: true,
      supportsJson: true,
      costTier: "medium",
      speedTier: "balanced",
      reasoningTier: "standard",
    });
    expect(modelRef.status).toBe(201);
    const model = await modelRef.json();

    const assignRef = await postJson(api, "/model-slots/executor_default/assign", {
      projectId: project.id,
      registeredModelId: model.id,
    });
    expect(assignRef.status).toBe(200);

    const previewRef = await postJson(api, "/model-policy/preview", {
      projectId: project.id,
      slotKey: "executor_default",
      requiredCapabilities: ["tools", "json"],
    });
    expect(previewRef.status).toBe(200);
    const preview = await previewRef.json();

    expect(preview.ok).toBe(true);
    expect(preview.value.concreteModelName).toBe("openai:gpt-test");

    const events = await prisma.loopEvent.findMany({
      where: { projectId: project.id },
      orderBy: [{ createdAt: "asc" }],
    });
    expect(events.map((event) => event.type)).toEqual([
      "model.resolution.requested",
      "model.resolution.succeeded",
    ]);
  });

  test("bootstraps a runnable model setup idempotently", async () => {
    const api = createApp({
      prisma,
      env: {
        VIMBUS_TEST_KEY: "present",
      },
    });
    const body = {
      projectName: "Setup Project",
      rootPath: tempDir,
      providerKey: "openai",
      providerKind: "openai",
      providerStatus: "active",
      secretEnv: "VIMBUS_TEST_KEY",
      modelName: "GPT Test",
      modelSlug: "gpt-test",
      capabilities: ["tools", "json"],
      slotKeys: ["executor_default"],
    };

    const firstSetup = await postJson(api, "/model-setup", body);
    const secondSetup = await postJson(api, "/model-setup", body);
    expect(firstSetup.status).toBe(201);
    expect(secondSetup.status).toBe(201);

    const setup = await secondSetup.json();
    expect(setup.project.name).toBe("Setup Project");
    expect(setup.provider.status).toBe("active");
    expect(setup.slots).toHaveLength(1);

    const testRef = await postJson(api, "/model-slots/executor_default/test", {
      projectId: setup.project.id,
      requiredCapabilities: ["json"],
    });
    const result = await testRef.json();

    expect(result.ok).toBe(true);
    expect(result.value.concreteModelName).toBe("openai:gpt-test");
  });
});

describe("planner/task/approval API", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-api-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  });

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test("creates a project and planner run, stores interview answers, and persists proposals", async () => {
    const api = createApp({ prisma });
    const projectRef = await postJson(api, "/projects", {
      name: "Planner Project",
      rootPath: tempDir,
    });
    const project = await projectRef.json();

    const plannerRunRef = await postJson(api, "/planner/runs", {
      projectId: project.id,
      goal: "Implement backend foundation",
      moduleName: "api",
    });
    expect(plannerRunRef.status).toBe(201);
    const plannerRun = await plannerRunRef.json();

    // VIM-34 — interview is now a strict-ordered 5-round conversation. The
    // batch payload is still accepted as long as the keys arrive in canonical
    // order from the next-expected round.
    const answerRef = await postJson(api, `/planner/runs/${plannerRun.id}/answers`, {
      answers: {
        scope: { in: ["api", "db"], out: ["cli"] },
        domain: { models: ["task", "epic"] },
        interfaces: { http: true },
        verification: { required: ["logic"] },
        policy: { license: "MIT" },
      },
    });
    expect(answerRef.status).toBe(200);
    const answeredPlannerRun = await answerRef.json();
    expect(answeredPlannerRun.interview.scope.in).toEqual(["api", "db"]);
    expect(answeredPlannerRun.expectedNextRound).toBeNull();

    const generateRef = await postJson(api, `/planner/runs/${plannerRun.id}/generate`, {
      summary: "Persist proposal payload",
      epics: [buildPlannerEpicPayload()],
    });
    expect(generateRef.status).toBe(200);
    const generatedPlannerRun = await generateRef.json();

    expect(generatedPlannerRun.status).toBe("generated");
    expect(generatedPlannerRun.proposalSummary.taskCount).toBe(1);
    expect(generatedPlannerRun.epics[0].tasks[0].status).toBe("planned");

    const eventsRef = await api.fetch(new Request(`http://localhost/events?projectId=${project.id}`));
    const events = await eventsRef.json();
    expect(events.map((event: { type: string }) => event.type)).toContain("planner.answer");
    expect(events.map((event: { type: string }) => event.type)).toContain("planner.proposed");
  });

  test("generates planner proposals through the planner service path", async () => {
    const env = {
      VIMBUS_TEST_KEY: "present",
    };
    const plannerService = createPlannerService({
      prisma,
      env,
      generator: async () => ({
        object: {
          summary: "AI-backed planner proposal",
          epics: [
            {
              key: "planner-slice",
              title: "Planner Vertical Slice",
              goal: "Generate structured planner output",
              acceptance: ["planner run persists generated output"],
              risks: ["slot assignment drift"],
              tasks: [
                {
                  stableId: "persist-planner-proposal",
                  title: "Persist planner proposal",
                  description: "Write generated planner records through the repository layer",
                  type: "backend",
                  complexity: "medium",
                  acceptance: ["proposal persisted"],
                  targetFiles: ["packages/planner/src/index.ts", "apps/api/src/app.ts"],
                  requires: ["planner_deep"],
                  verificationPlan: {
                    rationale: "Need one runnable verification check",
                    items: [
                      {
                        kind: "logic",
                        runner: "vitest",
                        title: "planner proposal persists",
                        description: "stores epics, tasks, and verification plans",
                        command: "bun run test:vitest",
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      }),
    });
    const api = createApp({
      prisma,
      env,
      plannerService,
    });

    const projectRef = await postJson(api, "/projects", {
      name: "Planner Service Project",
      rootPath: tempDir,
    });
    const project = await projectRef.json();

    const setupRef = await postJson(api, "/model-setup", {
      projectId: project.id,
      providerKey: "openai",
      providerKind: "openai",
      providerStatus: "active",
      secretEnv: "VIMBUS_TEST_KEY",
      modelName: "GPT Planner",
      modelSlug: "gpt-planner",
      capabilities: ["json"],
      slotKeys: ["planner_deep"],
    });
    expect(setupRef.status).toBe(201);
    // VIM-33 follow-up: each planner agent now resolves its own slot. The
    // verification designer agent maps to the verification_designer slot, so
    // we need to seed it for the planner pipeline to resolve cleanly.
    const verificationSetupRef = await postJson(api, "/model-setup", {
      projectId: project.id,
      providerKey: "openai",
      providerKind: "openai",
      providerStatus: "active",
      secretEnv: "VIMBUS_TEST_KEY",
      modelName: "GPT Verification",
      modelSlug: "gpt-verification",
      capabilities: ["json"],
      slotKeys: ["verification_designer"],
    });
    expect(verificationSetupRef.status).toBe(201);

    const plannerRunRef = await postJson(api, "/planner/runs", {
      projectId: project.id,
      goal: "Implement planner vertical slice",
      moduleName: "planner",
    });
    const plannerRun = await plannerRunRef.json();

    await postJson(api, `/planner/runs/${plannerRun.id}/answers`, {
      answers: {
        scope: { in: ["packages/planner", "apps/api", "apps/cli"] },
        domain: { models: ["plannerRun", "task"] },
        interfaces: { http: true },
        verification: { required: ["logic", "integration"] },
        policy: { license: "MIT" },
      },
    });

    const generateRef = await postJson(api, `/planner/runs/${plannerRun.id}/generate`, {});
    expect(generateRef.status).toBe(200);
    const generatedPlannerRun = await generateRef.json();

    expect(generatedPlannerRun.status).toBe("generated");
    expect(generatedPlannerRun.summary).toBe("AI-backed planner proposal");
    expect(generatedPlannerRun.proposalSummary.taskCount).toBe(1);
    expect(generatedPlannerRun.epics[0].key).toContain("PLAN-");
    expect(generatedPlannerRun.epics[0].tasks[0].stableId).toContain("PLAN-");
    expect(generatedPlannerRun.epics[0].tasks[0].status).toBe("planned");

    const tasksRef = await api.fetch(new Request(`http://localhost/tasks?projectId=${project.id}`));
    const tasks = await tasksRef.json();
    expect(tasks[0].status).toBe("planned");

    const events = await prisma.loopEvent.findMany({
      where: { projectId: project.id },
      orderBy: [{ createdAt: "asc" }],
    });
    expect(events.map((event) => event.type)).toContain("model.resolution.requested");
    expect(events.map((event) => event.type)).toContain("model.resolution.succeeded");
    expect(events.map((event) => event.type)).toContain("planner.proposed");
  });

  test("planner approval and verification approval advance task state in order", async () => {
    const api = createApp({ prisma });
    const { project, plannerRun } = await seedGeneratedPlannerRun(api, tempDir);

    const beforeApprovalTasksRef = await api.fetch(new Request(`http://localhost/tasks?projectId=${project.id}`));
    const beforeApprovalTasks = await beforeApprovalTasksRef.json();
    expect(beforeApprovalTasks[0].status).toBe("planned");

    const plannerApprovalRef = await postJson(api, "/approvals", {
      projectId: project.id,
      subjectType: "planner_run",
      subjectId: plannerRun.id,
      stage: "planner_review",
      status: "granted",
    });
    expect(plannerApprovalRef.status).toBe(201);

    const tasksAfterPlannerApprovalRef = await api.fetch(new Request(`http://localhost/tasks?projectId=${project.id}`));
    const tasksAfterPlannerApproval = await tasksAfterPlannerApprovalRef.json();
    expect(tasksAfterPlannerApproval[0].status).toBe("awaiting_verification_approval");

    const taskDetailRef = await api.fetch(new Request(`http://localhost/tasks/${tasksAfterPlannerApproval[0].id}`));
    const taskDetail = await taskDetailRef.json();
    expect(taskDetail.latestVerificationPlan.status).toBe("proposed");

    const verificationApprovalRef = await postJson(
      api,
      `/tasks/${tasksAfterPlannerApproval[0].id}/verification/approve`,
      {
        operator: "ak",
      },
    );
    expect(verificationApprovalRef.status).toBe(200);
    const approvedTask = await verificationApprovalRef.json();

    expect(approvedTask.status).toBe("ready");
    expect(approvedTask.latestVerificationPlan.status).toBe("approved");

    const approvalsRef = await api.fetch(
      new Request(
        `http://localhost/approvals?subjectType=planner_run&subjectId=${plannerRun.id}&projectId=${project.id}`,
      ),
    );
    const approvals = await approvalsRef.json();
    expect(approvals).toHaveLength(1);
  });

  test("rejected planner runs do not advance generated tasks", async () => {
    const api = createApp({ prisma });
    const { project, plannerRun } = await seedGeneratedPlannerRun(api, tempDir);

    const rejectionRef = await postJson(api, "/approvals", {
      projectId: project.id,
      subjectType: "planner_run",
      subjectId: plannerRun.id,
      stage: "planner_review",
      status: "rejected",
      reason: "Needs revision",
    });
    expect(rejectionRef.status).toBe(201);

    const plannerRunDetailRef = await api.fetch(new Request(`http://localhost/planner/runs/${plannerRun.id}`));
    const plannerRunDetail = await plannerRunDetailRef.json();
    expect(plannerRunDetail.status).toBe("rejected");

    const tasksRef = await api.fetch(new Request(`http://localhost/tasks?projectId=${project.id}`));
    const tasks = await tasksRef.json();
    expect(tasks[0].status).toBe("planned");
  });
});

describe("MVP integration APIs", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-mvp-api-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  });

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test("sets up MCP servers idempotently and stores env-backed credentials", async () => {
    const api = createApp({ prisma });
    const project = await prisma.project.create({
      data: {
        name: "MCP Project",
        rootPath: tempDir,
        baseBranch: "main",
      },
    });

    const firstSetupRef = await postJson(api, `/mcp/setup?projectId=${project.id}`, { activate: true });
    const secondSetupRef = await postJson(api, `/mcp/setup?projectId=${project.id}`, { activate: true });
    expect(firstSetupRef.status).toBe(201);
    expect(secondSetupRef.status).toBe(201);
    const firstSetup = await firstSetupRef.json();
    const secondSetup = await secondSetupRef.json();

    expect(firstSetup.created.length).toBeGreaterThan(0);
    expect(secondSetup.unchanged.length).toBe(firstSetup.created.length);

    const credentialRef = await postJson(api, `/mcp/servers/${firstSetup.created[0].id}/credential`, {
      credentialEnv: "DATABASE_URL",
      credentialLabel: "db env",
    });
    expect(credentialRef.status).toBe(200);
    const serverWithCredential = await credentialRef.json();
    expect(serverWithCredential.credentialRef.reference).toBe("DATABASE_URL");
  });

  test("ingests source assets and approval decisions approve them", async () => {
    const api = createApp({ prisma });
    const project = await prisma.project.create({
      data: {
        name: "Visual Project",
        rootPath: tempDir,
        baseBranch: "main",
      },
    });
    writeProjectFile(tempDir, "docs/assets/reference.txt", "visual source\n");

    const assetRef = await postJson(api, `/projects/${project.id}/source-assets`, {
      relativePath: "docs/assets/reference.txt",
    });
    expect(assetRef.status).toBe(201);
    const asset = await assetRef.json();
    expect(asset.status).toBe("proposed");
    expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);

    const approvalRef = await postJson(api, "/approvals", {
      projectId: project.id,
      subjectType: "source_of_truth_asset",
      subjectId: asset.id,
      stage: "visual_source_review",
      status: "granted",
    });
    expect(approvalRef.status).toBe(201);

    const storedAsset = await prisma.sourceOfTruthAsset.findUnique({ where: { id: asset.id } });
    expect(storedAsset?.status).toBe("approved");
    expect(storedAsset?.approvedAt).toBeTruthy();
  });

  test("runs benchmarks, creates baselines, compares regressions, and stores LangSmith links", async () => {
    const api = createApp({ prisma });
    const project = await prisma.project.create({
      data: {
        name: "Benchmark Project",
        rootPath: tempDir,
        baseBranch: "main",
      },
    });

    const scenarioRef = await postJson(api, "/benchmarks/scenarios", {
      projectId: project.id,
      name: "happy path",
      goal: "Pass deterministic route scoring.",
      expectedTools: ["planner.plan"],
      expectedVerificationItems: ["unit"],
      passThreshold: 70,
    });
    expect(scenarioRef.status).toBe(201);
    const scenario = await scenarioRef.json();

    const runRef = await postJson(api, `/benchmarks/scenarios/${scenario.id}/run`, {
      runId: "run-1",
      toolCalls: [{ server: "planner", name: "planner.plan", status: "succeeded" }],
      verificationItems: [{ name: "unit", status: "passed" }],
    });
    expect(runRef.status).toBe(201);
    const runPayload = await runRef.json();
    expect(runPayload.run.verdict).toBe("passed");

    const baselineRef = await postJson(api, "/regressions/baselines", {
      projectId: project.id,
      benchmarkScenarioId: scenario.id,
      evalRunId: runPayload.evalRun.id,
    });
    expect(baselineRef.status).toBe(201);

    const compareRef = await postJson(api, "/regressions/compare", {
      projectId: project.id,
      benchmarkScenarioId: scenario.id,
      evalRunId: runPayload.evalRun.id,
    });
    expect(compareRef.status).toBe(200);
    expect(await compareRef.json()).toMatchObject({ status: "passed" });

    const linkRef = await postJson(api, "/langsmith/links", {
      projectId: project.id,
      subjectType: "eval_run",
      subjectId: runPayload.evalRun.id,
      runId: "langsmith-run-1",
    });
    expect(linkRef.status).toBe(201);
    const linksRef = await api.fetch(new Request(`http://localhost/langsmith/links?projectId=${project.id}`));
    expect(await linksRef.json()).toHaveLength(1);
  });

  test("hydrates benchmark runs from execution MCP calls and test runs", async () => {
    const api = createApp({ prisma });
    const { project, execution } = await seedBenchmarkExecutionTelemetry(prisma, tempDir);

    const scenarioRef = await postJson(api, "/benchmarks/scenarios", {
      projectId: project.id,
      name: "hydrated execution",
      goal: "Score persisted execution telemetry.",
      expectedTools: ["first.tool", "second.tool"],
      expectedVerificationItems: ["unit", "typecheck"],
      passThreshold: 70,
    });
    expect(scenarioRef.status).toBe(201);
    const scenario = await scenarioRef.json();

    const runRef = await postJson(api, `/benchmarks/scenarios/${scenario.id}/run`, {
      runId: "hydrated-run",
      taskExecutionId: execution.id,
    });
    expect(runRef.status).toBe(201);
    const payload = await runRef.json();

    expect(payload.run.toolSequenceSummary).toEqual(["server.first.tool", "server.second.tool"]);
    expect(payload.run.verificationSummary).toMatchObject({
      total: 2,
      passed: 1,
      failed: 1,
      allRequiredPassed: false,
    });
    expect(payload.run.verdict).toBe("blocked");
    expect(
      payload.run.dimensionScores.find((score: { dimension: string }) => score.dimension === "outcome_correctness"),
    ).toMatchObject({ score: 0, passed: false });
    expect(payload.evalRun.taskExecutionId).toBe(execution.id);
  });

  test("uses explicit benchmark tool calls before hydrated execution calls", async () => {
    const api = createApp({ prisma });
    const { project, execution } = await seedBenchmarkExecutionTelemetry(prisma, tempDir);

    const scenarioRef = await postJson(api, "/benchmarks/scenarios", {
      projectId: project.id,
      name: "explicit tools",
      goal: "Prefer request body tool calls.",
      expectedTools: ["explicit.tool"],
      expectedVerificationItems: ["unit"],
      passThreshold: 70,
    });
    const scenario = await scenarioRef.json();

    const runRef = await postJson(api, `/benchmarks/scenarios/${scenario.id}/run`, {
      runId: "explicit-run",
      taskExecutionId: execution.id,
      toolCalls: [{ server: "request", name: "explicit.tool", status: "succeeded" }],
      verificationItems: [{ name: "unit", status: "passed" }],
    });
    expect(runRef.status).toBe(201);
    const payload = await runRef.json();

    expect(payload.run.toolSequenceSummary).toEqual(["request.explicit.tool"]);
    expect(payload.run.dimensionScores.find((score: { dimension: string }) => score.dimension === "tool_usage_quality"))
      .toMatchObject({ score: 100, passed: true });
  });
});

describe("execution API", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-execution-api-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
    initializeGitRepository(tempDir, {
      baseBranch: "main",
      initialFiles: {
        "README.md": "# execution api\n",
      },
    });
  });

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test("runs the local operator smoke from approved task to patch approval with persisted artifacts", async () => {
    const api = createApp({
      prisma,
      env: {
        VIMBUS_TEST_KEY: "present",
      },
    });

    const projectRef = await postJson(api, "/projects", {
      name: "HC-92 Smoke Project",
      rootPath: tempDir,
      baseBranch: "main",
    });
    expect(projectRef.status).toBe(201);
    const project = await projectRef.json();

    const mcpSetupRef = await postJson(api, `/mcp/setup?projectId=${project.id}`, {
      activate: true,
    });
    expect(mcpSetupRef.status).toBe(201);

    const modelSetupRef = await postJson(api, "/model-setup", {
      projectId: project.id,
      providerKey: "openai",
      providerKind: "openai",
      providerStatus: "active",
      secretEnv: "VIMBUS_TEST_KEY",
      modelName: "GPT Smoke",
      modelSlug: "gpt-smoke",
      capabilities: ["json"],
      slotKeys: ["executor_default"],
    });
    expect(modelSetupRef.status).toBe(201);

    const plannerRunRef = await postJson(api, "/planner/runs", {
      projectId: project.id,
      goal: "Prove the local execution loop from task approval to patch review",
      moduleName: "smoke",
    });
    expect(plannerRunRef.status).toBe(201);
    const plannerRun = await plannerRunRef.json();

    const answerRef = await postJson(api, `/planner/runs/${plannerRun.id}/answers`, {
      answers: {
        scope: { in: ["apps/api", "packages/agent", "packages/test-runner"] },
        domain: { models: ["task"] },
        interfaces: { http: true },
        verification: { required: ["command-backed smoke"] },
        policy: { license: "MIT" },
      },
    });
    expect(answerRef.status).toBe(200);

    const generateRef = await postJson(
      api,
      `/planner/runs/${plannerRun.id}/generate`,
      buildExecutionLoopSmokeProposal(),
    );
    expect(generateRef.status).toBe(200);
    const generatedPlannerRun = await generateRef.json();
    expect(generatedPlannerRun.status).toBe("generated");
    expect(generatedPlannerRun.proposalSummary).toMatchObject({
      epicCount: 1,
      taskCount: 1,
      verificationPlanCount: 1,
    });

    const plannerApprovalRef = await postJson(api, "/approvals", {
      projectId: project.id,
      subjectType: "planner_run",
      subjectId: plannerRun.id,
      stage: "planner_review",
      status: "granted",
      operator: "hc-92-smoke",
    });
    expect(plannerApprovalRef.status).toBe(201);

    const tasksRef = await api.fetch(new Request(`http://localhost/tasks?projectId=${project.id}`));
    expect(tasksRef.status).toBe(200);
    const tasks = await tasksRef.json();
    expect(tasks).toHaveLength(1);
    const task = tasks[0];
    expect(task.status).toBe("awaiting_verification_approval");

    const verificationReviewRef = await api.fetch(new Request(`http://localhost/tasks/${task.id}/verification`));
    expect(verificationReviewRef.status).toBe(200);
    const verificationReview = await verificationReviewRef.json();
    expect(verificationReview.summary).toMatchObject({
      totalCount: 1,
      runnableCount: 1,
      deferredCount: 0,
      allRunnableNow: true,
    });
    expect(verificationReview.plan.items[0]).toMatchObject({
      title: "README smoke output is present",
      runnableNow: true,
      deferredReason: null,
    });

    const verificationApprovalRef = await postJson(api, `/tasks/${task.id}/verification/approve`, {
      operator: "hc-92-smoke",
      reason: "Local smoke command is deterministic.",
    });
    expect(verificationApprovalRef.status).toBe(200);
    const approvedTask = await verificationApprovalRef.json();
    expect(approvedTask.status).toBe("ready");
    expect(approvedTask.latestVerificationPlan.status).toBe("approved");
    expect(approvedTask.latestVerificationPlan.items[0].status).toBe("approved");

    const branchRef = await postJson(api, `/tasks/${task.id}/branch`, {});
    expect(branchRef.status).toBe(200);
    const branch = await branchRef.json();
    expect(branch.state).toBe("created");
    expect(branch.name).toContain("HC-92-SMOKE-1");
    expect(runCommand("git", ["branch", "--show-current"], tempDir).stdout.trim()).toBe(branch.name);

    const executeRef = await postJson(api, `/tasks/${task.id}/execute`, {});
    expect(executeRef.status).toBe(201);
    const execution = await executeRef.json();
    expect(execution.status).toBe("implementing");
    expect(execution.task.status).toBe("executing");
    expect(execution.branch.id).toBe(branch.id);
    expect(execution.branch.state).toBe("active");
    expect(execution.latestAgentStep).toMatchObject({
      role: "executor",
      modelName: "openai:gpt-smoke",
      status: "started",
    });
    expect(execution.policy.modelResolution.concreteModelName).toBe("openai:gpt-smoke");

    writeProjectFile(tempDir, "README.md", "# execution api\nsmoke patch\n");

    const runTestsRef = await postJson(api, `/executions/${execution.id}/test-runs`, {});
    expect(runTestsRef.status).toBe(200);
    const testRuns = await runTestsRef.json();
    expect(testRuns).toHaveLength(1);
    const testRun = testRuns[0];
    expect(testRun).toMatchObject({
      status: "passed",
      exitCode: 0,
      command: buildReadmeSmokeCommand(),
    });
    expect(testRun.verificationItem).toMatchObject({
      kind: "logic",
      title: "README smoke output is present",
      status: "green",
    });
    expect(testRun.stdoutPath).toContain(`.artifacts/executions/${execution.id}/test-runs/0-`);
    expect(testRun.stdoutPath && existsSync(testRun.stdoutPath)).toBe(true);
    expect(testRun.stderrPath && existsSync(testRun.stderrPath)).toBe(true);
    expect(readFileSync(testRun.stdoutPath, "utf8")).toContain("smoke verified");

    const metaPath = join(dirname(testRun.stdoutPath), "meta.json");
    expect(existsSync(metaPath)).toBe(true);
    expect(JSON.parse(readFileSync(metaPath, "utf8"))).toMatchObject({
      executionId: execution.id,
      verificationItemId: testRun.verificationItem.id,
      orderIndex: 0,
      kind: "logic",
      title: "README smoke output is present",
      command: buildReadmeSmokeCommand(),
      exitCode: 0,
      status: "passed",
    });

    const listedTestRunsRef = await api.fetch(new Request(`http://localhost/executions/${execution.id}/test-runs`));
    expect(listedTestRunsRef.status).toBe(200);
    expect(await listedTestRunsRef.json()).toHaveLength(1);

    const patchRef = await api.fetch(new Request(`http://localhost/executions/${execution.id}/patch`));
    expect(patchRef.status).toBe(200);
    const patch = await patchRef.json();
    expect(patch.patchReview.status).toBe("ready");
    expect(patch.patchReview.diffPath).toContain(`.taskgoblin/artifacts/executions/${execution.id}/patch/current.diff`);
    expect(patch.patchReview.diffPath && existsSync(patch.patchReview.diffPath)).toBe(true);
    expect(readFileSync(patch.patchReview.diffPath, "utf8")).toContain("smoke patch");
    expect(patch.execution.status).toBe("patch_ready");
    expect(patch.execution.task.status).toBe("awaiting_patch_approval");
    expect(patch.execution.branch.state).toBe("verified");

    const modelDecisions = await prisma.modelDecision.findMany({
      where: {
        taskExecutionId: execution.id,
      },
    });
    expect(modelDecisions).toHaveLength(1);
    expect(modelDecisions[0]?.selectedModel).toBe("openai:gpt-smoke");

    const eventsRef = await api.fetch(new Request(`http://localhost/events?projectId=${project.id}`));
    expect(eventsRef.status).toBe(200);
    const events = await eventsRef.json();
    expect(events.map((event: { type: string }) => event.type)).toEqual(
      expect.arrayContaining([
        "planner.started",
        "planner.answer",
        "planner.proposed",
        "approval.granted",
        "branch.created",
        "branch.switched",
        "task.selected",
        "model.selected",
        "agent.step.started",
        "test.started",
        "test.stdout",
        "test.finished",
        "patch.ready",
      ]),
    );

    const approvePatchRef = await postJson(api, `/executions/${execution.id}/patch/approve`, {});
    expect(approvePatchRef.status).toBe(200);
    const approvedPatch = await approvePatchRef.json();
    expect(approvedPatch.patchReview.status).toBe("approved");
    expect(approvedPatch.patchReview.approvedAt).toBeTruthy();
    expect(approvedPatch.execution.status).toBe("completed");
    expect(approvedPatch.execution.task.status).toBe("completed");
    expect(approvedPatch.execution.branch.state).toBe("approved");

    const finalEventsRef = await api.fetch(new Request(`http://localhost/events?projectId=${project.id}`));
    const finalEvents = await finalEventsRef.json();
    expect(finalEvents.map((event: { type: string }) => event.type)).toEqual(
      expect.arrayContaining(["patch.approved", "task.completed"]),
    );
  }, 60000);

  test("creates, loads, and abandons a task branch through the API", async () => {
    const api = createApp({
      prisma,
      env: {
        VIMBUS_TEST_KEY: "present",
      },
    });
    const { task } = await seedExecutableTask(api, tempDir, {
      command: "echo ready",
    });

    const createBranchRef = await postJson(api, `/tasks/${task.id}/branch`, {});
    expect(createBranchRef.status).toBe(200);
    const branch = await createBranchRef.json();
    expect(branch.state).toBe("created");

    const getBranchRef = await api.fetch(new Request(`http://localhost/tasks/${task.id}/branch`));
    expect(getBranchRef.status).toBe(200);
    const loadedBranch = await getBranchRef.json();
    expect(loadedBranch.name).toBe(branch.name);

    const abandonBranchRef = await postJson(api, `/tasks/${task.id}/branch/abandon`, {});
    expect(abandonBranchRef.status).toBe(200);
    const abandonedBranch = await abandonBranchRef.json();
    expect(abandonedBranch.state).toBe("abandoned");
    expect(runCommand("git", ["branch", "--show-current"], tempDir).stdout.trim()).toBe("main");
  }, 20000);

  test("starts execution through the API and persists the model snapshot", async () => {
    const api = createApp({
      prisma,
      env: {
        VIMBUS_TEST_KEY: "present",
      },
    });
    const { task } = await seedExecutableTask(api, tempDir, {
      command: "echo execution-started",
    });

    const executeRef = await postJson(api, `/tasks/${task.id}/execute`, {});
    expect(executeRef.status).toBe(201);
    const execution = await executeRef.json();

    expect(execution.status).toBe("implementing");
    expect(execution.task.status).toBe("executing");
    expect(execution.branch.state).toBe("active");
    expect(execution.latestAgentStep.modelName).toBe("openai:gpt-test");
    expect(execution.policy.modelResolution.concreteModelName).toBe("openai:gpt-test");
    expect(runCommand("git", ["branch", "--show-current"], tempDir).stdout.trim()).toBe(execution.branch.name);
  }, 20000);

  test("rejects a ready patch through the patch review API", async () => {
    const api = createApp({
      prisma,
      env: {
        VIMBUS_TEST_KEY: "present",
      },
    });
    const { project, task } = await seedExecutableTask(api, tempDir, {
      command: "echo ready-to-reject",
    });
    const executeRef = await postJson(api, `/tasks/${task.id}/execute`, {});
    const execution = await executeRef.json();

    writeProjectFile(tempDir, "README.md", "# execution api\nrejectable patch\n");

    const runTestsRef = await postJson(api, `/executions/${execution.id}/test-runs`, {});
    expect(runTestsRef.status).toBe(200);
    const testRuns = await runTestsRef.json();
    expect(testRuns).toHaveLength(1);
    expect(testRuns[0].status).toBe("passed");

    const listTestsRef = await api.fetch(new Request(`http://localhost/executions/${execution.id}/test-runs`));
    expect(listTestsRef.status).toBe(200);
    const listedTestRuns = await listTestsRef.json();
    expect(listedTestRuns).toHaveLength(1);

    const patchRef = await api.fetch(new Request(`http://localhost/executions/${execution.id}/patch`));
    expect(patchRef.status).toBe(200);
    const patch = await patchRef.json();
    expect(patch.patchReview.status).toBe("ready");
    expect(patch.patchReview.summary).toContain("file");

    const rejectPatchRef = await postJson(api, `/executions/${execution.id}/patch/reject`, {});
    expect(rejectPatchRef.status).toBe(200);
    const rejectedPatch = await rejectPatchRef.json();

    expect(rejectedPatch.patchReview.status).toBe("rejected");
    expect(rejectedPatch.execution.status).toBe("failed");
    expect(rejectedPatch.execution.task.status).toBe("failed");

    const eventsRef = await api.fetch(
      new Request(`http://localhost/events?projectId=${project.id}&taskExecutionId=${execution.id}`),
    );
    const events = await eventsRef.json();
    expect(events.map((event: { type: string }) => event.type)).toContain("task.failed");
  }, 20000);

  test("marks the task execution failed when verification command execution fails", async () => {
    const api = createApp({
      prisma,
      env: {
        VIMBUS_TEST_KEY: "present",
      },
    });
    const { task } = await seedExecutableTask(api, tempDir, {
      command: "exit 1",
    });
    const executeRef = await postJson(api, `/tasks/${task.id}/execute`, {});
    const execution = await executeRef.json();

    writeProjectFile(tempDir, "src/failing.ts", "export const broken = true;\n");

    const runTestsRef = await postJson(api, `/executions/${execution.id}/test-runs`, {});
    expect(runTestsRef.status).toBe(200);
    const testRuns = await runTestsRef.json();
    expect(testRuns[0].status).toBe("failed");

    const storedExecution = await prisma.taskExecution.findUnique({
      where: { id: execution.id },
    });
    const storedTask = await prisma.task.findUnique({
      where: { id: task.id },
    });
    expect(storedExecution?.status).toBe("failed");
    expect(storedTask?.status).toBe("failed");

    const patchRef = await api.fetch(new Request(`http://localhost/executions/${execution.id}/patch`));
    expect(patchRef.status).toBe(404);
  }, 20000);

  test("dispatches approved visual items without commands to visual verification", async () => {
    const api = createApp({
      prisma,
      env: {
        VIMBUS_TEST_KEY: "present",
      },
    });
    const { task } = await seedExecutableTask(api, tempDir, {
      items: [
        {
          kind: "logic",
          title: "command-backed verification",
          description: "runs through the shell",
          command: "echo ok",
        },
        {
          kind: "visual",
          runner: "playwright",
          title: "visual review item",
          description: "has no command in the current slice",
          command: null,
        },
      ],
    });
    const executeRef = await postJson(api, `/tasks/${task.id}/execute`, {});
    const execution = await executeRef.json();

    const runTestsRef = await postJson(api, `/executions/${execution.id}/test-runs`, {});
    expect(runTestsRef.status).toBe(200);

    const visualResultsRef = await api.fetch(new Request(`http://localhost/executions/${execution.id}/visual-results`));
    expect(visualResultsRef.status).toBe(200);
    await expect(visualResultsRef.json()).resolves.toMatchObject([
      {
        status: "blocked",
        mode: "screenshot",
      },
    ]);
    const storedExecution = await prisma.taskExecution.findUnique({
      where: { id: execution.id },
    });
    expect(storedExecution?.status).toBe("failed");
  });

  test("returns a strict 422 payload when there are zero approved verification items", async () => {
    const api = createApp({
      prisma,
      env: {
        VIMBUS_TEST_KEY: "present",
      },
    });
    const { task } = await seedExecutableTask(api, tempDir, {
      command: "echo ok",
    });

    await prisma.verificationItem.updateMany({
      where: {
        taskId: task.id,
      },
      data: {
        status: "skipped",
      },
    });

    const executeRef = await postJson(api, `/tasks/${task.id}/execute`, {});
    const execution = await executeRef.json();

    const runTestsRef = await postJson(api, `/executions/${execution.id}/test-runs`, {});

    expect(runTestsRef.status).toBe(422);
    expect(await runTestsRef.json()).toEqual({
      code: "NO_APPROVED_VERIFICATION_ITEMS",
      message: "This execution has no approved verification items to run.",
      items: [],
    });
  });
});

async function seedGeneratedPlannerRun(api: ReturnType<typeof createApp>, rootPath: string) {
  const projectRef = await postJson(api, "/projects", {
    name: "Foundation Project",
    rootPath,
  });
  const project = await projectRef.json();

  const plannerRunRef = await postJson(api, "/planner/runs", {
    projectId: project.id,
    goal: "Implement foundation",
  });
  const plannerRun = await plannerRunRef.json();

  await postJson(api, `/planner/runs/${plannerRun.id}/generate`, {
    summary: "One epic with one task",
    epics: [buildPlannerEpicPayload()],
  });

  return { project, plannerRun };
}

async function seedExecutableTask(
  api: ReturnType<typeof createApp>,
  rootPath: string,
  options: {
    command?: string | null;
    items?: SeedExecutionVerificationItem[];
  },
) {
  const projectRef = await postJson(api, "/projects", {
    name: "Execution Project",
    rootPath,
    baseBranch: "main",
  });
  const project = await projectRef.json();

  const mcpSetupRef = await postJson(api, `/mcp/setup?projectId=${project.id}`, {
    activate: true,
  });
  expect(mcpSetupRef.status).toBe(201);

  const setupRef = await postJson(api, "/model-setup", {
    projectId: project.id,
    providerKey: "openai",
    providerKind: "openai",
    providerStatus: "active",
    secretEnv: "VIMBUS_TEST_KEY",
    modelName: "GPT Test",
    modelSlug: "gpt-test",
    capabilities: ["json"],
    slotKeys: ["executor_default"],
  });
  expect(setupRef.status).toBe(201);

  const plannerRunRef = await postJson(api, "/planner/runs", {
    projectId: project.id,
    goal: "Execute one approved task",
    moduleName: "api",
  });
  const plannerRun = await plannerRunRef.json();

  const generateRef = await postJson(api, `/planner/runs/${plannerRun.id}/generate`, {
    summary: "Execution task proposal",
    epics: [
      {
        key: "EXEC-EPIC-1",
        title: "Execution Flow",
        goal: "Execute and verify one task",
        tasks: [
          {
            stableId: "EXEC-TASK-1",
            title: "Execute backend task",
            description: "Prepare branch, run verification, and patch review",
            type: "backend",
            complexity: "medium",
            acceptance: [{ label: "execution persists state" }],
            verificationPlan: {
              rationale: "Need one deterministic command",
              items: (options.items ?? buildDefaultExecutionVerificationItems(options.command ?? null)).map(
                (item, index) => ({
                  kind: item.kind,
                  runner: item.runner ?? "custom",
                  title: item.title,
                  description: item.description,
                  command: item.command ?? null,
                  orderIndex: item.orderIndex ?? index,
                }),
              ),
            },
          },
        ],
      },
    ],
  });
  expect(generateRef.status).toBe(200);

  const approvePlannerRef = await postJson(api, "/approvals", {
    projectId: project.id,
    subjectType: "planner_run",
    subjectId: plannerRun.id,
    stage: "planner_review",
    status: "granted",
  });
  expect(approvePlannerRef.status).toBe(201);

  const tasksRef = await api.fetch(new Request(`http://localhost/tasks?projectId=${project.id}`));
  const tasks = await tasksRef.json();
  const task = tasks[0];
  expect(task.status).toBe("awaiting_verification_approval");

  const approveVerificationRef = await postJson(api, `/tasks/${task.id}/verification/approve`, {});
  expect(approveVerificationRef.status).toBe(200);

  return {
    project,
    task,
  };
}

async function seedBenchmarkExecutionTelemetry(prisma: PrismaClient, rootPath: string) {
  const project = await prisma.project.create({
    data: {
      name: "Benchmark Hydration Project",
      rootPath,
      baseBranch: "main",
    },
  });
  const plannerRun = await prisma.plannerRun.create({
    data: {
      projectId: project.id,
      status: "generated",
      goal: "Benchmark hydration",
    },
  });
  const epic = await prisma.epic.create({
    data: {
      projectId: project.id,
      plannerRunId: plannerRun.id,
      key: `BENCH-${crypto.randomUUID()}`,
      title: "Benchmark",
      goal: "Hydrate from execution telemetry",
      status: "planned",
      orderIndex: 0,
      acceptanceJson: "[]",
    },
  });
  const task = await prisma.task.create({
    data: {
      epicId: epic.id,
      stableId: `BENCH-${crypto.randomUUID()}`,
      title: "Hydrate benchmark",
      type: "backend",
      complexity: "medium",
      status: "ready",
      orderIndex: 0,
      acceptanceJson: "[]",
    },
  });
  const branch = await prisma.taskBranch.create({
    data: {
      taskId: task.id,
      name: `tg/benchmark/${task.id}`,
      base: "main",
      state: "active",
    },
  });
  const execution = await prisma.taskExecution.create({
    data: {
      taskId: task.id,
      branchId: branch.id,
      status: "completed",
      retryCount: 1,
    },
  });
  const plan = await prisma.verificationPlan.create({
    data: {
      taskId: task.id,
      status: "approved",
      rationale: "benchmark hydration test plan",
      approvedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
  const unit = await prisma.verificationItem.create({
    data: {
      planId: plan.id,
      taskId: task.id,
      kind: "logic",
      title: "unit",
      description: "unit verification",
      command: "bun test unit",
      status: "green",
      orderIndex: 0,
    },
  });
  const typecheck = await prisma.verificationItem.create({
    data: {
      planId: plan.id,
      taskId: task.id,
      kind: "typecheck",
      title: "typecheck",
      description: "typecheck verification",
      command: "bun run typecheck",
      status: "failed",
      orderIndex: 1,
    },
  });

  await prisma.mcpToolCall.createMany({
    data: [
      {
        projectId: project.id,
        taskExecutionId: execution.id,
        serverName: "server",
        toolName: "first.tool",
        status: "succeeded",
        mutability: "read",
        createdAt: new Date("2026-01-01T00:00:01.000Z"),
      },
      {
        projectId: project.id,
        taskExecutionId: execution.id,
        serverName: "server",
        toolName: "second.tool",
        status: "succeeded",
        mutability: "read",
        createdAt: new Date("2026-01-01T00:00:02.000Z"),
      },
    ],
  });

  await prisma.testRun.createMany({
    data: [
      {
        taskExecutionId: execution.id,
        verificationItemId: unit.id,
        command: "bun test unit",
        status: "passed",
        exitCode: 0,
        phase: "post_green",
        iterationIndex: 1,
        createdAt: new Date("2026-01-01T00:00:03.000Z"),
      },
      {
        taskExecutionId: execution.id,
        verificationItemId: typecheck.id,
        command: "bun run typecheck",
        status: "failed",
        exitCode: 1,
        phase: "post_green",
        iterationIndex: 1,
        createdAt: new Date("2026-01-01T00:00:04.000Z"),
      },
    ],
  });

  return { project, execution };
}

type SeedExecutionVerificationItem = {
  kind: string;
  runner?: string | null;
  title: string;
  description: string;
  command?: string | null;
  orderIndex?: number;
};

function buildDefaultExecutionVerificationItems(command: string | null): SeedExecutionVerificationItem[] {
  return [
    {
      kind: "logic",
      runner: "custom",
      title: "verification command",
      description: "runs one deterministic verification command",
      command,
    },
  ];
}

function buildReadmeSmokeCommand() {
  return "node -e \"const fs=require('node:fs'); const body=fs.readFileSync('README.md','utf8'); if (!body.includes('smoke patch')) process.exit(1); console.log('smoke verified');\"";
}

function buildExecutionLoopSmokeProposal() {
  return {
    summary: "HC-92 deterministic execution-loop smoke",
    epics: [
      {
        key: "HC-92-SMOKE",
        title: "Execution Loop Smoke",
        goal: "Exercise the local execution loop from task approval to patch review",
        orderIndex: 0,
        acceptance: [{ label: "operator can approve a verified patch" }],
        risks: [{ label: "verification must stay command-backed and deterministic" }],
        tasks: [
          {
            stableId: "HC-92-SMOKE-1",
            title: "Run MVP execution loop smoke",
            description: "Prepare a branch, run command-backed verification, persist artifacts, and approve the patch.",
            type: "backend",
            complexity: "medium",
            orderIndex: 0,
            acceptance: [{ label: "patch review reaches approved after verification passes" }],
            targetFiles: ["README.md"],
            requires: ["executor_default"],
            verificationPlan: {
              rationale: "The local smoke uses one deterministic command that checks the generated patch content.",
              items: [
                {
                  kind: "logic",
                  runner: "custom",
                  title: "README smoke output is present",
                  description: "Checks that the execution patch wrote the expected smoke marker.",
                  command: buildReadmeSmokeCommand(),
                  orderIndex: 0,
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function buildPlannerEpicPayload() {
  return {
    key: "EPIC-1",
    title: "Backend Foundation",
    goal: "Persist planner outputs",
    orderIndex: 0,
    acceptance: [{ label: "tasks exist" }],
    risks: [{ label: "missing approval" }],
    tasks: [
      {
        stableId: "TASK-1",
        title: "Persist planner proposal",
        description: "Write generated records",
        type: "backend",
        complexity: "medium",
        orderIndex: 0,
        acceptance: [{ label: "proposal persisted" }],
        targetFiles: ["apps/api/src/app.ts"],
        requires: ["database"],
        verificationPlan: {
          rationale: "Need one runnable verification plan",
          items: [
            {
              kind: "logic",
              runner: "vitest",
              title: "planner persists records",
              description: "stores epics, tasks, and verification plans",
              command: "bun run test:vitest",
              orderIndex: 0,
            },
          ],
        },
      },
    ],
  };
}

describe("verification review API", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-verification-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  });

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test("GET /tasks/:id/verification returns 404 for unknown task", async () => {
    const api = createApp({ prisma });
    const response = await api.fetch(new Request("http://localhost/tasks/nonexistent/verification"));

    expect(response.status).toBe(404);
  });

  test("GET /tasks/:id/verification returns plan=null summary=null when no plan exists", async () => {
    const api = createApp({ prisma });
    const project = await prisma.project.create({
      data: { name: "Test", rootPath: tempDir, baseBranch: "main" },
    });
    const plannerRun = await prisma.plannerRun.create({
      data: { projectId: project.id, goal: "test", status: "interviewing" },
    });
    const epic = await prisma.epic.create({
      data: { plannerRunId: plannerRun.id, projectId: project.id, key: "E-1", title: "E", goal: "G", orderIndex: 0, status: "proposed", acceptanceJson: "[]" },
    });
    const task = await prisma.task.create({
      data: { epicId: epic.id, stableId: "T-1", title: "T", type: "backend", complexity: "low", orderIndex: 0, status: "proposed", acceptanceJson: "[]" },
    });

    const response = await api.fetch(new Request(`http://localhost/tasks/${task.id}/verification`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.taskId).toBe(task.id);
    expect(body.plan).toBeNull();
    expect(body.summary).toBeNull();
  });

  test("GET /tasks/:id/verification returns runnableNow and deferredReason per item", async () => {
    const api = createApp({ prisma });
    const project = await prisma.project.create({
      data: { name: "Test", rootPath: tempDir, baseBranch: "main" },
    });
    const plannerRun = await prisma.plannerRun.create({
      data: { projectId: project.id, goal: "test", status: "generating" },
    });
    const epic = await prisma.epic.create({
      data: { plannerRunId: plannerRun.id, projectId: project.id, key: "E-1", title: "E", goal: "G", orderIndex: 0, status: "proposed", acceptanceJson: "[]" },
    });
    const task = await prisma.task.create({
      data: { epicId: epic.id, stableId: "T-1", title: "T", type: "backend", complexity: "low", orderIndex: 0, status: "proposed", acceptanceJson: "[]" },
    });
    const plan = await prisma.verificationPlan.create({
      data: { taskId: task.id, status: "proposed", rationale: "test plan" },
    });
    await prisma.verificationItem.createMany({
      data: [
        { planId: plan.id, taskId: task.id, kind: "logic", title: "unit test", description: "runs vitest", command: "bun run test:vitest", status: "proposed", orderIndex: 0 },
        { planId: plan.id, taskId: task.id, kind: "visual", title: "screenshot check", description: "compare baseline", command: null, status: "proposed", orderIndex: 1, route: "/tasks" },
      ],
    });

    const response = await api.fetch(new Request(`http://localhost/tasks/${task.id}/verification`));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.summary.totalCount).toBe(2);
    expect(body.summary.runnableCount).toBe(1);
    expect(body.summary.deferredCount).toBe(1);
    expect(body.summary.allRunnableNow).toBe(false);

    const logicItem = body.plan.items[0];
    expect(logicItem.runnableNow).toBe(true);
    expect(logicItem.deferredReason).toBeNull();

    const visualItem = body.plan.items[1];
    expect(visualItem.runnableNow).toBe(false);
    expect(visualItem.deferredReason).toContain("Visual checks");
    expect(visualItem.route).toBe("/tasks");
  });

  test("GET /tasks/:id/verification summary shows allRunnableNow=true when all items have commands", async () => {
    const api = createApp({ prisma });
    const project = await prisma.project.create({
      data: { name: "Test", rootPath: tempDir, baseBranch: "main" },
    });
    const plannerRun = await prisma.plannerRun.create({
      data: { projectId: project.id, goal: "test", status: "generating" },
    });
    const epic = await prisma.epic.create({
      data: { plannerRunId: plannerRun.id, projectId: project.id, key: "E-1", title: "E", goal: "G", orderIndex: 0, status: "proposed", acceptanceJson: "[]" },
    });
    const task = await prisma.task.create({
      data: { epicId: epic.id, stableId: "T-1", title: "T", type: "backend", complexity: "low", orderIndex: 0, status: "proposed", acceptanceJson: "[]" },
    });
    const plan = await prisma.verificationPlan.create({
      data: { taskId: task.id, status: "proposed", rationale: "all runnable" },
    });
    await prisma.verificationItem.createMany({
      data: [
        { planId: plan.id, taskId: task.id, kind: "logic", title: "unit test", description: "vitest", command: "bun run test:vitest", status: "proposed", orderIndex: 0 },
        { planId: plan.id, taskId: task.id, kind: "typecheck", title: "typecheck", description: "tsc", command: "bun run typecheck", status: "proposed", orderIndex: 1 },
      ],
    });

    const response = await api.fetch(new Request(`http://localhost/tasks/${task.id}/verification`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.summary.allRunnableNow).toBe(true);
    expect(body.summary.runnableCount).toBe(2);
    expect(body.summary.deferredCount).toBe(0);
    expect(body.plan.items.every((item: { runnableNow: boolean }) => item.runnableNow)).toBe(true);
  });
});

function postJson(api: ReturnType<typeof createApp>, path: string, body: unknown) {
  return api.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
}
