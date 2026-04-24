import type { DatabaseClient } from "./types";

export type CreateVisualVerificationResultInput = {
  taskExecutionId: string;
  verificationItemId: string;
  sourceAssetId?: string | null;
  mode: string;
  status?: string;
  artifactDirectory?: string | null;
  actualPath?: string | null;
  diffPath?: string | null;
  reportPath?: string | null;
  sha256?: string | null;
  diffRatio?: number | null;
  threshold?: number | null;
  metadataJson?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
};

export type PersistVisualVerificationResultInput = {
  taskExecutionId: string;
  verificationItemId: string;
  sourceAssetId?: string | null;
  mode: string;
  status: string;
  summary?: string | null;
  artifactDirectory?: string | null;
  actualPath?: string | null;
  diffPath?: string | null;
  reportPath?: string | null;
  sha256?: string | null;
  diffRatio?: number | null;
  threshold?: number | null;
  metadata?: unknown;
  startedAt?: Date | null;
  finishedAt?: Date | null;
};

export async function createVisualVerificationResult(
  db: DatabaseClient,
  input: CreateVisualVerificationResultInput,
) {
  return db.visualVerificationResult.create({
    data: {
      taskExecutionId: input.taskExecutionId,
      verificationItemId: input.verificationItemId,
      sourceAssetId: input.sourceAssetId ?? null,
      mode: input.mode,
      status: input.status ?? "running",
      artifactDirectory: input.artifactDirectory ?? null,
      actualPath: input.actualPath ?? null,
      diffPath: input.diffPath ?? null,
      reportPath: input.reportPath ?? null,
      sha256: input.sha256 ?? null,
      diffRatio: input.diffRatio ?? null,
      threshold: input.threshold ?? null,
      metadataJson: input.metadataJson ?? null,
      startedAt: input.startedAt ?? null,
      finishedAt: input.finishedAt ?? null,
    },
  });
}

export async function persistVisualVerificationResult(
  db: DatabaseClient,
  input: PersistVisualVerificationResultInput,
) {
  return createVisualVerificationResult(db, {
    taskExecutionId: input.taskExecutionId,
    verificationItemId: input.verificationItemId,
    sourceAssetId: input.sourceAssetId ?? null,
    mode: input.mode,
    status: input.status,
    artifactDirectory: input.artifactDirectory ?? null,
    actualPath: input.actualPath ?? null,
    diffPath: input.diffPath ?? null,
    reportPath: input.reportPath ?? null,
    sha256: input.sha256 ?? null,
    diffRatio: input.diffRatio ?? null,
    threshold: input.threshold ?? null,
    metadataJson: JSON.stringify({
      summary: input.summary ?? null,
      metadata: input.metadata ?? null,
    }),
    startedAt: input.startedAt ?? null,
    finishedAt: input.finishedAt ?? null,
  });
}

export async function finishVisualVerificationResult(
  db: DatabaseClient,
  id: string,
  input: {
    status: string;
    summary?: string | null;
    actualPath?: string | null;
    diffPath?: string | null;
    reportPath?: string | null;
    sha256?: string | null;
    diffRatio?: number | null;
    threshold?: number | null;
    metadata?: unknown;
    finishedAt?: Date | null;
  },
) {
  const update: Partial<Omit<CreateVisualVerificationResultInput, "taskExecutionId" | "verificationItemId">> = {
    status: input.status,
    metadataJson: JSON.stringify({
      summary: input.summary ?? null,
      metadata: input.metadata ?? null,
    }),
    finishedAt: input.finishedAt ?? new Date(),
  };

  if (input.actualPath !== undefined) {
    update.actualPath = input.actualPath;
  }
  if (input.diffPath !== undefined) {
    update.diffPath = input.diffPath;
  }
  if (input.reportPath !== undefined) {
    update.reportPath = input.reportPath;
  }
  if (input.sha256 !== undefined) {
    update.sha256 = input.sha256;
  }
  if (input.diffRatio !== undefined) {
    update.diffRatio = input.diffRatio;
  }
  if (input.threshold !== undefined) {
    update.threshold = input.threshold;
  }

  return updateVisualVerificationResult(db, id, update);
}

export async function updateVisualVerificationResult(
  db: DatabaseClient,
  id: string,
  input: Partial<Omit<CreateVisualVerificationResultInput, "taskExecutionId" | "verificationItemId">>,
) {
  return db.visualVerificationResult.update({
    where: { id },
    data: input,
  });
}

export async function listVisualVerificationResults(
  db: DatabaseClient,
  input: { taskExecutionId?: string; verificationItemId?: string; status?: string },
) {
  return db.visualVerificationResult.findMany({
    where: {
      taskExecutionId: input.taskExecutionId,
      verificationItemId: input.verificationItemId,
      status: input.status,
    },
    orderBy: [{ createdAt: "asc" }],
  });
}
