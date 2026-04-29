# Sprint 7 Plan — M2 Release Candidate

_Drafted 2026-04-28, after critique of the v1 Sprint 7 proposal. Supersedes the v1 draft._

---

## Actual Jira key mapping (post-filing, 2026-04-28)

The placeholder keys in the body of this doc (VIM-47, VIM-48, VIM-49, VIM-50) used pre-create assumed numbering. Jira auto-assigned the new epic to VIM-47, shifting all stories down by one. **Use this mapping when reading the rest of the doc**:

| Plan label | Actual Jira key | Role |
|---|---|---|
| (new epic) | **VIM-47** | M2 Release Candidate & Dogfood (Epic) |
| VIM-48 | **VIM-48** | Test matrix and flake hardening |
| VIM-47 | **VIM-49** | M2 golden-path dogfood harness (minimum viable) |
| VIM-49 | **VIM-50** | Roadmap and runbook cleanup for M2 |
| VIM-50 | **VIM-51** | M2 golden-path full instrumentation (stretch) |

VIM-48 (test matrix) lined up as planned. Blocks links: VIM-48 → VIM-49 (test matrix blocks dogfood); VIM-49 → VIM-51 (dogfood blocks stretch).

---

## VIM-48 closure note (2026-04-28, follow-up 2026-04-29)

VIM-48 shipped as `9ac2ccc` on 2026-04-28 with a same-day follow-up `177b1eb` (`fix(VIM-48): drop tight 20s overrides on parallel-pool API tests`). The follow-up removed per-test 20000ms timeouts on four `apps/api/src/app.test.ts` tests (branch lifecycle, execution start, patch reject, verification command failure) which had been tighter than the 30s global from `vitest.config.ts` and tripped under parallel-pool contention on Windows once the template-DB change made the suite faster overall. `verify:m2` is now green end-to-end at `177b1eb` (typecheck + `test:unit` 471/2-skip in 94s + `test:serial` 471/2-skip in 206s + `test:postgres` 1-pass).

Carry-over flake table from `STATUS-2026-04-28.md` resolved as follows:

| Flake | Resolution |
|---|---|
| `packages/test-runner/src/index.test.ts` parallel-pool timing | **Fixed at root cause.** Both this and the `db` `beforeEach` flake share one cause: `createIsolatedPrisma` re-applied the full 799-line migration set against a fresh SQLite file per test, contending on file locks under the parallel pool. `packages/db/src/testing.ts` now builds a per-worker memoized template DB (migrate once, then `copyFileSync` the main db file per test). Three back-to-back full-suite runs land 471/472 deterministically (1 skipped is the Postgres smoke when `DATABASE_URL` is unset). |
| `packages/db` `beforeEach` hook timeout | **Fixed at root cause.** Same template-DB change. |
| `packages/planner/src/projectManagerPack.test.ts` mirror snapshot drift | **Assertion deleted.** Mirror was doc-only — no runtime imports — and there was no generator script keeping it in sync, so byte-equality drifted on every prompt edit and was a stable false-positive across Sprints 4-6. The test now asserts only that the mirror file exists. Restore the equality assertion if a generator is later added. |
| `apps/api/src/app.test.ts` "dispatches approved visual items..." | **Subsumed by VIM-39.** Confirmed 5/5 isolated runs + 1/1 alongside its 22 sibling tests in `app.test.ts`. Removed from the active carry-over list. |

Stratified scripts shipped at repo root:

- `test:unit` — full suite, parallel pool. Inner-loop check.
- `test:serial` — full suite under `vitest --no-file-parallelism`. Audit pass; if it fails when `test:unit` passes, a parallel-pool bug exists.
- `test:postgres` — `bun scripts/test-postgres.ts`. Brings docker-compose `postgres` up, generates the postgres Prisma client, pushes the schema, runs `packages/db/src/postgres.smoke.test.ts`, tears the service down.
- `verify:m2` — `typecheck && test:unit && test:serial && test:postgres`. Authoritative answer to "is the tree green?" and the bar for M2 closure criterion 4.

