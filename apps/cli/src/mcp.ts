import { PRODUCT_NAME } from "@vimbuspromax3000/shared";

export const MCP_COMMANDS = [
  "/mcp",
  "/mcp:servers",
  "/mcp:tools",
  "/mcp:calls",
  "/mcp:approve-call",
  "/mcp:setup",
  "/mcp:add-server",
  "/mcp:set-secret",
  "/mcp:probe",
] as const;

export type McpCommand = (typeof MCP_COMMANDS)[number];

export type McpCommandOptions = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
};

export type ParsedMcpCommand = {
  command: McpCommand;
  options: McpParsedOptions;
  apiUrl: string;
};

export type McpServerView = {
  id?: string;
  name: string;
  transport: string;
  status: string;
  authType?: string;
  trustLevel?: string;
  endpoint?: string | null;
  lastVerifiedAt?: string | null;
  lastError?: string | null;
};

export type McpToolView = {
  serverName?: string;
  name: string;
  description?: string | null;
  mutability: string;
  approvalRequired: boolean;
  status?: string;
};

export type McpToolCallView = {
  id: string;
  serverName: string;
  toolName: string;
  status: string;
  mutability: string;
  approvalId?: string | null;
  latencyMs?: number | null;
  resultSummary?: string | null;
  errorSummary?: string | null;
  createdAt?: string;
};

export type McpParsedOptions = Record<string, string | undefined>;

type ApiMcpServer = McpServerView & {
  tools?: McpToolView[];
};

type ApiMcpSetupResult = {
  projectId: string;
  created?: ApiMcpServer[];
  updated?: ApiMcpServer[];
  unchanged?: string[];
  servers?: ApiMcpServer[];
};

type ApiMcpProbeResult = {
  name: string;
  ok: boolean;
  transport?: string;
  message?: string;
  missingEnv?: string[];
};

export function isMcpCommand(value: string): boolean {
  return MCP_COMMANDS.includes(value as McpCommand);
}

export function parseMcpCommand(args: readonly string[], env: Record<string, string | undefined> = {}): ParsedMcpCommand {
  const command = (args.find(isMcpCommand) as McpCommand | undefined) ?? "/mcp";
  const options = parseMcpOptions(args.filter((arg) => arg !== command));
  const apiUrl = withoutTrailingSlash(options["api-url"] ?? env.VIMBUS_API_URL ?? "http://localhost:3000");

  return {
    command,
    options,
    apiUrl,
  };
}

export async function runMcpCommand(args: readonly string[], commandOptions: McpCommandOptions = {}): Promise<string> {
  const parsed = parseMcpCommand(args, commandOptions.env);
  const request = commandOptions.fetch ?? fetch;

  switch (parsed.command) {
    case "/mcp":
      return getMcpViewSnapshot();
    case "/mcp:servers":
      return runListMcpServers(parsed.apiUrl, parsed.options, request);
    case "/mcp:tools":
      return runListMcpTools(parsed.apiUrl, parsed.options, request);
    case "/mcp:calls":
      return runListMcpCalls(parsed.apiUrl, parsed.options, request);
    case "/mcp:approve-call":
      return runApproveMcpCall(parsed.apiUrl, parsed.options, request);
    case "/mcp:setup":
      return runSetupMcp(parsed.apiUrl, parsed.options, request);
    case "/mcp:add-server":
      return runAddMcpServer(parsed.apiUrl, parsed.options, request);
    case "/mcp:set-secret":
      return runSetMcpSecret(parsed.apiUrl, parsed.options, request);
    case "/mcp:probe":
      return runProbeMcp(parsed.apiUrl, parsed.options, request);
  }

  throw new Error(`Unknown MCP command: ${parsed.command}`);
}

export function getMcpViewSnapshot(): string {
  return [
    `${PRODUCT_NAME} MCP`,
    `Commands: ${MCP_COMMANDS.join(" ")}`,
    "Use --api-url to target a non-default API server.",
  ].join("\n");
}

export function getMcpServersViewSnapshot(servers: readonly McpServerView[]): string {
  const lines = [`${PRODUCT_NAME} MCP servers`];

  if (servers.length === 0) {
    lines.push("No MCP servers.");
  } else {
    lines.push(...servers.map(formatMcpServer));
  }

  return lines.join("\n");
}

