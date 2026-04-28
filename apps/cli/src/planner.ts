import { basename } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as defaultStdin, stdout as defaultStdout } from "node:process";
import { PRODUCT_NAME } from "@vimbuspromax3000/shared";

export const PLANNER_COMMANDS = [
  "/projects",
  "/projects:create",
  "/plan",
  "/plan:show",
  "/plan:answer",
  "/plan:interview",
  "/plan:generate",
  "/approve:plan",
  "/tasks",
  "/approvals",
  // VIM-38 Sprint 5 — read-only view over GET /projects/:id/dependency-map.
  "/dependency-map",
] as const;

/**
 * VIM-34 — fixed 5-round interview order. Mirrored from
 * `INTERVIEW_ROUNDS` in @vimbuspromax3000/planner. Hard-coded here so the CLI
 * does not need a workspace dependency on the planner package just to display
 * the round name in prompts.
 */
export const PLANNER_INTERVIEW_ROUNDS = [
  "scope",
  "domain",
  "interfaces",
  "verification",
  "policy",
] as const;

export type PlannerInterviewRound = (typeof PLANNER_INTERVIEW_ROUNDS)[number];

export type PlannerPromptFn = (prompt: string) => Promise<string>;

export type PlannerCommandOptions = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  /** Test/headless override for the per-round operator prompt. */
  prompt?: PlannerPromptFn;
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
    case "/plan:interview":
      return runInterviewPlannerRun(apiUrl, parsed, request, options.prompt);
    case "/plan:generate":
      return runGeneratePlannerRun(apiUrl, parsed, request);
    case "/approve:plan":
      return runApprovePlannerRun(apiUrl, parsed, request);
    case "/tasks":
      return runListTasks(apiUrl, parsed, request);
    case "/approvals":
      return runListApprovals(apiUrl, parsed, request);
    case "/dependency-map":
      return runDependencyMapView(apiUrl, parsed, request);
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

/**
 * VIM-34 — walk the operator through the 5-round interview, one round at a
 * time. After every round we POST the single-round payload to the API which
 * either accepts it (200) and tells us the next expected round, or rejects it
 * with 422 + the expected next round so we re-prompt for the right one.
 *
 * In test/headless contexts the caller can supply `--prompt-json` (a JSON
 * object keyed by round name) or override `options.prompt` directly.
 */
async function runInterviewPlannerRun(
  apiUrl: string,
  options: ParsedOptions,
  request: typeof fetch,
  promptOverride?: PlannerPromptFn,
): Promise<string> {
  const plannerRunId = requireOption(options, "planner-run-id");
  const url = `${apiUrl}/planner/runs/${encodeURIComponent(plannerRunId)}/answers`;

  // Optional --prompt-json gives non-interactive callers a deterministic way
  // to feed answers per round. Tests use this to assert the round walk.
  const promptedAnswers = options["prompt-json"]
    ? parseAnswersJson(options["prompt-json"])
    : undefined;
  const ask = promptOverride ?? createDefaultPlannerPrompt();

  const lines: string[] = [`${PRODUCT_NAME} planner interview`];
  let plannerRun: ApiPlannerRun | undefined;

  // Drive the round loop off the server's reported `expectedNextRound`. We
  // start at the canonical first round; after each accepted round the API
  // tells us what's next (or null when complete).
  let nextRound: PlannerInterviewRound | null = PLANNER_INTERVIEW_ROUNDS[0];

  while (nextRound) {
    const round: PlannerInterviewRound = nextRound;
    lines.push(`Round: ${round}`);

    const answer = await collectInterviewAnswer(round, ask, promptedAnswers);

    let response: InterviewSubmissionResponse;
    try {
      response = await requestJson<InterviewSubmissionResponse>(request, url, {
        method: "POST",
        body: { round, answer },
      });
    } catch (error) {
      // The API surfaces 422 with `expectedNextRound` for out-of-order. We
      // re-prompt at the round the API expected and retry the loop without
      // crashing so the operator can recover.
      const recovered = parseOutOfOrderError(error);
      if (recovered) {
        lines.push(`Out of order: server expected ${recovered.expectedNextRound ?? "(complete)"}.`);
        nextRound = recovered.expectedNextRound;
        continue;
      }
      throw error;
    }

    plannerRun = response;
    nextRound = response.expectedNextRound ?? null;
    lines.push(`Accepted: ${round}.`);
  }

  if (plannerRun) {
    lines.push(getPlannerRunViewSnapshot(plannerRun));
  }
  return lines.join("\n");
}

type InterviewSubmissionResponse = ApiPlannerRun & {
  expectedNextRound: PlannerInterviewRound | null;
};

async function collectInterviewAnswer(
  round: PlannerInterviewRound,
  ask: PlannerPromptFn,
  prefilled: Record<string, unknown> | undefined,
): Promise<Record<string, unknown>> {
  if (prefilled && Object.prototype.hasOwnProperty.call(prefilled, round)) {
    const value = prefilled[round];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    throw new Error(`--prompt-json[${round}] must be an object.`);
  }

  const reply = await ask(`[${round}] answer (JSON object): `);
  return parseAnswersJson(reply);
}

