# Vimbus 1.0 — Status & Roadmap

_Generated 2026-04-29, immediately after Sprint 7 close-out._
_Updated 2026-04-29 after Jira closure of VIM-48, VIM-49, VIM-50, and the VIM-47 epic._
_Top SHA on `main`: Sprint 7 close commit chain ending at the VIM-50 doc rollover (see git log)._
_Sprint 7 added 14 commits across 3 stories totalling 15 story points; reserved capacity consumed by VIM-48 timeout follow-ups and VIM-49 live-run fixes._

---

## TL;DR

**No actionable VIM-prefixed tickets remain open after Sprint 7 close.** All stories and tasks are Done; the VIM-28 (Observability & production hardening) epic remains Open as a residual category container with no open children. VIM-42 was rescoped post-Sprint-6 (residual scope absorbed by VIM-45 + VIM-46) and closed on 2026-04-28; the `sprint-8-backlog` label remains as a label-only marker, not as an open-ticket signal. Sprint 8 work will be filed as fresh tickets at sprint start.

- **M1 — "Execution Loop Live" — closed.** Carried from Sprint 5; unchanged by Sprint 7.
- **M2 — "Verifiable Execution at Scale" — declaration deferred to Sprint 8.** Sprint 7 shipped VIM-48 + VIM-49 + VIM-50 (the implementation surface for criteria 1, 2, 4, 5). Criterion 3 (`bun run dogfood:m2` reaching a `passed` verdict end-to-end on a clean machine) is currently `blocked` on the dev machine because Playwright's Chromium headless-shell hits a 180s launch timeout. The Sprint 8 Chromium environmental fix paired with a re-run will satisfy criterion 3, after which M2 is declared shipped.
- **Test matrix discipline** is now durable. `bun run verify:m2` is the authoritative answer to "is the tree green?" — green at every Sprint 7 SHA after `177b1eb`, deterministic across `test:unit` (parallel pool) + `test:serial` (single fork) + `test:postgres` (docker-compose).
- **M2 golden-path harness** (`bun run dogfood:m2`) is code-complete and documented. All eight scenario steps wired, full artifact bundle population, idempotency proven byte-for-byte, runbook complete with troubleshooting drawn from real failure modes.
- **Sprint 8 anchor** is the Chromium environmental fix (small, ~3 pts) plus VIM-51 stretch. Backlog candidates from `docs/SPRINT-7-PLAN.md` queue behind those two.

---

## M2 closure-criteria scoreboard

