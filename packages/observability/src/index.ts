import { randomUUID } from "node:crypto";
import {
  LANGSMITH_SYNC_STATUSES,
  type LangSmithSyncStatus,
} from "@vimbuspromax3000/shared";

export type LangSmithTraceLinkSyncStatus = LangSmithSyncStatus;

export type LangSmithTraceLink = {
  id: string;
  projectId: string;
  subjectType: string;
  subjectId: string;
  traceUrl: string | null;
  datasetId: string | null;
  experimentId: string | null;
  runId: string | null;
  syncStatus: LangSmithTraceLinkSyncStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateLangSmithTraceLinkInput = {
  projectId: string;
  subjectType: string;
  subjectId: string;
  traceUrl?: string | null;
  datasetId?: string | null;
  experimentId?: string | null;
  runId?: string | null;
  syncStatus?: LangSmithTraceLinkSyncStatus;
};

export type UpdateLangSmithTraceLinkInput = Partial<
  Pick<CreateLangSmithTraceLinkInput, "traceUrl" | "datasetId" | "experimentId" | "runId" | "syncStatus">
>;

export type ListLangSmithTraceLinksFilter = {
  projectId?: string;
  subjectType?: string;
  subjectId?: string;
  syncStatus?: LangSmithTraceLinkSyncStatus;
};

export type LangSmithTraceLinkRepository = {
  create(input: NormalizedCreateLangSmithTraceLinkInput): Promise<LangSmithTraceLink>;
  list(filter: ListLangSmithTraceLinksFilter): Promise<LangSmithTraceLink[]>;
  update(id: string, input: NormalizedUpdateLangSmithTraceLinkInput): Promise<LangSmithTraceLink>;
};

export type LangSmithTraceLinkEventSink = {
  append(input: {
    projectId: string;
    subjectType: string;
    subjectId: string;
    type: "langsmith.trace.linked";
    payload: Record<string, unknown>;
  }): Promise<void>;
};

export type LangSmithTraceLinkService = {
  create(input: CreateLangSmithTraceLinkInput): Promise<LangSmithTraceLink>;
  list(filter: ListLangSmithTraceLinksFilter): Promise<LangSmithTraceLink[]>;
  update(id: string, input: UpdateLangSmithTraceLinkInput): Promise<LangSmithTraceLink>;
  exportTrace(input: PersistLangSmithTraceExportInput): Promise<LangSmithTraceExportStartResult>;
};

export type LangSmithTraceLinkValidationOptions = {
  allowedTraceHostnames?: readonly string[];
};

export type NormalizedCreateLangSmithTraceLinkInput = {
  projectId: string;
  subjectType: string;
  subjectId: string;
  traceUrl: string | null;
  datasetId: string | null;
  experimentId: string | null;
  runId: string | null;
  syncStatus: LangSmithTraceLinkSyncStatus;
};

export type NormalizedUpdateLangSmithTraceLinkInput = Partial<
  Pick<NormalizedCreateLangSmithTraceLinkInput, "traceUrl" | "datasetId" | "experimentId" | "runId" | "syncStatus">
>;

export type LangSmithExporter = {
  readonly enabled: boolean;
  exportTrace(input: LangSmithTraceExportInput): Promise<LangSmithTraceExportResult>;
};

export type LangSmithTraceRunInput = {
  id?: string;
  projectName?: string;
  runName: string;
  runType?: string;
  startedAt?: Date | string | null;
  finishedAt?: Date | string | null;
  error?: string | null;
  inputs?: unknown;
  outputs?: unknown;
  metadata?: Record<string, unknown>;
  childRuns?: LangSmithTraceRunInput[];
};

export type LangSmithTraceExportInput = LangSmithTraceRunInput & {
  subjectType: string;
  subjectId: string;
};

export type LangSmithTraceExportResult =
  | {
      ok: true;
      skipped: false;
      traceUrl?: string;
      runId?: string;
    }
  | {
      ok: true;
      skipped: true;
      reason: "disabled";
    }
  | {
      ok: false;
      skipped: false;
      reason: string;
    };

export type LangSmithExporterConfig = {
  apiKey?: string;
  endpoint?: string;
  projectName?: string;
  enabled?: boolean;
};

export type LangSmithExporterClient = {
  createRun(input: {
    apiKey: string;
    endpoint: string;
    projectName?: string;
    runId: string;
    parentRunId?: string;
    runName: string;
    runType: string;
    startedAt: string;
    finishedAt?: string;
    error?: string;
    inputs?: unknown;
    outputs?: unknown;
    metadata: Record<string, unknown>;
  }): Promise<{
    traceUrl?: string;
    runId?: string;
  }>;
};

export type NonBlockingExportResult = {
  accepted: boolean;
  skipped: boolean;
  reason?: string;
};

export type PersistLangSmithTraceExportInput = LangSmithTraceExportInput & {
  projectId: string;
};

export type LangSmithTraceExportStartResult = {
  link: LangSmithTraceLink | null;
  export: NonBlockingExportResult;
};

export type ExportAndPersistLangSmithTraceOptions = {
  exporter: LangSmithExporter;
  repository: LangSmithTraceLinkRepository;
  linkId: string;
  input: LangSmithTraceExportInput;
  validation?: LangSmithTraceLinkValidationOptions;
  onLinked?: (link: LangSmithTraceLink) => Promise<void> | void;
  onError?: (error: unknown) => void;
};

const DEFAULT_LANGSMITH_TRACE_HOSTNAMES = ["smith.langchain.com", "langsmith.langchain.com"] as const;
const DEFAULT_LANGSMITH_ENDPOINT = "https://api.smith.langchain.com";

export function createLangSmithTraceLinkService(options: {
  repository: LangSmithTraceLinkRepository;
  eventSink?: LangSmithTraceLinkEventSink;
  validation?: LangSmithTraceLinkValidationOptions;
  exporter?: LangSmithExporter;
  onExportError?: (error: unknown) => void;
}): LangSmithTraceLinkService {
  const validation = options.validation;
  const emitLinkedEvent = async (link: LangSmithTraceLink) => {
    await options.eventSink?.append({
      projectId: link.projectId,
      subjectType: link.subjectType,
      subjectId: link.subjectId,
      type: "langsmith.trace.linked",
      payload: buildTraceLinkEventPayload(link),
    });
  };

  return {
    async create(input) {
      const created = await createLangSmithTraceLink(options.repository, input, validation);

      if (hasLangSmithReference(created)) {
        await emitLinkedEvent(created);
      }

      return created;
    },

    list(filter) {
      return listLangSmithTraceLinks(options.repository, filter);
    },

    update(id, input) {
      return updateLangSmithTraceLink(options.repository, id, input, validation);
    },

    async exportTrace(input) {
      if (!options.exporter?.enabled) {
        return {
          link: null,
          export: {
            accepted: false,
            skipped: true,
            reason: "disabled",
          },
        };
      }

      const link = await createLangSmithTraceLink(
        options.repository,
        {
          projectId: input.projectId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          syncStatus: "pending",
        },
        validation,
      );

      return {
        link,
        export: exportAndPersistLangSmithTraceNonBlocking({
          exporter: options.exporter,
          repository: options.repository,
          linkId: link.id,
          input,
          validation,
          onLinked: emitLinkedEvent,
          onError: options.onExportError,
        }),
      };
    },
  };
}

export function createLangSmithTraceLink(
  repository: LangSmithTraceLinkRepository,
  input: CreateLangSmithTraceLinkInput,
  options: LangSmithTraceLinkValidationOptions = {},
) {
  return repository.create(normalizeCreateLangSmithTraceLinkInput(input, options));
}

export function listLangSmithTraceLinks(
  repository: LangSmithTraceLinkRepository,
  filter: ListLangSmithTraceLinksFilter,
) {
  return repository.list(normalizeListLangSmithTraceLinksFilter(filter));
}

export function updateLangSmithTraceLink(
  repository: LangSmithTraceLinkRepository,
  id: string,
  input: UpdateLangSmithTraceLinkInput,
  options: LangSmithTraceLinkValidationOptions = {},
) {
  const normalizedId = requireNonEmptyString(id, "id");

  return repository.update(normalizedId, normalizeUpdateLangSmithTraceLinkInput(input, options));
}

export function normalizeCreateLangSmithTraceLinkInput(
  input: CreateLangSmithTraceLinkInput,
  options: LangSmithTraceLinkValidationOptions = {},
): NormalizedCreateLangSmithTraceLinkInput {
  const normalized = {
    projectId: requireNonEmptyString(input.projectId, "projectId"),
    subjectType: requireNonEmptyString(input.subjectType, "subjectType"),
    subjectId: requireNonEmptyString(input.subjectId, "subjectId"),
    traceUrl: normalizeOptionalTraceUrl(input.traceUrl, options),
    datasetId: normalizeOptionalString(input.datasetId),
    experimentId: normalizeOptionalString(input.experimentId),
    runId: normalizeOptionalString(input.runId),
    syncStatus: normalizeSyncStatus(input.syncStatus ?? "linked"),
  };

  assertCreateInputHasRequiredLangSmithReference(normalized);

  return normalized;
}

export function normalizeUpdateLangSmithTraceLinkInput(
  input: UpdateLangSmithTraceLinkInput,
  options: LangSmithTraceLinkValidationOptions = {},
): NormalizedUpdateLangSmithTraceLinkInput {
  const normalized: NormalizedUpdateLangSmithTraceLinkInput = {};

  if ("traceUrl" in input) {
    normalized.traceUrl = normalizeOptionalTraceUrl(input.traceUrl, options);
  }
  if ("datasetId" in input) {
    normalized.datasetId = normalizeOptionalString(input.datasetId);
  }
  if ("experimentId" in input) {
    normalized.experimentId = normalizeOptionalString(input.experimentId);
  }
  if ("runId" in input) {
    normalized.runId = normalizeOptionalString(input.runId);
  }
  if ("syncStatus" in input) {
    normalized.syncStatus = normalizeSyncStatus(input.syncStatus);
  }

  if (Object.keys(normalized).length === 0) {
    throw new Error("At least one field is required to update a LangSmith trace link.");
  }

  return normalized;
}

export function normalizeListLangSmithTraceLinksFilter(
  filter: ListLangSmithTraceLinksFilter,
): ListLangSmithTraceLinksFilter {
  return {
    projectId: normalizeOptionalString(filter.projectId) ?? undefined,
    subjectType: normalizeOptionalString(filter.subjectType) ?? undefined,
    subjectId: normalizeOptionalString(filter.subjectId) ?? undefined,
    syncStatus: filter.syncStatus ? normalizeSyncStatus(filter.syncStatus) : undefined,
  };
}

export function validateLangSmithTraceUrl(
  value: string,
  options: LangSmithTraceLinkValidationOptions = {},
): string {
  const traceUrl = requireNonEmptyString(value, "traceUrl");
  let url: URL;

  try {
    url = new URL(traceUrl);
  } catch {
    throw new Error("traceUrl must be a valid URL.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("traceUrl must use http or https.");
  }

  const allowedHostnames = options.allowedTraceHostnames ?? DEFAULT_LANGSMITH_TRACE_HOSTNAMES;

  if (allowedHostnames.length > 0 && !isAllowedHostname(url.hostname, allowedHostnames)) {
    throw new Error(`traceUrl hostname ${url.hostname} is not an allowed LangSmith host.`);
  }

  return url.toString();
}

export function createLangSmithExporter(
  config: LangSmithExporterConfig = langSmithExporterConfigFromEnv(),
  client?: LangSmithExporterClient,
): LangSmithExporter {
  const apiKey = normalizeOptionalString(config.apiKey);

  if (config.enabled === false || !apiKey) {
    return createNoopLangSmithExporter();
  }

  const endpoint = normalizeOptionalString(config.endpoint) ?? DEFAULT_LANGSMITH_ENDPOINT;
  const projectName = normalizeOptionalString(config.projectName);
  const exporterClient = client ?? createLangSmithHttpClient();

  return {
    enabled: true,
    async exportTrace(input) {
      try {
        const rootResult = await exportLangSmithRunTree({
          client: exporterClient,
          apiKey,
          endpoint,
          projectName: normalizeOptionalString(input.projectName) ?? projectName ?? undefined,
          run: {
            ...input,
            metadata: {
              ...input.metadata,
              subjectType: requireNonEmptyString(input.subjectType, "subjectType"),
              subjectId: requireNonEmptyString(input.subjectId, "subjectId"),
            },
          },
        });

        return {
          ok: true,
          skipped: false,
          traceUrl: rootResult.traceUrl,
          runId: rootResult.runId,
        };
      } catch (error) {
        return {
          ok: false,
          skipped: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

export function createLangSmithHttpClient(fetchImpl: typeof fetch = fetch): LangSmithExporterClient {
  return {
    async createRun(input) {
      const runId = requireNonEmptyString(input.runId, "runId");
      const headers = {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": input.apiKey,
      };
      const createPayload = compactObject({
        id: runId,
        name: requireNonEmptyString(input.runName, "runName"),
        run_type: requireNonEmptyString(input.runType, "runType"),
        inputs: input.inputs ?? {},
        start_time: input.startedAt,
        session_name: normalizeOptionalString(input.projectName) ?? undefined,
        parent_run_id: normalizeOptionalString(input.parentRunId) ?? undefined,
        extra: Object.keys(input.metadata).length > 0 ? { metadata: input.metadata } : undefined,
      });
      const created = await requestLangSmithJson(fetchImpl, langSmithApiUrl(input.endpoint, "runs"), {
        method: "POST",
        headers,
        body: JSON.stringify(createPayload),
      });
      const persistedRunId = extractString(created, ["id", "run_id", "runId"]) ?? runId;
      const updatePayload = compactObject({
        outputs: input.outputs,
        end_time: input.finishedAt,
        error: input.error,
      });

      if (Object.keys(updatePayload).length > 0) {
        await requestLangSmithJson(fetchImpl, langSmithApiUrl(input.endpoint, `runs/${persistedRunId}`), {
          method: "PATCH",
          headers,
          body: JSON.stringify(updatePayload),
        });
      }

      return {
        runId: persistedRunId,
        traceUrl:
          extractString(created, ["trace_url", "traceUrl", "url", "web_url", "webUrl", "app_url", "appUrl"]) ??
          buildLangSmithTraceUrl(input.endpoint, persistedRunId),
      };
    },
  };
}

export function createNoopLangSmithExporter(): LangSmithExporter {
  return {
    enabled: false,
    async exportTrace() {
      return {
        ok: true,
        skipped: true,
        reason: "disabled",
      };
    },
  };
}

export function exportLangSmithTraceNonBlocking(
  exporter: LangSmithExporter,
  input: LangSmithTraceExportInput,
  onError?: (error: unknown) => void,
): NonBlockingExportResult {
  if (!exporter.enabled) {
    return {
      accepted: false,
      skipped: true,
      reason: "disabled",
    };
  }

  void exporter.exportTrace(input).then((result) => {
    if (!result.ok) {
      onError?.(new Error(result.reason));
    }
  }, onError);

  return {
    accepted: true,
    skipped: false,
  };
}

export function exportAndPersistLangSmithTraceNonBlocking(
  options: ExportAndPersistLangSmithTraceOptions,
): NonBlockingExportResult {
  if (!options.exporter.enabled) {
    return {
      accepted: false,
      skipped: true,
      reason: "disabled",
    };
  }

  void options.exporter.exportTrace(options.input).then(
    async (result) => {
      if (result.ok && !result.skipped) {
        await persistExportedLangSmithTraceLink(options, result);
        return;
      }

      if (!result.ok) {
        await markLangSmithTraceLinkExportFailed(options);
        options.onError?.(new Error(result.reason));
      }
    },
    async (error) => {
      await markLangSmithTraceLinkExportFailed(options);
      options.onError?.(error);
    },
  );

  return {
    accepted: true,
    skipped: false,
  };
}

export function langSmithExporterConfigFromEnv(
  env: Record<string, string | undefined> = getDefaultEnv(),
): LangSmithExporterConfig {
  const tracing = normalizeOptionalString(env.LANGSMITH_TRACING)?.toLowerCase();

  return {
    apiKey: env.LANGSMITH_API_KEY,
    endpoint: env.LANGSMITH_ENDPOINT,
    projectName: env.LANGSMITH_PROJECT,
    enabled: tracing === "true" || tracing === "1",
  };
}

async function exportLangSmithRunTree(options: {
  client: LangSmithExporterClient;
  apiKey: string;
  endpoint: string;
  projectName?: string;
  run: LangSmithTraceRunInput;
  parentRunId?: string;
}): Promise<{ runId: string; traceUrl: string }> {
  const runId = normalizeOptionalString(options.run.id) ?? randomUUID();
  const result = await options.client.createRun({
    apiKey: options.apiKey,
    endpoint: options.endpoint,
    projectName: normalizeOptionalString(options.run.projectName) ?? options.projectName,
    runId,
    parentRunId: options.parentRunId,
    runName: requireNonEmptyString(options.run.runName, "runName"),
    runType: normalizeOptionalString(options.run.runType) ?? "chain",
    startedAt: normalizeOptionalTimestamp(options.run.startedAt) ?? new Date().toISOString(),
    finishedAt: normalizeOptionalTimestamp(options.run.finishedAt) ?? undefined,
    error: normalizeOptionalString(options.run.error) ?? undefined,
    inputs: options.run.inputs,
    outputs: options.run.outputs,
    metadata: options.run.metadata ?? {},
  });
  const persistedRunId = normalizeOptionalString(result.runId) ?? runId;

  for (const child of options.run.childRuns ?? []) {
    await exportLangSmithRunTree({
      ...options,
      run: child,
      parentRunId: persistedRunId,
    });
  }

  return {
    runId: persistedRunId,
    traceUrl: normalizeOptionalString(result.traceUrl) ?? buildLangSmithTraceUrl(options.endpoint, persistedRunId),
  };
}

function normalizeOptionalTimestamp(value: Date | string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return requireNonEmptyString(value, "timestamp");
}

function langSmithApiUrl(endpoint: string, path: string) {
  const normalizedEndpoint = endpoint.endsWith("/") ? endpoint : `${endpoint}/`;
  return new URL(path, normalizedEndpoint).toString();
}

async function requestLangSmithJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  const response = await fetchImpl(url, init);
  const text = await response.text();
  const parsed = text ? parseJson(text) : null;

  if (!response.ok) {
    const detail = text ? `: ${text.slice(0, 500)}` : "";
    throw new Error(`LangSmith request failed with HTTP ${response.status}${detail}`);
  }

  return parsed;
}

function compactObject(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function extractString(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return null;
}

function buildLangSmithTraceUrl(endpoint: string, runId: string) {
  try {
    const apiUrl = new URL(endpoint);

    if (apiUrl.hostname === "api.smith.langchain.com") {
      return `https://smith.langchain.com/runs/${encodeURIComponent(runId)}`;
    }

    if (apiUrl.hostname.endsWith(".smith.langchain.com")) {
      return `https://smith.langchain.com/runs/${encodeURIComponent(runId)}`;
    }

    return `${apiUrl.origin}/runs/${encodeURIComponent(runId)}`;
  } catch {
    return `https://smith.langchain.com/runs/${encodeURIComponent(runId)}`;
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getDefaultEnv(): Record<string, string | undefined> {
  const runtime = globalThis as {
    process?: {
      env?: Record<string, string | undefined>;
    };
  };

  return runtime.process?.env ?? {};
}

function normalizeOptionalTraceUrl(
  value: string | null | undefined,
  options: LangSmithTraceLinkValidationOptions,
) {
  const normalized = normalizeOptionalString(value);

  return normalized ? validateLangSmithTraceUrl(normalized, options) : null;
}

function normalizeSyncStatus(value: string | null | undefined): LangSmithTraceLinkSyncStatus {
  const normalized = normalizeOptionalString(value);

  if (normalized && (LANGSMITH_SYNC_STATUSES as readonly string[]).includes(normalized)) {
    return normalized as LangSmithTraceLinkSyncStatus;
  }

  throw new Error(`Unknown LangSmith sync status: ${String(value)}`);
}

function assertCreateInputHasRequiredLangSmithReference(input: {
  syncStatus: LangSmithTraceLinkSyncStatus;
  traceUrl: string | null;
  datasetId: string | null;
  experimentId: string | null;
  runId: string | null;
}) {
  if (input.syncStatus === "pending" || input.syncStatus === "failed") {
    return;
  }

  if (!input.traceUrl && !input.datasetId && !input.experimentId && !input.runId) {
    throw new Error("At least one LangSmith reference is required.");
  }
}

function requireNonEmptyString(value: unknown, fieldName: string) {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} is required.`);
  }

  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`${fieldName} is required.`);
  }

  return normalized;
}

function normalizeOptionalString(value: string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = value.trim();

  return normalized.length > 0 ? normalized : null;
}

function isAllowedHostname(hostname: string, allowedHostnames: readonly string[]) {
  return allowedHostnames.some((allowedHostname) => {
    const normalized = allowedHostname.toLowerCase();
    const candidate = hostname.toLowerCase();

    return candidate === normalized || candidate.endsWith(`.${normalized}`);
  });
}

function hasLangSmithReference(input: {
  traceUrl: string | null;
  datasetId: string | null;
  experimentId: string | null;
  runId: string | null;
}) {
  return Boolean(input.traceUrl || input.datasetId || input.experimentId || input.runId);
}

async function persistExportedLangSmithTraceLink(
  options: ExportAndPersistLangSmithTraceOptions,
  result: Extract<LangSmithTraceExportResult, { ok: true; skipped: false }>,
) {
  try {
    const updated = await updateLangSmithTraceLink(
      options.repository,
      options.linkId,
      {
        traceUrl: result.traceUrl ?? null,
        runId: result.runId ?? null,
        syncStatus: "exported",
      },
      options.validation,
    );

    if (hasLangSmithReference(updated)) {
      await options.onLinked?.(updated);
    }
  } catch (error) {
    await markLangSmithTraceLinkExportFailed(options);
    options.onError?.(error);
  }
}

async function markLangSmithTraceLinkExportFailed(options: ExportAndPersistLangSmithTraceOptions) {
  try {
    await updateLangSmithTraceLink(options.repository, options.linkId, {
      syncStatus: "failed",
    });
  } catch (error) {
    options.onError?.(error);
  }
}

function buildTraceLinkEventPayload(link: LangSmithTraceLink): Record<string, unknown> {
  return {
    langSmithTraceLinkId: link.id,
    traceUrl: link.traceUrl,
    datasetId: link.datasetId,
    experimentId: link.experimentId,
    runId: link.runId,
    syncStatus: link.syncStatus,
  };
}
