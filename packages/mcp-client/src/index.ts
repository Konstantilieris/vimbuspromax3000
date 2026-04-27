import type {
  McpServerAuthType,
  McpServerStatus,
  McpServerTransport,
  McpServerTrustLevel,
} from "@vimbuspromax3000/shared";
import { APPLY_PATCH_INPUT_SCHEMA, TASKGOBLIN_PATCH_SERVER_NAME } from "./wrappers/patch";

export { createMcpService, McpError, McpValidationError } from "./service";
export { STANDARD_MCP_SERVERS } from "./definitions";
export { normalizeArgs, hashArgs } from "./args";
export { validateToolArguments } from "./validation";
export { McpPolicyError, McpWrapperExecutionError } from "./wrappers";
export type {
  ApproveToolCallInput,
  CreateToolCallInput,
  ExecuteToolCallResult,
  McpService,
} from "./service";
export type { McpWrapperResult } from "./wrappers";

export const STANDARD_MCP_SERVER_NAMES = [
  "taskgoblin-fs-git",
  "taskgoblin-patch",
  "taskgoblin-shell",
  "taskgoblin-browser",
  "taskgoblin-db",
] as const;

export type StandardMcpServerName = (typeof STANDARD_MCP_SERVER_NAMES)[number];
export type McpToolMutability = "read" | "write" | "execute";
export type McpToolStatus = "active" | "disabled";

export type McpToolDefinition = {
  name: string;
  description: string;
  mutability: McpToolMutability;
  approvalRequired: boolean;
  inputSchema: Record<string, unknown>;
  status?: McpToolStatus;
};

export type McpServerDefinition = {
  name: StandardMcpServerName | string;
  label: string;
  transport: McpServerTransport;
  endpoint?: string;
  command?: string;
  args?: string[];
  env?: string[];
  trustLevel: McpServerTrustLevel;
  authType: McpServerAuthType;
  status: McpServerStatus;
  tools: McpToolDefinition[];
  config?: Record<string, unknown>;
  credentialEnv?: string;
  credentialLabel?: string;
  probe?: McpServerProbeConfig;
};

export type McpServerProbeConfig = {
  command?: string;
  args?: string[];
  endpoint?: string;
  timeoutMs?: number;
};

export type ApiMcpServer = {
  id: string;
  projectId?: string;
  name: string;
  transport: McpServerTransport | string;
  endpoint?: string | null;
  trustLevel: McpServerTrustLevel | string;
  status: McpServerStatus | string;
  authType: McpServerAuthType | string;
  credentialRefId?: string | null;
  lastVerifiedAt?: Date | string | null;
  lastError?: string | null;
  configJson?: string | null;
  credentialRef?: ApiMcpCredentialRef | null;
  tools?: ApiMcpTool[];
};

export type ApiMcpCredentialRef = {
  id: string;
  kind: string;
  label: string;
  storageType: string;
  reference: string;
  status: string;
};

export type ApiMcpTool = {
  id?: string;
  name: string;
  description?: string | null;
  mutability: string;
  approvalRequired: boolean;
  inputSchemaJson?: string;
  status?: string;
};

export type McpServerSetupInput = {
  projectId: string;
  definitions?: readonly McpServerDefinition[];
  existingServers?: readonly ApiMcpServer[];
};

export type McpServerSetupPlan = {
  projectId: string;
  create: McpServerSetupPayload[];
  update: Array<{
    serverId: string;
    serverName: string;
    payload: McpServerSetupPayload;
  }>;
  unchanged: string[];
};

export type McpServerSetupPayload = {
  projectId: string;
  name: string;
  label: string;
  transport: McpServerTransport;
  endpoint: string | null;
  trustLevel: McpServerTrustLevel;
  status: McpServerStatus;
  authType: McpServerAuthType;
  credentialEnv?: string;
  credentialLabel?: string;
  config: Record<string, unknown>;
  tools: Array<{
    name: string;
    description: string;
    mutability: McpToolMutability;
    approvalRequired: boolean;
    inputSchema: Record<string, unknown>;
    status: McpToolStatus;
  }>;
};

