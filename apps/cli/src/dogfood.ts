import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { PRODUCT_NAME } from "@vimbuspromax3000/shared";

/**
 * VIM-49 — M2 golden-path dogfood harness, minimum viable.
 *
 * One CLI command (`dogfood`) drives the eight-step deterministic golden-path
 * scenario from a clean state and emits a self-contained artifact bundle under
 * `.artifacts/m2/<run-id>/`. The orchestrator that brings docker-compose
 * Postgres up, starts the API server, and tears them back down lives at
 * `scripts/dogfood-m2.ts` (root script `bun run dogfood:m2`); this file is the
 * scenario logic that the orchestrator calls.
 *
 * Acceptance criteria (canonical text in `docs/SPRINT-7-PLAN.md` "VIM-47 — M2
 * golden-path dogfood harness, minimum viable"; the Jira key is VIM-49):
 *
 *  1. Clean DB.
 *  2. Create project.
 *  3. Seed deterministic planner output (no LLM call).
 *  4. Approve task + verification plan.
 *  5. Execute one task branch.
 *  6. Run one browser/a11y/visual verification item against a checked-in
 *     fixture page.
 *  7. Confirm `TestRun.evidenceJson` is persisted.
 *  8. Hydrate a benchmark run from the resulting `taskExecutionId` and
 *     confirm the verdict.
 *
 * Idempotent: two runs against the same clean state produce identical bundle
 * contents modulo timestamps and run IDs.
 *
 * Out of scope (deferred to VIM-51 stretch): LangSmith trace link assertion,
 * SSE event-sequence assertions, additional verification dimensions.
 *
 * Implementation status (2026-04-29): structure + steps 1-2 implemented;
 * steps 3-8 throw "not yet implemented" with inline pointers to the surface
 * map (`apps/cli/src/dogfood.ts` file-level comment, the API routes in
 * `apps/api/src/app.ts`, and `docs/SPRINT-7-PLAN.md` VIM-49 section).
 *
 * The agent-loop integration in step 5 is the largest open design call: the
 * naive `POST /tasks/:id/execute` triggers the LLM-driven agent loop, which
 * needs a configured model. The deterministic harness needs either a stub
 * model in the registry or a direct test-run dispatch path that bypasses the
 * agent loop. The next session that picks this up decides between those two.
 */

export const DOGFOOD_COMMANDS = ["dogfood"] as const;

export type DogfoodCommandOptions = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  cwd?: string;
  now?: () => Date;
};

type ParsedOptions = Record<string, string | undefined>;

export type DogfoodVerdict = "passed" | "failed" | "scaffold";

export type DogfoodRunSummary = {
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  verdict: DogfoodVerdict;
  artifactBundlePath: string;
  apiUrl: string;
  notes: string[];
};

type ScenarioContext = {
  apiUrl: string;
  databaseUrl: string;
  runId: string;
  request: typeof fetch;
  now: () => Date;
  cwd: string;
};

// Mirror of `PlannerProposalInput` from
// `packages/db/src/repositories/plannerRepository.ts:11-50`. We don't import
// from `@vimbuspromax3000/db` because the CLI deliberately stays HTTP-only
// (no DB dep) — this duplicates the contract for the deterministic seed and
// fails at runtime via the API's normalize layer if the shape drifts.
type PlannerProposalInput = {
  plannerRunId: string;
  summary?: string | null;
  epics: Array<{
    key: string;
    title: string;
    goal: string;
    orderIndex?: number;
    acceptance?: unknown;
    risks?: unknown;
    tasks: Array<{
      stableId: string;
      title: string;
      description?: string | null;
      type: string;
      complexity: string;
      orderIndex?: number;
      acceptance: unknown;
      targetFiles?: unknown;
      requires?: unknown;
      verificationPlan: {
        rationale?: string | null;
        items: Array<{
          kind: string;
          runner?: string | null;
          title: string;
          description: string;
          rationale?: string | null;
          command?: string | null;
          testFilePath?: string | null;
          route?: string | null;
          interaction?: string | null;
          expectedAssetId?: string | null;
          orderIndex?: number;
          config?: unknown;
        }>;
      };
    }>;
  }>;
};

