import type { ApprovalStatus, ApprovalSubjectType } from "@vimbuspromax3000/shared";
import { appendLoopEvent } from "./eventRepository";
import type { DatabaseClient } from "./types";
import { setPlannerRunStatus } from "./plannerRepository";

export type CreateApprovalDecisionInput = {
  projectId: string;
  subjectType: ApprovalSubjectType;
  subjectId: string;
  stage: string;
  status: ApprovalStatus;
  operator?: string | null;
  reason?: string | null;
};

export type ListApprovalsInput = {
  projectId?: string;
  subjectType?: ApprovalSubjectType;
  subjectId?: string;
};

export async function createApprovalDecision(db: DatabaseClient, input: CreateApprovalDecisionInput) {
  return db.$transaction(async (tx) => {
    const approval = await tx.approval.create({
      data: {
        projectId: input.projectId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        stage: input.stage,
        status: input.status,
        operator: input.operator ?? null,
        reason: input.reason ?? null,
      },
    });

    if (input.subjectType === "planner_run") {
      await applyPlannerRunApproval(tx, input);
    }

    if (input.subjectType === "verification_plan") {
      await applyVerificationPlanApproval(tx, input, approval.id);
    }

    await appendLoopEvent(tx, {
      projectId: input.projectId,
      type: input.status === "granted" ? "approval.granted" : "approval.rejected",
      payload: {
        approvalId: approval.id,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        stage: input.stage,
        status: input.status,
      },
    });

    return approval;
  });
}

export async function listApprovals(db: DatabaseClient, input: ListApprovalsInput) {
  return db.approval.findMany({
    where: {
      projectId: input.projectId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
    },
    orderBy: [{ createdAt: "asc" }],
  });
}

async function applyPlannerRunApproval(db: DatabaseClient, input: CreateApprovalDecisionInput) {
  await setPlannerRunStatus(db, input.subjectId, input.status === "granted" ? "approved" : "rejected");

  if (input.status === "granted") {
    await db.task.updateMany({
      where: {
        status: "planned",
        epic: {
          plannerRunId: input.subjectId,
        },
      },
      data: {
        status: "awaiting_verification_approval",
      },
    });
  }
}

async function applyVerificationPlanApproval(
  db: DatabaseClient,
  input: CreateApprovalDecisionInput,
  approvalId: string,
) {
  const plan = await db.verificationPlan.findUnique({
    where: { id: input.subjectId },
    include: {
      task: {
        include: {
          epic: true,
        },
      },
    },
  });

  if (!plan) {
    throw new Error(`Verification plan ${input.subjectId} was not found.`);
  }

  const now = new Date();

  await db.verificationPlan.update({
    where: { id: plan.id },
    data: {
      status: input.status === "granted" ? "approved" : "rejected",
      approvedAt: input.status === "granted" ? now : null,
    },
  });

  if (input.status === "granted") {
    const verificationItems = await db.verificationItem.findMany({
      where: { planId: plan.id },
      select: { id: true },
    });
    const verificationItemIds = verificationItems.map((item) => item.id);

    await db.verificationItem.updateMany({
      where: {
        planId: plan.id,
        status: "proposed",
      },
      data: {
        status: "approved",
      },
    });

    if (verificationItemIds.length > 0) {
      await db.validation.updateMany({
        where: {
          taskId: plan.taskId,
          status: "proposed",
          OR: [
            { verificationItemId: { in: verificationItemIds } },
            { legacyVerificationItemId: { in: verificationItemIds } },
          ],
        },
        data: {
          status: "approved",
          approvalId,
          approvedAt: now,
          rejectedAt: null,
        },
      });
    }

    await refreshTaskReadiness(db, plan.taskId);
  }
}

export async function refreshTaskReadiness(db: DatabaseClient, taskId: string) {
  const data = await buildReadyTaskStatusUpdate(db, taskId);

  if (!data.status) {
    return null;
  }

  return db.task.update({
    where: { id: taskId },
    data,
  });
}

async function buildReadyTaskStatusUpdate(db: DatabaseClient, taskId: string): Promise<{ status?: string }> {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { status: true },
  });

  if (!task) {
    return {};
  }

  const validations = await db.validation.findMany({
    where: { taskId },
    select: { status: true },
  });

  if (validations.length > 0) {
    if (validations.every((validation) => validation.status === "approved")) {
      return { status: "ready" };
    }

    return task.status === "ready" ? { status: "awaiting_verification_approval" } : {};
  }

  const approvedPlan = await db.verificationPlan.findFirst({
    where: {
      taskId,
      status: "approved",
    },
    select: { id: true },
  });

  if (approvedPlan) {
    return { status: "ready" };
  }

  return task.status === "ready" ? { status: "awaiting_verification_approval" } : {};
}
