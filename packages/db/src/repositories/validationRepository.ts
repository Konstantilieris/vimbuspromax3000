import type { Prisma } from "../generated/prisma/client";
import { refreshTaskReadiness } from "./approvalRepository";
import { appendLoopEvent } from "./eventRepository";
import type { DatabaseClient } from "./types";

export const VALIDATION_TEST_TYPES = [
  "logic",
  "integration",
  "visual",
  "typecheck",
  "lint",
  "a11y",
  "evidence",
  "playwright",
  "manual",
] as const;
export type ValidationTestType = (typeof VALIDATION_TEST_TYPES)[number];

export const VALIDATION_STATUSES = [
  "proposed",
  "approved",
  "rejected",
  "running",
  "passed",
  "failed",
] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];
export type ValidationExecutionStatus = Extract<ValidationStatus, "running" | "passed" | "failed">;

export type CreateValidationInput = {
  taskId: string;
  testType: ValidationTestType | string;
  title: string;
  description?: string | null;
  acceptanceCriteria?: unknown;
  acceptanceCriteriaJson?: string | null;
  rationale?: string | null;
  command?: string | null;
  testFilePath?: string | null;
  metadataJson?: string | null;
  orderIndex?: number;
  verificationItemId?: string | null;
  legacyVerificationItemId?: string | null;
  status?: ValidationStatus;
  approvedAt?: Date | null;
  rejectedAt?: Date | null;
};

export type ListValidationsByTaskFilters = {
  status?: ValidationStatus;
  testType?: ValidationTestType | string;
};

export type ValidationDecisionInput = {
  validationId: string;
  operator?: string | null;
  reason?: string | null;
  stage?: string | null;
};

export type SetValidationExecutionResultInput = {
  validationId: string;
  status: ValidationExecutionStatus;
  taskExecutionId?: string | null;
  testRunId?: string | null;
  exitCode?: number | null;
  resultSummary?: string | null;
  resultJson?: string | null;
  artifactPath?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
};

export type CreateValidationReviewArtifactInput = {
  validationId: string;
  stage?: string | null;
};

export function isValidationTestType(value: string): value is ValidationTestType {
  return (VALIDATION_TEST_TYPES as readonly string[]).includes(value);
}

export function isValidationStatus(value: string): value is ValidationStatus {
  return (VALIDATION_STATUSES as readonly string[]).includes(value);
}

export async function createValidation(db: DatabaseClient, input: CreateValidationInput) {
  const status = input.status ?? "proposed";

  return db.validation.create({
    data: {
      taskId: input.taskId,
      verificationItemId: input.verificationItemId ?? null,
      testType: input.testType,
      status,
      title: input.title,
      description: input.description ?? null,
      acceptanceCriteriaJson:
        input.acceptanceCriteriaJson ?? serializeJson(input.acceptanceCriteria) ?? "[]",
      rationale: input.rationale ?? null,
      command: input.command ?? null,
      testFilePath: input.testFilePath ?? null,
      metadataJson: input.metadataJson ?? null,
      orderIndex: input.orderIndex ?? 0,
      legacyVerificationItemId: input.legacyVerificationItemId ?? input.verificationItemId ?? null,
      approvedAt: input.approvedAt ?? (status === "approved" ? new Date() : null),
      rejectedAt: input.rejectedAt ?? (status === "rejected" ? new Date() : null),
    },
  });
}

export async function listValidationsByTask(
  db: DatabaseClient,
  taskId: string,
  filters: ListValidationsByTaskFilters = {},
) {
  return db.validation.findMany({
    where: {
      taskId,
      status: filters.status,
      testType: filters.testType,
    },
    orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
  });
}

export async function getValidation(db: DatabaseClient, id: string) {
  return db.validation.findUnique({
    where: { id },
  });
}

export async function createValidationReviewArtifact(
  db: DatabaseClient,
  inputOrValidationId: CreateValidationReviewArtifactInput | string,
) {
  const input =
    typeof inputOrValidationId === "string"
      ? { validationId: inputOrValidationId }
      : inputOrValidationId;
  const validation = await getValidationReviewDetail(db, input.validationId);

  if (!validation) {
    throw new Error(`Validation ${input.validationId} was not found.`);
  }

  const stage = input.stage ?? "validation_review";
  const projectId = validation.task.epic.projectId;

  const artifact = await db.reviewArtifact.create({
    data: {
      projectId,
      subjectType: "validation",
      subjectId: validation.id,
      title: `Validation review: ${validation.title}`,
      markdown: "",
      payloadJson: serializeJson({
        kind: "validation_review",
        validationId: validation.id,
        taskId: validation.taskId,
      }),
      stage,
      status: "pending",
    },
  });
  const markdown = buildValidationReviewMarkdown(validation, artifact.id);
  const updatedArtifact = await db.reviewArtifact.update({
    where: { id: artifact.id },
    data: { markdown },
  });

  await appendLoopEvent(db, {
    projectId,
    type: "review.requested",
    payload: {
      reviewArtifactId: updatedArtifact.id,
      subjectType: updatedArtifact.subjectType,
      subjectId: updatedArtifact.subjectId,
      stage: updatedArtifact.stage,
      status: updatedArtifact.status,
    },
  });

  return updatedArtifact;
}

export async function approveValidation(db: DatabaseClient, input: ValidationDecisionInput) {
  return decideValidation(db, input, "granted");
}

export async function rejectValidation(db: DatabaseClient, input: ValidationDecisionInput) {
  return decideValidation(db, input, "rejected");
}