const DOGFOOD_TASK_STABLE_ID = "m2-dogfood-task-1";

export function isDogfoodCommand(value: string): boolean {
  return DOGFOOD_COMMANDS.includes(value as (typeof DOGFOOD_COMMANDS)[number]);
}

export async function runDogfoodCommand(
  args: readonly string[],
  options: DogfoodCommandOptions = {},
): Promise<string> {
  const commandIndex = args.findIndex(isDogfoodCommand);
  if (commandIndex < 0) {
    throw new Error("No dogfood command found.");
  }

  const parsed = parseOptions(args.filter((_, index) => index !== commandIndex));
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? (() => new Date());
  const request = options.fetch ?? fetch;

  const apiUrl = withoutTrailingSlash(parsed["api-url"] ?? env.VIMBUS_API_URL ?? "http://localhost:3000");
  const databaseUrl = parsed["database-url"] ?? env.DATABASE_URL;
  const runId = parsed["run-id"] ?? cryptoRandomId();
  const dryRun = parsed["dry-run"] === "true";

  if (!dryRun && !databaseUrl) {
    throw new Error(
      "Missing DATABASE_URL. The dogfood harness needs Postgres mode; run `bun run dogfood:m2` (which orchestrates docker-compose + DB) or pass --database-url=...",
    );
  }

  const startedAt = now();
  const artifactBundlePath = resolveArtifactBundle(cwd, runId);
  mkdirSync(artifactBundlePath, { recursive: true });

  const notes: string[] = [];

  if (dryRun) {
    notes.push("dry-run: bundle directory created, scenario skipped");
    return finalizeRun({ runId, startedAt, now, verdict: "scaffold", artifactBundlePath, apiUrl, notes });
  }

  const ctx: ScenarioContext = {
    apiUrl,
    databaseUrl: databaseUrl!,
    runId,
    request,
    now,
    cwd,
  };

  const verdict = await runM2GoldenPath(ctx, notes);
  return finalizeRun({ runId, startedAt, now, verdict, artifactBundlePath, apiUrl, notes });
}

async function runM2GoldenPath(ctx: ScenarioContext, notes: string[]): Promise<DogfoodVerdict> {
  await step1CleanDatabase(ctx);
  notes.push("step 1 (clean db): API /health responded ok");

  const { projectId } = await step2CreateProject(ctx);
  notes.push(`step 2 (create project): projectId=${projectId}`);

  const { plannerRunId, taskId } = await step3SeedPlannerOutput(ctx, projectId);
  notes.push(`step 3 (seed planner): plannerRunId=${plannerRunId}, taskId=${taskId}`);

  await step4ApproveTaskAndPlan(ctx, taskId);
  notes.push(`step 4 (approve task + verification plan): taskId=${taskId}`);

  const { executionId } = await step5ExecuteTask(ctx, taskId);
  notes.push(`step 5 (execute task branch, headless): executionId=${executionId}`);

  // Steps 6-8 are scaffolded but not yet implemented. The next session lands
  // them in order. Keep the throw here so a non-dry-run accidentally invoked
  // against a live environment fails loudly rather than silently writing an
  // incomplete artifact bundle.
  await step6ObserveVisualVerification(ctx, executionId);
  // unreachable until step6 is implemented — listed for completeness of the
  // call graph the next session will fill in.
  // const { evidenceJson } = await step7FetchEvidence(ctx, executionId);
  // const { benchmarkRun } = await step8HydrateBenchmark(ctx, projectId, executionId);
  // return benchmarkRun.verdict === "passed" ? "passed" : "failed";

  return "scaffold";
}

async function step1CleanDatabase(ctx: ScenarioContext): Promise<void> {
  // Pre-condition: the orchestrator (`scripts/dogfood-m2.ts`) brought
  // docker-compose Postgres up and pushed a fresh schema before invoking
  // this command. We sanity-check the API is reachable and self-reports
  // healthy; we don't truncate or reset anything from inside this command
  // because the orchestrator owns the lifecycle.
  const health = await getJson<{ ok?: boolean; status?: string }>(ctx, "/health");
  if (!health.ok && health.status !== "ok") {
    throw new Error(`API /health did not return ok; got ${JSON.stringify(health)}`);
  }
}

