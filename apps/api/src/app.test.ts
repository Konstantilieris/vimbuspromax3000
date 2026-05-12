import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
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

describe("project API", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-project-api-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  });

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test("looks up projects by normalized root path and returns null for misses", async () => {
    const api = createApp({ prisma });
    const createRef = await postJson(api, "/projects", {
      name: "Lookup Project",
      rootPath: join(tempDir, "workspace", "."),
    });
    expect(createRef.status).toBe(201);
    const project = await createRef.json();
    const rootPathWithTrailingSeparator = project.rootPath.endsWith(sep)
      ? project.rootPath
      : `${project.rootPath}${sep}`;

    const lookupRef = await api.fetch(
      new Request(`http://localhost/projects/lookup?rootPath=${encodeURIComponent(rootPathWithTrailingSeparator)}`),
    );
    expect(lookupRef.status).toBe(200);
    await expect(lookupRef.json()).resolves.toMatchObject({
      project: {
        id: project.id,
        rootPath: project.rootPath,
      },
    });

    const missingRef = await api.fetch(
      new Request(`http://localhost/projects/lookup?rootPath=${encodeURIComponent(join(tempDir, "missing"))}`),
    );
    expect(missingRef.status).toBe(200);
    await expect(missingRef.json()).resolves.toEqual({ project: null });
  });

  test("fetches a project by id and creates projects idempotently by root path", async () => {
    const api = createApp({ prisma });
    const firstRef = await postJson(api, "/projects", {
      name: "Idempotent Project",
      rootPath: join(tempDir, "workspace"),
    });
    expect(firstRef.status).toBe(201);
    const first = await firstRef.json();

    const secondRef = await postJson(api, "/projects", {
      name: "Duplicate Project",
      rootPath: `${first.rootPath}${sep}`,
    });
    expect(secondRef.status).toBe(200);
    const second = await secondRef.json();

    expect(second.id).toBe(first.id);
    expect(second.existing).toBe(true);
    await expect(prisma.project.count()).resolves.toBe(1);

    const byIdRef = await api.fetch(new Request(`http://localhost/projects/${first.id}`));
    expect(byIdRef.status).toBe(200);
    await expect(byIdRef.json()).resolves.toMatchObject({ id: first.id });
  });
});