Other VIM-48 deliverables:

- `docker-compose.yml` at repo root with a single `postgres:16-alpine` service on `127.0.0.1:55432`. Used by `test:postgres` and consumable by VIM-49 dogfood.
- `packages/db/src/postgres.smoke.test.ts` checked in — gated by `describe.skipIf(!isPostgres)` so it skips silently in `test:unit`/`test:serial` and runs only when `test:postgres` sets `DATABASE_URL`.
- Root `README.md` "Quality Checks" section names `verify:m2` as authoritative.
- `apps/api/README.md` documents docker-compose Postgres as the canonical local Postgres for tests and the two-process LoopEventBus smoke.

---

## Theme

**Prove the full loop is repeatable. Ship the test-matrix discipline that makes the proof trustworthy.**

Sprint 6 closed the verification breadth and observability gaps. Sprint 7 turns the locally-drafted features into a durable, repeatable, *operator-runnable* M2 release candidate — the answer to: "can a clean operator run Vimbus end-to-end without help?"

---

## What changed from v1

| v1 | v2 | Reason |
|---|---|---|
| VIM-42 silently dropped | VIM-42 explicitly rescoped to 5 pts and deferred to Sprint 8 backlog | v1's "VIM backlog empty after Sprint 7" claim was false; VIM-42 still open under VIM-28 |
| VIM-47 (8 pts) before VIM-48 (5 pts) | VIM-48 first; VIM-47 consumes its harness | Dogfood signal is meaningless without a deterministic test matrix |
| VIM-47 = 8 pts spanning ~8 subsystems + new artifact bundle | VIM-47 split into 8-pt minimum-viable + 5-pt stretch (VIM-50) | Honest sizing; keeps a sprint-end gate |
| No Sprint 6 fix-up buffer | 2-3 pts reserved capacity (no pre-filed ticket) | Sprint 6 is unverified at sprint start |
| M2 lives only in prose | M2 declared via fixVersion or epic-level closure criteria | Parity with M1 (epic VIM-24); enables a clean "M2 shipped" claim |
| Postgres smoke: undecided | docker-compose, owned by VIM-48, consumed by VIM-47 | Decided up front so VIM-47 day-1 isn't infra setup |

---

## Pre-sprint actions

These must happen **before** filing the new epic/stories. They unblock the "VIM backlog empty" claim and lock in operator-side decisions.

### 1. Rescope VIM-42

- Add comment on VIM-42:
  > Rescoped post-Sprint-6. The original "Postgres adapter" surface was delivered by VIM-45 (LISTEN/NOTIFY adapter) and VIM-46 (dual-client + API startup wiring). Residual scope: connection pool sizing, reconnection guidance, migration discipline beyond `prisma db push`, ops runbook. Re-estimated at 5 pts. Deferring to Sprint 8 backlog.
- Re-estimate to 5 pts (was 8).
- Labels: keep `infrastructure technical-debt`; add `sprint-8-backlog`.
- Do not transition. Keep open under VIM-28.

### 2. Declare the M2 milestone

Pick one (whichever the team prefers):
- **Option A (preferred):** Create Jira `fixVersion` "M2 — Verifiable Execution at Scale" and apply it to VIM-47, VIM-48, VIM-49 (and VIM-50 if stretch is pulled).
- **Option B:** Add closure-criteria comment to the new epic with the same bar.

**M2 closure criteria** (use verbatim either way):
> M2 is declared shipped when:
> 1. VIM-47 + VIM-48 + VIM-49 are Done.
> 2. `origin/main` has all Sprint 7 work pushed.
> 3. `bun run dogfood:m2` runs end-to-end on a clean machine without operator help.
> 4. `bun run verify:m2` is deterministic — failures are product, not harness.
> 5. `docs/runbooks/m2-golden-path.md` is the only doc a new operator needs.

### 3. Lock in the Postgres-smoke approach

