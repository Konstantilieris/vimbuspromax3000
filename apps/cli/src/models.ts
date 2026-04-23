import { MODEL_SLOT_KEYS, PRODUCT_NAME, type ModelSlotKey } from "@vimbuspromax3000/shared";

export const MODEL_COMMANDS = [
  "/models",
  "/models:add-provider",
  "/models:add-model",
  "/models:assign-slot",
  "/models:test",
  "/models:setup",
] as const;

export type ModelSlotAssignmentView = {
  slotKey: ModelSlotKey;
  primary?: string;
  fallback?: string;
};

export type ModelsViewState = {
  providers?: string[];
  models?: string[];
  slots?: ModelSlotAssignmentView[];
};

export type ModelsCommandOptions = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
};

type ParsedOptions = Record<string, string | undefined>;

type ApiProvider = {
  id: string;
  key: string;
  label: string;
  providerKind: string;
  status: string;
};

type ApiModel = {
  id: string;
  name: string;
  slug: string;
  provider?: {
    key: string;
  };
};

type ApiSlot = {
  slotKey: ModelSlotKey;
  primaryModel?: ApiModel | null;
  fallbackModel?: ApiModel | null;
};

export function getModelsViewLines(state: ModelsViewState = {}): string[] {
  const providers = state.providers ?? [];
  const models = state.models ?? [];
  const slots = state.slots ?? MODEL_SLOT_KEYS.map((slotKey) => ({ slotKey }));

  return [
    `${PRODUCT_NAME} model registry`,
    `Commands: ${MODEL_COMMANDS.join(" ")}`,
    `Providers: ${providers.length > 0 ? providers.join(", ") : "none registered"}`,
    `Models: ${models.length > 0 ? models.join(", ") : "none registered"}`,
    "Slots:",
    ...slots.map(formatSlotAssignment),
  ];
}

export function getModelsViewSnapshot(state: ModelsViewState = {}): string {
  return getModelsViewLines(state).join("\n");
}

export function isModelsCommand(value: string): boolean {
  return MODEL_COMMANDS.includes(value as (typeof MODEL_COMMANDS)[number]);
}

export async function runModelsCommand(
  args: readonly string[],
  options: ModelsCommandOptions = {},
): Promise<string> {
  const command = args.find(isModelsCommand) ?? "/models";
  const parsed = parseOptions(args.filter((arg) => arg !== command));
  const apiUrl = withoutTrailingSlash(parsed["api-url"] ?? options.env?.VIMBUS_API_URL ?? "http://localhost:3000");
  const request = options.fetch ?? fetch;

  switch (command) {
    case "/models":
      return runListModels(apiUrl, parsed, request);
    case "/models:add-provider":
      return runAddProvider(apiUrl, parsed, request);
    case "/models:add-model":
      return runAddModel(apiUrl, parsed, request);
    case "/models:assign-slot":
      return runAssignSlot(apiUrl, parsed, request);
    case "/models:test":
      return runTestSlot(apiUrl, parsed, request);
    case "/models:setup":
      return runSetup(apiUrl, parsed, request);
  }

  throw new Error(`Unknown models command: ${command}`);
}

function formatSlotAssignment(slot: ModelSlotAssignmentView): string {
  const primary = slot.primary ?? "unassigned";
  const fallback = slot.fallback ? ` fallback=${slot.fallback}` : "";

  return `- ${slot.slotKey}: ${primary}${fallback}`;
}

async function runListModels(apiUrl: string, options: ParsedOptions, request: typeof fetch): Promise<string> {
  const projectId = requireOption(options, "project-id");
  const query = `projectId=${encodeURIComponent(projectId)}`;
  const [providers, models, slots] = await Promise.all([
    requestJson<ApiProvider[]>(request, `${apiUrl}/model-providers?${query}`),
    requestJson<ApiModel[]>(request, `${apiUrl}/models?${query}`),
    requestJson<ApiSlot[]>(request, `${apiUrl}/model-slots?${query}`),
  ]);

  return getModelsViewSnapshot({
    providers: providers.map((provider) => `${provider.key} (${provider.providerKind}, ${provider.status})`),
    models: models.map(formatApiModel),
    slots: slots.map((slot) => ({
      slotKey: slot.slotKey,
      primary: slot.primaryModel ? formatApiModel(slot.primaryModel) : undefined,
      fallback: slot.fallbackModel ? formatApiModel(slot.fallbackModel) : undefined,
    })),
  });
}

async function runAddProvider(apiUrl: string, options: ParsedOptions, request: typeof fetch): Promise<string> {
  const projectId = requireOption(options, "project-id");
  const key = requireOption(options, "key");
  const secretEnv = options["secret-env"];
  let secretRefId = options["secret-ref-id"];

  if (secretEnv) {
    const secretRef = await requestJson<{ id: string }>(request, `${apiUrl}/model-secret-refs`, {
      method: "POST",
      body: {
        projectId,
        label: options["secret-label"] ?? `${key} api key`,
        reference: secretEnv,
      },
    });
    secretRefId = secretRef.id;
  }

  const provider = await requestJson<ApiProvider>(request, `${apiUrl}/model-providers`, {
    method: "POST",
    body: {
      projectId,
      key,
      label: options.label ?? key,
      providerKind: requireOption(options, "provider-kind"),
      baseUrl: options["base-url"] ?? null,
      authType: options["auth-type"] ?? (secretRefId ? "api_key" : "none"),
      secretRefId: secretRefId ?? null,
      status: options.status ?? "pending_approval",
    },
  });

  return `Added provider ${provider.key} (${provider.providerKind}) with status ${provider.status}.`;
}

