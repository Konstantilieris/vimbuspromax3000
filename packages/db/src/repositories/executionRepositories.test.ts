import type { PrismaClient } from "../client";
import { createIsolatedPrisma, removeTempDir } from "../testing";
import {
  approveVerificationPlan,
  createApprovalDecision,
  createPatchReview,
  createPlannerRun,
  createProject,
  createTaskBranch,
  createTaskExecution,
  createTestRun,
  getExecutionVerificationRunContext,
  getLatestPatchReview,
  getTaskBranchDetail,
  getTaskExecutionContext,
  getTaskExecutionDetail,
  getTestRun,
  listTaskExecutions,
  listTasks,
  listTestRuns,
  persistPlannerProposal,
  updatePatchReview,
  updateTaskBranch,
  updateTaskExecution,
  updateTestRun,
} from "./index";

describe("execution repositories", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-exec-repo-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  });

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test("stores and loads branch, execution, test run, and patch review state", async () => {
    const { project, task } = await seedReadyTask(prisma, tempDir);
    const taskContext = await getTaskExecutionContext(prisma, task.id);

    expect(taskContext?.epic.project.rootPath).toBe(tempDir);
    expect(taskContext?.latestVerificationPlan?.status).toBe("approved");

    const branch = await createTaskBranch(prisma, {
      taskId: task.id,
      name: "tg/api/TASK-EXEC-1-persist-execution-state",
      base: project.baseBranch,
      state: "created",
      currentHead: "abc123",
    });
    await updateTaskBranch(prisma, branch.id, {
      state: "active",
      currentHead: "def456",
    });

    const execution = await createTaskExecution(prisma, {
      taskId: task.id,
      branchId: branch.id,
      status: "queued",
      startedAt: new Date(),
    });
    await updateTaskExecution(prisma, execution.id, {
      status: "implementing",
      policyJson: JSON.stringify({
        modelResolution: {
          concreteModelName: "openai:gpt-test",
        },
      }),
    });

    const testRun = await createTestRun(prisma, {
      taskExecutionId: execution.id,
      verificationItemId: taskContext?.latestVerificationPlan?.items[0]?.id,
      command: "echo ok",
      status: "running",
      startedAt: new Date(),
    });
    await updateTestRun(prisma, testRun.id, {
      status: "passed",
      exitCode: 0,
      stdoutPath: `${tempDir.replace(/\\/g, "/")}/stdout.log`,
      stderrPath: `${tempDir.replace(/\\/g, "/")}/stderr.log`,
      finishedAt: new Date(),
    });

    const patchReview = await createPatchReview(prisma, {
      taskExecutionId: execution.id,
      status: "ready",
      diffPath: `${tempDir.replace(/\\/g, "/")}/current.diff`,
      summary: "1 file changed, 3 insertions(+)",
    });
    await updatePatchReview(prisma, patchReview.id, {
      status: "approved",
      approvedAt: new Date(),
    });

    const branchDetail = await getTaskBranchDetail(prisma, task.id);
    const executionDetail = await getTaskExecutionDetail(prisma, execution.id);
    const storedTestRun = await getTestRun(prisma, testRun.id);
    const listedExecutions = await listTaskExecutions(prisma, {
      taskId: task.id,
    });
    const listedTestRuns = await listTestRuns(prisma, {
      taskExecutionId: execution.id,
    });
    const latestPatchReview = await getLatestPatchReview(prisma, execution.id);

    expect(branchDetail?.state).toBe("active");
    expect(branchDetail?.latestExecution?.id).toBe(execution.id);
    expect(executionDetail?.status).toBe("implementing");
    expect(executionDetail?.latestVerificationPlan?.items).toHaveLength(1);
    expect(executionDetail?.policy).toMatchObject({
      modelResolution: {
        concreteModelName: "openai:gpt-test",
      },
    });
    expect(storedTestRun?.status).toBe("passed");
    expect(listedExecutions).toHaveLength(1);
    expect(listedTestRuns).toHaveLength(1);
    expect(latestPatchReview?.status).toBe("approved");
  });

  test("loads the latest approved verification plan and approved items for verification runs", async () => {
    const { project, task } = await seedReadyTask(prisma, tempDir);
    const branch = await createTaskBranch(prisma, {
      taskId: task.id,
      name: "tg/api/TASK-EXEC-1-verification-context",
      base: project.baseBranch,
      state: "active",
      currentHead: "abc123",
    });
    const execution = await createTaskExecution(prisma, {
      taskId: task.id,
      branchId: branch.id,
      status: "implementing",
      startedAt: new Date(),
    });

    const proposedPlan = await prisma.verificationPlan.create({
      data: {
        taskId: task.id,
        rationale: "Newer proposed plan",
        status: "proposed",
      },
    });
    await prisma.verificationItem.create({
      data: {
        taskId: task.id,
        planId: proposedPlan.id,
        kind: "visual",
        runner: "playwright",
        title: "newer proposed item",
        description: "should not be selected for execution",
        status: "proposed",
        orderIndex: 0,
      },
    });

    const context = await getExecutionVerificationRunContext(prisma, execution.id);

    expect(context?.latestApprovedVerificationPlan?.status).toBe("approved");
    expect(context?.latestApprovedVerificationPlan?.items).toHaveLength(1);
    expect(context?.latestApprovedVerificationPlan?.items[0]).toMatchObject({
      status: "approved",
      title: "execution verification",
    });
  });
});

async function seedReadyTask(prisma: PrismaClient, rootPath: string) {
  const project = await createProject(prisma, {
    name: "Execution Repository Project",
    rootPath,
    baseBranch: "main",
  });
  const plannerRun = await createPlannerRun(prisma, {
    projectId: project.id,
    goal: "Persist execution state",
    moduleName: "api",
  });

  await persistPlannerProposal(prisma, {
    plannerRunId: plannerRun.id,
    summary: "Execution repository proposal",
    epics: [
      {
        key: "EPIC-EXEC-1",
        title: "Execution Repository",
        goal: "Persist execution rows",
        tasks: [
          {
            stableId: "TASK-EXEC-1",
            title: "Persist execution state",
            type: "backend",
            complexity: "medium",
            acceptance: [{ label: "execution persisted" }],
            verificationPlan: {
              items: [
                {
                  kind: "logic",
                  runner: "custom",
                  title: "execution verification",
                  description: "stores branch and execution records",
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
    throw new Error("Expected a task to be created.");
  }

  await approveVerificationPlan(prisma, {
    taskId: task.id,
  });

  return {
    project,
    task,
  };
}