export type McpClientHttpOptions = {
  apiUrl: string;
  request?: typeof fetch;
};

export type ApplyMcpServerSetupOptions = McpClientHttpOptions & {
  projectId: string;
  definitions?: readonly McpServerDefinition[];
};

export type ApplyMcpServerSetupResult = McpServerSetupPlan & {
  created: ApiMcpServer[];
  updated: ApiMcpServer[];
};

export type SpawnInvocation = {
  command: string;
  args: readonly string[];
  env: Record<string, string | undefined>;
  timeoutMs: number;
};

export type SpawnResult = {
  code: number | null;
  stdout?: string;
  stderr?: string;
  error?: unknown;
};

export type SpawnProbe = (invocation: SpawnInvocation) => Promise<SpawnResult> | SpawnResult;

export type ProbeMcpServerOptions = {
  spawn?: SpawnProbe;
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
};

export type ProbeMcpServerResult = {
  name: string;
  ok: boolean;
  transport: McpServerTransport;
  code?: number | null;
  message: string;
  missingEnv: string[];
  stdout?: string;
  stderr?: string;
};

export type McpServerPrerequisiteResult = {
  name: string;
  ok: boolean;
  missingEnv: string[];
};

export type McpDiscoveredServer = {
  name: string;
  label: string;
  transport: McpServerTransport;
  tools: Array<McpToolDefinition & { serverName: string }>;
};

const JSON_OBJECT_SCHEMA = {
  type: "object",
  additionalProperties: true,
} satisfies Record<string, unknown>;

const PATH_SCHEMA = {
  type: "object",
  properties: {
    path: { type: "string" },
  },
  required: ["path"],
  additionalProperties: false,
} satisfies Record<string, unknown>;

const COMMAND_SCHEMA = {
  type: "object",
  properties: {
    command: { type: "string" },
    cwd: { type: "string" },
    timeoutMs: { type: "number" },
  },
  required: ["command"],
  additionalProperties: false,
} satisfies Record<string, unknown>;

export function getStandardMcpServerDefinitions(): McpServerDefinition[] {
  return [
    {
      name: "taskgoblin-fs-git",
      label: "TaskGoblin filesystem and git",
      transport: "stdio",
      command: "bun",
      args: ["--filter", "@vimbuspromax3000/mcp-server-fs-git", "start"],
      trustLevel: "trusted",
      authType: "none",
      status: "pending",
      tools: [
        tool("read_file", "Read an allowlisted workspace file.", "read", false, PATH_SCHEMA),
        tool("grep", "Search allowlisted workspace files.", "read", false, JSON_OBJECT_SCHEMA),
        tool("git_status", "Read git status for the workspace.", "read", false, JSON_OBJECT_SCHEMA),
        tool("git_diff", "Read git diff metadata and patches.", "read", false, JSON_OBJECT_SCHEMA),
        tool("apply_patch", "Apply a reviewed patch to the workspace.", "write", true, JSON_OBJECT_SCHEMA),
      ],
    },
    {
      name: TASKGOBLIN_PATCH_SERVER_NAME,
      label: "TaskGoblin patch application",
      transport: "stdio",
      command: "bun",
      args: ["--filter", "@vimbuspromax3000/mcp-server-patch", "start"],
      trustLevel: "trusted",
      authType: "none",
      status: "pending",
      tools: [
        tool(
          "apply_patch",
          "Apply a unified diff to the active execution worktree using git apply --3way.",
          "write",
          true,
          APPLY_PATCH_INPUT_SCHEMA as unknown as Record<string, unknown>,
        ),
      ],
    },
    {
      name: "taskgoblin-shell",
      label: "TaskGoblin approved shell",
      transport: "stdio",
      command: "bun",
      args: ["--filter", "@vimbuspromax3000/mcp-server-shell", "start"],
      trustLevel: "restricted",
      authType: "none",
      status: "pending",
      tools: [tool("run_command", "Run an approved shell command.", "execute", true, COMMAND_SCHEMA)],
    },
    {
      name: "taskgoblin-browser",
      label: "TaskGoblin browser automation",
      transport: "stdio",
      command: "bun",
      args: ["--filter", "@vimbuspromax3000/mcp-server-browser", "start"],
      trustLevel: "restricted",
      authType: "none",
      status: "pending",
      tools: [
        tool("browser_navigate", "Navigate a browser page.", "execute", true, JSON_OBJECT_SCHEMA),
        tool("browser_screenshot", "Capture a browser screenshot.", "read", false, JSON_OBJECT_SCHEMA),
        tool("browser_accessibility", "Inspect browser accessibility state.", "read", false, JSON_OBJECT_SCHEMA),
      ],
    },
    {
      name: "taskgoblin-db",
      label: "TaskGoblin read-only database",
      transport: "stdio",
      command: "bun",
      args: ["--filter", "@vimbuspromax3000/mcp-server-db", "start"],
      env: ["DATABASE_URL"],
      trustLevel: "trusted",
      authType: "env_passthrough",
      credentialEnv: "DATABASE_URL",
      credentialLabel: "TaskGoblin database MCP env",
      status: "pending",
      tools: [tool("db_inspect", "Inspect project database records read-only.", "read", false, JSON_OBJECT_SCHEMA)],
    },
  ];
}

