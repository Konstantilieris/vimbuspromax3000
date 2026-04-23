import { appendLoopEvent } from "./eventRepository";
import type { DatabaseClient } from "./types";

export type CreatePlannerRunInput = {
  projectId: string;
  goal: string;
  moduleName?: string | null;
  contextPath?: string | null;
};

export type PlannerProposalInput = {
  plannerRunId: string;
  summary?: string | null;
  epics: Array<{
    key: string;
    title: string;
    goal: string;
    orderIndex?: number;
    acceptance?: unknown;
    risks?: unknown;
    tasks: Array<{
      stableId: string;
      title: string;
      description?: string | null;
      type: string;
      complexity: string;
      orderIndex?: number;
      acceptance: unknown;
      targetFiles?: unknown;
      requires?: unknown;
      verificationPlan: {
        rationale?: string | null;
        items: Array<{
          kind: string;
          runner?: string | null;
          title: string;
          description: string;
          rationale?: string | null;
          command?: string | null;
          testFilePath?: string | null;
          route?: string | null;
          interaction?: string | null;
          expectedAssetId?: string | null;
          orderIndex?: number;
          config?: unknown;
        }>;
      };
    }>;
  }>;
};

export async function createPlannerRun(db: DatabaseClient, input: CreatePlannerRunInput) {
  const plannerRun = await db.plannerRun.create({
    data: {
      projectId: input.projectId,
      status: "interviewing",
      goal: input.goal,
      moduleName: input.moduleName ?? null,
      contextPath: input.contextPath ?? null,
    },
  });

  await appendLoopEvent(db, {
    projectId: input.projectId,
    type: "planner.started",
    payload: {
      plannerRunId: plannerRun.id,
      goal: plannerRun.goal,
      moduleName: plannerRun.moduleName,
      contextPath: plannerRun.contextPath,
    },
  });

  return plannerRun;
}

