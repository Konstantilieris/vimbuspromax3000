import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@vimbuspromax3000/db/client";
import {
  approveVerificationPlan,
  createApprovalDecision,
  createPlannerRun,
  createProject,
  approveSourceAsset,
  createSourceAsset,
  listTasks,
  listTestRuns,
  listVisualVerificationResults,
  persistPlannerProposal,
  updateVerificationItemExpectedAsset,
} from "@vimbuspromax3000/db";
import {
  createIsolatedPrisma,
  initializeGitRepository,
  removeTempDir,
  writeProjectFile,
} from "@vimbuspromax3000/db/testing";
import { setupModelRegistry } from "@vimbuspromax3000/model-registry";
import { createExecutionService } from "@vimbuspromax3000/agent";
import { createTestRunnerService } from "./index";

describe("test runner service", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-test-runner-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
    initializeGitRepository(tempDir, {
      baseBranch: "main",
      initialFiles: {
        "README.md": "# verification repo\n",
      },
    });
  });

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test("allows approved command-backed items, including evidence items, and persists deterministic artifacts", async () => {
    const env = {
      VIMBUS_TEST_KEY: "present",
    };
    const { project, task } = await seedReadyTask(prisma, tempDir, {
      items: [
        {
          kind: "logic",
          title: "logic verification",
          description: "runs the first deterministic command",
          command: "echo verification-one",
        },
        {
          kind: "evidence",
          title: "evidence verification",
          description: "runs the second deterministic command",
          command: "echo verification-two",
        },
      ],
    });
    const { execution, testRunnerService } = await startExecutionForTask(prisma, project.id, task.id, env);

    writeProjectFile(tempDir, "README.md", "# verification repo\nupdated verification output\n");

    const testRuns = await testRunnerService.runExecutionVerification({
      executionId: execution.id,
    });

    expect(testRuns).toHaveLength(2);
    expect(testRuns.map((testRun) => testRun.status)).toEqual(["passed", "passed"]);
    expect(testRuns[0]?.command).toBe("echo verification-one");
    expect(testRuns[1]?.command).toBe("echo verification-two");
    expect(testRuns[0]?.stdoutPath && existsSync(testRuns[0].stdoutPath)).toBe(true);
    expect(testRuns[1]?.stdoutPath && existsSync(testRuns[1].stdoutPath)).toBe(true);
    expect(readFileSync(testRuns[0]?.stdoutPath ?? "", "utf8")).toContain("verification-one");
    expect(readFileSync(testRuns[1]?.stdoutPath ?? "", "utf8")).toContain("verification-two");

    const firstMetaPath = join(
      tempDir,
      ".artifacts",
      "executions",
      execution.id,
      "test-runs",
      `0-${testRuns[0]?.verificationItem?.id}`,
      "meta.json",
    );
    const secondMetaPath = join(
      tempDir,
      ".artifacts",
      "executions",
      execution.id,
      "test-runs",
      `1-${testRuns[1]?.verificationItem?.id}`,
      "meta.json",
    );
    const firstMeta = JSON.parse(readFileSync(firstMetaPath, "utf8"));
    const secondMeta = JSON.parse(readFileSync(secondMetaPath, "utf8"));

    expect(firstMeta).toMatchObject({
      executionId: execution.id,
      verificationItemId: testRuns[0]?.verificationItem?.id,
      orderIndex: 0,
      kind: "logic",
      title: "logic verification",
      command: "echo verification-one",
      exitCode: 0,
      status: "passed",
    });
    expect(secondMeta).toMatchObject({
      executionId: execution.id,
      verificationItemId: testRuns[1]?.verificationItem?.id,
      orderIndex: 1,
      kind: "evidence",
      title: "evidence verification",
      command: "echo verification-two",
      exitCode: 0,
      status: "passed",
    });

    const updatedExecution = await prisma.taskExecution.findUnique({
      where: { id: execution.id },
    });
    const updatedTask = await prisma.task.findUnique({
      where: { id: task.id },
    });
    const updatedBranch = await prisma.taskBranch.findUnique({
      where: { id: execution.branch.id },
    });
    const patchReview = await prisma.patchReview.findFirst({
      where: {
        taskExecutionId: execution.id,
      },
      orderBy: [{ createdAt: "desc" }],
    });

    expect(updatedExecution?.status).toBe("patch_ready");
    expect(updatedTask?.status).toBe("awaiting_patch_approval");
    expect(updatedBranch?.state).toBe("verified");
    expect(patchReview?.status).toBe("ready");
    expect(patchReview?.summary).toContain("file");
    expect(patchReview?.diffPath && existsSync(patchReview.diffPath)).toBe(true);
  }, 60000);

  test.each([
    { kind: "visual", assetKind: "image", mode: "asset-presence" },
    { kind: "pdf", assetKind: "pdf", mode: "pdf-render" },
    { kind: "manual-evidence", assetKind: "manual_evidence", mode: "manual-evidence" },
    { kind: "evidence", assetKind: "manual_evidence", mode: "manual-evidence" },
  ])("handles approved $kind items without a command through visual verification", async ({ kind, assetKind, mode }) => {
    const env = {
      VIMBUS_TEST_KEY: "present",
    };
    const { project, task } = await seedReadyTask(prisma, tempDir, {
      items: [
        {
          kind,
          runner: "custom",
          title: `${kind} source check`,
          description: "uses approved source-of-truth evidence",
          command: null,
        },
      ],
    });
    const item = await getOnlyVerificationItem(prisma, task.id);
    await attachApprovedSourceAsset(prisma, {
      projectId: project.id,
      taskId: task.id,
      verificationItemId: item.id,
      kind: assetKind,
      relativePath: `docs/assets/${kind}.png`,
      mimeType: assetKind === "pdf" ? "application/pdf" : "image/png",
    });
    const { execution, testRunnerService } = await startExecutionForTask(prisma, project.id, task.id, env);

    const testRuns = await testRunnerService.runExecutionVerification({
      executionId: execution.id,
    });
    const visualResults = await listVisualVerificationResults(prisma, {
      taskExecutionId: execution.id,
    });
    const storedItems = await prisma.verificationItem.findMany({
      where: {
        taskId: task.id,
      },
    });

    expect(testRuns).toHaveLength(0);
    expect(visualResults).toHaveLength(1);
    expect(visualResults[0]?.mode).toBe(mode);
    expect(visualResults[0]?.status).toBe("passed");
    expect(storedItems.map((storedItem) => storedItem.status)).toEqual(["green"]);
  });

  test("blocks approved evidence items without approved source assets instead of rejecting them as unsupported", async () => {
    const env = {
      VIMBUS_TEST_KEY: "present",
    };
    const { project, task } = await seedReadyTask(prisma, tempDir, {
      items: [
        {
          kind: "evidence",
          title: "operator evidence capture",
          description: "stores a manual evidence artifact",
          command: null,
        },
      ],
    });
    const { execution, testRunnerService } = await startExecutionForTask(prisma, project.id, task.id, env);

    const testRuns = await testRunnerService.runExecutionVerification({
      executionId: execution.id,
    });
    const visualResults = await listVisualVerificationResults(prisma, {
      taskExecutionId: execution.id,
    });
    const updatedExecution = await prisma.taskExecution.findUnique({
      where: { id: execution.id },
    });

    expect(testRuns).toHaveLength(0);
    expect(visualResults).toHaveLength(1);
    expect(visualResults[0]?.mode).toBe("manual-evidence");
    expect(visualResults[0]?.status).toBe("blocked");
    expect(updatedExecution?.status).toBe("failed");
  });

  test("runs command-backed items and non-command visual items in one verification pass", async () => {
    const env = {
      VIMBUS_TEST_KEY: "present",
    };
    const seenCommands: string[] = [];
    const { project, task } = await seedReadyTask(prisma, tempDir, {
      items: [
        {
          kind: "logic",
          title: "command verification",
          description: "runs a deterministic command",
          command: "echo allowed",
        },
        {
          kind: "visual",
          runner: "playwright",
          title: "source asset verification",
          description: "uses an approved visual source asset",
          command: null,
        },
      ],
    });
    const visualItem = await prisma.verificationItem.findFirstOrThrow({
      where: {
        taskId: task.id,
        kind: "visual",
      },
    });
    await attachApprovedSourceAsset(prisma, {
      projectId: project.id,
      taskId: task.id,
      verificationItemId: visualItem.id,
      kind: "image",
      relativePath: "docs/assets/source-check.png",
      mimeType: "image/png",
    });
    const { execution, testRunnerService } = await startExecutionForTask(prisma, project.id, task.id, env, {
      commandRunner: createStubCommandRunner(tempDir, seenCommands),
    });

    const testRuns = await testRunnerService.runExecutionVerification({
      executionId: execution.id,
    });
    const visualResults = await listVisualVerificationResults(prisma, {
      taskExecutionId: execution.id,
    });

    const storedItems = await prisma.verificationItem.findMany({
      where: {
        taskId: task.id,
      },
      orderBy: [{ orderIndex: "asc" }],
    });

    expect(seenCommands).toEqual(["echo allowed"]);
    expect(testRuns).toHaveLength(1);
    expect(visualResults).toHaveLength(1);
    expect(visualResults[0]?.status).toBe("passed");
    expect(storedItems.map((item) => item.status)).toEqual(["green", "green"]);
  });

  test("rejects when the latest approved plan has zero approved verification items", async () => {
    const env = {
      VIMBUS_TEST_KEY: "present",
    };
    const { project, task } = await seedReadyTask(prisma, tempDir, {
      items: [
        {
          kind: "logic",
          title: "skipped verification",
          description: "starts approved and is later skipped",
          command: "echo skipped",
        },
      ],
    });

    await prisma.verificationItem.updateMany({
      where: {
        taskId: task.id,
      },
      data: {
        status: "skipped",
      },
    });

    const { execution, testRunnerService } = await startExecutionForTask(prisma, project.id, task.id, env);

    await expect(
      testRunnerService.runExecutionVerification({
        executionId: execution.id,
      }),
    ).rejects.toMatchObject({
      code: "NO_APPROVED_VERIFICATION_ITEMS",
      message: "This execution has no approved verification items to run.",
      items: [],
    });
  });

  test("runs multiple approved commands in order and updates execution state", async () => {
    const env = {
      VIMBUS_TEST_KEY: "present",
    };
    const seenCommands: string[] = [];
    const { project, task } = await seedReadyTask(prisma, tempDir, {
      items: [
        {
          kind: "logic",
          title: "third command",
          description: "runs third by order index",
          command: "echo third",
          orderIndex: 2,
        },
        {
          kind: "integration",
          title: "first command",
          description: "runs first by order index",
          command: "echo first",
          orderIndex: 0,
        },
        {
          kind: "typecheck",
          title: "second command",
          description: "runs second by order index",
          command: "echo second",
          orderIndex: 1,
        },
      ],
    });
    const { execution, testRunnerService } = await startExecutionForTask(prisma, project.id, task.id, env, {
      commandRunner: createStubCommandRunner(tempDir, seenCommands),
    });

    const testRuns = await testRunnerService.runExecutionVerification({
      executionId: execution.id,
    });

    expect(seenCommands).toEqual(["echo first", "echo second", "echo third"]);
    expect(testRuns.map((testRun) => testRun.command)).toEqual(["echo first", "echo second", "echo third"]);
    expect(testRuns.map((testRun) => testRun.status)).toEqual(["passed", "passed", "passed"]);

    const storedItems = await prisma.verificationItem.findMany({
      where: {
        taskId: task.id,
      },
      orderBy: [{ orderIndex: "asc" }],
    });
    expect(storedItems.map((item) => item.status)).toEqual(["green", "green", "green"]);

    const updatedExecution = await prisma.taskExecution.findUnique({
      where: { id: execution.id },
    });
    const updatedTask = await prisma.task.findUnique({
      where: { id: task.id },
    });
    const updatedBranch = await prisma.taskBranch.findUnique({
      where: { id: execution.branch.id },
    });

    expect(updatedExecution?.status).toBe("patch_ready");
    expect(updatedTask?.status).toBe("awaiting_patch_approval");
    expect(updatedBranch?.state).toBe("verified");
  });

  test("accepts Playwright CLI commands as normal command-backed verification items", async () => {
    const env = {
      VIMBUS_TEST_KEY: "present",
    };
    const seenCommands: string[] = [];
    const playwrightCommand = "pnpm playwright test tests/login.spec.ts";
    const { project, task } = await seedReadyTask(prisma, tempDir, {
      items: [
        {
          kind: "visual",
          runner: "playwright",
          title: "login flow visual regression",
          description: "runs Playwright through the shell",
          command: playwrightCommand,
        },
      ],
    });
    const { execution, testRunnerService } = await startExecutionForTask(prisma, project.id, task.id, env, {
      commandRunner: createStubCommandRunner(tempDir, seenCommands),
    });

    const testRuns = await testRunnerService.runExecutionVerification({
      executionId: execution.id,
    });

    expect(seenCommands).toEqual([playwrightCommand]);
    expect(testRuns).toHaveLength(1);
    expect(testRuns[0]?.command).toBe(playwrightCommand);
    expect(testRuns[0]?.status).toBe("passed");
    expect(testRuns[0]?.verificationItem?.kind).toBe("visual");
  });

  test("runs a11y items through the browser runner and stores axe evidence on the test run", async () => {
    const env = {
      VIMBUS_TEST_KEY: "present",
    };
    const browserRunner = createStubBrowserRunner(tempDir, {
      axeViolations: [
        {
          id: "image-alt",
          impact: "serious",
          description: "Images must have alternate text.",
        },
      ],
    });
    const { project, task } = await seedReadyTask(prisma, tempDir, {
      items: [
        {
          kind: "a11y",
          runner: "axe",
          title: "home accessibility",
          description: "runs axe against the page",
          command: null,
          route: "data:text/html,<img src='x.png'>",
        },
      ],
    });
    const { execution, testRunnerService } = await startExecutionForTask(prisma, project.id, task.id, env, {
      browserRunner,
    });

    const testRuns = await testRunnerService.runExecutionVerification({
      executionId: execution.id,
    });
    const storedRuns = await listTestRuns(prisma, {
      taskExecutionId: execution.id,
    });

    expect(testRuns).toHaveLength(1);
    expect(testRuns[0]?.status).toBe("failed");
    expect(storedRuns[0]?.evidenceJson).toContain("image-alt");
    expect(browserRunner.runAxe).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "data:text/html,<img src='x.png'>",
      }),
    );
  });

  test("runs browser visual items with a target URL as screenshot diff checks", async () => {
    const env = {
      VIMBUS_TEST_KEY: "present",
    };
    const browserRunner = createStubBrowserRunner(tempDir);
    const { project, task } = await seedReadyTask(prisma, tempDir, {
      items: [
        {
          kind: "visual",
          runner: "playwright",
          title: "home screenshot",
          description: "captures and diffs a page",
          command: null,
          route: "data:text/html,<main>ok</main>",
          config: {
            threshold: 0.05,
          },
        },
      ],
    });
    const item = await getOnlyVerificationItem(prisma, task.id);
    await attachApprovedSourceAsset(prisma, {
      projectId: project.id,
      taskId: task.id,
      verificationItemId: item.id,
      kind: "image",
      relativePath: "docs/assets/home.png",
      mimeType: "image/png",
    });
    const { execution, testRunnerService } = await startExecutionForTask(prisma, project.id, task.id, env, {
      browserRunner,
    });

    const testRuns = await testRunnerService.runExecutionVerification({
      executionId: execution.id,
    });
    const visualResults = await listVisualVerificationResults(prisma, {
      taskExecutionId: execution.id,
    });

    expect(testRuns).toHaveLength(0);
    expect(visualResults).toHaveLength(1);
    expect(visualResults[0]?.status).toBe("passed");
    expect(visualResults[0]?.mode).toBe("screenshot");
    expect(visualResults[0]?.diffRatio).toBe(0);
    expect(visualResults[0]?.threshold).toBe(0.05);
    expect(browserRunner.navigate).toHaveBeenCalled();
    expect(browserRunner.screenshot).toHaveBeenCalled();
    expect(browserRunner.compareImages).toHaveBeenCalled();
  });
});