export function buildMcpServerSetupPlan(input: McpServerSetupInput): McpServerSetupPlan {
  const definitions = input.definitions ?? getStandardMcpServerDefinitions();
  const existingByName = new Map((input.existingServers ?? []).map((server) => [server.name, server]));
  const plan: McpServerSetupPlan = {
    projectId: input.projectId,
    create: [],
    update: [],
    unchanged: [],
  };

  for (const definition of definitions) {
    const payload = toSetupPayload(input.projectId, definition);
    const existing = existingByName.get(definition.name);

    if (!existing) {
      plan.create.push(payload);
      continue;
    }

    if (isServerEquivalent(existing, payload)) {
      plan.unchanged.push(definition.name);
      continue;
    }

    plan.update.push({
      serverId: existing.id,
      serverName: existing.name,
      payload,
    });
  }

  return plan;
}

export async function applyMcpServerSetup(options: ApplyMcpServerSetupOptions): Promise<ApplyMcpServerSetupResult> {
  const request = options.request ?? fetch;
  const apiUrl = withoutTrailingSlash(options.apiUrl);
  const query = new URLSearchParams({ projectId: options.projectId });
  const existingServers = await requestJson<ApiMcpServer[]>(request, `${apiUrl}/mcp/servers?${query.toString()}`);
  const plan = buildMcpServerSetupPlan({
    projectId: options.projectId,
    definitions: options.definitions,
    existingServers,
  });

  const created = await Promise.all(
    plan.create.map((payload) =>
      requestJson<ApiMcpServer>(request, `${apiUrl}/mcp/servers`, {
        method: "POST",
        body: payload,
      }),
    ),
  );
  const updated = await Promise.all(
    plan.update.map((entry) =>
      requestJson<ApiMcpServer>(request, `${apiUrl}/mcp/servers/${encodeURIComponent(entry.serverId)}`, {
        method: "PATCH",
        body: entry.payload,
      }),
    ),
  );

  return {
    ...plan,
    created,
    updated,
  };
}

export async function probeMcpServerDefinition(
  definition: McpServerDefinition,
  options: ProbeMcpServerOptions = {},
): Promise<ProbeMcpServerResult> {
  const missingEnv = getMissingMcpServerEnv(definition, options.env ?? {});

  if (missingEnv.length > 0) {
    return {
      name: definition.name,
      ok: false,
      transport: definition.transport,
      message: `Missing environment: ${missingEnv.join(", ")}`,
      missingEnv,
    };
  }

  if (definition.transport === "http") {
    return probeHttpServer(definition, options);
  }

  return probeStdioServer(definition, options, missingEnv);
}

