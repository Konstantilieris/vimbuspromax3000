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
      await applyVerificationPlanApproval(tx, input);
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

async function applyVerificationPlanApproval(db: DatabaseClient, input: CreateApprovalDecisionInput) {
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

  await db.verificationPlan.update({
    where: { id: plan.id },
    data: {
      status: input.status === "granted" ? "approved" : "rejected",
      approvedAt: input.status === "granted" ? new Date() : null,
    },
  });

  if (input.status === "granted") {
    await db.verificationItem.updateMany({
      where: {
        planId: plan.id,
        status: "proposed",
      },
      data: {
        status: "approved",
      },
    });

    await db.task.update({
      where: { id: plan.taskId },
      data: {
        status: "ready",
      },
    });
  }
}
