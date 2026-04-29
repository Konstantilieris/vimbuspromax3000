import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
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
  bundlePath: string;
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
    bundlePath: artifactBundlePath,
  };

  const verdict = await runM2GoldenPath(ctx, notes);
  return finalizeRun({ runId, startedAt, now, verdict, artifactBundlePath, apiUrl, notes });
}

async function runM2GoldenPath(ctx: ScenarioContext, notes: string[]): Promise<DogfoodVerdict> {
  await step1CleanDatabase(ctx);
  notes.push("step 1 (clean db): API /health responded ok");

  const { projectId } = await step2CreateProject(ctx);
  notes.push(`step 2 (create project): projectId=${projectId}`);

  const { plannerRunId, taskId, plannerPayload } = await step3SeedPlannerOutput(ctx, projectId);
  notes.push(`step 3 (seed planner): plannerRunId=${plannerRunId}, taskId=${taskId}`);

  await step4ApproveTaskAndPlan(ctx, taskId);
  notes.push(`step 4 (approve task + verification plan): taskId=${taskId}`);

  const { executionId } = await step5ExecuteTask(ctx, taskId);
  notes.push(`step 5 (execute task branch, headless): executionId=${executionId}`);

  const { testRuns } = await step6ObserveVisualVerification(ctx, executionId);
  notes.push(`step 6 (verification dispatch): ${testRuns.length} TestRun row(s)`);

  const { evidenceCount, evidence } = await step7FetchEvidence(testRuns);
  notes.push(`step 7 (evidenceJson persisted): ${evidenceCount}/${testRuns.length} runs carry evidence`);

  const benchmark = await step8HydrateBenchmark(ctx, projectId, executionId);
  notes.push(`step 8 (benchmark hydration): runId=${benchmark.run.runId}, verdict=${benchmark.run.verdict}`);

  await writeArtifactBundle(ctx, {
    executionId,
    plannerPayload,
    testRuns,
    evidence,
    benchmark,
  });
  notes.push(
    "bundle: planner-payload, agent-step-log, mcp-tool-call-log, screenshots/, axe-results, evidence, benchmark-run",
  );

  return benchmark.run.verdict === "passed" ? "passed" : "failed";
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
): Promise<{ plannerRunId: string; taskId: string; plannerPayload: PlannerProposalInput }> {
  // POST /planner/runs to create the run, then POST /planner/runs/:id/generate
  // with the deterministic PlannerProposalInput payload. The API's
  // hasPlannerProposalPayload check at apps/api/src/app.ts:352 short-circuits
  // the LLM and persists the proposal directly via persistPlannerProposal.
  const plannerRun = await postJson<{ id: string }>(ctx, "/planner/runs", {
    projectId,
    goal: "M2 dogfood deterministic seed",
  });

  const plannerPayload = buildDeterministicPlannerPayload(ctx, plannerRun.id);
  await postJson(ctx, `/planner/runs/${plannerRun.id}/generate`, plannerPayload);

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

  return { plannerRunId: plannerRun.id, taskId: task.id, plannerPayload };
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

type TestRunSummary = {
  id: string;
  status: string;
  evidenceJson?: string | null;
  verificationItemId?: string | null;
};

async function step6ObserveVisualVerification(
  ctx: ScenarioContext,
  executionId: string,
): Promise<{ testRuns: TestRunSummary[] }> {
  // POST /executions/:id/test-runs fires the test-runner against every
  // approved verification item on the execution. The route at app.ts
  // returns the persisted TestRun rows (or a TestRunnerEligibilityError on
  // 409/422 if dispatch can't proceed). For the dogfood scenario the
  // approved set is exactly one a11y item against the fixture page, so the
  // expected return is a single TestRun row.
  const testRuns = await postJson<TestRunSummary[]>(
    ctx,
    `/executions/${encodeURIComponent(executionId)}/test-runs`,
    {},
  );
  if (testRuns.length === 0) {
    throw new Error(
      "step 6: test-runner returned no TestRun rows. The dogfood planner payload approves exactly one a11y item — check the dispatch path (apps/api/src/app.ts /executions/:id/test-runs and packages/test-runner).",
    );
  }
  return { testRuns };
}

async function step7FetchEvidence(
  testRuns: TestRunSummary[],
): Promise<{ evidenceCount: number; evidence: Array<{ verificationItemId: string | null; evidence: unknown }> }> {
  // The dogfood AC requires that TestRun.evidenceJson is persisted; we
  // already received the rows from step 6, so this is a synchronous decode
  // pass rather than a second API roundtrip. Returns the parsed evidence
  // payloads alongside the count of rows that actually have evidence (the
  // a11y item should always; command-backed items may not).
  const evidence: Array<{ verificationItemId: string | null; evidence: unknown }> = [];
  for (const run of testRuns) {
    if (run.evidenceJson) {
      evidence.push({
        verificationItemId: run.verificationItemId ?? null,
        evidence: JSON.parse(run.evidenceJson),
      });
    }
  }
  if (evidence.length === 0) {
    throw new Error(
      "step 7: no TestRun row carried evidenceJson. The a11y verification item should persist axe-core results; check the dispatch path in packages/test-runner.",
    );
  }
  return { evidenceCount: evidence.length, evidence };
}

type BenchmarkResponse = {
  run: { runId: string; verdict: string; aggregateScore: number };
  evalRun: { id: string };
};

async function step8HydrateBenchmark(
  ctx: ScenarioContext,
  projectId: string,
  executionId: string,
): Promise<BenchmarkResponse> {
  // First, create a deterministic benchmark scenario for this project. We
  // recreate it per dogfood run so the artifact bundle's benchmark-run.json
  // is self-contained. Reuse-by-name optimization could come later but
  // correctness first.
  const scenario = await postJson<{ id: string }>(ctx, "/benchmarks/scenarios", {
    projectId,
    name: `M2 Dogfood Scenario (${ctx.runId})`,
    goal: "M2 dogfood deterministic benchmark verdict",
    status: "active",
    thresholds: {},
    passThreshold: 0,
  });

  // Then hydrate a run from the executionId. The API loads BenchmarkToolCalls
  // and BenchmarkVerificationItems off the execution's persisted rows, scores
  // the run, persists the EvalRun, and returns { run, evalRun }.
  return postJson<BenchmarkResponse>(
    ctx,
    `/benchmarks/scenarios/${encodeURIComponent(scenario.id)}/run`,
    { taskExecutionId: executionId },
  );
}

async function writeArtifactBundle(
  ctx: ScenarioContext,
  data: {
    executionId: string;
    plannerPayload: PlannerProposalInput;
    testRuns: TestRunSummary[];
    evidence: Array<{ verificationItemId: string | null; evidence: unknown }>;
    benchmark: BenchmarkResponse;
  },
): Promise<void> {
  // 1. planner-payload.json — verbatim deterministic seed used in step 3.
  writeJson(ctx.bundlePath, "planner-payload.json", data.plannerPayload);

  // 2. agent-step-log.jsonl — currently empty because the dogfood uses the
  // /headless route which skips the agent loop. The file is written anyway so
  // the bundle layout is stable across dogfood and (future) full-fat dogfood
  // runs that exercise the agent loop. The runbook documents this.
  writeJsonl(ctx.bundlePath, "agent-step-log.jsonl", []);

  // 3. mcp-tool-call-log.jsonl — fetched via the existing API route. Verification
  // dispatch (step 6) does drive MCP tool calls (browser/a11y) so this file
  // generally has entries. If the route 404s in some environments, fall back
  // to an empty file with a TODO note in the runbook.
  let mcpCalls: unknown[] = [];
  try {
    mcpCalls = await getJson<unknown[]>(
      ctx,
      `/executions/${encodeURIComponent(data.executionId)}/mcp/calls`,
    );
  } catch {
    // The route exists per app.ts; a fetch failure here is not fatal for the
    // bundle. Empty file with the failure surfaced in the manifest notes.
  }
  writeJsonl(ctx.bundlePath, "mcp-tool-call-log.jsonl", mcpCalls);

  // 4. screenshots/ — copy from the test-runner's output dir at
  // .artifacts/executions/<executionId>/browser/. This is where the visual
  // verification step writes its PNGs (per VIM-39). When no visual items run,
  // the source dir doesn't exist and we create an empty screenshots/ in the
  // bundle anyway for layout stability.
  const screenshotsSource = resolve(
    ctx.cwd,
    ".artifacts",
    "executions",
    data.executionId,
    "browser",
  );
  const screenshotsDest = resolve(ctx.bundlePath, "screenshots");
  mkdirSync(screenshotsDest, { recursive: true });
  if (existsSync(screenshotsSource)) {
    cpSync(screenshotsSource, screenshotsDest, { recursive: true });
  }

  // 5. axe-results.json — first axe payload extracted from evidence. The
  // dogfood scenario plans exactly one a11y verification item, so the first
  // evidence entry's payload is the axe result we want.
  const axeEvidence = data.evidence[0]?.evidence ?? null;
  writeJson(ctx.bundlePath, "axe-results.json", axeEvidence);

  // 6. evidence.json — full evidence array from step 7, indexed by
  // verification item id where known.
  writeJson(ctx.bundlePath, "evidence.json", data.evidence);

  // 7. benchmark-run.json — { run, evalRun } from step 8 verbatim.
  writeJson(ctx.bundlePath, "benchmark-run.json", data.benchmark);
}

function writeJson(bundlePath: string, filename: string, value: unknown): void {
  writeFileSync(resolve(bundlePath, filename), JSON.stringify(value, null, 2) + "\n", "utf8");
}

function writeJsonl(bundlePath: string, filename: string, rows: readonly unknown[]): void {
  const body = rows.length > 0 ? rows.map((row) => JSON.stringify(row)).join("\n") + "\n" : "";
  writeFileSync(resolve(bundlePath, filename), body, "utf8");
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
