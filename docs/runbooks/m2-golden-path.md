# M2 Golden Path Runbook

> The deterministic dogfood scenario that proves Vimbus's planner → approval → execute → verify → evidence → benchmark loop works end-to-end against the M2 release-candidate stack. Per the VIM-47 epic's closure criteria, this runbook is the only doc a new operator needs to validate the M2 milestone.

## What this runbook is for

The M2 milestone is "Verifiable Execution at Scale." Closure criterion 5 (per the VIM-47 epic) says: **`docs/runbooks/m2-golden-path.md` is the only doc a new operator needs.** This runbook covers running the deterministic golden-path scenario from a clean checkout and inspecting the resulting artifact bundle.

## Prerequisites

- **Bun `1.3.13`** on PATH. On Windows the binary lives at `C:\Users\<you>\.bun\bin\bun.exe`; from bash sessions you may need `export PATH="/c/Users/<you>/.bun/bin:$PATH"` first.
- **Docker** (or any docker-compatible container runtime) supporting `docker compose up --wait`. The orchestrator brings up an ephemeral Postgres container on `127.0.0.1:55432` and tears it down on exit.
- **Git** on PATH. The orchestrator initializes a deterministic temp repo at `/tmp/vimbus-m2-dogfood/<runId>` for the scenario's project rootPath.
- **Playwright + Chromium** installed and runnable — the verification dispatch step drives axe-core through Playwright. If your machine lacks Chromium or the headless launch hangs, `axe-results.json` in the bundle captures the launch error verbatim and the benchmark verdict comes back as `blocked` rather than `passed`. See "Troubleshooting" below.
- **Port 3137** free on the loopback interface (the orchestrator's default API bind). Override with `VIMBUS_DOGFOOD_API_PORT` if 3137 is taken.

## Running the dogfood harness

```bash
bun run dogfood:m2
```

This single command:

1. Brings the docker-compose `postgres` service up and waits for it to be healthy (`127.0.0.1:55432`).
2. Generates the SQLite + Postgres Prisma clients via `bun --filter @vimbuspromax3000/db db:generate`.
3. Force-resets the Postgres schema via `prisma db push --force-reset --accept-data-loss`. (This is what gives the deterministic-from-clean-state guarantee.)
4. Prepares a deterministic temp git repo at `/tmp/vimbus-m2-dogfood/<runId>/`.
5. Spawns the API server in Postgres mode (`bun --filter @vimbuspromax3000/api start`) on port 3137.
6. Polls `/health` until the API self-reports ok (120s budget; typical <5s).
7. Drives the eight-step deterministic scenario via the CLI dogfood command:
   1. Clean DB sanity-check (`GET /health`).
   2. Create project (`POST /projects`).
   3. Seed deterministic planner output (`POST /planner/runs` then `POST /planner/runs/:id/generate` with a frozen `PlannerProposalInput` payload — bypasses the LLM via `hasPlannerProposalPayload`).
   4. Approve task + verification plan (`POST /tasks/:id/verification/approve`).
   5. Execute one task branch headlessly (`POST /tasks/:id/execute/headless` — bypasses the LLM-driven agent loop; this route is dogfood-only).
   6. Run the a11y verification item against the checked-in fixture (`POST /executions/:id/test-runs`).
   7. Confirm `TestRun.evidenceJson` is persisted.
   8. Hydrate a benchmark run from the resulting `taskExecutionId` (`POST /benchmarks/scenarios` then `POST /benchmarks/scenarios/:id/run`).
8. Writes a self-contained artifact bundle under `.artifacts/m2/<runId>/`.
9. Stops the API and tears the docker-compose service down — even if any step above failed.

A green run exits 0 and the manifest's `verdict` is `passed`. A red run still leaves the bundle in place for inspection; common red verdicts are `blocked` (a verification dimension scored 0) or `failed` (a verification dimension scored below its `passThreshold`).

## Artifact bundle layout

```
.artifacts/m2/<run-id>/
├── manifest.json           # scenario metadata: runId, SHAs, durations, verdict, per-step notes
├── planner-payload.json    # the deterministic seed used in step 3 (verbatim PlannerProposalInput)
├── agent-step-log.jsonl    # AgentStep rows for this taskExecutionId (one JSON per line)
├── mcp-tool-call-log.jsonl # McpToolCall rows for this taskExecutionId (one JSON per line)
├── screenshots/            # PNGs from the visual verification step
├── axe-results.json        # axe-core output from the a11y verification step
├── evidence.json           # all TestRun.evidenceJson payloads, decoded
└── benchmark-run.json      # the BenchmarkScenarioRun row + EvalRun hydrated post-execution
```

Two runs against the same clean state produce identical bundle contents modulo the `runId` and the `manifest.json` timestamp fields. The `apps/cli/src/dogfood.test.ts` idempotency test asserts this byte-for-byte.

## What each step proves

| Step | What this validates |
|---|---|
| 1. Clean DB | The orchestrator wired Postgres + the API correctly; the API process is real, not a leftover from another project. |
| 2. Create project | The `Project` write path persists; `rootPath` accepted as-is. |
| 3. Seed planner output | The `hasPlannerProposalPayload` short-circuit at `apps/api/src/app.ts` works — operator can persist a known-good plan without paying for an LLM call. The planner's `normalizePlannerProposalInput` rewrites stableIds to `PLAN-<runSuffix>-<UPPERCASED>`; this rewrite is intentional and the scenario filters by "exactly one task in the project" (not by exact stableId). |
| 4. Approve | The single `POST /tasks/:id/verification/approve` call covers both halves (task + plan) so operator approval is one click in the real UI. |
| 5. Execute headless | `POST /tasks/:id/execute/headless` (dogfood-only) creates a `TaskExecution` row + prepares the git branch without the LLM-driven agent loop. The integration test at `apps/api/src/app.test.ts` asserts: zero `AgentStep` rows, zero `ModelDecision` rows, branch state="active", `task.selected` event with `mode=headless`. |
| 6. Verification dispatch | VIM-39's a11y/visual dispatch path fires for an approved item with no command-backed tail. The test-runner's `runExecutionVerification` hits `packages/verification` which drives Playwright + axe-core. |
| 7. Evidence persisted | `TestRun.evidenceJson` carries the axe payload (or the launch error if Chromium can't be driven — see Troubleshooting). |
| 8. Benchmark hydration | VIM-40's `BenchmarkScenarioRun` hydration from `taskExecutionId` works: `loadBenchmarkToolCalls` and `loadBenchmarkVerificationItems` walk the execution's persisted MCP and `TestRun` rows, score them, and persist an `EvalRun` row. |

## Troubleshooting

Common failure modes from the first end-to-end runs of the harness:

### Port conflict on 3000

Symptom: `[dogfood] /health still polling` reports `HTTP 404` repeatedly even after `VimbusProMax3000 API listening on http://localhost:...` printed.

Cause: another HTTP server (often a Node dev server) is bound to the conventional port 3000, the orchestrator's API spawn fails to bind silently, and the polls hit the unrelated server.

Fix: the orchestrator now defaults to port 3137. If 3137 is also taken, override with `VIMBUS_DOGFOOD_API_PORT=<port> bun run dogfood:m2`.

### Playwright Chromium launch timeout

Symptom: `axe-results.json` contains an `error` field with `launch: Timeout 180000ms exceeded` and a chromium-headless-shell command line. Benchmark verdict is `blocked` because verification_quality scored 0.

Cause: the chromium binary path is correct but the launch hangs (Windows Defender / antivirus interference, missing system libraries, or stale browser cache). This is environmental and orthogonal to the harness.

Fix (in priority order):
1. Run `bun x playwright install chromium` to refresh the binary.
2. Add the Chromium path to your antivirus exclusions.
3. Try `bun x playwright install --with-deps chromium` if available.
4. As a last resort, run the dogfood with `VIMBUS_SKIP_BROWSER=1` (not yet implemented; tracked under Sprint 8 backlog) to short-circuit visual/a11y dispatch and still exercise the rest of the loop.

### `prisma db push` blocked by Claude Code safety guard

Symptom: `Prisma Migrate detected that it was invoked by Claude Code. ... You are attempting a highly dangerous action ...`.

Cause: Prisma 7.8.0 added a guard that requires explicit operator consent before destructive migrate operations when invoked by an AI agent.

Fix: when running the orchestrator under Claude Code, set `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="<your consent message verbatim>"`. Direct operator invocations don't trigger the guard.

### `--hot` mode startup hang

Symptom: API spawn prints ~80 lines like `warn: File ... is not in the project directory and will not be watched` and `/health` polls time out before the server binds.

Cause: `bun --hot` bootstraps the file watcher at startup; with our cross-package monorepo it logs a warning per non-watched file and takes 30-60s to actually bind.

Fix: the orchestrator already uses `start` (no `--hot`). If you customize the spawn, keep it on `start`.

## Out of scope for the minimum-viable harness

These extensions are tracked under VIM-51 (M2 golden-path full instrumentation, stretch):

- LangSmith trace link assertion + `LangSmithTraceLink` row check.
- SSE event-sequence assertion against `/events` (assert `task.execution.started` → `verification.run.completed` → `benchmark.finished` lands in order).
- Multi-dimensional verification matrix (visual + a11y + PDF render in the same scenario).

Those are not required for the M2 release-candidate gate; this runbook will not document them until VIM-51 lands.
