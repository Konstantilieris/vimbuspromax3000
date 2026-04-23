import { basename } from "node:path";
import { PRODUCT_NAME } from "@vimbuspromax3000/shared";

export const PLANNER_COMMANDS = [
  "/projects",
  "/projects:create",
  "/plan",
  "/plan:show",
  "/plan:answer",
  "/plan:generate",
  "/approve:plan",
  "/tasks",
  "/approvals",
] as const;

export type PlannerCommandOptions = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
};

type ParsedOptions = Record<string, string | undefined>;

type ApiProject = {
  id: string;
  name: string;
  rootPath: string;
  baseBranch: string;
};

type ApiTask = {
  id: string;
  stableId: string;
  title: string;
  status: string;
  epic?: {
    key: string;
    title: string;
  };
};

type ApiApproval = {
  id: string;
  subjectType: string;
  subjectId: string;
  stage: string;
  status: string;
  operator?: string | null;
  reason?: string | null;
};

type ApiPlannerRun = {
  id: string;
  projectId: string;
  status: string;
  goal: string;
  moduleName?: string | null;
  contextPath?: string | null;
  summary?: string | null;
  interview?: Record<string, unknown>;
  proposalSummary?: {
    epicCount: number;
    taskCount: number;
    verificationPlanCount: number;
  };
  approvals?: ApiApproval[];
  epics?: Array<{
    key: string;
    title: string;
    tasks: ApiTask[];
  }>;
};

export function isPlannerCommand(value: string): boolean {
  return PLANNER_COMMANDS.includes(value as (typeof PLANNER_COMMANDS)[number]);
}

export async function runPlannerCommand(
  args: readonly string[],
  options: PlannerCommandOptions = {},
): Promise<string> {
  const command = args.find(isPlannerCommand) ?? "/projects";
  const parsed = parseOptions(args.filter((arg) => arg !== command));
  const apiUrl = withoutTrailingSlash(parsed["api-url"] ?? options.env?.VIMBUS_API_URL ?? "http://localhost:3000");
  const request = options.fetch ?? fetch;

  switch (command) {
    case "/projects":
      return runListProjects(apiUrl, request);
    case "/projects:create":
      return runCreateProject(apiUrl, parsed, request);
    case "/plan":
      return runCreatePlannerRun(apiUrl, parsed, request);
    case "/plan:show":
      return runShowPlannerRun(apiUrl, parsed, request);
    case "/plan:answer":
      return runAnswerPlannerRun(apiUrl, parsed, request);
    case "/plan:generate":
      return runGeneratePlannerRun(apiUrl, parsed, request);
    case "/approve:plan":
      return runApprovePlannerRun(apiUrl, parsed, request);
    case "/tasks":
      return runListTasks(apiUrl, parsed, request);
    case "/approvals":
      return runListApprovals(apiUrl, parsed, request);
  }

  throw new Error(`Unknown planner command: ${command}`);
}

export function getProjectsViewSnapshot(projects: ApiProject[]): string {
  const lines = [`${PRODUCT_NAME} projects`];

  if (projects.length === 0) {
    lines.push("No projects.");
  } else {
    lines.push(...projects.map((project) => `- ${project.name} (${project.id}) [${project.baseBranch}] ${project.rootPath}`));
  }

  return lines.join("\n");
}

export function getPlannerRunViewSnapshot(plannerRun: ApiPlannerRun): string {
  const interviewKeys = Object.keys(plannerRun.interview ?? {});
  const lines = [
    `${PRODUCT_NAME} planner`,
    `Run: ${plannerRun.id}`,
    `Status: ${plannerRun.status}`,
    `Goal: ${plannerRun.goal}`,
    `Module: ${plannerRun.moduleName ?? "n/a"}`,
    `Summary: ${plannerRun.summary ?? "pending"}`,
    `Interview Keys: ${interviewKeys.length > 0 ? interviewKeys.join(", ") : "none"}`,
  ];

  if (plannerRun.proposalSummary) {
    lines.push(
      `Proposal: epics=${plannerRun.proposalSummary.epicCount} tasks=${plannerRun.proposalSummary.taskCount} verification=${plannerRun.proposalSummary.verificationPlanCount}`,
    );
  }

  const epics = plannerRun.epics ?? [];
  if (epics.length === 0) {
    lines.push("Epics: none");
  } else {
    lines.push("Epics:");
    for (const epic of epics) {
      lines.push(`- ${epic.key} ${epic.title} (${epic.tasks.length} tasks)`);
      for (const task of epic.tasks) {
        lines.push(`  - ${task.status} ${task.stableId} ${task.title}`);
      }
    }
  }

  return lines.join("\n");
}

