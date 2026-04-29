import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

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
};

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
  };

  const verdict = await runM2GoldenPath(ctx, notes);
  return finalizeRun({ runId, startedAt, now, verdict, artifactBundlePath, apiUrl, notes });
}

async function runM2GoldenPath(ctx: ScenarioContext, notes: string[]): Promise<DogfoodVerdict> {
  await step1CleanDatabase(ctx);
  notes.push("step 1 (clean db): API /health responded ok");

  const { projectId } = await step2CreateProject(ctx);
  notes.push(`step 2 (create project): projectId=${projectId}`);

  // Steps 3-8 are scaffolded but not yet implemented. The next session lands
  // them in order. Keep the throw here so a non-dry-run accidentally invoked
  // against a live environment fails loudly rather than silently writing an
  // incomplete artifact bundle.
  await step3SeedPlannerOutput(ctx, projectId);
  // unreachable until step3 is implemented — listed for completeness of the
  // call graph the next session will fill in.
  // const { plannerRunId, taskId } = await step3SeedPlannerOutput(ctx, projectId);
  // await step4ApproveTaskAndPlan(ctx, taskId);
  // const { executionId } = await step5ExecuteTask(ctx, taskId);
  // await step6ObserveVisualVerification(ctx, executionId);
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
  _ctx: ScenarioContext,
  _projectId: string,
): Promise<{ plannerRunId: string; taskId: string }> {
  // Implementation: POST /planner/runs to create a run, then
  // POST /planner/runs/:id/generate with a deterministic PlannerProposalInput
  // (shape in packages/db/src/repositories/plannerRepository.ts:11-50). The
  // payload short-circuits the LLM via the `hasPlannerProposalPayload` check
  // at apps/api/src/app.ts:352. Then GET /tasks?projectId=<projectId> to find
  // the seeded task id. The proposal fixture should contain exactly one epic
  // with one task and one a11y verification item pointing at the
  // dogfood-fixtures/index.html page (file:// URL, computed at runtime so the
  // path is absolute on the operator's machine).
  throw new Error("VIM-49 step 3 (seed deterministic planner output) is not yet implemented.");
}

// Step 4-8 helpers omitted until the next implementation pass; their
// signatures are documented in the call graph above.

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