export async function getPlannerRunDetail(db: DatabaseClient, id: string) {
  const plannerRun = await db.plannerRun.findUnique({
    where: { id },
    include: {
      project: true,
      epics: {
        orderBy: [{ orderIndex: "asc" }],
        include: {
          tasks: {
            orderBy: [{ orderIndex: "asc" }],
            include: {
              verificationPlans: {
                orderBy: [{ createdAt: "desc" }],
                take: 1,
                include: {
                  items: {
                    orderBy: [{ orderIndex: "asc" }],
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!plannerRun) {
    return null;
  }

  const approvals = await db.approval.findMany({
    where: {
      subjectType: "planner_run",
      subjectId: plannerRun.id,
    },
    orderBy: [{ createdAt: "asc" }],
  });

  return {
    ...plannerRun,
    interview: parseRecordJson(plannerRun.interviewJson),
    proposalSummary: {
      epicCount: plannerRun.epics.length,
      taskCount: plannerRun.epics.reduce((count, epic) => count + epic.tasks.length, 0),
      verificationPlanCount: plannerRun.epics.reduce(
        (count, epic) => count + epic.tasks.reduce((taskCount, task) => taskCount + task.verificationPlans.length, 0),
        0,
      ),
    },
    approvals,
  };
}

export async function updatePlannerInterview(
  db: DatabaseClient,
  input: {
    plannerRunId: string;
    answers: Record<string, unknown>;
  },
) {
  const plannerRun = await db.plannerRun.findUnique({
    where: { id: input.plannerRunId },
  });

  if (!plannerRun) {
    throw new Error(`Planner run ${input.plannerRunId} was not found.`);
  }

  const mergedInterview = {
    ...parseRecordJson(plannerRun.interviewJson),
    ...input.answers,
  };

  const updatedPlannerRun = await db.plannerRun.update({
    where: { id: input.plannerRunId },
    data: {
      interviewJson: JSON.stringify(mergedInterview),
    },
  });

  await appendLoopEvent(db, {
    projectId: plannerRun.projectId,
    type: "planner.answer",
    payload: {
      plannerRunId: plannerRun.id,
      answers: input.answers,
    },
  });

  return {
    ...updatedPlannerRun,
    interview: mergedInterview,
  };
}

export async function persistPlannerProposal(db: DatabaseClient, input: PlannerProposalInput) {
  if (input.epics.length === 0) {
    throw new Error("Planner proposal must include at least one epic.");
  }

  return db.$transaction(async (tx) => {
    const plannerRun = await tx.plannerRun.findUnique({
      where: { id: input.plannerRunId },
    });

    if (!plannerRun) {
      throw new Error(`Planner run ${input.plannerRunId} was not found.`);
    }

    await clearPlannerRunProposal(tx, plannerRun.id);

    for (const [epicIndex, epic] of input.epics.entries()) {
      const createdEpic = await tx.epic.create({
        data: {
          projectId: plannerRun.projectId,
          plannerRunId: plannerRun.id,
          key: epic.key,
          title: epic.title,
          goal: epic.goal,
          status: "planned",
          orderIndex: epic.orderIndex ?? epicIndex,
          acceptanceJson: serializeJson(epic.acceptance),
          risksJson: serializeJson(epic.risks),
        },
      });

      for (const [taskIndex, task] of epic.tasks.entries()) {
        if (task.verificationPlan.items.length === 0) {
          throw new Error(`Task ${task.stableId} must include at least one verification item.`);
        }

        const createdTask = await tx.task.create({
          data: {
            epicId: createdEpic.id,
            stableId: task.stableId,
            title: task.title,
            description: task.description ?? null,
            type: task.type,
            complexity: task.complexity,
            status: "planned",
            orderIndex: task.orderIndex ?? taskIndex,
            acceptanceJson: serializeRequiredJson(task.acceptance, `task ${task.stableId} acceptance`),
            targetFilesJson: serializeJson(task.targetFiles),
            requiresJson: serializeJson(task.requires),
          },
        });

        const verificationPlan = await tx.verificationPlan.create({
          data: {
            taskId: createdTask.id,
            status: "proposed",
            rationale: task.verificationPlan.rationale ?? null,
          },
        });

        for (const [itemIndex, item] of task.verificationPlan.items.entries()) {
          await tx.verificationItem.create({
            data: {
              planId: verificationPlan.id,
              taskId: createdTask.id,
              kind: item.kind,
              runner: item.runner ?? null,
              title: item.title,
              description: item.description,
              rationale: item.rationale ?? null,
              command: item.command ?? null,
              testFilePath: item.testFilePath ?? null,
              route: item.route ?? null,
              interaction: item.interaction ?? null,
              expectedAssetId: item.expectedAssetId ?? null,
              status: "proposed",
              orderIndex: item.orderIndex ?? itemIndex,
              configJson: serializeJson(item.config),
            },
          });
        }
      }
    }

    const updatedPlannerRun = await tx.plannerRun.update({
      where: { id: plannerRun.id },
      data: {
        summary: input.summary ?? null,
        status: "generated",
      },
    });

    await appendLoopEvent(tx, {
      projectId: plannerRun.projectId,
      type: "planner.proposed",
      payload: {
        plannerRunId: plannerRun.id,
        summary: input.summary ?? null,
        epicCount: input.epics.length,
        taskCount: input.epics.reduce((count, epic) => count + epic.tasks.length, 0),
      },
    });

    return updatedPlannerRun;
  });
}

export async function setPlannerRunStatus(db: DatabaseClient, plannerRunId: string, status: string) {
  return db.plannerRun.update({
    where: { id: plannerRunId },
    data: { status },
  });
}

async function clearPlannerRunProposal(db: DatabaseClient, plannerRunId: string) {
  const epics = await db.epic.findMany({
    where: { plannerRunId },
    select: { id: true },
  });

  if (epics.length === 0) {
    return;
  }

  const epicIds = epics.map((epic) => epic.id);
  const tasks = await db.task.findMany({
    where: {
      epicId: { in: epicIds },
    },
    select: { id: true },
  });
  const taskIds = tasks.map((task) => task.id);

  if (taskIds.length > 0) {
    await db.verificationItem.deleteMany({
      where: {
        taskId: { in: taskIds },
      },
    });
    await db.verificationPlan.deleteMany({
      where: {
        taskId: { in: taskIds },
      },
    });
    await db.task.deleteMany({
      where: {
        id: { in: taskIds },
      },
    });
  }

  await db.epic.deleteMany({
    where: { plannerRunId },
  });
}

function parseRecordJson(value: string | null): Record<string, unknown> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }

  return {};
}

function serializeJson(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return typeof value === "string" ? value : JSON.stringify(value);
}

function serializeRequiredJson(value: unknown, fieldName: string): string {
  const serialized = serializeJson(value);

  if (!serialized) {
    throw new Error(`${fieldName} is required.`);
  }

  return serialized;
}
