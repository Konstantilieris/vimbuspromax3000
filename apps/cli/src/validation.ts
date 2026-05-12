import { PRODUCT_NAME } from "@vimbuspromax3000/shared";

export const VALIDATION_COMMANDS = [
  "/validation:list",
  "/validation:show",
  "/validation:approve",
  "/validation:reject",
] as const;

export type ValidationCommandOptions = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
};

type ParsedOptions = Record<string, string | undefined>;

type ApiValidation = {
  id: string;
  taskId: string;
  verificationItemId?: string | null;
  testType: string;
  status: string;
  title: string;
  description?: string | null;
  acceptanceCriteriaJson?: string | null;
  rationale?: string | null;
  command?: string | null;
  testFilePath?: string | null;
  metadataJson?: string | null;
  orderIndex?: number | null;
  approvalId?: string | null;
  legacyVerificationItemId?: string | null;
  lastTaskExecutionId?: string | null;
  lastTestRunId?: string | null;
  lastExitCode?: number | null;
  resultSummary?: string | null;
  resultJson?: string | null;
  artifactPath?: string | null;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type ApiValidationDecision = {
  validation: ApiValidation;
  approval: {
    id: string;
    subjectType: string;
    subjectId: string;
    stage: string;
    status: string;
    operator?: string | null;
    reason?: string | null;
  };
};

export function isValidationCommand(value: string): boolean {
  return VALIDATION_COMMANDS.includes(value as (typeof VALIDATION_COMMANDS)[number]);
}

export async function runValidationCommand(
  args: readonly string[],
  options: ValidationCommandOptions = {},
): Promise<string> {
  const command = args.find(isValidationCommand);
  if (!command) throw new Error("No validation command found.");

  const parsed = parseOptions(args.filter((arg) => arg !== command));
  const apiUrl = withoutTrailingSlash(parsed["api-url"] ?? options.env?.VIMBUS_API_URL ?? "http://localhost:3000");
  const request = options.fetch ?? fetch;

  switch (command) {
    case "/validation:list":
      return runListValidations(apiUrl, parsed, request);
    case "/validation:show":
      return runShowValidation(apiUrl, parsed, request);
    case "/validation:approve":
      return runApproveValidation(apiUrl, parsed, request);
    case "/validation:reject":
      return runRejectValidation(apiUrl, parsed, request);
  }

  throw new Error(`Unknown validation command: ${command}`);
}

export function getValidationListSnapshot(validations: readonly ApiValidation[]): string {
  const lines = [`${PRODUCT_NAME} validations`];

  if (validations.length === 0) {
    lines.push("No validations.");
    return lines.join("\n");
  }

  for (const validation of validations) {
    lines.push(formatValidationListItem(validation));
  }

  return lines.join("\n");
}

export function getValidationDetailSnapshot(validation: ApiValidation): string {
  const lines = [
    `${PRODUCT_NAME} validation`,
    `Validation: ${validation.id}`,
    `Task: ${validation.taskId}`,
    `Status: ${validation.status}`,
    `Type: ${validation.testType}`,
    `Title: ${validation.title}`,
    `Description: ${validation.description ?? "n/a"}`,
    `Acceptance: ${formatJsonText(validation.acceptanceCriteriaJson)}`,
    `Rationale: ${validation.rationale ?? "n/a"}`,
    `Command: ${validation.command ?? "n/a"}`,
    `Test file: ${validation.testFilePath ?? "n/a"}`,
    `Order: ${validation.orderIndex ?? 0}`,
    `Verification item: ${validation.verificationItemId ?? "n/a"}`,
    `Legacy item: ${validation.legacyVerificationItemId ?? "n/a"}`,
    `Approval: ${validation.approvalId ?? "n/a"}`,
    `Last execution: ${validation.lastTaskExecutionId ?? "n/a"}`,
    `Last test run: ${validation.lastTestRunId ?? "n/a"}`,
    `Last exit code: ${validation.lastExitCode ?? "n/a"}`,
    `Result: ${validation.resultSummary ?? "n/a"}`,
    `Result JSON: ${formatJsonText(validation.resultJson)}`,
    `Artifact: ${validation.artifactPath ?? "n/a"}`,
    `Metadata: ${formatJsonText(validation.metadataJson)}`,
    `Approved: ${validation.approvedAt ?? "n/a"}`,
    `Rejected: ${validation.rejectedAt ?? "n/a"}`,
    `Started: ${validation.startedAt ?? "n/a"}`,
    `Finished: ${validation.finishedAt ?? "n/a"}`,
  ];

  return lines.join("\n");
}

async function runListValidations(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const taskId = requireOption(options, "task-id");
  const validations = await requestJson<ApiValidation[]>(
    request,
    `${apiUrl}/tasks/${encodeURIComponent(taskId)}/validations`,
  );

  return getValidationListSnapshot(validations);
}

async function runShowValidation(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const validationId = requireValidationId(options);
  const validation = await requestJson<ApiValidation>(
    request,
    `${apiUrl}/validations/${encodeURIComponent(validationId)}`,
  );

  return getValidationDetailSnapshot(validation);
}

async function runApproveValidation(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const validationId = requireValidationId(options);
  const decision = await requestJson<ApiValidationDecision>(
    request,
    `${apiUrl}/validations/${encodeURIComponent(validationId)}/approve`,
    {
      method: "POST",
      body: {
        operator: options.operator,
        reason: options.reason,
      },
    },
  );

  return `Approved validation ${decision.validation.id} (${decision.validation.status}; approval=${decision.approval.status}).`;
}

async function runRejectValidation(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const validationId = requireValidationId(options);
  const decision = await requestJson<ApiValidationDecision>(
    request,
    `${apiUrl}/validations/${encodeURIComponent(validationId)}/reject`,
    {
      method: "POST",
      body: {
        operator: options.operator,
        reason: options.reason,
      },
    },
  );

  return `Rejected validation ${decision.validation.id} (${decision.validation.status}; approval=${decision.approval.status}).`;
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
    throw new Error(`API ${response.status}: ${message}`, { cause: payload });
  }

  return payload as T;
}

