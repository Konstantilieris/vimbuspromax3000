import type { PrismaClient } from "../client";
import { createIsolatedPrisma, removeTempDir } from "../testing";
import {
  approveVerificationPlan,
  createApprovalDecision,
  createPlannerRun,
  createProject,
  createValidation,
  getTaskDetail,
  listTasks,
  persistPlannerProposal,
  refreshTaskReadiness,
} from "./index";

describe("planner validation continuation", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-planner-validation-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  });

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test("dual-writes validations and derives readiness from validation approvals", async () => {
    const project = await createProject(prisma, {
      name: "Planner Validation Project",
      rootPath: tempDir,
    });
    const plannerRun = await createPlannerRun(prisma, {
      projectId: project.id,
      goal: "Persist validation-ready planner proposal",
    });
    const taskAcceptance = [{ label: "task acceptance copied" }];
    const explicitAcceptance = [{ label: "explicit validation acceptance" }];

    await persistPlannerProposal(prisma, {
      plannerRunId: plannerRun.id,
      epics: [
        {
          key: "EPIC-PLAN-VAL-1",
          title: "Planner validation",
          goal: "Persist linked validations",
          tasks: [
            {
              stableId: "TASK-PLAN-VAL-1",
              title: "Dual-write validations",
              type: "backend",
              complexity: "medium",
              acceptance: taskAcceptance,
              validations: [
                {
                  verificationItemIndex: 0,
                  title: "Explicit validation override",
                  testType: "logic",
                  acceptanceCriteria: explicitAcceptance,
                },
              ],
              verificationPlan: {
                items: [
                  {
                    kind: "logic",
                    runner: "vitest",
                    title: "legacy unit item",
                    description: "Legacy item with explicit validation override",
                    command: "bun run test:vitest",
                  },
                  {
                    kind: "visual",
                    runner: "playwright",
                    title: "legacy browser item",
                    description: "Legacy item that derives a validation",
                    command: "bunx playwright test",
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

    const tasks = await listTasks(prisma, { projectId: project.id });
    const task = tasks[0];
    if (!task) {
      throw new Error("Expected planner proposal to create a task.");
    }

    const verificationItems = task.verificationPlans[0]?.items ?? [];
    const validations = await prisma.validation.findMany({
      where: { taskId: task.id },
      orderBy: [{ orderIndex: "asc" }],
    });

    expect(validations).toHaveLength(2);
    expect(validations[0]).toMatchObject({
      verificationItemId: verificationItems[0]?.id,
      legacyVerificationItemId: verificationItems[0]?.id,
      title: "Explicit validation override",
      testType: "logic",
      acceptanceCriteriaJson: JSON.stringify(explicitAcceptance),
      status: "proposed",
    });
    expect(validations[1]).toMatchObject({
      verificationItemId: verificationItems[1]?.id,
      legacyVerificationItemId: verificationItems[1]?.id,
      testType: "playwright",
      acceptanceCriteriaJson: JSON.stringify(taskAcceptance),
      status: "proposed",
    });

    const extraValidation = await createValidation(prisma, {
      taskId: task.id,
      testType: "manual",
      title: "Manual acceptance",
    });

    await approveVerificationPlan(prisma, { taskId: task.id, operator: "ak" });
    const blockedTask = await getTaskDetail(prisma, task.id);
    const linkedValidations = await prisma.validation.findMany({
      where: {
        taskId: task.id,
        verificationItemId: { not: null },
      },
    });

    expect(linkedValidations.every((validation) => validation.status === "approved")).toBe(true);
    expect(blockedTask?.status).toBe("awaiting_verification_approval");

    await prisma.validation.update({
      where: { id: extraValidation.id },
      data: { status: "approved" },
    });
    await refreshTaskReadiness(prisma, task.id);

    const readyTask = await getTaskDetail(prisma, task.id);
    expect(readyTask?.status).toBe("ready");
  });
});
