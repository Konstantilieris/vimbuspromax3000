import type { PrismaClient } from "../client";
import { createIsolatedPrisma, removeTempDir } from "../testing";
import {
  appendLoopEvent,
  approveVerificationPlan,
  createApprovalDecision,
  createPlannerRun,
  createProject,
  findProjectByRootPath,
  getPlannerRunDetail,
  getTaskDetail,
  listLoopEvents,
  listProjects,
  listTasks,
  persistPlannerProposal,
  updatePlannerInterview,
} from "./index";

describe("db repositories", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-repo-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  });

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test("creates, lists, and finds projects", async () => {
    const project = await createProject(prisma, {
      name: "Repo Project",
      rootPath: tempDir,
    });

    const projects = await listProjects(prisma);
    const foundByRootPath = await findProjectByRootPath(prisma, tempDir);

    expect(projects.map((item) => item.id)).toContain(project.id);
    expect(foundByRootPath?.id).toBe(project.id);
  });

  test("creates planner runs, merges interview state, and persists proposal payloads", async () => {
    const project = await createProject(prisma, {
      name: "Planner Repo",
      rootPath: tempDir,
    });
    const plannerRun = await createPlannerRun(prisma, {
      projectId: project.id,
      goal: "Persist proposal",
    });

    const updatedInterview = await updatePlannerInterview(prisma, {
      plannerRunId: plannerRun.id,
      answers: {
        scope: { module: "api" },
        verification: { kinds: ["logic"] },
      },
    });
    expect(updatedInterview.interview.scope).toEqual({ module: "api" });

    await persistPlannerProposal(prisma, {
      plannerRunId: plannerRun.id,
      summary: "Persist backend proposal",
      epics: [buildPlannerEpicPayload()],
    });

    const detail = await getPlannerRunDetail(prisma, plannerRun.id);
    expect(detail?.status).toBe("generated");
    expect(detail?.proposalSummary.epicCount).toBe(1);
    expect(detail?.proposalSummary.taskCount).toBe(1);
    expect(detail?.epics[0]?.tasks[0]?.verificationPlans[0]?.items).toHaveLength(1);
  });

  test("approval side effects advance planner and verification state in order", async () => {
    const { project, plannerRun, task } = await seedGeneratedPlannerRun(prisma, tempDir);

    await createApprovalDecision(prisma, {
      projectId: project.id,
      subjectType: "planner_run",
      subjectId: plannerRun.id,
      stage: "planner_review",
      status: "granted",
    });

    const plannedTask = await getTaskDetail(prisma, task.id);
    expect(plannedTask?.status).toBe("awaiting_verification_approval");

    const approvedTask = await approveVerificationPlan(prisma, {
      taskId: task.id,
      operator: "ak",
    });

    expect(approvedTask?.status).toBe("ready");
    expect(approvedTask?.latestVerificationPlan?.status).toBe("approved");
  });

  test("lists tasks and loop events for a generated planner run", async () => {
    const { project, plannerRun, task } = await seedGeneratedPlannerRun(prisma, tempDir);

    await appendLoopEvent(prisma, {
      projectId: project.id,
      type: "task.selected",
      payload: {
        taskId: task.id,
      },
    });

    const tasks = await listTasks(prisma, {
      projectId: project.id,
      plannerRunId: plannerRun.id,
      status: "planned",
    });
    const events = await listLoopEvents(prisma, {
      projectId: project.id,
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.id).toBe(task.id);
    expect(events.map((event) => event.type)).toContain("planner.proposed");
    expect(events.map((event) => event.type)).toContain("task.selected");
  });
});

async function seedGeneratedPlannerRun(prisma: PrismaClient, rootPath: string) {
  const project = await createProject(prisma, {
    name: "Approval Repo",
    rootPath,
  });
  const plannerRun = await createPlannerRun(prisma, {
    projectId: project.id,
    goal: "Persist approval flow",
  });

  await persistPlannerProposal(prisma, {
    plannerRunId: plannerRun.id,
    summary: "Proposal for repository tests",
    epics: [buildPlannerEpicPayload()],
  });

  const tasks = await listTasks(prisma, {
    projectId: project.id,
    plannerRunId: plannerRun.id,
  });

  if (!tasks[0]) {
    throw new Error("Expected a generated task.");
  }

  return {
    project,
    plannerRun,
    task: tasks[0],
  };
}

function buildPlannerEpicPayload() {
  return {
    key: "EPIC-REPO-1",
    title: "Repository foundation",
    goal: "Store proposal data",
    orderIndex: 0,
    acceptance: [{ label: "task persisted" }],
    risks: [{ label: "approval state drift" }],
    tasks: [
      {
        stableId: "TASK-REPO-1",
        title: "Persist proposal data",
        type: "backend",
        complexity: "medium",
        orderIndex: 0,
        acceptance: [{ label: "records written" }],
        verificationPlan: {
          rationale: "Need at least one verification check",
          items: [
            {
              kind: "logic",
              runner: "vitest",
              title: "proposal persisted",
              description: "proposal writes epics/tasks/items",
              command: "bun run test:vitest",
              orderIndex: 0,
            },
          ],
        },
      },
    ],
  };
}