describe("Jira import API", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-jira-import-api-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test("imports direct issues without calling Jira", async () => {
    const api = createApp({ prisma });
    const project = await prisma.project.create({
      data: { name: "Jira Import", rootPath: tempDir, baseBranch: "main" },
    });

    const response = await postJson(api, "/jira/import", {
      projectId: project.id,
      epicKey: "HC-100",
      issues: jiraIssues(),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      plannerRunId: expect.any(String),
      reviewArtifactId: expect.any(String),
      summary: {
        issueCount: 3,
        taskCount: 1,
        validationCount: 1,
      },
    });
    await expect(prisma.epic.findUnique({ where: { jiraIssueKey: "HC-100" } })).resolves.toMatchObject({
      key: "HC-100",
      title: "Import Jira epic",
    });
    await expect(prisma.task.findUnique({ where: { jiraIssueKey: "HC-101" } })).resolves.toMatchObject({
      stableId: "HC-101",
      title: "Build the API route",
    });
    await expect(prisma.reviewArtifact.findUnique({ where: { id: body.reviewArtifactId } })).resolves.toMatchObject({
      subjectType: "planner_run",
      subjectId: body.plannerRunId,
      stage: "jira_import",
      status: "pending",
      title: "Jira import summary: HC-100",
      markdown: expect.stringContaining("- Validations: 1"),
      payloadJson: expect.stringContaining('"epicIssueKey":"HC-100"'),
    });
  });

  test("approving a Jira import review approves the planner run without making tasks ready", async () => {
    const api = createApp({ prisma });
    const project = await prisma.project.create({
      data: { name: "Jira Import Approval", rootPath: tempDir, baseBranch: "main" },
    });
    const importRef = await postJson(api, "/jira/import", {
      projectId: project.id,
      epicKey: "HC-100",
      issues: jiraIssues(),
    });
    const imported = await importRef.json();

    const approveRef = await postJson(api, `/review-artifacts/${imported.reviewArtifactId}/approve`, {
      operator: "ak",
    });

    expect(approveRef.status).toBe(200);
    const approval = await approveRef.json();
    expect(approval.artifact).toMatchObject({
      id: imported.reviewArtifactId,
      status: "approved",
      subjectType: "planner_run",
      subjectId: imported.plannerRunId,
    });
    expect(approval.approval).toMatchObject({
      subjectType: "planner_run",
      subjectId: imported.plannerRunId,
      stage: "jira_import",
      status: "granted",
    });

    await expect(prisma.plannerRun.findUnique({ where: { id: imported.plannerRunId } })).resolves.toMatchObject({
      status: "approved",
    });
    await expect(prisma.task.findUnique({ where: { jiraIssueKey: "HC-101" } })).resolves.toMatchObject({
      status: "awaiting_verification_approval",
    });
    await expect(prisma.validation.findUnique({ where: { id: imported.validationIds[0] } })).resolves.toMatchObject({
      status: "proposed",
    });

    const validationApproveRef = await postJson(api, `/validations/${imported.validationIds[0]}/approve`, {
      operator: "ak",
    });
    expect(validationApproveRef.status).toBe(200);
    await expect(prisma.task.findUnique({ where: { jiraIssueKey: "HC-101" } })).resolves.toMatchObject({
      status: "ready",
    });
  });

  test("fetches issues by JQL when direct issues are absent", async () => {
    const requests: string[] = [];
    const mockFetch = async (input: string | URL | Request) => {
      requests.push(String(input));
      return Response.json({ issues: jiraIssues() });
    };
    vi.stubGlobal("fetch", mockFetch);

    const api = createApp({
      prisma,
      env: {
        TASKGOBLIN_JIRA_CLOUD_ID: "cloud-123",
      },
    });
    const project = await prisma.project.create({
      data: { name: "Jira Import", rootPath: tempDir, baseBranch: "main" },
    });

    const response = await postJson(api, "/jira/import", {
      projectId: project.id,
      jql: "project = HC ORDER BY created ASC",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.summary).toEqual({
      issueCount: 3,
      taskCount: 1,
      validationCount: 1,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("https://api.atlassian.com/ex/jira/cloud-123/rest/api/3/search/jql");
    expect(requests[0]).toContain("jql=project+%3D+HC+ORDER+BY+created+ASC");
  });

  test("resolves Jira local env files with .env.local before .env", async () => {
    const previousCwd = process.cwd();
    const requests: string[] = [];
    const mockFetch = async (input: string | URL | Request) => {
      requests.push(String(input));
      return Response.json({ issues: jiraIssues() });
    };
    vi.stubGlobal("fetch", mockFetch);
    writeFileSync(join(tempDir, ".env"), "TASKGOBLIN_JIRA_CLOUD_ID=cloud-from-env\n");
    writeFileSync(join(tempDir, ".env.local"), "TASKGOBLIN_JIRA_CLOUD_ID=cloud-from-local\n");
    process.chdir(tempDir);

    try {
      const api = createApp({ prisma });
      const project = await prisma.project.create({
        data: { name: "Jira Local Env Import", rootPath: tempDir, baseBranch: "main" },
      });

      const response = await postJson(api, "/jira/import", {
        projectId: project.id,
        jql: "project = HC",
      });

      expect(response.status).toBe(200);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toContain("https://api.atlassian.com/ex/jira/cloud-from-local/rest/api/3/search/jql");
    } finally {
      process.chdir(previousCwd);
    }
  });

  test("fetches an epic with children when direct issues and JQL are absent", async () => {
    const requests: string[] = [];
    const mockFetch = async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const jql = url.searchParams.get("jql") ?? "";
      requests.push(jql);

      if (jql === 'key = "HC-100"') {
        return Response.json({ issues: [jiraIssues()[0]] });
      }
      if (jql === 'parent = "HC-100" ORDER BY created ASC') {
        return Response.json({ issues: [jiraIssues()[1]] });
      }
      if (jql === 'parent in ("HC-101") ORDER BY created ASC') {
        return Response.json({ issues: [jiraIssues()[2]] });
      }

      return Response.json({ issues: [] });
    };
    vi.stubGlobal("fetch", mockFetch);

    const api = createApp({
      prisma,
      env: {
        TASKGOBLIN_JIRA_SITE_URL: "https://jira.example.test",
      },
    });
    const project = await prisma.project.create({
      data: { name: "Jira Epic Import", rootPath: tempDir, baseBranch: "main" },
    });

    const response = await postJson(api, "/jira/import", {
      projectId: project.id,
      epicKey: "HC-100",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.summary).toEqual({
      issueCount: 3,
      taskCount: 1,
      validationCount: 1,
    });
    expect(requests).toEqual([
      'key = "HC-100"',
      'parent = "HC-100" ORDER BY created ASC',
      'parent in ("HC-101") ORDER BY created ASC',
    ]);
  });
});

describe("validation API", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-validation-api-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  });

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test("creates, lists, updates, approves, and rejects task validations", async () => {
    const api = createApp({ prisma });
    const { task } = await seedApiTask(prisma, tempDir, {
      taskStatus: "awaiting_verification_approval",
    });

    const emptyListRef = await api.fetch(new Request(`http://localhost/tasks/${task.id}/validations`));
    expect(emptyListRef.status).toBe(200);
    await expect(emptyListRef.json()).resolves.toEqual([]);

    const createRef = await postJson(api, `/tasks/${task.id}/validations`, {
      description: "Dashboard renders the primary task list.",
      acceptanceCriteria: [{ label: "task list visible" }],
      testType: "playwright",
      rationale: "Browser coverage for the primary workflow.",
      orderIndex: 0,
    });
    expect(createRef.status).toBe(201);
    const validation = await createRef.json();
    expect(validation).toMatchObject({
      taskId: task.id,
      title: "Dashboard renders the primary task list.",
      status: "proposed",
      testType: "playwright",
      acceptanceCriteriaJson: JSON.stringify([{ label: "task list visible" }]),
    });

    const listRef = await api.fetch(new Request(`http://localhost/tasks/${task.id}/validations`));
    expect(listRef.status).toBe(200);
    const validations = await listRef.json();
    expect(validations.map((item: { id: string }) => item.id)).toEqual([validation.id]);

    const patchRef = await api.fetch(
      new Request(`http://localhost/validations/${validation.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description: "Dashboard renders filtered tasks.",
          acceptanceCriteria: [{ label: "filtered task visible" }],
          testType: "manual",
        }),
      }),
    );
    expect(patchRef.status).toBe(200);
    const patched = await patchRef.json();
    expect(patched).toMatchObject({
      id: validation.id,
      description: "Dashboard renders filtered tasks.",
      testType: "manual",
      acceptanceCriteriaJson: JSON.stringify([{ label: "filtered task visible" }]),
    });

    const approveRef = await postJson(api, `/validations/${validation.id}/approve`, {
      operator: "ak",
      reason: "Ready to run.",
    });
    expect(approveRef.status).toBe(200);
    const approval = await approveRef.json();
    expect(approval.validation.status).toBe("approved");
    expect(approval.approval).toMatchObject({
      subjectType: "validation",
      subjectId: validation.id,
      status: "granted",
    });

    const rejectRef = await postJson(api, `/tasks/${task.id}/validations`, {
      title: "Ambiguous manual check",
      description: "Needs a concrete assertion.",
      testType: "manual",
    });
    const rejectedValidation = await rejectRef.json();
    const rejectDecisionRef = await postJson(api, `/validations/${rejectedValidation.id}/reject`, {
      operator: "ak",
    });
    expect(rejectDecisionRef.status).toBe(200);
    const rejection = await rejectDecisionRef.json();
    expect(rejection.validation.status).toBe("rejected");
    expect(rejection.approval.status).toBe("rejected");
  });

  test("generates a Playwright spec review artifact with a safe code payload", async () => {
    const projectRoot = join(tempDir, "project");
    const stagingRoot = join(tempDir, "api-workspace");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(stagingRoot, { recursive: true });
    const { project, task } = await seedApiTask(prisma, projectRoot, {
      taskStatus: "awaiting_verification_approval",
    });
    const api = createApp({
      prisma,
      playwrightWorkspaceRoot: stagingRoot,
      playwrightGeneratorDeps: {
        loadSystemPrompt: () => "Generate only TypeScript Playwright code.",
        generateText: async ({ prompt }) => {
          expect(prompt).toContain("Preferred route:\n/checkout");
          return [
            "```ts",
            "import { expect, test } from '@playwright/test';",
            "",
            "test('checkout is visible', async ({ page }) => {",
            "  await page.goto('/checkout');",
            "  await expect(page.getByText('<script>alert(1)</script>')).toBeVisible();",
            "});",
            "```",
          ].join("\n");
        },
      },
    });

    const createRef = await postJson(api, `/tasks/${task.id}/validations`, {
      title: "Checkout route renders safely",
      description: "The checkout page should render without leaking unsafe markup.",
      acceptanceCriteria: [{ label: "checkout route is visible" }],
      testType: "playwright",
      orderIndex: 0,
    });
    expect(createRef.status).toBe(201);
    const validation = await createRef.json();

    const generateRef = await postJson(api, `/validations/${validation.id}/generate-spec`, {
      route: "/checkout",
    });
    expect(generateRef.status).toBe(201);
    const generated = await generateRef.json();
    expect(generated.stagingFilePath).toBe(
      `apps/api/.artifacts/staging/playwright/${task.id}/${validation.id}.spec.ts`,
    );
    expect(existsSync(join(projectRoot, "tests"))).toBe(false);

    const artifact = await prisma.reviewArtifact.findUniqueOrThrow({
      where: { id: generated.artifactId },
    });
    const payload = JSON.parse(artifact.payloadJson ?? "{}") as {
      kind: string;
      code: string;
      stagingFilePath: string;
      stagingWorkspaceRoot: string;
      targetTestFilePath: string;
    };
    expect(artifact).toMatchObject({
      projectId: project.id,
      subjectType: "validation",
      subjectId: validation.id,
      stage: "validation_review",
      status: "pending",
    });
    expect(payload).toMatchObject({
      kind: "playwright_spec",
      stagingFilePath: generated.stagingFilePath,
      stagingWorkspaceRoot: stagingRoot,
      targetTestFilePath: `tests/generated/${task.id}/${validation.id}.spec.ts`,
    });
    expect(payload.code).toContain("page.goto('/checkout')");
    expect(readFileSync(join(stagingRoot, generated.stagingFilePath), "utf8")).toBe(payload.code);

    const pageRef = await api.fetch(new Request(`http://localhost/review/${artifact.id}`));
    expect(pageRef.status).toBe(200);
    const html = await pageRef.text();
    expect(html).toContain("<h2>Generated spec</h2>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");

    const approveRef = await postJson(api, `/review-artifacts/${artifact.id}/approve`, {
      operator: "ak",
    });
    expect(approveRef.status).toBe(200);
    const decision = await approveRef.json();
    expect(decision.approval).toMatchObject({
      subjectType: "validation",
      subjectId: validation.id,
      status: "granted",
    });
    expect(existsSync(join(stagingRoot, generated.stagingFilePath))).toBe(false);
    expect(readFileSync(join(projectRoot, payload.targetTestFilePath), "utf8")).toBe(payload.code);

    const approvedValidation = await prisma.validation.findUniqueOrThrow({
      where: { id: validation.id },
    });
    expect(approvedValidation).toMatchObject({
      status: "approved",
      testFilePath: payload.targetTestFilePath,
    });
  });

  test("translates validation gate failures from execution into a 412 payload", async () => {
    const api = createApp({
      prisma,
      env: {
        VIMBUS_TEST_KEY: "present",
      },
    });
    const { project, task } = await seedApiTask(prisma, tempDir, {
      taskStatus: "ready",
      verificationPlanStatus: "proposed",
    });
    await prisma.mcpServer.create({
      data: {
        projectId: project.id,
        name: "taskgoblin-db",
        transport: "stdio",
        trustLevel: "trusted",
        status: "active",
      },
    });

    const executeRef = await postJson(api, `/tasks/${task.id}/execute`, {});
    expect(executeRef.status).toBe(412);
    await expect(executeRef.json()).resolves.toMatchObject({
      error: "validation_gate",
      code: "VALIDATION_GATE_FAILED",
      taskId: task.id,
      missingValidations: [],
      hint: "No validations defined - run /plan:generate or /validation:create.",
    });
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
    expect(generatedPlannerRun.reviewArtifact).toMatchObject({
      subjectType: "planner_run",
      subjectId: plannerRun.id,
      status: "pending",
      stage: "planner_review",
    });

    const eventsRef = await api.fetch(new Request(`http://localhost/events?projectId=${project.id}`));
    const events = await eventsRef.json();
    expect(events.map((event: { type: string }) => event.type)).toContain("planner.answer");
    expect(events.map((event: { type: string }) => event.type)).toContain("planner.proposed");
    expect(events.map((event: { type: string }) => event.type)).toContain("review.requested");
  });

  test("creates markdown review artifacts and renders a safe browser page", async () => {
    const api = createApp({ prisma });
    const projectRef = await postJson(api, "/projects", {
      name: "Review Project",
      rootPath: tempDir,
    });
    const project = await projectRef.json();

    const createRef = await postJson(api, "/review-artifacts", {
      projectId: project.id,
      subjectType: "agent_plan",
      subjectId: "plan_1",
      title: "Approve generated plan",
      markdown: "# Generated Plan\n\n<script>alert(1)</script>\n\n- Run `bun test`",
    });
    expect(createRef.status).toBe(201);
    const artifact = await createRef.json();
    expect(artifact.status).toBe("pending");
    expect(artifact.stage).toBe("review");

    const listRef = await api.fetch(
      new Request(`http://localhost/review-artifacts?projectId=${project.id}&status=pending`),
    );
    const artifacts = await listRef.json();
    expect(artifacts.map((item: { id: string }) => item.id)).toContain(artifact.id);

    const pageRef = await api.fetch(
      new Request(`http://localhost/review/${artifact.id}`, {
        headers: { accept: "text/html" },
      }),
    );
    expect(pageRef.status).toBe(200);
    const html = await pageRef.text();
    expect(html).toContain("<h1>Approve generated plan</h1>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain(`/review-artifacts/${artifact.id}/approve`);

    const approveRef = await postJson(api, `/review-artifacts/${artifact.id}/approve`, {
      operator: "ak",
    });
    expect(approveRef.status).toBe(200);
    const decision = await approveRef.json();
    expect(decision.artifact.status).toBe("approved");
    expect(decision.approval).toMatchObject({
      subjectType: "review_artifact",
      subjectId: artifact.id,
      status: "granted",
      operator: "ak",
    });
  });

  test("browser review approval for validation artifacts updates validation readiness", async () => {
    const api = createApp({ prisma });
    const { project, task } = await seedApiTask(prisma, tempDir, {
      taskStatus: "awaiting_verification_approval",
    });
    const validationRef = await postJson(api, `/tasks/${task.id}/validations`, {
      title: "Approve browser-reviewed validation",
      description: "Validation review artifact drives readiness.",
      acceptanceCriteria: [{ label: "browser approval marks task ready" }],
      testType: "manual",
    });
    const validation = await validationRef.json();
    const artifactRef = await postJson(api, "/review-artifacts", {
      projectId: project.id,
      subjectType: "validation",
      subjectId: validation.id,
      title: "Review validation contract",
      markdown: "# Review validation contract\n\n- [ ] browser approval marks task ready",
      stage: "validation_review",
    });
    const artifact = await artifactRef.json();

    const pageRef = await api.fetch(new Request(`http://localhost/review/${artifact.id}`));
    expect(pageRef.status).toBe(200);
    const html = await pageRef.text();
    expect(html).toContain("Review validation contract");
    expect(html).toContain(`/review-artifacts/${artifact.id}/approve`);

    const approveRef = await postJson(api, `/review-artifacts/${artifact.id}/approve`, {
      operator: "ak",
    });
    expect(approveRef.status).toBe(200);
    const decision = await approveRef.json();
    expect(decision.approval).toMatchObject({
      subjectType: "validation",
      subjectId: validation.id,
      status: "granted",
    });

    const approvedValidationRef = await api.fetch(new Request(`http://localhost/validations/${validation.id}`));
    const approvedValidation = await approvedValidationRef.json();
    expect(approvedValidation.status).toBe("approved");
    expect(approvedValidation.approvalId).toBe(decision.approval.id);

    const taskRef = await api.fetch(new Request(`http://localhost/tasks/${task.id}`));
    const readyTask = await taskRef.json();
    expect(readyTask.status).toBe("ready");
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
    expect(generatedPlannerRun.reviewArtifact.title).toContain("Plan review");

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
    expect(events.map((event) => event.type)).toContain("review.requested");
  });

  test("browser planner review approval advances generated tasks", async () => {
    const api = createApp({ prisma });
    const { project, plannerRun } = await seedGeneratedPlannerRun(api, tempDir);
    const artifactsRef = await api.fetch(
      new Request(`http://localhost/review-artifacts?subjectType=planner_run&subjectId=${plannerRun.id}`),
    );
    const artifacts = await artifactsRef.json();
    const artifact = artifacts[0];
    expect(artifact.status).toBe("pending");

    const pageRef = await api.fetch(new Request(`http://localhost/review/${artifact.id}`));
    expect(pageRef.status).toBe(200);
    expect(await pageRef.text()).toContain("Plan review: Implement foundation");

    const approveRef = await api.fetch(
      new Request(`http://localhost/review-artifacts/${artifact.id}/approve`, {
        method: "POST",
        headers: { accept: "text/html" },
      }),
    );
    expect(approveRef.status).toBe(302);
    expect(approveRef.headers.get("location")).toBe(`/review/${artifact.id}`);

    const tasksAfterPlannerApprovalRef = await api.fetch(new Request(`http://localhost/tasks?projectId=${project.id}`));
    const tasksAfterPlannerApproval = await tasksAfterPlannerApprovalRef.json();
    expect(tasksAfterPlannerApproval[0].status).toBe("awaiting_verification_approval");

    const approvalsRef = await api.fetch(
      new Request(
        `http://localhost/approvals?subjectType=planner_run&subjectId=${plannerRun.id}&projectId=${project.id}`,
      ),
    );
    const approvals = await approvalsRef.json();
    expect(approvals).toHaveLength(1);
    expect(approvals[0].status).toBe("granted");
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
  });

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
  });

  test("VIM-49 — POST /tasks/:id/execute/headless creates a TaskExecution without invoking the agent loop", async () => {
    const api = createApp({
      prisma,
      env: {
        VIMBUS_TEST_KEY: "present",
      },
    });
    const { task } = await seedExecutableTask(api, tempDir, {
      command: "echo execution-started",
    });

    const executeRef = await postJson(api, `/tasks/${task.id}/execute/headless`, {});
    expect(executeRef.status).toBe(201);
    const execution = await executeRef.json();

    // The route returns the raw TaskExecution row (not the rich detail
    // shape `/execute` returns) — that's intentional: the dogfood scenario
    // only needs the id to drive subsequent steps.
    expect(execution.taskId).toBe(task.id);
    expect(execution.status).toBe("implementing");
    expect(execution.branchId).toBeTruthy();
    expect(execution.startedAt).toBeTruthy();

    // Persisted-state assertions: branch active, task executing, no agent
    // loop side effects.
    const dbExecution = await prisma.taskExecution.findUnique({
      where: { id: execution.id },
    });
    expect(dbExecution?.status).toBe("implementing");
    expect(dbExecution?.policyJson).toBeNull();

    const agentSteps = await prisma.agentStep.findMany({
      where: { taskExecutionId: execution.id },
    });
    expect(agentSteps).toHaveLength(0);

    const decisions = await prisma.modelDecision.findMany({
      where: { taskExecutionId: execution.id },
    });
    expect(decisions).toHaveLength(0);

    const dbTask = await prisma.task.findUnique({ where: { id: task.id } });
    expect(dbTask?.status).toBe("executing");

    const dbBranch = await prisma.taskBranch.findUnique({ where: { id: execution.branchId } });
    expect(dbBranch?.state).toBe("active");

    // task.selected event was logged with mode=headless so the loop bus
    // can distinguish dogfood-driven executions from real agent-driven
    // ones if anyone subscribes to the stream.
    const events = await prisma.loopEvent.findMany({
      where: { taskExecutionId: execution.id, type: "task.selected" },
    });
    expect(events).toHaveLength(1);
    const payload = JSON.parse(events[0]!.payloadJson) as { mode?: string };
    expect(payload.mode).toBe("headless");

    // The git branch is real — prepareTaskBranch ran end-to-end.
    expect(runCommand("git", ["branch", "--show-current"], tempDir).stdout.trim()).not.toBe("main");
  });

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
  });

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
  });

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