function formatValidationListItem(validation: ApiValidation): string {
  const order = validation.orderIndex ?? 0;
  const command = validation.command ? ` command=${validation.command}` : "";
  const file = validation.testFilePath ? ` file=${validation.testFilePath}` : "";
  const result = validation.resultSummary ? ` result=${validation.resultSummary}` : "";

  return `- [${order}] ${validation.status} ${validation.testType} ${validation.title} (${validation.id})${command}${file}${result}`;
}

function formatJsonText(value: string | null | undefined): string {
  if (!value) return "n/a";

  try {
    return JSON.stringify(JSON.parse(value));
  } catch {
    return value;
  }
}

function parseOptions(args: readonly string[]): ParsedOptions {
  const parsed: ParsedOptions = {};

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (!token?.startsWith("--")) {
      const position = nextPositionIndex(parsed);
      parsed[`_${position}`] = token;
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

function requireValidationId(options: ParsedOptions): string {
  const validationId = getOptionValue(options, "validation-id") ?? getOptionValue(options, "_0");

  if (!validationId) {
    throw new Error("Missing required option --validation-id or positional <validation-id>.");
  }

  return validationId;
}

function requireOption(options: ParsedOptions, name: string): string {
  const value = getOptionValue(options, name);

  if (!value) {
    throw new Error(`Missing required option --${name}.`);
  }

  return value;
}

function getOptionValue(options: ParsedOptions, name: string): string | null {
  const value = options[name];
  return value && value !== "true" ? value : null;
}

function nextPositionIndex(options: ParsedOptions) {
  let index = 0;

  while (options[`_${index}`] !== undefined) {
    index += 1;
  }

  return index;
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function isObject(value: unknown): value is { error?: unknown } {
  return typeof value === "object" && value !== null;
}