type SeedVerificationItem = {
  kind: string;
  runner?: string | null;
  title: string;
  description: string;
  command?: string | null;
  orderIndex?: number;
  route?: string | null;
  config?: Record<string, unknown> | null;
};

async function seedReadyTask(
  prisma: PrismaClient,
  rootPath: string,
  options: {
    items: SeedVerificationItem[];
  },
) {
  const project = await createProject(prisma, {
    name: "Test Runner Project",
    rootPath,
    baseBranch: "main",
  });
  const plannerRun = await createPlannerRun(prisma, {
    projectId: project.id,
    goal: "Run verification",
    moduleName: "api",
  });

  await persistPlannerProposal(prisma, {
    plannerRunId: plannerRun.id,
    summary: "Test runner proposal",
    epics: [
      {
        key: "EPIC-TEST-1",
        title: "Verification Runner",
        goal: "Run verification commands",
        tasks: [
          {
            stableId: "TASK-TEST-1",
            title: "Run verification command",
            type: "backend",
            complexity: "medium",
            acceptance: [{ label: "verification command runs" }],
            verificationPlan: {
              items: options.items.map((item, index) => ({
                kind: item.kind,
                runner: item.runner ?? "custom",
                title: item.title,
                description: item.description,
                command: item.command ?? null,
                orderIndex: item.orderIndex ?? index,
                route: item.route ?? null,
                config: item.config ?? undefined,
              })),
            },
          },
        ],
      },
    ],
  });

  await createApprovalDecision(prisma, {
    projectId: project.id,
    subjectType: "planner_run",
    subjectId: plannerRun.id,
    stage: "planner_review",
    status: "granted",
  });

  const tasks = await listTasks(prisma, {
    projectId: project.id,
  });
  const task = tasks[0];

  if (!task) {
    throw new Error("Expected task to exist.");
  }

  await approveVerificationPlan(prisma, {
    taskId: task.id,
  });

  return {
    project,
    task,
  };
}

