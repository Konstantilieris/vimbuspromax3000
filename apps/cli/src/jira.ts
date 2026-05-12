export const JIRA_COMMANDS = ["/jira:import"] as const;

export type JiraCommandOptions = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
};

type ParsedOptions = Record<string, string | undefined>;

type JiraImportResponse = {
  plannerRunId: string;
  epicId?: string;
  taskIds: string[];
  validationIds: string[];
  reviewArtifactId: string;
  summary?: {
    issueCount?: number;
    taskCount?: number;
    validationCount?: number;
  };
};

export function isJiraCommand(value: string): boolean {
  return JIRA_COMMANDS.includes(value as (typeof JIRA_COMMANDS)[number]);
}

export async function runJiraCommand(args: readonly string[], options: JiraCommandOptions = {}): Promise<string> {
  const command = args.find(isJiraCommand);
  if (!command) throw new Error("No Jira command found.");

  const parsed = parseOptions(args.filter((arg) => arg !== command));
  const apiUrl = withoutTrailingSlash(parsed["api-url"] ?? options.env?.VIMBUS_API_URL ?? "http://localhost:3000");
  const request = options.fetch ?? fetch;

  switch (command) {
    case "/jira:import":
      return runJiraImport(apiUrl, parsed, request);
  }

  throw new Error(`Unknown Jira command: ${command}`);
}

async function runJiraImport(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const projectId = requireOption(options, "project-id");
  const epicKey = getOptionValue(options, "epic") ?? getOptionValue(options, "epic-key");
  const jql = getOptionValue(options, "jql");
  const acceptanceCriteriaField =
    getOptionValue(options, "acceptance-criteria-field") ?? getOptionValue(options, "ac-field");

  if (!epicKey && !jql) {
    throw new Error("Missing required option --epic or --jql.");
  }

  const response = await requestJson<JiraImportResponse>(request, `${apiUrl}/jira/import`, {
    method: "POST",
    body: {
      projectId,
      ...(epicKey ? { epicKey } : {}),
      ...(jql ? { jql } : {}),
      ...(acceptanceCriteriaField ? { acceptanceCriteriaField } : {}),
    },
  });

  return [
    `Imported Jira issues into planner run ${response.plannerRunId}.`,
    `Planner run: ${response.plannerRunId}`,
    response.epicId ? `Epic: ${response.epicId}` : null,
    `Tasks: ${response.summary?.taskCount ?? response.taskIds.length}`,
    `Validations: ${response.summary?.validationCount ?? response.validationIds.length}`,
    `Review artifact: ${response.reviewArtifactId}`,
  ].filter((line): line is string => line !== null).join("\n");
}

async function requestJson<T>(
  request: typeof fetch,
  url: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await request(url, {
    method: options.method ?? "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(pruneUndefined(options.body)) : undefined,
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : undefined;

  if (!response.ok) {
    const message = isObject(payload) && typeof payload.error === "string" ? payload.error : response.statusText;
    throw new Error(`API ${response.status}: ${message}`, { cause: payload });
  }

  return payload as T;
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

function pruneUndefined(value: unknown): unknown {
  if (!isObject(value)) return value;

  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
