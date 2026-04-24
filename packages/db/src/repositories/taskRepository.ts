import { getVerificationDeferredReason, isVerificationItemRunnableNow } from "@vimbuspromax3000/shared";
import { createApprovalDecision } from "./approvalRepository";
import type { DatabaseClient } from "./types";

function enrichItem<T extends { kind: string; command: string | null }>(item: T) {
  return {
    ...item,
    runnableNow: isVerificationItemRunnableNow(item.command),
    deferredReason: getVerificationDeferredReason(item.kind, item.command),
  };
}

export type ListTasksInput = {
  projectId: string;
  plannerRunId?: string;
  status?: string;
  epicId?: string;
};

export type ApproveVerificationPlanInput = {
  taskId: string;
  operator?: string | null;
  reason?: string | null;
  stage?: string;
};

export async function listTasks(db: DatabaseClient, input: ListTasksInput) {
  return db.task.findMany({
    where: {
      status: input.status,
      epicId: input.epicId,
      epic: {
        projectId: input.projectId,
        plannerRunId: input.plannerRunId,
      },
    },
    include: {
      epic: true,
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
    orderBy: [{ orderIndex: "asc" }],
  });
}

export async function getTaskDetail(db: DatabaseClient, taskId: string) {
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: {
      epic: true,
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
  });

  if (!task) {
    return null;
  }

  const latestPlan = task.verificationPlans[0];
  const approvals = await db.approval.findMany({
    where: {
      OR: [
        {
          subjectType: "task",
          subjectId: task.id,
        },
        ...(latestPlan
          ? [
              {
                subjectType: "verification_plan" as const,
                subjectId: latestPlan.id,
              },
            ]
          : []),
      ],
    },
    orderBy: [{ createdAt: "asc" }],
  });

  const enrichedPlan = latestPlan
    ? {
        ...latestPlan,
        items: latestPlan.items.map(enrichItem),
      }
    : null;

  return {
    ...task,
    latestVerificationPlan: enrichedPlan,
    approvals,
  };
}

export async function getTaskVerificationReview(db: DatabaseClient, taskId: string) {
  const task = await db.task.findUnique({
    where: { id: taskId },
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
  });

  if (!task) {
    return null;
  }

  const latestPlan = task.verificationPlans[0] ?? null;

  if (!latestPlan) {
    return { taskId, plan: null, summary: null };
  }

  const enrichedItems = latestPlan.items.map(enrichItem);
  const runnableCount = enrichedItems.filter((item) => item.runnableNow).length;
  const deferredCount = enrichedItems.length - runnableCount;

  return {
    taskId,
    plan: {
      ...latestPlan,
      items: enrichedItems,
    },
    summary: {
      totalCount: enrichedItems.length,
      runnableCount,
      deferredCount,
      allRunnableNow: deferredCount === 0 && enrichedItems.length > 0,
    },
  };
}

export async function getTaskExecutionContext(db: DatabaseClient, taskId: string) {
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: {
      epic: {
        include: {
          plannerRun: true,
          project: true,
        },
      },
      verificationPlans: {
        orderBy: [{ createdAt: "desc" }],
        take: 1,
        include: {
          items: {
            orderBy: [{ orderIndex: "asc" }],
          },
        },
      },
      branch: true,
      executions: {
        orderBy: [{ createdAt: "desc" }],
        take: 1,
        include: {
          agentSteps: {
            orderBy: [{ createdAt: "desc" }],
            take: 1,
          },
          patchReviews: {
            orderBy: [{ createdAt: "desc" }],
            take: 1,
          },
          testRuns: {
            orderBy: [{ createdAt: "asc" }],
          },
        },
      },
    },
  });

  if (!task) {
    return null;
  }

  const latestVerificationPlan = task.verificationPlans[0] ?? null;
  const latestExecution = task.executions[0] ?? null;

  return {
    ...task,
    latestVerificationPlan,
    latestExecution: latestExecution
      ? {
          ...latestExecution,
          latestAgentStep: latestExecution.agentSteps[0] ?? null,
          latestPatchReview: latestExecution.patchReviews[0] ?? null,
        }
      : null,
  };
}

export async function approveVerificationPlan(db: DatabaseClient, input: ApproveVerificationPlanInput) {
  const task = await db.task.findUnique({
    where: { id: input.taskId },
    include: {
      epic: true,
      verificationPlans: {
        where: {
          status: "proposed",
        },
        orderBy: [{ createdAt: "desc" }],
        take: 1,
      },
    },
  });

  if (!task) {
    throw new Error(`Task ${input.taskId} was not found.`);
  }

  const latestPlan = task.verificationPlans[0];

  if (!latestPlan) {
    throw new Error(`Task ${input.taskId} has no proposed verification plan to approve.`);
  }

  await createApprovalDecision(db, {
    projectId: task.epic.projectId,
    subjectType: "verification_plan",
    subjectId: latestPlan.id,
    stage: input.stage ?? "verification_review",
    status: "granted",
    operator: input.operator ?? null,
    reason: input.reason ?? null,
  });

  return getTaskDetail(db, task.id);
}

export async function setTaskStatus(db: DatabaseClient, taskId: string, status: string) {
  return db.task.update({
    where: { id: taskId },
    data: { status },
  });
}