async function startExecutionForTask(
  prisma: PrismaClient,
  projectId: string,
  taskId: string,
  env: Record<string, string>,
  options: {
    commandRunner?: Parameters<typeof createTestRunnerService>[0]["commandRunner"];
    browserRunner?: Parameters<typeof createTestRunnerService>[0]["browserRunner"];
  } = {},
) {
  await setupModelRegistry(prisma, {
    projectId,
    providerKey: "openai",
    providerKind: "openai",
    providerStatus: "active",
    secretEnv: "VIMBUS_TEST_KEY",
    modelName: "GPT Test",
    modelSlug: "gpt-test",
    capabilities: ["json"],
    slotKeys: ["executor_default"],
  });

  const executionService = createExecutionService({ prisma, env });
  const testRunnerService = createTestRunnerService({
    prisma,
    commandRunner: options.commandRunner,
    browserRunner: options.browserRunner,
  });
  const execution = await executionService.startTaskExecution({ taskId });

  return {
    execution,
    testRunnerService,
  };
}

function createStubBrowserRunner(
  rootPath: string,
  options: {
    axeViolations?: Array<{ id: string; impact?: string; description?: string }>;
  } = {},
): NonNullable<Parameters<typeof createTestRunnerService>[0]["browserRunner"]> {
  return {
    navigate: vi.fn(async (input) => ({
      url: input.url,
      title: "Fixture",
      status: 200,
    })),
    screenshot: vi.fn(async (input) => {
      mkdirSync(join(rootPath, ".artifacts"), { recursive: true });
      writeFileSync(input.outputPath, "fake-png", "utf8");
      return {
        path: input.outputPath,
        viewport: input.viewport ?? { width: 1280, height: 720 },
        bytes: 8,
      };
    }),
    runAxe: vi.fn(async (input) => ({
      url: input.url,
      violations: options.axeViolations ?? [],
      violationCount: options.axeViolations?.length ?? 0,
    })),
    compareImages: vi.fn(async () => ({
      matched: true,
      diffPixels: 0,
      totalPixels: 100,
    })),
  };
}

