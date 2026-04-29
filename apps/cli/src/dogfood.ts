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
 * THIS FILE IS A SCAFFOLD. Step bodies are placeholders that reference the
 * surface map. The implementation pass fills each `runStepN` function in
 * order.
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
    const finishedAt = now();
    const summary: DogfoodRunSummary = {
      runId,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      verdict: "scaffold",
      artifactBundlePath,
      apiUrl,
      notes,
    };
    writeManifest(artifactBundlePath, summary);
    return formatSummary(summary);
  }

  // Implementation pass: replace the throw below with the eight scenario steps.
  // Each step gets its own internal function that takes a context object and
  // returns step-scoped data the next step needs. Surface map and per-step
  // route/payload references live in the file header above and in
  // `docs/SPRINT-7-PLAN.md` (VIM-49 closure section, once filled in).
  throw new Error(
    "VIM-49 dogfood scenario is not yet implemented. The CLI command shell, " +
      "argument parsing, and artifact-bundle layout are scaffolded. Run with " +
      "--dry-run to exercise the scaffold. Implementation lands in the next " +
      "VIM-49 commit; see docs/runbooks/m2-golden-path.md for what each step " +
      "will do.",
  );
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
  // Avoid pulling in `node:crypto` import for a single id; the bundled `crypto`
  // global is available under bun and node 20+ test runners.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for environments without WebCrypto — vanishingly unlikely in our
  // toolchain but keeps the function pure if the global is missing.
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `dogfood-${now}-${rand}`;
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