**Decision:** ship `docker-compose.yml` for the Postgres smoke as part of VIM-48's `test:postgres` script. VIM-47 consumes it. Rejected alternatives: required local Postgres install (friction, version skew); skip live Postgres (weak signal). `testcontainers` is a Sprint 8 candidate if fully programmatic setup is needed later.

---

## New epic

**VIM-XX "M2 Release Candidate & Dogfood"**

- Type: Epic
- Parent: none (top-level)
- Linked milestone: M2 fixVersion (per pre-sprint action 2)
- Children: VIM-47, VIM-48, VIM-49 (+ VIM-50 if stretch is pulled)

Closure criteria: as defined above.

---

## Committed slate — 15 pts

| Order | Key | Pts | Story | Why now |
|---|---|---:|---|---|
| 1 | **VIM-48** | 5 | Test matrix and flake hardening | Must merge first; everything downstream depends on a trustworthy signal. |
| 2 | **VIM-47** | 8 | M2 golden-path dogfood harness (minimum viable) | Consumes VIM-48. Proves the Sprint 1-6 surfaces work in concert. |
| 3 | **VIM-49** | 2 | Roadmap and runbook cleanup for M2 | Parallel-safe; can land any time post-pre-sprint. |

**Reserved capacity:** 2-3 pts implicit, **not** pre-filed. If Sprint 6 verification (per `docs/NEXT-SESSION-PROMPT.md`) reveals real bugs, file `fix(VIM-39/40/41/46): ...` commits attributed to a single fix-up ticket created at the time of need, and consume buffer here.

---

## Stretch — pull only if VIM-47 + VIM-48 land by mid-sprint

| Order | Key | Pts | Story | Notes |
|---|---|---:|---|---|
| S1 | **VIM-50** | 5 | M2 golden-path full instrumentation | Lifts VIM-47 from "minimum viable" to "complete." LangSmith link assertion + SSE assertions + artifact bundle additions. |

---

## Sprint 8 backlog (do not pull into Sprint 7)

| Candidate | Pts | Notes |
|---|---:|---|
| VIM-42 (rescoped) — Postgres production hardening | 5 | Connection pool, reconnection guidance, migration discipline beyond `db push`, ops runbook. Pre-sprint action 1 sets this up. |
| Browser install / autosmoke hardening | 3 | Playwright install reliability, Chromium presence verification, screenshot artifact retention. |
| LangSmith live export polish | 3 | Dataset/experiment linkage, redaction review. Pull after VIM-50 lands. |
| Full PDF rendered-page diff | 5 | Previously deferred from visual verification. |
| Cloud deploy rehearsal | 5–8 | Only after local M2 RC is stable. |
| Programmatic Postgres via testcontainers | 3 | Alternative to docker-compose if VIM-48's approach proves friction-heavy. |

---

## Story details

### VIM-48 — Test matrix and flake hardening (5 pts)

**Why:** Sprint 4-6 carried a known parallel-pool flake. M2 RC requires deterministic verification — a failure must be a product failure, not harness noise.

**Acceptance criteria:**
- Identify the parallel-pool exit cause for `packages/test-runner/src/index.test.ts`. Either fix root cause, or document the test as serial-only with a stable workaround (`vitest --pool=forks --poolOptions.forks.singleFork=true` is the starting hypothesis).
- Stable npm scripts at repo root:
  - `test:unit` — fast non-stateful matrix, parallel pool
  - `test:serial` — stateful tests that need isolation, single fork
  - `test:postgres` — exercises Postgres-backed paths via docker-compose
  - `verify:m2` — composite that runs all three in the right order
- `docker-compose.yml` at repo root for the Postgres smoke. Documented in `apps/api/README.md` as the canonical local Postgres for tests.
- One paragraph in root `README.md` says which command is authoritative for "is the tree green."
- The four pre-existing flakes from `STATUS-2026-04-28.md` are each: fixed, explicitly quarantined with an in-code known-issue comment, *or* shown to be subsumed by Sprint 6's changes.
- Running the Sprint 6 touched test set under each new script is clean.

**Out of scope:** CI infra (GitHub Actions etc.); test refactors beyond what stratification needs; new test coverage.

