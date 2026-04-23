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
  runCommand,
  writeProjectFile,
} from "@vimbuspromax3000/db/testing";
import { setupModelRegistry } from "@vimbuspromax3000/model-registry";
import { createExecutionService } from "./index";

describe("execution service", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-agent-exec-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
    initializeGitRepository(tempDir, {
      baseBranch: "main",
      initialFiles: {
        "README.md": "# temp repo\n",
      },
    });
  }, 20000);

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test("prepares a deterministic task branch and reuses it on subsequent calls", async () => {
    const { task } = await seedReadyTask(prisma, tempDir, {
      moduleName: "api",
      title: "Persist execution state",
    });
    const service = createExecutionService({ prisma });

    const firstBranch = await service.prepareTaskBranch({ taskId: task.id });
    const secondBranch = await service.prepareTaskBranch({ taskId: task.id });

    expect(firstBranch?.name).toBe("tg/api/TASK-EXEC-1-persist-execution-state");
    expect(secondBranch?.id).toBe(firstBranch?.id);
    expect(runCommand("git", ["branch", "--show-current"], tempDir).stdout.trim()).toBe(firstBranch?.name);
  }, 20000);

  test("blocks branch preparation when the worktree is dirty", async () => {
    const { task } = await seedReadyTask(prisma, tempDir);
    const service = createExecutionService({ prisma });

    writeProjectFile(tempDir, "dirty.txt", "pending\n");

    await expect(service.prepareTaskBranch({ taskId: task.id })).rejects.toThrow("clean git worktree");
  });

  test("fails branch preparation when the configured base branch does not exist", async () => {
    const { task } = await seedReadyTask(prisma, tempDir, {
      baseBranch: "release",
    });
    const service = createExecutionService({ prisma });

    await expect(service.prepareTaskBranch({ taskId: task.id })).rejects.toThrow(
      "Base branch release was not found",
    );
  });

  test("starts execution and persists model snapshot, branch, and agent-step state", async () => {
    const env = {
      VIMBUS_TEST_KEY: "present",
    };
    const { project, task } = await seedReadyTask(prisma, tempDir);
    await setupModelRegistry(prisma, {
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

    const service = createExecutionService({ prisma, env });
    const execution = await service.startTaskExecution({ taskId: task.id });

    expect(execution.status).toBe("implementing");
    expect(execution.branch.state).toBe("active");
    expect(execution.task.status).toBe("executing");
    expect(execution.latestAgentStep?.status).toBe("started");
    expect(execution.latestAgentStep?.modelName).toBe("openai:gpt-test");
    expect(execution.policy).toMatchObject({
      modelResolution: {
        concreteModelName: "openai:gpt-test",
      },
    });
    expect(runCommand("git", ["branch", "--show-current"], tempDir).stdout.trim()).toBe(execution.branch.name);

    const decisions = await prisma.modelDecision.findMany({
      where: {
        taskExecutionId: execution.id,
      },
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.selectedModel).toBe("openai:gpt-test");
  }, 20000);
});

async function seedReadyTask(
  prisma: PrismaClient,
  rootPath: string,
  options: {
    baseBranch?: string;
    moduleName?: string | null;
    title?: string;
  } = {},
) {
  const project = await createProject(prisma, {
    name: "Execution Service Project",
    rootPath,
    baseBranch: options.baseBranch ?? "main",
  });
  const plannerRun = await createPlannerRun(prisma, {
    projectId: project.id,
    goal: "Prepare task branch",
    moduleName: options.moduleName ?? "api",
  });

  await persistPlannerProposal(prisma, {
    plannerRunId: plannerRun.id,
    summary: "Execution service proposal",
    epics: [
      {
        key: "EPIC-EXEC-1",
        title: "Execution Service",
        goal: "Prepare and execute one task",
        tasks: [
          {
            stableId: "TASK-EXEC-1",
            title: options.title ?? "Persist execution state",
            type: "backend",
            complexity: "medium",
            acceptance: [{ label: "execution started" }],
            verificationPlan: {
              items: [
                {
                  kind: "logic",
                  runner: "custom",
                  title: "execution verification",
                  description: "verifies the execution service",
                  command: "echo ok",
                },
              ],
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