export async function setValidationExecutionResult(
  db: DatabaseClient,
  input: SetValidationExecutionResultInput,
) {
  const data: Prisma.ValidationUncheckedUpdateInput = {
    status: input.status,
  };

  if (input.taskExecutionId !== undefined) {
    data.lastTaskExecutionId = input.taskExecutionId ?? null;
  }
  if (input.testRunId !== undefined) {
    data.lastTestRunId = input.testRunId ?? null;
  }
  if (input.exitCode !== undefined) {
    data.lastExitCode = input.exitCode ?? null;
  }
  if (input.resultSummary !== undefined) {
    data.resultSummary = input.resultSummary ?? null;
  }
  if (input.resultJson !== undefined) {
    data.resultJson = input.resultJson ?? null;
  }
  if (input.artifactPath !== undefined) {
    data.artifactPath = input.artifactPath ?? null;
  }

  if (input.startedAt !== undefined) {
    data.startedAt = input.startedAt;
  } else if (input.status === "running") {
    data.startedAt = new Date();
  }

  if (input.finishedAt !== undefined) {
    data.finishedAt = input.finishedAt;
  } else if (input.status === "running") {
    data.finishedAt = null;
  } else {
    data.finishedAt = new Date();
  }

  if (input.status === "running") {
    data.lastExitCode = input.exitCode ?? null;
    data.resultSummary = input.resultSummary ?? null;
    data.resultJson = input.resultJson ?? null;
    data.artifactPath = input.artifactPath ?? null;
  }

  return db.validation.update({
    where: { id: input.validationId },
    data,
  });
}

export const validationRepository = {
  listByTask: listValidationsByTask,
  create: createValidation,
  get: getValidation,
  createReviewArtifact: createValidationReviewArtifact,
  approve: approveValidation,
  reject: rejectValidation,
  setExecutionResult: setValidationExecutionResult,
};

async function decideValidation(
  db: DatabaseClient,
  input: ValidationDecisionInput,
  approvalStatus: "granted" | "rejected",
) {
  const validation = await getValidationWithProject(db, input.validationId);

  if (!validation) {
    throw new Error(`Validation ${input.validationId} was not found.`);
  }

  const now = new Date();
  const nextStatus: ValidationStatus = approvalStatus === "granted" ? "approved" : "rejected";
  const projectId = validation.task.epic.projectId;
  const stage = input.stage ?? "validation_review";

  return db.$transaction(async (tx) => {
    const approval = await tx.approval.create({
      data: {
        projectId,
        subjectType: "validation",
        subjectId: validation.id,
        stage,
        status: approvalStatus,
        operator: input.operator ?? null,
        reason: input.reason ?? null,
      },
    });

    const updatedValidation = await tx.validation.update({
      where: { id: validation.id },
      data: {
        status: nextStatus,
        approvalId: approval.id,
        approvedAt: approvalStatus === "granted" ? now : null,
        rejectedAt: approvalStatus === "rejected" ? now : null,
      },
    });

    await appendLoopEvent(tx, {
      projectId,
      type: approvalStatus === "granted" ? "approval.granted" : "approval.rejected",
      payload: {
        approvalId: approval.id,
        subjectType: "validation",
        subjectId: validation.id,
        stage,
        status: approvalStatus,
      },
    });

    await refreshTaskReadiness(tx, validation.taskId);

    return {
      validation: updatedValidation,
      approval,
    };
  });
}

async function getValidationWithProject(db: DatabaseClient, id: string) {
  return db.validation.findUnique({
    where: { id },
    include: {
      task: {
        select: {
          epic: {
            select: {
              projectId: true,
            },
          },
        },
      },
    },
  });
}

async function getValidationReviewDetail(db: DatabaseClient, id: string) {
  return db.validation.findUnique({
    where: { id },
    include: {
      task: {
        select: {
          id: true,
          stableId: true,
          title: true,
          epic: {
            select: {
              projectId: true,
            },
          },
        },
      },
    },
  });
}

function buildValidationReviewMarkdown(
  validation: NonNullable<Awaited<ReturnType<typeof getValidationReviewDetail>>>,
  artifactId: string,
): string {
  const lines = [
    `# ${validation.title}`,
    "",
    "## Task",
    "",
    `${validation.task.stableId}: ${validation.task.title}`,
    "",
    "## Description",
    "",
    validation.description?.trim() || "No description provided.",
    "",
    "## Test Type",
    "",
    validation.testType,
    "",
    "## Acceptance Criteria",
    "",
    ...formatAcceptanceCriteriaChecklist(validation.acceptanceCriteriaJson),
    "",
    "## Browser Review",
    "",
    `Open /review/${artifactId} to approve or reject this validation.`,
    `Approve path: /review-artifacts/${artifactId}/approve`,
    `Reject path: /review-artifacts/${artifactId}/reject`,
  ];

  return lines.join("\n");
}

function formatAcceptanceCriteriaChecklist(acceptanceCriteriaJson: string | null): string[] {
  const parsed = parseJsonValue(acceptanceCriteriaJson);
  const items = Array.isArray(parsed) ? parsed : [];
  const labels = items
    .map((item) => formatAcceptanceCriterion(item))
    .filter((item): item is string => item.length > 0);

  if (labels.length === 0) {
    return ["- [ ] No acceptance criteria provided."];
  }

  return labels.map((label) => `- [ ] ${label}`);
}

function formatAcceptanceCriterion(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const field of ["label", "title", "description", "text"]) {
      const candidate = record[field];
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
  }

  return "";
}

function parseJsonValue(value: string | null): unknown {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function serializeJson(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return typeof value === "string" ? value : JSON.stringify(value);
}
