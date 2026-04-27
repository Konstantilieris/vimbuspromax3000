import { mkdirSync, writeFileSync } from "node:fs";
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
} from "@vimbuspromax3000/db/testing";
import { setupModelRegistry } from "@vimbuspromax3000/model-registry";
import { createExecutionService } from "@vimbuspromax3000/agent";
import { createTestRunnerService, TestRunnerEligibilityError } from "./index";

describe("test runner TDD red/green loop (VIM-31)", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-test-runner-tdd-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
    initializeGitRepository(tempDir, {
      baseBranch: "main",
      initialFiles: {
        "README.md": "# tdd repo\n",
      },
    });
  }, 30000);

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test("persists exactly two TestRun rows per iteration tagged pre_red and post_green with iterationIndex=1", async () => {
    const env = { VIMBUS_TEST_KEY: "present" };
    const { project, task } = await seedReadyTask(prisma, tempDir, {
      items: [
        {
          kind: "logic",
          title: "logic verification",
          description: "fails red, passes green",
          command: "echo logic",
        },
      ],
    });

    // Phase-aware stub command runner: pre_red exits non-zero (red),
    // post_green exits zero (green). Drives one iteration red -> green.
    const phaseAwareRunner = (input: {
      command: string;
      rootPath: string;
      executionId: string;
      verificationItemId: string;
      orderIndex: number;
      phase?: "pre_red" | "post_green";
    }) => {
      const phase = input.phase ?? "post_green";
      const artifactDirectory = join(
        input.rootPath,
        ".artifacts",
        "executions",
        input.executionId,
        "test-runs",
        `${phase}-${input.orderIndex}-${input.verificationItemId}`,
      );
      mkdirSync(artifactDirectory, { recursive: true });
      const stdoutPath = join(artifactDirectory, "stdout.log").replace(/\\/g, "/");
      const stderrPath = join(artifactDirectory, "stderr.log").replace(/\\/g, "/");
      writeFileSync(stdoutPath, `${phase}: ${input.command}\n`, "utf8");
      writeFileSync(stderrPath, "", "utf8");
      return {
        artifactDirectory: artifactDirectory.replace(/\\/g, "/"),
        // Red on pre_red, green on post_green.
        exitCode: phase === "pre_red" ? 1 : 0,
        stdout: `${phase}: ${input.command}\n`,
        stderr: "",
        stdoutPath,
        stderrPath,
      };
    };

    const { execution, testRunnerService } = await startExecutionForTask(
      prisma,
      project.id,
      task.id,
      env,
      { commandRunner: phaseAwareRunner },
    );

    const result = await testRunnerService.runExecutionVerificationIteration({
      executionId: execution.id,
      iterationIndex: 1,
    });

    expect(result.preRedAborted).toBe(false);

    const allRuns = await prisma.testRun.findMany({
      where: { taskExecutionId: execution.id },
      orderBy: [{ createdAt: "asc" }],
    });

    // Acceptance: exactly two TestRun rows for iteration 1, one per phase.
    const iterOne = allRuns.filter((row) => row.iterationIndex === 1);
    expect(iterOne).toHaveLength(2);

    const preRed = iterOne.find((row) => row.phase === "pre_red");
    const postGreen = iterOne.find((row) => row.phase === "post_green");

    expect(preRed).toBeDefined();
    expect(preRed?.iterationIndex).toBe(1);
    expect(preRed?.status).toBe("failed");
    expect(preRed?.exitCode).toBe(1);

    expect(postGreen).toBeDefined();
    expect(postGreen?.iterationIndex).toBe(1);
    expect(postGreen?.status).toBe("passed");
    expect(postGreen?.exitCode).toBe(0);
  }, 30000);

  test("aborts as tdd_invariant_violated when a logic test passes during pre_red", async () => {
    const env = { VIMBUS_TEST_KEY: "present" };
    const { project, task } = await seedReadyTask(prisma, tempDir, {
      items: [
        {
          kind: "logic",
          title: "premature green logic",
          description: "should never pass before any edits",
          command: "echo invalid-green",
        },
      ],
    });

    // Buggy runner: passes on pre_red (the invariant violation).
    const buggyRunner = (input: {
      command: string;
      rootPath: string;
      executionId: string;
      verificationItemId: string;
      orderIndex: number;
      phase?: "pre_red" | "post_green";
    }) => {
      const phase = input.phase ?? "post_green";
      const artifactDirectory = join(
        input.rootPath,
        ".artifacts",
        "executions",
        input.executionId,
        "test-runs",
        `${phase}-${input.orderIndex}-${input.verificationItemId}`,
      );
      mkdirSync(artifactDirectory, { recursive: true });
      const stdoutPath = join(artifactDirectory, "stdout.log").replace(/\\/g, "/");
      const stderrPath = join(artifactDirectory, "stderr.log").replace(/\\/g, "/");
      writeFileSync(stdoutPath, `${phase}: ${input.command}\n`, "utf8");
      writeFileSync(stderrPath, "", "utf8");
      return {
        artifactDirectory: artifactDirectory.replace(/\\/g, "/"),
        exitCode: 0, // Always green — invariant violation when phase==='pre_red'
        stdout: `${phase}: ${input.command}\n`,
        stderr: "",
        stdoutPath,
        stderrPath,
      };
    };

    const { execution, testRunnerService } = await startExecutionForTask(
      prisma,
      project.id,
      task.id,
      env,
      { commandRunner: buggyRunner },
    );

    const result = await testRunnerService.runExecutionVerificationIteration({
      executionId: execution.id,
      iterationIndex: 1,
    });

    expect(result.preRedAborted).toBe(true);
    expect(result.abortCode).toBe("tdd_invariant_violated");

    // pre_red row must be persisted; post_green must NOT exist for this iteration.
    const allRuns = await prisma.testRun.findMany({
      where: { taskExecutionId: execution.id },
      orderBy: [{ createdAt: "asc" }],
    });
    const iterOne = allRuns.filter((row) => row.iterationIndex === 1);
    const preRed = iterOne.find((row) => row.phase === "pre_red");
    const postGreen = iterOne.find((row) => row.phase === "post_green");

    expect(preRed).toBeDefined();
    expect(postGreen).toBeUndefined();
  }, 30000);

  test("preserves TestRunnerEligibilityError surface on the iteration entry point", async () => {
    const env = { VIMBUS_TEST_KEY: "present" };
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
      where: { taskId: task.id },
      data: { status: "skipped" },
    });

    const { execution, testRunnerService } = await startExecutionForTask(
      prisma,
      project.id,
      task.id,
      env,
    );

    await expect(
      testRunnerService.runExecutionVerificationIteration({
        executionId: execution.id,
        iterationIndex: 1,
      }),
    ).rejects.toBeInstanceOf(TestRunnerEligibilityError);
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
  options: { items: SeedVerificationItem[] },
) {
  const project = await createProject(prisma, {
    name: "TDD Test Runner Project",
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
    summary: "TDD test runner proposal",
    epics: [
      {
        key: "EPIC-TDD-1",
        title: "TDD Verification Runner",
        goal: "Run verification commands in red/green phases",
        tasks: [
          {
            stableId: "TASK-TDD-1",
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

  const tasks = await listTasks(prisma, { projectId: project.id });
  const task = tasks[0];
  if (!task) {
    throw new Error("Expected task to exist.");
  }
  await approveVerificationPlan(prisma, { taskId: task.id });

  return { project, task };
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

  return { execution, testRunnerService };
}