async function getOnlyVerificationItem(prisma: PrismaClient, taskId: string) {
  const item = await prisma.verificationItem.findFirst({
    where: {
      taskId,
    },
    orderBy: [{ orderIndex: "asc" }],
  });

  if (!item) {
    throw new Error("Expected verification item to exist.");
  }

  return item;
}

async function attachApprovedSourceAsset(
  prisma: PrismaClient,
  input: {
    projectId: string;
    taskId: string;
    verificationItemId: string;
    kind: string;
    relativePath: string;
    mimeType: string;
  },
) {
  const asset = await createSourceAsset(prisma, {
    projectId: input.projectId,
    taskId: input.taskId,
    verificationItemId: input.verificationItemId,
    kind: input.kind,
    relativePath: input.relativePath,
    mimeType: input.mimeType,
    sha256: randomUUID().replace(/-/g, "").padEnd(64, "0"),
    metadataJson: JSON.stringify({
      testFixture: true,
    }),
  });
  const approvedAsset = await approveSourceAsset(prisma, asset.id);

  await updateVerificationItemExpectedAsset(prisma, {
    verificationItemId: input.verificationItemId,
    expectedAssetId: approvedAsset.id,
  });

  return approvedAsset;
}

function createStubCommandRunner(rootPath: string, seenCommands: string[]) {
  return (input: {
    command: string;
    rootPath: string;
    executionId: string;
    verificationItemId: string;
    orderIndex: number;
  }) => {
    seenCommands.push(input.command);

    const artifactDirectory = join(
      rootPath,
      ".artifacts",
      "executions",
      input.executionId,
      "test-runs",
      `${input.orderIndex}-${input.verificationItemId}`,
    );

    mkdirSync(artifactDirectory, { recursive: true });

    const stdoutPath = join(artifactDirectory, "stdout.log").replace(/\\/g, "/");
    const stderrPath = join(artifactDirectory, "stderr.log").replace(/\\/g, "/");
    const stdout = `stubbed: ${input.command}\n`;
    const stderr = "";

    writeFileSync(stdoutPath, stdout, "utf8");
    writeFileSync(stderrPath, stderr, "utf8");

    return {
      artifactDirectory: artifactDirectory.replace(/\\/g, "/"),
      exitCode: 0,
      stdout,
      stderr,
      stdoutPath,
      stderrPath,
    };
  };
}
