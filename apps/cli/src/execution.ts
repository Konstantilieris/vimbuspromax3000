import { PRODUCT_NAME } from "@vimbuspromax3000/shared";

export const EXECUTION_COMMANDS = [
  "/execution:start",
  "/approve:verification",
  "/branch:create",
  "/branch:show",
  "/branch:abandon",
  "/test-runs",
  "/test-runs:start",
  "/patch:show",
  "/patch:approve",
  "/patch:reject",
  "/events",
  "/mcp-calls",
  "/mcp-calls:approve",
] as const;

export type ExecutionCommandOptions = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
};

type ParsedOptions = Record<string, string | undefined>;

type ApiExecution = {
  id: string;
  taskId: string;
  status: string;
  branchName?: string | null;
  createdAt: string;
};

type ApiBranch = {
  id: string;
  taskId: string;
  branchName: string;
  state: string;
  baseBranch: string;
};

type ApiTestRun = {
  id: string;
  executionId: string;
  status: string;
  orderIndex: number;
  command?: string | null;
  exitCode?: number | null;
  stdout?: string | null;
  stderr?: string | null;
};

type ApiPatch = {
  executionId: string;
  status: string;
  approvalStatus?: string | null;
  filesChanged?: number | null;
  linesAdded?: number | null;
  linesRemoved?: number | null;
  diffSummary?: string | null;
};

type ApiEvent = {
  id: string;
  projectId: string;
  taskId?: string | null;
  executionId?: string | null;
  kind: string;
  createdAt: string;
};

type ApiMcpCall = {
  id: string;
  executionId: string;
  toolName: string;
  status: string;
  requiresApproval: boolean;
};

type ApiApproval = {
  id: string;
  subjectType: string;
  subjectId: string;
  stage: string;
  status: string;
};

export function isExecutionCommand(value: string): boolean {
  return EXECUTION_COMMANDS.includes(value as (typeof EXECUTION_COMMANDS)[number]);
}

export async function runExecutionCommand(
  args: readonly string[],
  options: ExecutionCommandOptions = {},
): Promise<string> {
  const command = args.find(isExecutionCommand);
  if (!command) throw new Error("No execution command found.");
  const parsed = parseOptions(args.filter((arg) => arg !== command));
  const apiUrl = withoutTrailingSlash(parsed["api-url"] ?? options.env?.VIMBUS_API_URL ?? "http://localhost:3000");
  const request = options.fetch ?? fetch;

  switch (command) {
    case "/execution:start":
      return runStartExecution(apiUrl, parsed, request);
    case "/approve:verification":
      return runApproveVerification(apiUrl, parsed, request);
    case "/branch:create":
      return runCreateBranch(apiUrl, parsed, request);
    case "/branch:show":
      return runShowBranch(apiUrl, parsed, request);
    case "/branch:abandon":
      return runAbandonBranch(apiUrl, parsed, request);
    case "/test-runs:start":
      return runStartTestRuns(apiUrl, parsed, request);
    case "/test-runs":
      return runListTestRuns(apiUrl, parsed, request);
    case "/patch:show":
      return runShowPatch(apiUrl, parsed, request);
    case "/patch:approve":
      return runApprovePatch(apiUrl, parsed, request);
    case "/patch:reject":
      return runRejectPatch(apiUrl, parsed, request);
    case "/events":
      return runListEvents(apiUrl, parsed, request);
    case "/mcp-calls":
      return runListMcpCalls(apiUrl, parsed, request);
    case "/mcp-calls:approve":
      return runApproveMcpCall(apiUrl, parsed, request);
  }

  throw new Error(`Unknown execution command: ${command}`);
}

export function getExecutionViewSnapshot(execution: ApiExecution): string {
  return [
    `${PRODUCT_NAME} execution`,
    `Execution: ${execution.id}`,
    `Task: ${execution.taskId}`,
    `Status: ${execution.status}`,
    `Branch: ${execution.branchName ?? "none"}`,
    `Created: ${execution.createdAt}`,
  ].join("\n");
}

export function getBranchViewSnapshot(branch: ApiBranch): string {
  return [
    `${PRODUCT_NAME} branch`,
    `Branch: ${branch.branchName}`,
    `State: ${branch.state}`,
    `Base: ${branch.baseBranch}`,
    `Task: ${branch.taskId}`,
  ].join("\n");
}

export function getTestRunsViewSnapshot(testRuns: ApiTestRun[]): string {
  const lines = [`${PRODUCT_NAME} test-runs`];

  if (testRuns.length === 0) {
    lines.push("No test runs.");
  } else {
    for (const run of testRuns) {
      lines.push(
        `- [${run.orderIndex}] ${run.status} exit=${run.exitCode ?? "n/a"} ${run.command ?? "(no command)"}`,
      );
      if (run.stdout) lines.push(`  stdout: ${run.stdout.slice(0, 200)}`);
      if (run.stderr) lines.push(`  stderr: ${run.stderr.slice(0, 200)}`);
    }
  }

  return lines.join("\n");
}

export function getPatchViewSnapshot(patch: ApiPatch): string {
  return [
    `${PRODUCT_NAME} patch`,
    `Execution: ${patch.executionId}`,
    `Status: ${patch.status}`,
    `Approval: ${patch.approvalStatus ?? "pending"}`,
    `Files changed: ${patch.filesChanged ?? "n/a"}`,
    `Lines: +${patch.linesAdded ?? 0} -${patch.linesRemoved ?? 0}`,
    `Summary: ${patch.diffSummary ?? "none"}`,
  ].join("\n");
}