async function step2CreateProject(ctx: ScenarioContext): Promise<{ projectId: string }> {
  const project = await postJson<{ id: string }>(ctx, "/projects", {
    name: `M2 Dogfood (${ctx.runId})`,
    rootPath: `/tmp/vimbus-m2-dogfood/${ctx.runId}`,
    baseBranch: "main",
  });
  return { projectId: project.id };
}

async function step3SeedPlannerOutput(
  ctx: ScenarioContext,
  projectId: string,
): Promise<{ plannerRunId: string; taskId: string }> {
  // POST /planner/runs to create the run, then POST /planner/runs/:id/generate
  // with the deterministic PlannerProposalInput payload. The API's
  // hasPlannerProposalPayload check at apps/api/src/app.ts:352 short-circuits
  // the LLM and persists the proposal directly via persistPlannerProposal.
  const plannerRun = await postJson<{ id: string }>(ctx, "/planner/runs", {
    projectId,
    goal: "M2 dogfood deterministic seed",
  });

  await postJson(ctx, `/planner/runs/${plannerRun.id}/generate`, buildDeterministicPlannerPayload(ctx, plannerRun.id));

  // Locate the seeded task by stableId. listTasks returns Task rows scoped to
  // the project's epics; we filter for the deterministic stableId we set
  // when constructing the proposal.
  const tasks = await getJson<Array<{ id: string; stableId: string }>>(
    ctx,
    `/tasks?projectId=${encodeURIComponent(projectId)}`,
  );
  const task = tasks.find((entry) => entry.stableId === DOGFOOD_TASK_STABLE_ID);
  if (!task) {
    throw new Error(
      `Deterministic planner payload did not produce a task with stableId=${DOGFOOD_TASK_STABLE_ID}. Got ${tasks.length} task(s).`,
    );
  }

  return { plannerRunId: plannerRun.id, taskId: task.id };
}

async function step4ApproveTaskAndPlan(ctx: ScenarioContext, taskId: string): Promise<void> {
  // POST /tasks/:id/verification/approve does both halves: it approves the
  // task and its verification plan in one call (see app.ts:445).
  await postJson(ctx, `/tasks/${encodeURIComponent(taskId)}/verification/approve`, {
    operator: "m2-dogfood",
    reason: "M2 dogfood deterministic auto-approval",
    stage: "verification_review",
  });
}

async function step5ExecuteTask(
  ctx: ScenarioContext,
  taskId: string,
): Promise<{ executionId: string }> {
  // POST /tasks/:id/execute/headless — dogfood-only API route added by this
  // story (VIM-49). It prepares the task branch and creates a TaskExecution
  // row WITHOUT invoking the LLM-driven agent loop, so the dogfood is
  // deterministic and offline. Production execution still flows through the
  // sibling POST /tasks/:id/execute route. The headless route is documented
  // and bounded in apps/api/src/app.ts and is intentionally only used by
  // this scenario.
  const execution = await postJson<{ id: string }>(
    ctx,
    `/tasks/${encodeURIComponent(taskId)}/execute/headless`,
    {},
  );
  return { executionId: execution.id };
}

async function step6ObserveVisualVerification(
  _ctx: ScenarioContext,
  _executionId: string,
): Promise<void> {
  // Implementation: poll GET /executions/:id/test-runs (or
  // /executions/:id/visual-results) until the a11y item from the
  // deterministic planner payload has been dispatched and persisted, then
  // return. The headless execution from step 5 doesn't auto-dispatch; the
  // next session decides between (a) calling
  // POST /executions/:id/test-runs explicitly to fire the verification
  // pipeline, or (b) extending the headless route to auto-dispatch
  // approved no-command verification items. Either way, this step's
  // contract is: by the time it returns, TestRun rows for the task's
  // verification items exist with status != "queued".
  throw new Error("VIM-49 step 6 (observe visual/a11y verification) is not yet implemented.");
}