async function runAddModel(apiUrl: string, options: ParsedOptions, request: typeof fetch): Promise<string> {
  const capabilities = parseCapabilities(options.capabilities);
  const contextWindow = options["context-window"] ? Number(options["context-window"]) : null;
  const model = await requestJson<ApiModel>(request, `${apiUrl}/models`, {
    method: "POST",
    body: {
      providerId: requireOption(options, "provider-id"),
      name: requireOption(options, "name"),
      slug: requireOption(options, "slug"),
      supportsTools: capabilities.includes("tools"),
      supportsVision: capabilities.includes("vision"),
      supportsJson: capabilities.includes("json"),
      supportsStreaming: capabilities.includes("streaming"),
      contextWindow,
      costTier: options["cost-tier"] ?? "medium",
      speedTier: options["speed-tier"] ?? "balanced",
      reasoningTier: options["reasoning-tier"] ?? "standard",
    },
  });

  return `Added model ${model.slug} (${model.id}).`;
}

async function runAssignSlot(apiUrl: string, options: ParsedOptions, request: typeof fetch): Promise<string> {
  const slot = requireOption(options, "slot");
  const assignment = await requestJson<ApiSlot>(request, `${apiUrl}/model-slots/${encodeURIComponent(slot)}/assign`, {
    method: "POST",
    body: {
      projectId: requireOption(options, "project-id"),
      registeredModelId: requireOption(options, "model-id"),
      fallbackRegisteredModelId: options["fallback-model-id"] ?? null,
    },
  });

  return `Assigned ${assignment.slotKey} to ${assignment.primaryModel ? formatApiModel(assignment.primaryModel) : "unassigned"}.`;
}

async function runTestSlot(apiUrl: string, options: ParsedOptions, request: typeof fetch): Promise<string> {
  const slot = requireOption(options, "slot");
  const result = await requestJson<{
    ok: boolean;
    value?: { concreteModelName: string; usedFallback: boolean };
    code?: string;
    message?: string;
  }>(request, `${apiUrl}/model-slots/${encodeURIComponent(slot)}/test`, {
    method: "POST",
    body: {
      projectId: requireOption(options, "project-id"),
      requiredCapabilities: parseCapabilities(options.capabilities),
    },
  });

  if (!result.ok) {
    return `Slot ${slot} failed: ${result.code ?? "unknown"} ${result.message ?? ""}`.trim();
  }

  return `Slot ${slot} resolved to ${result.value?.concreteModelName ?? "unknown"}${
    result.value?.usedFallback ? " using fallback" : ""
  }.`;
}

async function runSetup(apiUrl: string, options: ParsedOptions, request: typeof fetch): Promise<string> {
  const setup = await requestJson<{
    project: { id: string; name: string };
    provider: { id: string; key: string; status: string };
    model: { id: string; slug: string };
    slots: Array<{ slotKey: string }>;
  }>(request, `${apiUrl}/model-setup`, {
    method: "POST",
    body: {
      projectId: options["project-id"],
      projectName: options["project-name"],
      rootPath: options["root-path"],
      baseBranch: options["base-branch"],
      secretEnv: options["secret-env"],
      secretLabel: options["secret-label"],
      providerKey: requireOption(options, "provider-key"),
      providerLabel: options["provider-label"],
      providerKind: requireOption(options, "provider-kind"),
      baseUrl: options["base-url"] ?? null,
      authType: options["auth-type"],
      providerStatus: options.status,
      modelName: requireOption(options, "model-name"),
      modelSlug: requireOption(options, "model-slug"),
      capabilities: parseCapabilities(options.capabilities),
      contextWindow: options["context-window"] ? Number(options["context-window"]) : null,
      costTier: options["cost-tier"],
      speedTier: options["speed-tier"],
      reasoningTier: options["reasoning-tier"],
      slotKeys: parseOptionalCsv(options.slots ?? options.slot),
    },
  });

  return `Setup project ${setup.project.name} (${setup.project.id}); provider ${setup.provider.key} (${setup.provider.status}); model ${setup.model.slug}; slots ${setup.slots
    .map((slot) => slot.slotKey)
    .join(", ")}.`;
}

async function requestJson<T>(
  request: typeof fetch,
  url: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await request(url, {
    method: options.method ?? "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : undefined;

  if (!response.ok) {
    const message = isObject(payload) && typeof payload.error === "string" ? payload.error : response.statusText;
    throw new Error(`API ${response.status}: ${message}`);
  }

  return payload as T;
}

function parseOptions(args: readonly string[]): ParsedOptions {
  const parsed: ParsedOptions = {};

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (!token?.startsWith("--")) {
      continue;
    }

    const inlineValueIndex = token.indexOf("=");
    if (inlineValueIndex >= 0) {
      parsed[token.slice(2, inlineValueIndex)] = token.slice(inlineValueIndex + 1);
      continue;
    }

    const next = args[index + 1];
    parsed[token.slice(2)] = next && !next.startsWith("--") ? next : "true";

    if (next && !next.startsWith("--")) {
      index += 1;
    }
  }

  return parsed;
}

function requireOption(options: ParsedOptions, name: string): string {
  const value = options[name];

  if (!value || value === "true") {
    throw new Error(`Missing required option --${name}.`);
  }

  return value;
}

function parseCapabilities(value: string | undefined): string[] {
  return parseCsv(value);
}

function parseCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((capability) => capability.trim())
    .filter(Boolean);
}

function parseOptionalCsv(value: string | undefined): string[] | undefined {
  const values = parseCsv(value);

  return values.length > 0 ? values : undefined;
}

function formatApiModel(model: ApiModel): string {
  return `${model.provider?.key ? `${model.provider.key}:` : ""}${model.slug}`;
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function isObject(value: unknown): value is { error?: unknown } {
  return typeof value === "object" && value !== null;
}