async function seedApiTask(
  prisma: PrismaClient,
  rootPath: string,
  options: {
    taskStatus?: string;
    verificationPlanStatus?: string;
  } = {},
) {
  const project = await prisma.project.create({
    data: {
      name: "Validation API Project",
      rootPath,
      baseBranch: "main",
    },
  });
  const plannerRun = await prisma.plannerRun.create({
    data: {
      projectId: project.id,
      goal: "Validate API routes",
      status: "generated",
    },
  });
  const epic = await prisma.epic.create({
    data: {
      projectId: project.id,
      plannerRunId: plannerRun.id,
      key: `VALAPI-${Math.random().toString(36).slice(2)}`,
      title: "Validation API",
      goal: "Expose task validations.",
      status: "planned",
      orderIndex: 0,
      acceptanceJson: "[]",
    },
  });
  const task = await prisma.task.create({
    data: {
      epicId: epic.id,
      stableId: `VALAPI-TASK-${Math.random().toString(36).slice(2)}`,
      title: "Expose validations",
      type: "backend",
      complexity: "medium",
      status: options.taskStatus ?? "ready",
      orderIndex: 0,
      acceptanceJson: JSON.stringify([{ label: "validations are visible" }]),
    },
  });
  const verificationPlan = await prisma.verificationPlan.create({
    data: {
      taskId: task.id,
      status: options.verificationPlanStatus ?? "approved",
      approvedAt: options.verificationPlanStatus === "proposed" ? null : new Date(),
    },
  });

  return {
    project,
    plannerRun,
    epic,
    task,
    verificationPlan,
  };
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

function jiraIssues() {
  return [
    {
      id: "100",
      key: "HC-100",
      self: "https://jira.example.test/browse/HC-100",
      fields: {
        summary: "Import Jira epic",
        description: "Bring Jira issues into TaskGoblin.",
        issuetype: { name: "Epic" },
        status: { name: "To Do" },
      },
    },
    {
      id: "101",
      key: "HC-101",
      self: "https://jira.example.test/browse/HC-101",
      fields: {
        summary: "Build the API route",
        description: "Wire the import service.",
        issuetype: { name: "Task" },
        parent: { key: "HC-100" },
        status: { name: "To Do" },
      },
    },
    {
      id: "102",
      key: "HC-102",
      self: "https://jira.example.test/browse/HC-102",
      fields: {
        summary: "Manual import smoke check",
        description: "Confirm imported tasks are reviewable.",
        issuetype: { name: "Sub-task", subtask: true },
        parent: { key: "HC-101" },
        labels: ["test-type:manual"],
        status: { name: "To Do" },
      },
    },
  ];
}