export function getMcpToolsViewSnapshot(tools: readonly McpToolView[]): string {
  const lines = [`${PRODUCT_NAME} MCP tools`];

  if (tools.length === 0) {
    lines.push("No MCP tools.");
  } else {
    lines.push(...tools.map(formatMcpTool));
  }

  return lines.join("\n");
}

export function getMcpCallsViewSnapshot(calls: readonly McpToolCallView[]): string {
  const lines = [`${PRODUCT_NAME} MCP calls`];

  if (calls.length === 0) {
    lines.push("No MCP calls.");
  } else {
    lines.push(...calls.map(formatMcpCall));
  }

  return lines.join("\n");
}

async function runListMcpServers(apiUrl: string, options: McpParsedOptions, request: typeof fetch): Promise<string> {
  const query = new URLSearchParams();

  if (options["project-id"]) {
    query.set("projectId", options["project-id"]);
  }

  const servers = await requestJson<ApiMcpServer[]>(
    request,
    `${apiUrl}/mcp/servers${query.size > 0 ? `?${query.toString()}` : ""}`,
  );

  return getMcpServersViewSnapshot(servers);
}

async function runListMcpTools(apiUrl: string, options: McpParsedOptions, request: typeof fetch): Promise<string> {
  const taskId = requireOption(options, "task-id");
  const tools = await requestJson<McpToolView[]>(
    request,
    `${apiUrl}/tasks/${encodeURIComponent(taskId)}/mcp/tools`,
  );

  return getMcpToolsViewSnapshot(tools);
}

async function runListMcpCalls(apiUrl: string, options: McpParsedOptions, request: typeof fetch): Promise<string> {
  const executionId = requireOption(options, "execution-id");
  const calls = await requestJson<McpToolCallView[]>(
    request,
    `${apiUrl}/executions/${encodeURIComponent(executionId)}/mcp/calls`,
  );

  return getMcpCallsViewSnapshot(calls);
}

async function runApproveMcpCall(apiUrl: string, options: McpParsedOptions, request: typeof fetch): Promise<string> {
  const executionId = requireOption(options, "execution-id");
  const callId = requireOption(options, "call-id");
  const approval = await requestJson<{ status: string; subjectId?: string }>(
    request,
    `${apiUrl}/executions/${encodeURIComponent(executionId)}/mcp/calls/${encodeURIComponent(callId)}/approve`,
    {
      method: "POST",
      body: {
        projectId: options["project-id"],
        operator: options.operator,
        reason: options.reason,
      },
    },
  );

  return `Recorded ${approval.status} MCP approval for ${approval.subjectId ?? callId}.`;
}

async function runSetupMcp(apiUrl: string, options: McpParsedOptions, request: typeof fetch): Promise<string> {
  const result = await requestJson<ApiMcpSetupResult>(request, `${apiUrl}/mcp/setup`, {
    method: "POST",
    body: {
      projectId: requireOption(options, "project-id"),
      servers: parseOptionalCsv(options.servers ?? options.server),
      activate: parseBooleanOption(options.activate),
    },
  });
  const created = result.created?.length ?? 0;
  const updated = result.updated?.length ?? 0;
  const unchanged = result.unchanged?.length ?? 0;

  return `Setup MCP for project ${result.projectId}: created=${created} updated=${updated} unchanged=${unchanged}.`;
}

async function runAddMcpServer(apiUrl: string, options: McpParsedOptions, request: typeof fetch): Promise<string> {
  const name = requireOption(options, "name");
  const secretRefId = options["secret-ref-id"];
  const secretEnv = options["secret-env"];
  const server = await requestJson<ApiMcpServer>(request, `${apiUrl}/mcp/servers`, {
    method: "POST",
    body: {
      projectId: requireOption(options, "project-id"),
      name,
      label: options.label ?? name,
      transport: options.transport ?? "stdio",
      endpoint: options.endpoint ?? null,
      trustLevel: options["trust-level"] ?? "restricted",
      status: options.status ?? "pending",
      authType: options["auth-type"] ?? (secretRefId || secretEnv ? "env_passthrough" : "none"),
      credentialRefId: secretRefId ?? undefined,
      credentialEnv: secretEnv ?? undefined,
      credentialLabel: options["secret-label"] ?? undefined,
      config: buildServerConfig(options),
      tools: [],
    },
  });

  return `Added MCP server ${server.name} (${server.transport}) with status ${server.status}.`;
}