export async function probeStandardMcpServers(
  options: ProbeMcpServerOptions & { definitions?: readonly McpServerDefinition[] } = {},
): Promise<ProbeMcpServerResult[]> {
  const definitions = options.definitions ?? getStandardMcpServerDefinitions();
  return Promise.all(definitions.map((definition) => probeMcpServerDefinition(definition, options)));
}

export function checkMcpServerPrerequisites(
  definition: McpServerDefinition,
  env: Record<string, string | undefined> = {},
): McpServerPrerequisiteResult {
  const missingEnv = getMissingMcpServerEnv(definition, env);

  return {
    name: definition.name,
    ok: missingEnv.length === 0,
    missingEnv,
  };
}

export function checkStandardMcpServerPrerequisites(
  options: { env?: Record<string, string | undefined>; definitions?: readonly McpServerDefinition[] } = {},
): McpServerPrerequisiteResult[] {
  const definitions = options.definitions ?? getStandardMcpServerDefinitions();
  return definitions.map((definition) => checkMcpServerPrerequisites(definition, options.env ?? {}));
}

export function discoverMcpServerTools(
  definitions: readonly McpServerDefinition[] = getStandardMcpServerDefinitions(),
): McpDiscoveredServer[] {
  return definitions.map((definition) => ({
    name: definition.name,
    label: definition.label,
    transport: definition.transport,
    tools: definition.tools.map((entry) => ({
      ...entry,
      serverName: definition.name,
      status: entry.status ?? "active",
      inputSchema: { ...entry.inputSchema },
    })),
  }));
}

export async function testMcpServerDefinition(
  definition: McpServerDefinition,
  options: ProbeMcpServerOptions = {},
): Promise<ProbeMcpServerResult> {
  return probeMcpServerDefinition(definition, options);
}

export function getMissingMcpServerEnv(
  definition: McpServerDefinition,
  env: Record<string, string | undefined>,
): string[] {
  return (definition.env ?? []).filter((key) => !env[key]);
}

export function normalizeMcpServerDefinition(definition: McpServerDefinition): McpServerDefinition {
  return {
    ...definition,
    args: definition.args ? [...definition.args] : undefined,
    env: definition.env ? [...definition.env] : undefined,
    tools: definition.tools.map((entry) => ({ ...entry, inputSchema: { ...entry.inputSchema } })),
    config: definition.config ? { ...definition.config } : undefined,
    credentialEnv: definition.credentialEnv,
    credentialLabel: definition.credentialLabel,
    probe: definition.probe ? { ...definition.probe } : undefined,
  };
}