function buildDeterministicPlannerPayload(ctx: ScenarioContext, plannerRunId: string): PlannerProposalInput {
  const fixtureUrl = resolveFixtureUrl(ctx);
  return {
    plannerRunId,
    summary: "M2 dogfood deterministic scenario",
    epics: [
      {
        key: "M2-DOGFOOD",
        title: "M2 Golden Path",
        goal: "Verify deterministic execution loop end-to-end against a checked-in fixture page.",
        orderIndex: 0,
        acceptance: [{ label: "fixture page renders the expected heading and passes axe-core" }],
        risks: [],
        tasks: [
          {
            stableId: DOGFOOD_TASK_STABLE_ID,
            title: "Render the dogfood fixture page",
            description: "A11y verification of the deterministic fixture page shipped under apps/cli/src/dogfood-fixtures/.",
            type: "ui",
            complexity: "trivial",
            orderIndex: 0,
            acceptance: [{ label: "fixture page renders the expected heading and passes axe-core" }],
            targetFiles: [],
            requires: [],
            verificationPlan: {
              rationale: "One a11y verification item against the checked-in fixture page (no command-backed items so the verification path is deterministic and offline).",
              items: [
                {
                  kind: "a11y",
                  runner: "axe",
                  title: "axe scan on dogfood fixture page",
                  description: "Run axe-core against the deterministic fixture page and confirm zero violations.",
                  rationale: "M2 dogfood scenario step 6.",
                  command: null,
                  testFilePath: null,
                  route: fixtureUrl,
                  interaction: null,
                  expectedAssetId: null,
                  orderIndex: 0,
                  config: { url: fixtureUrl },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function resolveFixtureUrl(ctx: ScenarioContext): string {
  const fixturePath = resolve(ctx.cwd, "apps", "cli", "src", "dogfood-fixtures", "index.html");
  return pathToFileURL(fixturePath).href;
}

async function postJson<T>(ctx: ScenarioContext, path: string, body: unknown): Promise<T> {
  return requestJson<T>(ctx, path, { method: "POST", body });
}

async function getJson<T>(ctx: ScenarioContext, path: string): Promise<T> {
  return requestJson<T>(ctx, path, { method: "GET" });
}

async function requestJson<T>(
  ctx: ScenarioContext,
  path: string,
  options: { method: string; body?: unknown },
): Promise<T> {
  const response = await ctx.request(`${ctx.apiUrl}${path}`, {
    method: options.method,
    headers: options.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : undefined;

  if (!response.ok) {
    const message =
      isObject(payload) && typeof payload.error === "string" ? payload.error : response.statusText;
    throw new Error(`API ${response.status} ${options.method} ${path}: ${message}`);
  }

  return payload as T;
}

function finalizeRun(input: {
  runId: string;
  startedAt: Date;
  now: () => Date;
  verdict: DogfoodVerdict;
  artifactBundlePath: string;
  apiUrl: string;
  notes: string[];
}): string {
  const finishedAt = input.now();
  const summary: DogfoodRunSummary = {
    runId: input.runId,
    startedAt: input.startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - input.startedAt.getTime(),
    verdict: input.verdict,
    artifactBundlePath: input.artifactBundlePath,
    apiUrl: input.apiUrl,
    notes: input.notes,
  };
  writeManifest(input.artifactBundlePath, summary);
  return formatSummary(summary);
}

export function formatSummary(summary: DogfoodRunSummary): string {
  const lines = [
    `${PRODUCT_NAME} M2 dogfood`,
    `Run: ${summary.runId}`,
    `Started: ${summary.startedAt}`,
    `Finished: ${summary.finishedAt}`,
    `Duration: ${summary.durationMs}ms`,
    `Verdict: ${summary.verdict}`,
    `API: ${summary.apiUrl}`,
    `Artifacts: ${summary.artifactBundlePath}`,
  ];

  if (summary.notes.length > 0) {
    lines.push("Notes:");
    for (const note of summary.notes) {
      lines.push(`- ${note}`);
    }
  }

  return lines.join("\n");
}

function writeManifest(bundlePath: string, summary: DogfoodRunSummary): void {
  const manifestPath = resolve(bundlePath, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
}

function resolveArtifactBundle(cwd: string, runId: string): string {
  return resolve(cwd, ".artifacts", "m2", runId);
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `dogfood-${now}-${rand}`;
}

function isObject(value: unknown): value is { error?: unknown } {
  return typeof value === "object" && value !== null;
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
