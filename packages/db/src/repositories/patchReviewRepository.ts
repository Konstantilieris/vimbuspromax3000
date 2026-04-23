import type { PatchReviewStatus } from "@vimbuspromax3000/shared";
import type { DatabaseClient } from "./types";

export type CreatePatchReviewInput = {
  taskExecutionId: string;
  status: PatchReviewStatus;
  diffPath?: string | null;
  summary?: string | null;
  approvedAt?: Date | null;
};

export type UpdatePatchReviewInput = {
  status?: PatchReviewStatus;
  diffPath?: string | null;
  summary?: string | null;
  approvedAt?: Date | null;
};

export async function createPatchReview(db: DatabaseClient, input: CreatePatchReviewInput) {
  return db.patchReview.create({
    data: {
      taskExecutionId: input.taskExecutionId,
      status: input.status,
      diffPath: input.diffPath ?? null,
      summary: input.summary ?? null,
      approvedAt: input.approvedAt ?? null,
    },
  });
}

export async function getPatchReview(db: DatabaseClient, id: string) {
  return db.patchReview.findUnique({
    where: { id },
  });
}

export async function getLatestPatchReview(db: DatabaseClient, taskExecutionId: string) {
  return db.patchReview.findFirst({
    where: { taskExecutionId },
    orderBy: [{ createdAt: "desc" }],
  });
}

export async function updatePatchReview(db: DatabaseClient, id: string, input: UpdatePatchReviewInput) {
  return db.patchReview.update({
    where: { id },
    data: {
      status: input.status,
      diffPath: input.diffPath,
      summary: input.summary,
      approvedAt: input.approvedAt,
    },
  });
}
