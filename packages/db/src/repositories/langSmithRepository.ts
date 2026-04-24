import type { LangSmithSyncStatus, LangSmithSubjectType } from "@vimbuspromax3000/shared";
import { appendLoopEvent } from "./eventRepository";
import type { DatabaseClient } from "./types";

export type CreateLangSmithTraceLinkInput = {
  projectId: string;
  subjectType: LangSmithSubjectType;
  subjectId: string;
  traceUrl?: string | null;
  datasetId?: string | null;
  experimentId?: string | null;
  runId?: string | null;
  syncStatus?: LangSmithSyncStatus;
};

export type UpdateLangSmithTraceLinkInput = Partial<
  Pick<CreateLangSmithTraceLinkInput, "traceUrl" | "datasetId" | "experimentId" | "runId" | "syncStatus">
>;

export type ListLangSmithTraceLinksInput = {
  projectId: string;
  subjectType?: LangSmithSubjectType;
  subjectId?: string;
  syncStatus?: LangSmithSyncStatus;
};

export async function createLangSmithTraceLink(
  db: DatabaseClient,
  input: CreateLangSmithTraceLinkInput,
) {
  const link = await db.langSmithTraceLink.create({
    data: {
      projectId: input.projectId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      traceUrl: input.traceUrl ?? null,
      datasetId: input.datasetId ?? null,
      experimentId: input.experimentId ?? null,
      runId: input.runId ?? null,
      syncStatus: input.syncStatus ?? "linked",
    },
  });

  if (hasLangSmithReference(link)) {
    await appendLangSmithTraceLinkedEvent(db, link);
  }

  return link;
}

export async function listLangSmithTraceLinks(
  db: DatabaseClient,
  input: ListLangSmithTraceLinksInput,
) {
  return db.langSmithTraceLink.findMany({
    where: {
      projectId: input.projectId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      syncStatus: input.syncStatus,
    },
    orderBy: [{ createdAt: "desc" }],
  });
}

export async function updateLangSmithTraceLink(
  db: DatabaseClient,
  id: string,
  input: UpdateLangSmithTraceLinkInput,
) {
  const existing = await db.langSmithTraceLink.findUnique({
    where: { id },
  });

  if (!existing) {
    throw new Error(`LangSmith trace link ${id} was not found.`);
  }

  const updated = await db.langSmithTraceLink.update({
    where: { id },
    data: {
      traceUrl: input.traceUrl,
      datasetId: input.datasetId,
      experimentId: input.experimentId,
      runId: input.runId,
      syncStatus: input.syncStatus,
    },
  });

  if (!hasLangSmithReference(existing) && hasLangSmithReference(updated)) {
    await appendLangSmithTraceLinkedEvent(db, updated);
  }

  return updated;
}

export async function updateLangSmithTraceLinkStatus(
  db: DatabaseClient,
  id: string,
  syncStatus: LangSmithSyncStatus,
) {
  return updateLangSmithTraceLink(db, id, { syncStatus });
}

function hasLangSmithReference(input: {
  traceUrl: string | null;
  datasetId: string | null;
  experimentId: string | null;
  runId: string | null;
}) {
  return Boolean(input.traceUrl || input.datasetId || input.experimentId || input.runId);
}

async function appendLangSmithTraceLinkedEvent(
  db: DatabaseClient,
  link: {
    id: string;
    projectId: string;
    subjectType: string;
    subjectId: string;
    traceUrl: string | null;
    datasetId: string | null;
    experimentId: string | null;
    runId: string | null;
    syncStatus: string;
  },
) {
  await appendLoopEvent(db, {
    projectId: link.projectId,
    type: "langsmith.trace.linked",
    payload: {
      langSmithTraceLinkId: link.id,
      subjectType: link.subjectType,
      subjectId: link.subjectId,
      traceUrl: link.traceUrl,
      datasetId: link.datasetId,
      experimentId: link.experimentId,
      runId: link.runId,
      syncStatus: link.syncStatus,
    },
  });
}