export function getTasksViewSnapshot(tasks: ApiTask[]): string {
  const lines = [`${PRODUCT_NAME} tasks`];

  if (tasks.length === 0) {
    lines.push("No tasks.");
  } else {
    lines.push(
      ...tasks.map((task) => `- ${task.status} ${task.stableId} ${task.title} [${task.epic?.key ?? "no-epic"}]`),
    );
  }

  return lines.join("\n");
}

export function getApprovalsViewSnapshot(approvals: ApiApproval[]): string {
  const lines = [`${PRODUCT_NAME} approvals`];

  if (approvals.length === 0) {
    lines.push("No approvals.");
  } else {
    lines.push(
      ...approvals.map((approval) =>
        `- ${approval.status} ${approval.subjectType}/${approval.subjectId} ${approval.stage}${
          approval.operator ? ` (${approval.operator})` : ""
        }`,
      ),
    );
  }

  return lines.join("\n");
}

async function runListProjects(apiUrl: string, request: typeof fetch) {
  const projects = await requestJson<ApiProject[]>(request, `${apiUrl}/projects`);
  return getProjectsViewSnapshot(projects);
}

async function runCreateProject(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const rootPath = options["root-path"] ?? process.cwd();
  const project = await requestJson<ApiProject>(request, `${apiUrl}/projects`, {
    method: "POST",
    body: {
      name: options.name ?? basename(rootPath),
      rootPath,
      baseBranch: options["base-branch"],
      branchNaming: options["branch-naming"],
    },
  });

  return `Created project ${project.name} (${project.id}) at ${project.rootPath}.`;
}

async function runCreatePlannerRun(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const plannerRun = await requestJson<ApiPlannerRun>(request, `${apiUrl}/planner/runs`, {
    method: "POST",
    body: {
      projectId: requireOption(options, "project-id"),
      goal: requireOption(options, "goal"),
      moduleName: options["module-name"],
      contextPath: options["context-path"],
    },
  });

  return `Started planner run ${plannerRun.id} for project ${plannerRun.projectId}.`;
}

async function runShowPlannerRun(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const plannerRun = await requestJson<ApiPlannerRun>(
    request,
    `${apiUrl}/planner/runs/${encodeURIComponent(requireOption(options, "planner-run-id"))}`,
  );

  return getPlannerRunViewSnapshot(plannerRun);
}

async function runAnswerPlannerRun(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const answers = parseAnswersJson(requireOption(options, "answers-json"));
  const plannerRun = await requestJson<ApiPlannerRun>(
    request,
    `${apiUrl}/planner/runs/${encodeURIComponent(requireOption(options, "planner-run-id"))}/answers`,
    {
      method: "POST",
      body: { answers },
    },
  );

  return getPlannerRunViewSnapshot(plannerRun);
}

async function runGeneratePlannerRun(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const plannerRun = await requestJson<ApiPlannerRun>(
    request,
    `${apiUrl}/planner/runs/${encodeURIComponent(requireOption(options, "planner-run-id"))}/generate`,
    {
      method: "POST",
      body: options.seed ? { seed: Number(options.seed) } : {},
    },
  );

  return getPlannerRunViewSnapshot(plannerRun);
}

async function runApprovePlannerRun(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const approval = await requestJson<ApiApproval>(request, `${apiUrl}/approvals`, {
    method: "POST",
    body: {
      projectId: requireOption(options, "project-id"),
      subjectType: "planner_run",
      subjectId: requireOption(options, "planner-run-id"),
      stage: options.stage ?? "planner_review",
      status: options.status ?? "granted",
      operator: options.operator,
      reason: options.reason,
    },
  });

  return `Recorded ${approval.status} planner approval for ${approval.subjectId}.`;
}

async function runListTasks(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const query = new URLSearchParams({
    projectId: requireOption(options, "project-id"),
  });

  if (options["planner-run-id"]) {
    query.set("plannerRunId", options["planner-run-id"]);
  }
  if (options.status) {
    query.set("status", options.status);
  }
  if (options["epic-id"]) {
    query.set("epicId", options["epic-id"]);
  }

  const tasks = await requestJson<ApiTask[]>(request, `${apiUrl}/tasks?${query.toString()}`);
  return getTasksViewSnapshot(tasks);
}

async function runListApprovals(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const query = new URLSearchParams();

  if (options["project-id"]) {
    query.set("projectId", options["project-id"]);
  }
  if (options["subject-type"]) {
    query.set("subjectType", options["subject-type"]);
  }
  if (options["subject-id"]) {
    query.set("subjectId", options["subject-id"]);
  }

  const approvals = await requestJson<ApiApproval[]>(
    request,
    `${apiUrl}/approvals${query.size > 0 ? `?${query.toString()}` : ""}`,
  );

  return getApprovalsViewSnapshot(approvals);
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

function parseAnswersJson(value: string): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid --answers-json payload: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isObject(parsed) || Array.isArray(parsed)) {
    throw new Error("--answers-json must decode to an object.");
  }

  return parsed as Record<string, unknown>;
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