async function runSetMcpSecret(apiUrl: string, options: McpParsedOptions, request: typeof fetch): Promise<string> {
  const serverId = requireOption(options, "server-id");
  const secretEnv = options["secret-env"];
  const secretRefId = options["secret-ref-id"];

  if (!secretEnv && !secretRefId && options.clear !== "true") {
    throw new Error("Missing required option --secret-env or --secret-ref-id.");
  }

  const server = await requestJson<ApiMcpServer>(
    request,
    `${apiUrl}/mcp/servers/${encodeURIComponent(serverId)}/credential`,
    {
      method: "POST",
      body: {
        authType: options["auth-type"] ?? (options.clear === "true" ? "none" : "env_passthrough"),
        credentialRefId: options.clear === "true" ? null : secretRefId,
        credentialEnv: options.clear === "true" ? null : secretEnv,
        credentialLabel: options["secret-label"] ?? undefined,
      },
    },
  );

  return `Updated MCP credentials for ${server.name} (${server.authType ?? "none"}).`;
}

async function runProbeMcp(apiUrl: string, options: McpParsedOptions, request: typeof fetch): Promise<string> {
  const result = await requestJson<ApiMcpProbeResult[]>(request, `${apiUrl}/mcp/probe`, {
    method: "POST",
    body: {
      projectId: requireOption(options, "project-id"),
      servers: parseOptionalCsv(options.servers ?? options.server),
    },
  });
  const lines = [`${PRODUCT_NAME} MCP probe`];

  if (result.length === 0) {
    lines.push("No probe results.");
  } else {
    lines.push(
      ...result.map((entry) => {
        const missingEnv = entry.missingEnv && entry.missingEnv.length > 0 ? ` missing-env=${entry.missingEnv.join(",")}` : "";
        return `- ${entry.ok ? "ok" : "failed"} ${entry.name}${entry.transport ? ` (${entry.transport})` : ""}: ${
          entry.message ?? "no message"
        }${missingEnv}`;
      }),
    );
  }

  return lines.join("\n");
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

function formatMcpServer(server: McpServerView): string {
  const trustLevel = server.trustLevel ? ` trust=${server.trustLevel}` : "";
  const endpoint = server.endpoint ? ` endpoint=${server.endpoint}` : "";
  const lastVerified = server.lastVerifiedAt ? ` verified=${server.lastVerifiedAt}` : "";
  const lastError = server.lastError ? ` error=${server.lastError}` : "";

  return `- ${server.status} ${server.name} (${server.transport})${trustLevel}${endpoint}${lastVerified}${lastError}`;
}

function formatMcpTool(tool: McpToolView): string {
  const server = tool.serverName ? `${tool.serverName}:` : "";
  const approval = tool.approvalRequired ? " approval=required" : "";
  const status = tool.status ? ` status=${tool.status}` : "";

  return `- ${server}${tool.name} ${tool.mutability}${approval}${status}`;
}

function formatMcpCall(call: McpToolCallView): string {
  const latency = typeof call.latencyMs === "number" ? ` ${call.latencyMs}ms` : "";
  const approval = call.approvalId ? ` approval=${call.approvalId}` : "";
  const summary = call.errorSummary ?? call.resultSummary;

  return `- ${call.status} ${call.serverName}:${call.toolName} ${call.mutability}${latency}${approval}${
    summary ? ` ${summary}` : ""
  }`;
}

export function parseMcpOptions(args: readonly string[]): McpParsedOptions {
  const parsed: McpParsedOptions = {};

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

function parseBooleanOption(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }

  return value === "true" || value === "1" || value === "yes";
}

function buildServerConfig(options: McpParsedOptions): Record<string, unknown> {
  return compactObject({
    command: options.command,
    args: parseOptionalCsv(options.args),
    env: parseOptionalCsv(options.env ?? options["secret-env"]),
  });
}

function parseOptionalCsv(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const values = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return values.length > 0 ? values : undefined;
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function requireOption(options: McpParsedOptions, name: string): string {
  const value = options[name];

  if (!value || value === "true") {
    throw new Error(`Missing required option --${name}.`);
  }

  return value;
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function isObject(value: unknown): value is { error?: unknown } {
  return typeof value === "object" && value !== null;
}