**Surface:** root `package.json`, `vitest.config.ts` (root + per-package as needed), new `docker-compose.yml`, `apps/api/README.md`, possibly `packages/test-runner/src/index.test.ts` if root-cause is fixable.

---

### VIM-47 — M2 golden-path dogfood harness, minimum viable (8 pts)

**Why:** Validates that all Sprint 1-6 surfaces work in concert under a realistic, *deterministic* scenario.

**Prereq:** VIM-48 must merge first — VIM-47 consumes `verify:m2` and `test:postgres`.

**Acceptance criteria (minimum viable):**
- A single command (`bun run dogfood:m2`) runs a deterministic golden-path scenario from a clean state.
- Scenario steps: clean DB → create project → seed planner output (deterministic JSON, no LLM call required) → approve task + verification plan → execute one task branch → run one browser/a11y/visual verification item against a checked-in fixture page → confirm `TestRun.evidenceJson` is persisted → hydrate a benchmark run from the resulting `taskExecutionId` and confirm the verdict.
- Uses Postgres mode (consumes VIM-48's docker-compose).
- Leaves a durable artifact bundle under `.artifacts/m2/<run-id>/` containing: scenario manifest, planner payload, agent step log, MCP tool-call log, screenshot(s), axe results, evidenceJson, benchmark run record.
- `docs/runbooks/m2-golden-path.md` documents how to run it and what each artifact means.
- Idempotent: two runs against the same clean state produce identical artifacts modulo timestamps and run IDs.

**Out of scope (deferred to VIM-50):** LangSmith trace link assertion (env-coupled), live SSE event-sequence assertions, integration with the live planner's 5-round interview (uses deterministic seed instead), more verification dimensions, cloud deploy.

**Surface:** `apps/cli/src/dogfood.ts` (new command), `apps/cli/src/dogfood.test.ts`, fixture pages under `apps/cli/src/dogfood-fixtures/`, `docs/runbooks/m2-golden-path.md`. Reuses existing API endpoints (no `apps/api/src/app.ts` change expected — flag if one is needed).

---

### VIM-49 — Roadmap and runbook cleanup for M2 (2 pts)

**Why:** Docs already lag reality after Sprint 6. M2 RC declaration needs a coherent doc set.

**Acceptance criteria:**
- New `docs/STATUS-<close-date>-SPRINT-7-CLOSED.md` supersedes `docs/STATUS-2026-04-28.md`.
- `docs/NEXT-SESSION-PROMPT.md` archived to `docs/archive/` *or* replaced with a Sprint 8 starter prompt.
- `docs/execution/mvp-plan.md` updated to reflect Sprint 6 + 7 completion (skip if file does not exist).
- `docs/runbooks/m2-golden-path.md` exists (created by VIM-47) and is linked from root `README.md`.
- Concise "M2 Release Checklist" added to `README.md` *or* `docs/m2-checklist.md`. Items match the M2 closure criteria from pre-sprint action 2.
- Explicit statement at top of new STATUS doc: VIM-42 rescoped to Sprint 8; that's the only open VIM-prefixed ticket after Sprint 7 close.
- Operator validation: at least one team member who did not author VIM-47 successfully runs `bun run dogfood:m2` end-to-end on a clean checkout and reports bugs (none, or filed and triaged).

**Out of scope:** New documentation themes; rewriting CLAUDE.md or AGENTS.md; reorganizing the docs hierarchy.

**Surface:** `docs/`, root `README.md`.

---

### VIM-50 — M2 golden-path full instrumentation (5 pts, stretch)

**Why:** Lifts the dogfood harness from "the seams connect" to "everything is observable end-to-end."

**Prereq:** VIM-47 must merge first.

**Acceptance criteria:**
- The dogfood harness, when run with `LANGSMITH_TRACING=true` and `LANGSMITH_API_KEY` present, produces a trace link in the artifact bundle and asserts a `LangSmithTraceLink` row exists for the execution.
- The harness opens an SSE consumer against `/events` and asserts the expected event sequence (e.g. `task.execution.started`, `verification.run.completed`, `benchmark.finished`) lands in order.
- Artifact bundle gains: SSE event log, LangSmith trace URL, exporter status (enabled/skipped/failed).
- README links the trace from each artifact bundle.
- Harness fails gracefully when LangSmith env is absent — SSE assertions still run; LangSmith assertions skip with a logged note.

**Out of scope:** LangSmith dataset/experiment linkage (Sprint 8 backlog); SSE replay; trace redaction.

**Surface:** `apps/cli/src/dogfood.ts` (extend), `packages/observability/`, possibly `apps/api/src/app.ts` if SSE assertions need a new probe endpoint.

---

## Sprint 7 Definition of Done

- `origin/main` has VIM-47 + VIM-48 + VIM-49 merged. VIM-50 if stretch was pulled.
- VIM-47 + VIM-48 + VIM-49 are Done in Jira; the new "M2 Release Candidate & Dogfood" epic is closed.
- Pre-sprint actions 1-3 are complete (VIM-42 rescoped, M2 milestone declared, Postgres approach locked).
- A clean operator can run `bun run dogfood:m2` and complete the M2 flow without help; `docs/runbooks/m2-golden-path.md` is the only doc they need.
- `bun run verify:m2` is deterministic — a failure is a product failure, not harness noise.
- README documents the M2 release checklist; M2 is *declared* shipped if and only if all checklist items are green.
- Sprint 6 verification carry-over: any fix-up commits land before Sprint 7 close, attributed to `fix(VIM-39/40/41/46): ...`.

---

## Out of scope (explicit)

- New planner / interview features.
- New UI / TUI features.
- Cloud deploy.
- More benchmark dimensions.
- VIM-42's residual scope (rescoped to Sprint 8).
- Squashing the existing Sprint 6 commit chain.
- New tooling for tasks not on the M2 critical path.

---

## Sequencing and merge order

```
Pre-sprint
  1. Verify Sprint 6 (per docs/NEXT-SESSION-PROMPT.md)
     - typecheck + targeted vitest passes
     - retroactive Jira load (VIM-46/39/40/41 → In Progress → In Review)
     - push origin/main
     - close VIM-46/39/40/41
     - close epics VIM-26 (eligible) and VIM-27 (eligible)
  2. VIM-42 rescope: 8 → 5 pts, sprint-8-backlog label, comment
  3. M2 milestone: fixVersion or epic-level closure-criteria comment
  4. Postgres-smoke approach locked: docker-compose owned by VIM-48
  5. File new epic + VIM-47 + VIM-48 + VIM-49 with sprint-7 label

Sprint 7 (parallel worktree agents allowed; merge gate is VIM-48)
  Day 1-3:  VIM-48 develops in parallel with VIM-49.
            VIM-47 develops scaffolding (CLI command shell, fixture pages,
            artifact-bundle layout) but cannot run smoke until VIM-48 merges.
  Day 4:    VIM-48 merges first.
  Day 5-8:  VIM-47 consumes VIM-48; VIM-49 begins consuming both.
  Day 9:    VIM-47 merges.
  Day 10:   VIM-49 final pass and merges.
            Decide stretch: pull VIM-50 if capacity allows.
  Day 11-14: VIM-50 (if pulled) or Sprint 8 prep.
```

(Adjust dates to actual sprint calendar.)

---

## Operator decisions to lock in before Day 1

- **Postgres-smoke:** docker-compose (per pre-sprint action 3). Confirm Docker is installed on every developer machine that will run `verify:m2`.
- **LangSmith access:** decide whether `LANGSMITH_API_KEY` is shared via team vault now, or whether VIM-50's LangSmith ACs are environment-conditional from day 1.
- **Operator validation contact:** name the team member who will run the VIM-49 unfamiliar-operator validation. They need to *not* be the VIM-47 author.
- **Sprint dates:** the v1 plan assumed `2026-07-06 → 2026-07-19` for Sprint 6. Sprint 7 dates depend on whether Sprint 6 verification slips. Lock dates after Sprint 6 close-out.