async function probeStdioServer(
  definition: McpServerDefinition,
  options: ProbeMcpServerOptions,
  missingEnv: string[],
): Promise<ProbeMcpServerResult> {
  const spawn = options.spawn;

  if (!spawn) {
    return {
      name: definition.name,
      ok: false,
      transport: definition.transport,
      message: "No spawn probe was provided.",
      missingEnv,
    };
  }

  const command = definition.probe?.command ?? definition.command;
  if (!command) {
    return {
      name: definition.name,
      ok: false,
      transport: definition.transport,
      message: "No stdio command configured.",
      missingEnv,
    };
  }

  const timeoutMs = definition.probe?.timeoutMs ?? options.timeoutMs ?? 5_000;
  const result = await spawn({
    command,
    args: definition.probe?.args ?? ["--version"],
    env: { ...options.env },
    timeoutMs,
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join(" ").trim();
  const ok = result.code === 0;

  return {
    name: definition.name,
    ok,
    transport: definition.transport,
    code: result.code,
    message: ok ? "Probe command succeeded." : output || "Probe command failed.",
    missingEnv,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function probeHttpServer(
  definition: McpServerDefinition,
  options: ProbeMcpServerOptions,
): Promise<ProbeMcpServerResult> {
  const request = options.fetch ?? fetch;
  const endpoint = definition.probe?.endpoint ?? definition.endpoint;

  if (!endpoint) {
    return {
      name: definition.name,
      ok: false,
      transport: definition.transport,
      message: "No HTTP endpoint configured.",
      missingEnv: [],
    };
  }

  try {
    const response = await request(endpoint, { method: "GET" });
    return {
      name: definition.name,
      ok: response.ok,
      transport: definition.transport,
      code: response.status,
      message: response.ok ? "HTTP probe succeeded." : `HTTP probe returned ${response.status}.`,
      missingEnv: [],
    };
  } catch (error) {
    return {
      name: definition.name,
      ok: false,
      transport: definition.transport,
      message: error instanceof Error ? error.message : String(error),
      missingEnv: [],
    };
  }
}

function toSetupPayload(projectId: string, definition: McpServerDefinition): McpServerSetupPayload {
  return {
    projectId,
    name: definition.name,
    label: definition.label,
    transport: definition.transport,
    endpoint: definition.endpoint ?? null,
    trustLevel: definition.trustLevel,
    status: definition.status,
    authType: definition.authType,
    credentialEnv: definition.credentialEnv ?? inferCredentialEnv(definition),
    credentialLabel: definition.credentialLabel,
    config: compactObject({
      ...(definition.config ?? {}),
      command: definition.command,
      args: definition.args ?? [],
      env: definition.env ?? [],
    }),
    tools: definition.tools
      .map((entry) => ({
        name: entry.name,
        description: entry.description,
        mutability: entry.mutability,
        approvalRequired: entry.approvalRequired,
        inputSchema: entry.inputSchema,
        status: entry.status ?? "active",
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function isServerEquivalent(existing: ApiMcpServer, payload: McpServerSetupPayload): boolean {
  const existingConfig = parseJsonObject(existing.configJson);

  return (
    existing.name === payload.name &&
    existing.transport === payload.transport &&
    (existing.endpoint ?? null) === payload.endpoint &&
    existing.trustLevel === payload.trustLevel &&
    existing.status === payload.status &&
    existing.authType === payload.authType &&
    isCredentialEquivalent(existing, payload) &&
    stableJson(existingConfig) === stableJson(payload.config) &&
    stableJson(normalizeApiTools(existing.tools ?? [])) === stableJson(payload.tools)
  );
}

function normalizeApiTools(tools: readonly ApiMcpTool[]): McpServerSetupPayload["tools"] {
  return tools
    .map((entry) => ({
      name: entry.name,
      description: entry.description ?? "",
      mutability: entry.mutability as McpToolMutability,
      approvalRequired: entry.approvalRequired,
      inputSchema: parseJsonObject(entry.inputSchemaJson),
      status: (entry.status as McpToolStatus | undefined) ?? "active",
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
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

function tool(
  name: string,
  description: string,
  mutability: McpToolMutability,
  approvalRequired: boolean,
  inputSchema: Record<string, unknown>,
): McpToolDefinition {
  return {
    name,
    description,
    mutability,
    approvalRequired,
    inputSchema,
  };
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }

  const parsed = JSON.parse(value) as unknown;
  return isObject(parsed) && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (!isObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)]),
  );
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function inferCredentialEnv(definition: McpServerDefinition): string | undefined {
  if (definition.authType !== "env_passthrough") {
    return undefined;
  }

  return definition.env?.length === 1 ? definition.env[0] : undefined;
}

function isCredentialEquivalent(existing: ApiMcpServer, payload: McpServerSetupPayload): boolean {
  if (!payload.credentialEnv) {
    return true;
  }

  const credentialRef = existing.credentialRef;

  return (
    credentialRef?.kind === "mcp_server_env" &&
    credentialRef.storageType === "env" &&
    credentialRef.reference === payload.credentialEnv &&
    (!payload.credentialLabel || credentialRef.label === payload.credentialLabel)
  );
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