function parseOutOfOrderError(
  error: unknown,
): { expectedNextRound: PlannerInterviewRound | null } | null {
  if (!(error instanceof Error)) return null;
  // requestJson encodes API errors as `API <status>: <message>` and stuffs
  // the response payload into `cause` so we can read `expectedNextRound`.
  const cause = (error as { cause?: unknown }).cause;
  if (!cause || typeof cause !== "object") return null;
  const payload = cause as { error?: unknown; expectedNextRound?: unknown };
  if (payload.error !== "out_of_order") return null;
  if (payload.expectedNextRound === null) {
    return { expectedNextRound: null };
  }
  if (typeof payload.expectedNextRound === "string"
    && (PLANNER_INTERVIEW_ROUNDS as readonly string[]).includes(payload.expectedNextRound)) {
    return { expectedNextRound: payload.expectedNextRound as PlannerInterviewRound };
  }
  return null;
}

function createDefaultPlannerPrompt(): PlannerPromptFn {
  return async (prompt) => {
    const rl = createInterface({ input: defaultStdin, output: defaultStdout });
    try {
      return await rl.question(prompt);
    } finally {
      rl.close();
    }
  };
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

// VIM-38 Sprint 5 — read-only dependency-map view. Lives in its own
// function (no shared state with the planner-interview state machine
// VIM-34 is editing nearby) so the merge-ready surface area is just
// this block plus the PLANNER_COMMANDS / switch additions above.
type ApiDependencyMapNode = {
  id: string;
  stableId: string;
  title: string;
  status: string;
  type: string;
  complexity: string;
  orderIndex: number;
  epicId: string;
  epicKey: string;
  epicTitle: string;
};

type ApiDependencyMapEdge = { from: string; to: string };

type ApiDependencyMap = {
  nodes: ApiDependencyMapNode[];
  edges: ApiDependencyMapEdge[];
};

type ApiDependencyMapCycle = {
  error: "cycle";
  cycle: string[];
};

export function getDependencyMapViewSnapshot(map: ApiDependencyMap): string {
  const lines = [`${PRODUCT_NAME} dependency map`];

  if (map.nodes.length === 0) {
    lines.push("No tasks.");
    return lines.join("\n");
  }

  // Reverse-adjacency so each task line lists its declared dependencies.
  // Sorting the deps alphabetically keeps the rendered view stable when
  // the operator scans for diffs between runs.
  const dependenciesByTo = new Map<string, string[]>();
  for (const edge of map.edges) {
    const existing = dependenciesByTo.get(edge.to) ?? [];
    existing.push(edge.from);
    dependenciesByTo.set(edge.to, existing);
  }
  for (const deps of dependenciesByTo.values()) {
    deps.sort();
  }

  lines.push(`Tasks (${map.nodes.length}, topologically sorted):`);
  for (const node of map.nodes) {
    const deps = dependenciesByTo.get(node.stableId) ?? [];
    const requires = deps.length > 0 ? ` requires=${deps.join(",")}` : "";
    lines.push(`- ${node.stableId} ${node.title} [${node.epicKey}] ${node.status}${requires}`);
  }

  lines.push(`Edges (${map.edges.length}):`);
  if (map.edges.length === 0) {
    lines.push("- (none)");
  } else {
    for (const edge of map.edges) {
      lines.push(`- ${edge.from} -> ${edge.to}`);
    }
  }

  return lines.join("\n");
}

export function getDependencyMapCycleSnapshot(cycle: string[]): string {
  // A 422 cycle response is presented as a clearly-labelled single
  // block so the operator does not confuse it with the empty-graph
  // case. The arrow chain mirrors the structure of the cycle witness
  // returned by the API (start -> ... -> start).
  const chain = cycle.length === 0 ? "(empty)" : `${cycle.join(" -> ")} -> ${cycle[0]}`;
  return [
    `${PRODUCT_NAME} dependency map`,
    "Cycle detected. Resolve the offending requires entries before re-running.",
    `Cycle: ${chain}`,
  ].join("\n");
}

async function runDependencyMapView(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const projectId = requireOption(options, "project-id");
  const url = `${apiUrl}/projects/${encodeURIComponent(projectId)}/dependency-map`;
  const response = await request(url, {
    method: "GET",
    headers: undefined,
    body: undefined,
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : undefined;

  if (response.status === 422 && isCyclePayload(payload)) {
    return getDependencyMapCycleSnapshot(payload.cycle);
  }

  if (!response.ok) {
    const message = isObject(payload) && typeof payload.error === "string" ? payload.error : response.statusText;
    throw new Error(`API ${response.status}: ${message}`);
  }

  return getDependencyMapViewSnapshot(payload as ApiDependencyMap);
}

function isCyclePayload(value: unknown): value is ApiDependencyMapCycle {
  if (!isObject(value)) return false;
  if ((value as { error?: unknown }).error !== "cycle") return false;
  const cycle = (value as { cycle?: unknown }).cycle;
  return Array.isArray(cycle) && cycle.every((entry) => typeof entry === "string");
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
    // Attach the parsed payload as `cause` so structured handlers (e.g. the
    // VIM-34 out-of-order recovery in the interview command) can introspect
    // `expectedNextRound` without re-parsing the message.
    throw new Error(`API ${response.status}: ${message}`, { cause: payload });
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