export function getEventsViewSnapshot(events: ApiEvent[]): string {
  const lines = [`${PRODUCT_NAME} events`];

  if (events.length === 0) {
    lines.push("No events.");
  } else {
    for (const event of events) {
      const context = [
        event.taskId ? `task=${event.taskId}` : null,
        event.executionId ? `exec=${event.executionId}` : null,
      ]
        .filter(Boolean)
        .join(" ");
      lines.push(`- ${event.createdAt} ${event.kind}${context ? ` ${context}` : ""}`);
    }
  }

  return lines.join("\n");
}

export function getMcpCallsViewSnapshot(calls: ApiMcpCall[]): string {
  const lines = [`${PRODUCT_NAME} mcp-calls`];

  if (calls.length === 0) {
    lines.push("No MCP calls.");
  } else {
    for (const call of calls) {
      lines.push(
        `- ${call.id} ${call.toolName} status=${call.status}${call.requiresApproval ? " [requires-approval]" : ""}`,
      );
    }
  }

  return lines.join("\n");
}

async function runStartExecution(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const taskId = requireOption(options, "task-id");
  const execution = await requestJson<ApiExecution>(
    request,
    `${apiUrl}/tasks/${encodeURIComponent(taskId)}/execute`,
    { method: "POST", body: {} },
  );
  return getExecutionViewSnapshot(execution);
}

async function runApproveVerification(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const taskId = requireOption(options, "task-id");
  const approval = await requestJson<ApiApproval>(
    request,
    `${apiUrl}/tasks/${encodeURIComponent(taskId)}/verification/approve`,
    {
      method: "POST",
      body: {
        operator: options.operator,
        reason: options.reason,
      },
    },
  );
  return `Recorded ${approval.status} verification approval for task ${taskId}.`;
}

async function runCreateBranch(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const taskId = requireOption(options, "task-id");
  const branch = await requestJson<ApiBranch>(
    request,
    `${apiUrl}/tasks/${encodeURIComponent(taskId)}/branch`,
    {
      method: "POST",
      body: options["base-branch"] ? { baseBranch: options["base-branch"] } : {},
    },
  );
  return getBranchViewSnapshot(branch);
}

async function runShowBranch(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const taskId = requireOption(options, "task-id");
  const branch = await requestJson<ApiBranch>(
    request,
    `${apiUrl}/tasks/${encodeURIComponent(taskId)}/branch`,
  );
  return getBranchViewSnapshot(branch);
}

async function runAbandonBranch(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const taskId = requireOption(options, "task-id");
  await requestJson<unknown>(
    request,
    `${apiUrl}/tasks/${encodeURIComponent(taskId)}/branch/abandon`,
    { method: "POST", body: {} },
  );
  return `Branch for task ${taskId} abandoned.`;
}

async function runStartTestRuns(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const executionId = requireOption(options, "execution-id");
  const testRuns = await requestJson<ApiTestRun[]>(
    request,
    `${apiUrl}/executions/${encodeURIComponent(executionId)}/test-runs`,
    { method: "POST", body: {} },
  );
  return getTestRunsViewSnapshot(testRuns);
}

async function runListTestRuns(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const executionId = requireOption(options, "execution-id");
  const testRuns = await requestJson<ApiTestRun[]>(
    request,
    `${apiUrl}/executions/${encodeURIComponent(executionId)}/test-runs`,
  );
  return getTestRunsViewSnapshot(testRuns);
}

async function runShowPatch(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const executionId = requireOption(options, "execution-id");
  const patch = await requestJson<ApiPatch>(
    request,
    `${apiUrl}/executions/${encodeURIComponent(executionId)}/patch`,
  );
  return getPatchViewSnapshot(patch);
}

async function runApprovePatch(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const executionId = requireOption(options, "execution-id");
  const approval = await requestJson<ApiApproval>(
    request,
    `${apiUrl}/executions/${encodeURIComponent(executionId)}/patch/approve`,
    {
      method: "POST",
      body: {
        operator: options.operator,
        reason: options.reason,
      },
    },
  );
  return `Recorded ${approval.status} patch approval for execution ${executionId}.`;
}

async function runRejectPatch(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const executionId = requireOption(options, "execution-id");
  const approval = await requestJson<ApiApproval>(
    request,
    `${apiUrl}/executions/${encodeURIComponent(executionId)}/patch/reject`,
    {
      method: "POST",
      body: {
        operator: options.operator,
        reason: options.reason,
      },
    },
  );
  return `Recorded ${approval.status} patch rejection for execution ${executionId}.`;
}

async function runListEvents(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const query = new URLSearchParams({
    projectId: requireOption(options, "project-id"),
  });

  if (options["task-id"]) query.set("taskId", options["task-id"]);
  if (options["execution-id"]) query.set("executionId", options["execution-id"]);
  if (options.limit) query.set("limit", options.limit);

  const events = await requestJson<ApiEvent[]>(request, `${apiUrl}/events?${query.toString()}`);
  return getEventsViewSnapshot(events);
}

async function runListMcpCalls(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const executionId = requireOption(options, "execution-id");
  const calls = await requestJson<ApiMcpCall[]>(
    request,
    `${apiUrl}/executions/${encodeURIComponent(executionId)}/mcp/calls`,
  );
  return getMcpCallsViewSnapshot(calls);
}

async function runApproveMcpCall(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const executionId = requireOption(options, "execution-id");
  const callId = requireOption(options, "call-id");
  const result = await requestJson<{ id: string; status: string }>(
    request,
    `${apiUrl}/executions/${encodeURIComponent(executionId)}/mcp/calls/${encodeURIComponent(callId)}/approve`,
    { method: "POST", body: {} },
  );
  return `Approved MCP call ${result.id} (status: ${result.status}).`;
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

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function isObject(value: unknown): value is { error?: unknown } {
  return typeof value === "object" && value !== null;
}
