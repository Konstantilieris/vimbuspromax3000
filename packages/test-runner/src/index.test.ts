import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@vimbuspromax3000/db/client";
import {
  approveVerificationPlan,
  createApprovalDecision,
  createPlannerRun,
  createProject,
  listTasks,
  persistPlannerProposal,
} from "@vimbuspromax3000/db";
import {
  createIsolatedPrisma,
  initializeGitRepository,
  removeTempDir,
  writeProjectFile,
} from "@vimbuspromax3000/db/testing";
import { setupModelRegistry } from "@vimbuspromax3000/model-registry";
import { createExecutionService } from "@vimbuspromax3000/agent";
import { createTestRunnerService, TestRunnerEligibilityError } from "./index";

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
  }, 20000);

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
  }, 20000);

  test("rejects approved visual items without a command with a structured unsupported-items error", async () => {
    const env = {
      VIMBUS_TEST_KEY: "present",
    };
    const { project, task } = await seedReadyTask(prisma, tempDir, {
      items: [
        {
          kind: "visual",
          runner: "playwright",
          title: "login screen visual check",
          description: "captures a login screen comparison",
          command: null,
        },
      ],
    });
    const { execution, testRunnerService } = await startExecutionForTask(prisma, project.id, task.id, env);

    await expect(
      testRunnerService.runExecutionVerification({
        executionId: execution.id,
      }),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_VERIFICATION_ITEMS",
      message: "This execution contains approved verification items that cannot be run by the command runner.",
      items: [
        {
          kind: "visual",
          title: "login screen visual check",
        },
      ],
    });

    await expect(
      testRunnerService.runExecutionVerification({
        executionId: execution.id,
      }),
    ).rejects.toBeInstanceOf(TestRunnerEligibilityError);
  });

  test("rejects approved evidence items without a command with a structured unsupported-items error", async () => {
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

    await expect(
      testRunnerService.runExecutionVerification({
        executionId: execution.id,
      }),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_VERIFICATION_ITEMS",
      message: "This execution contains approved verification items that cannot be run by the command runner.",
      items: [
        {
          kind: "evidence",
          title: "operator evidence capture",
        },
      ],
    });
  });

  test("rejects the whole run when approved command-backed and non-command approved items are mixed", async () => {
    const env = {
      VIMBUS_TEST_KEY: "present",
    };
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
          title: "unsupported visual verification",
          description: "cannot run through the command runner yet",
          command: null,
        },
      ],
    });
    const { execution, testRunnerService } = await startExecutionForTask(prisma, project.id, task.id, env);

    await expect(
      testRunnerService.runExecutionVerification({
        executionId: execution.id,
      }),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_VERIFICATION_ITEMS",
      items: [
        {
          kind: "visual",
          title: "unsupported visual verification",
        },
      ],
    });

    expect(
      await prisma.testRun.count({
        where: {
          taskExecutionId: execution.id,
        },
      }),
    ).toBe(0);

    const storedItems = await prisma.verificationItem.findMany({
      where: {
        taskId: task.id,
      },
      orderBy: [{ orderIndex: "asc" }],
    });
    expect(storedItems.map((item) => item.status)).toEqual(["approved", "approved"]);
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
});

type SeedVerificationItem = {
  kind: string;
  runner?: string | null;
  title: string;
  description: string;
  command?: string | null;
  orderIndex?: number;
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
  });
  const execution = await executionService.startTaskExecution({ taskId });

  return {
    execution,
    testRunnerService,
  };
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