The five criteria (per the VIM-47 epic and the runbook's "What this runbook is for" section):

| # | Criterion | Status | Notes |
|---|---|---|---|
| 1 | VIM-48 + VIM-49 + VIM-50 Done | done | All three closed in Sprint 7. |
| 2 | `origin/main` has all Sprint 7 work | done | All commits referenced below pushed. |
| 3 | `bun run dogfood:m2` runs end-to-end on a clean machine, verdict `passed` | blocked | Orchestration completes; verdict `blocked` on dev machine due to Playwright Chromium 180s launch timeout. Resolves after Sprint 8 Chromium fix + re-run. |
| 4 | `bun run verify:m2` deterministic | done | Closed by VIM-48; suite stably 471 pass / 2 skip / 0 fail. |
| 5 | `docs/runbooks/m2-golden-path.md` is the only doc a new operator needs | done | Filled in at `5f7327b`. |

M2 is *not* declared shipped until criterion 3 reaches `passed`. See "Sprint 8 — recommended slate" below for the path.

---

## What ships today

### 1. Execution loop — closed (epic VIM-24, milestone M1)

Carried from `STATUS-2026-04-28.md` unchanged.

| Capability | Story | Sprint |
|---|---|---|
| Vercel AI SDK execution agent loop | VIM-29 | 1 |
| Retry / escalate runtime driven by evaluator verdicts | VIM-30 | 4 |
| `taskgoblin-patch.apply_patch` MCP wrapper | VIM-32 | 2 |
| TDD red → green → refactor verification runner | VIM-31 | 4 |
| Evaluator `runEvaluation` auto-flips `ModelDecision.state` on failing verdicts | VIM-44 | 4 |

### 2. Planner quality — feature-complete (epic VIM-25, closed)

Carried from prior STATUS. VIM-33, VIM-35, VIM-34 all Done; epic closed.

### 3. Operator console & live ops — closed (epic VIM-26)

Carried from prior STATUS plus Sprint 6 closure. VIM-36, VIM-37, VIM-38, VIM-45, VIM-46 all Done.

### 4. Verification breadth — closed (epic VIM-27)

VIM-39 Browser-MCP wrapper + a11y/visual verification runtime: Done in Sprint 6.

### 5. Observability & production hardening — partial (epic VIM-28)

| Story | Status | Note |
|---|---|---|
| VIM-43 DB-MCP read-only wrapper | Done (Sprint 5) | — |
| VIM-40 Benchmark hydration from execution telemetry | Done (Sprint 6) | Consumed by VIM-49 step 8. |
| VIM-41 Real LangSmith trace export | Done (Sprint 6) | Live polish on Sprint 8 backlog (not VIM-41 reopen). |
| VIM-42 Postgres adapter and production hardening | Done (2026-04-28, rescoped) | Original surface delivered by VIM-45 + VIM-46; residual closed. The `sprint-8-backlog` label is a label-only marker, not an open ticket. |

### 6. M2 release candidate — implementation surface complete (epic VIM-47, closed)

| Story | Pts | Status | Top commits |
|---|---:|---|---|
| VIM-48 Test matrix and flake hardening | 5 | Done | `9ac2ccc`, `177b1eb`, `3df9552` |
| VIM-49 M2 golden-path dogfood harness, minimum viable | 8 | Done | `e5f5eb5`, `dd4aa2f`, `128fceb`, `a5247a5`, `75aebdd`, `c68effb`, `28f60de`, `da3ec0e`, `9ece8a1`, `5f7327b` |
| VIM-50 Roadmap and runbook cleanup | 2 | Done | This STATUS doc + README edits + Sprint 8 starter prompt |

Epic VIM-47 closed. M2 milestone declaration deferred to Sprint 8 — see scoreboard above.

---

## Sprint 7 deliverables

| Key | Pts | Summary | Top SHA | Tests added |
|---|---:|---|---|---|
| VIM-48 | 5 | Stratified `test:unit` / `test:serial` / `test:postgres` / `verify:m2`; root-cause fix for parallel-pool flake via per-worker template DB; carry-over flakes resolved or subsumed | `3df9552` | docker-compose smoke + per-worker template DB regression coverage |
| VIM-49 | 8 | M2 golden-path dogfood harness: orchestrator at `scripts/dogfood-m2.ts`, eight-step scenario chain, full artifact bundle, idempotency-asserted, runbook landed | `5f7327b` | Headless-execute integration test + dogfood idempotency test |
| VIM-50 | 2 | STATUS rollover + README runbook link + M2 Release Checklist + Sprint 8 starter prompt | doc-only | n/a |

VIM-51 (M2 golden-path full instrumentation, 5 pts stretch) was **not** pulled — reserved for Sprint 8 behind the Chromium fix.

---

## Currently open work

**No open stories or tasks after Sprint 7 close.** The VIM-28 epic remains Open as a category container (eligible to close in Sprint 8 housekeeping). VIM-51 sits in the backlog (Created, not To Do — there is no Jira sprint object to "move into"; the project tracks sprint membership via the `sprint-N` label convention, not the Sprint custom field). The Sprint 8 Chromium environmental fix will be filed as a fresh ticket with the `sprint-8` and `m2-blocker` labels.

Per-epic state:

| Epic | Status | Note |
|---|---|---|
| VIM-24 Execution loop | Closed | M1. |
| VIM-25 Planner quality | Closed | Sprint 5. |
| VIM-26 Operator console | Closed | Sprint 6. |
| VIM-27 Verification breadth | Closed | Sprint 6. |
| VIM-28 Observability & production hardening | Open | Residual: future hardening work. No open children today. |
| VIM-47 M2 Release Candidate & Dogfood | Closed | Sprint 7. M2 declaration pending Sprint 8 Chromium fix. |

---

## Sprint 8 — recommended slate

**Theme: unblock M2 declaration, then lift the dogfood harness from minimum-viable to fully instrumented.**

| Order | Item | Pts | Why now |
|---|---|---:|---|
| 1 | **Chromium environmental fix** (new ticket; `m2-blocker`) | 3 | The single remaining blocker for M2 closure criterion 3. Concrete ACs: `playwright.chromium.launch()` succeeds on the dev machine without 180s timeout; new smoke fixture under `apps/cli/src/dogfood-fixtures/playwright-launch.smoke.ts` exercising only the launch step and wired into `verify:m2` as a fast pre-flight (~5s when working) so the dogfood orchestrator fails fast on the smoke instead of spending 180s in the full scenario; runbook troubleshooting section updated; `bun run dogfood:m2` re-run end-to-end with `passed` verdict captured under `.artifacts/m2/<run-id>/`. The re-run constitutes the operator-validation pass for VIM-50's deferred AC. |
| 2 | **VIM-51** M2 golden-path full instrumentation (stretch from Sprint 7) | 5 | Adds LangSmith trace link assertion + SSE event-sequence assertions + bundle additions. Pull only after Chromium fix lands and M2 is declared shipped. |
| 3+ | Sprint 8 backlog candidates from `docs/SPRINT-7-PLAN.md` | varies | LangSmith live export polish (~3); full PDF rendered-page diff (~5); cloud deploy rehearsal (5-8); programmatic Postgres via testcontainers (~3); browser install / autosmoke hardening (covers items 1's smoke fixture work). |

After the Chromium fix lands and the re-run produces `passed`: post a closure comment on VIM-50 noting the operator-validation AC satisfied by the post-Chromium-fix re-run; declare M2 shipped via epic-comment on VIM-47 / apply M2 fixVersion to VIM-48, VIM-49, VIM-50.

---

## Carry-over flake table — all resolved

Mirroring the format from `STATUS-2026-04-28.md` for continuity:

| Flake | Where | Status |
|---|---|---|
| `projectManagerPack.test.ts:158` agent-mirror text drift | `packages/planner` | **Resolved (VIM-48).** Assertion deleted; mirror is doc-only with no runtime consumer and no generator. Reduced to file-existence. |
| `test-runner/src/index.test.ts` timing under parallel pool | `packages/test-runner` | **Resolved (VIM-48).** Root cause was per-test full-migration in `createIsolatedPrisma`; replaced with a per-worker memoized template DB in `packages/db/src/testing.ts`. |
| `app.test.ts > "dispatches approved visual items..."` | `apps/api` | **Resolved (VIM-39, confirmed VIM-48).** 5/5 isolated runs + 1/1 alongside its 22 sibling tests. Removed from the active carry-over list. |
| Occasional `db` repo `beforeEach` hook timeout | `packages/db` | **Resolved (VIM-48).** Same root cause as the test-runner flake — fixed by the same template-DB change. |

The suite is stably green at every Sprint 7 SHA after `177b1eb` (471 pass / 2 skip / 0 fail across `test:unit` and `test:serial`, plus the `test:postgres` smoke pass).

---

## Risks and housekeeping

### Chromium environmental gap (carries into Sprint 8)

The Playwright `chromium-headless-shell` launch hits a 180s timeout on the dev machine — environmental, not harness. The runbook captures this verbatim in the Troubleshooting section. M2 declaration deferred until the fix lands and a clean re-run produces `passed`. This is the single remaining gap; no other criteria block.

### `prisma db push` Claude Code safety guard

Prisma 7.8.0 requires `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` when invoked under Claude Code. Documented in the runbook. Direct operator invocations are unaffected.

### M2 declaration timing

M2 is **not** declared shipped in this STATUS doc. The strict reading of criterion 3 (`bun run dogfood:m2` reaches `passed`) is the bar. The honest framing for outside readers: "M2 implementation surface complete in Sprint 7; M2 declared shipped in Sprint 8 after the Chromium environmental fix."

### Sprint 8 ticket-filing process

Sprint 8 has **no Jira Sprint object** — the project tracks sprints via labels (`sprint-5`, `sprint-6`, `sprint-7`), and JQL `sprint is not EMPTY` returns 0 issues across the project's history. There is no sprint ceremony to gate filing; Sprint 8 work is filed as fresh tickets with the `sprint-8` label whenever the operator chooses to start. Begin with the Chromium fix (labels: `sprint-8`, `m2-blocker`). The pre-existing `sprint-8-backlog` label on VIM-42 is a closed-ticket marker only; do not interpret it as an open-ticket signal.

---

## Reference: Sprint 7 commit chain

VIM-48: `9ac2ccc`, `177b1eb`, `3df9552`.

VIM-49: `e5f5eb5`, `dd4aa2f`, `128fceb`, `a5247a5`, `75aebdd`, `c68effb`, `28f60de`, `da3ec0e`, `9ece8a1`, `5f7327b`.

VIM-50: doc commits landing this STATUS file, the README edits, and the Sprint 8 starter prompt (this doc-commit chain creates new SHAs not referenced from inside this doc).
