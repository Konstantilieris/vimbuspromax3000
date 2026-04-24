import type { DatabaseClient } from "./types";
import { ingestSourceAsset, type SourceAssetDescriptor } from "@vimbuspromax3000/verification";

export type CreateSourceAssetInput = {
  projectId: string;
  taskId?: string | null;
  verificationItemId?: string | null;
  kind: string;
  relativePath: string;
  mimeType: string;
  sha256: string;
  width?: number | null;
  height?: number | null;
  pageCount?: number | null;
  comparisonMode?: string | null;
  metadataJson?: string | null;
  status?: string;
};

export type IngestProjectSourceAssetInput = {
  projectId: string;
  projectRoot: string;
  relativePath: string;
  taskId?: string | null;
  verificationItemId?: string | null;
  comparisonMode?: string | null;
  status?: string;
  setAsExpectedAsset?: boolean;
};

export async function createSourceAsset(db: DatabaseClient, input: CreateSourceAssetInput) {
  return db.sourceOfTruthAsset.create({
    data: {
      projectId: input.projectId,
      taskId: input.taskId ?? null,
      verificationItemId: input.verificationItemId ?? null,
      kind: input.kind,
      relativePath: input.relativePath,
      mimeType: input.mimeType,
      sha256: input.sha256,
      width: input.width ?? null,
      height: input.height ?? null,
      pageCount: input.pageCount ?? null,
      comparisonMode: input.comparisonMode ?? null,
      metadataJson: input.metadataJson ?? null,
      status: input.status ?? "proposed",
    },
  });
}

export async function ingestProjectSourceAsset(db: DatabaseClient, input: IngestProjectSourceAssetInput) {
  const asset = await ingestSourceAsset({
    projectRoot: input.projectRoot,
    relativePath: input.relativePath,
  });
  const data = mapSourceAssetDescriptorToCreateInput(input, asset);

  const persisted = await db.sourceOfTruthAsset.upsert({
    where: {
      projectId_relativePath: {
        projectId: input.projectId,
        relativePath: asset.relativePath,
      },
    },
    create: data,
    update: {
      taskId: data.taskId,
      verificationItemId: data.verificationItemId,
      kind: data.kind,
      mimeType: data.mimeType,
      sha256: data.sha256,
      width: data.width,
      height: data.height,
      pageCount: data.pageCount,
      comparisonMode: data.comparisonMode,
      metadataJson: data.metadataJson,
      status: data.status,
      approvedAt: null,
    },
  });

  if (input.setAsExpectedAsset && input.verificationItemId) {
    await updateVerificationItemExpectedAsset(db, {
      verificationItemId: input.verificationItemId,
      expectedAssetId: persisted.id,
    });
  }

  return persisted;
}

export async function listProjectSourceAssets(
  db: DatabaseClient,
  input: { projectId: string; taskId?: string; verificationItemId?: string; status?: string },
) {
  return db.sourceOfTruthAsset.findMany({
    where: {
      projectId: input.projectId,
      taskId: input.taskId,
      verificationItemId: input.verificationItemId,
      status: input.status,
    },
    orderBy: [{ createdAt: "asc" }],
  });
}

export async function listTaskSourceAssets(db: DatabaseClient, taskId: string) {
  return db.sourceOfTruthAsset.findMany({
    where: { taskId },
    orderBy: [{ createdAt: "asc" }],
  });
}

export async function getSourceAsset(db: DatabaseClient, id: string) {
  return db.sourceOfTruthAsset.findUnique({
    where: { id },
  });
}

export async function approveSourceAsset(db: DatabaseClient, id: string) {
  return db.sourceOfTruthAsset.update({
    where: { id },
    data: {
      status: "approved",
      approvedAt: new Date(),
    },
  });
}

export async function updateVerificationItemExpectedAsset(
  db: DatabaseClient,
  input: { verificationItemId: string; expectedAssetId: string | null },
) {
  return db.verificationItem.update({
    where: { id: input.verificationItemId },
    data: { expectedAssetId: input.expectedAssetId },
  });
}

function mapSourceAssetDescriptorToCreateInput(
  input: IngestProjectSourceAssetInput,
  asset: SourceAssetDescriptor,
): CreateSourceAssetInput {
  const imageMetadata = asset.metadata.kind === "image" ? asset.metadata : null;
  const pdfMetadata = asset.metadata.kind === "pdf" ? asset.metadata : null;

  return {
    projectId: input.projectId,
    taskId: input.taskId ?? null,
    verificationItemId: input.verificationItemId ?? null,
    kind: asset.kind,
    relativePath: asset.relativePath,
    mimeType: asset.mimeType,
    sha256: asset.sha256,
    width: imageMetadata?.width ?? null,
    height: imageMetadata?.height ?? null,
    pageCount: pdfMetadata?.pageCount ?? null,
    comparisonMode: input.comparisonMode ?? null,
    metadataJson: JSON.stringify({
      absolutePath: asset.absolutePath,
      byteLength: asset.byteLength,
      metadata: asset.metadata,
      approvalRequired: asset.approvalRequired,
    }),
    status: input.status ?? asset.status,
  };
}
