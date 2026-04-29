# Next Session — VIM-48 Jira hygiene, then VIM-49 steps 3-8

_Drafted 2026-04-28; revised 2026-04-29 in three passes as work landed: (a) `177b1eb` VIM-48 timeout follow-up on origin, (b) VIM-49 scaffold `e5f5eb5` + `d12cc48` doc on origin, (c) `3df9552` VIM-48 timeout-follow-up follow-up + `dd4aa2f` VIM-49 implementation pass 1 (steps 1-2 implemented) committed locally. Supersedes the prior Sprint 7 kickoff version of this file (preserved in git history at commit `eb8e371`)._

---

## TL;DR

VIM-48 (test matrix + flake hardening) is **implementation-done, verified, partially pushed**. The bulk is on `origin/main` (`9ac2ccc`, `177b1eb`); a tail-end timeout-override fix `3df9552` is committed locally and needs pushing.

VIM-49 (M2 golden-path dogfood harness) has its **scaffold + steps 1-2 committed**. Scaffold `e5f5eb5` and the doc rollover `d12cc48` are on `origin/main`; the implementation pass 1 (`dd4aa2f`, runM2GoldenPath chain + step1CleanDatabase + step2CreateProject + helper utilities + mocked-fetch tests) is committed locally.

Two commits are ahead of `origin/main` and need pushing. The VIM-48 Jira ticket is still in **To Do** because the Atlassian MCP tools weren't loaded in the prior sessions. Your job this session, in order:

1. Push the local commits (`3df9552` VIM-48 follow-up and `dd4aa2f` VIM-49 implementation pass 1) to `origin/main`.
2. Run VIM-48 through To Do → In Progress → In Review → Done in Jira, post the closure comment (it now references three SHAs: `9ac2ccc`, `177b1eb`, `3df9552`), and confirm VIM-49 is now unblocked.
3. Continue VIM-49 implementation: steps 3-8 (planner seed → approve → execute → visual verification observation → evidence query → benchmark hydration), the `scripts/dogfood-m2.ts` orchestrator, artifact-bundle population, idempotency proof, runbook fill-in.

The Atlassian MCP server is configured in project `.mcp.json` via `mcp-remote`. The user is approving/promoting the project-level MCP so the server loads at session start in the next session — confirm `mcp__atlassian__*` tools are available via `ToolSearch` before starting Jira work, and if they aren't, run `npx -y mcp-remote https://mcp.atlassian.com/v1/mcp` to re-trigger the OAuth dance against the cached client at `~/.mcp-auth/`.

---

## State at session start

### Repo

- Path: `C:\Users\ak\TaskGoblin` (TaskGoblin / VimbusProMax3000, Bun 1.3.13 monorepo).
- Branch: `main`.
- Expected: **2 commits ahead** of `origin/main` — verify with `git rev-list --count origin/main..HEAD`.
- The unpushed commits, top first:
  - `dd4aa2f feat(VIM-49): implement dogfood scenario chain (steps 1-2 of 8)` — replaces the all-or-nothing throw with a named step chain (runM2GoldenPath → step1 → step2 → step3 throws "not yet implemented for step 3"). step1CleanDatabase calls GET /health; step2CreateProject calls POST /projects. Adds requestJson/postJson/getJson helpers and a finalizeRun helper that writes manifest.json. 6/6 dogfood tests pass.
  - `3df9552 fix(VIM-48): drop remaining 20s overrides on test-runner/agent/planner` — same pattern as `177b1eb`: dropped per-test/per-hook `, 20000` overrides on `packages/test-runner/src/index.test.ts` beforeEach, `packages/planner/src/service.test.ts` beforeEach, and `packages/agent/src/execution.test.ts` (beforeEach + 2 test callbacks). Restored an explicit `, 60000` on the heavy `"allows approved command-backed items..."` test in test-runner because under parallel-pool load it can run >30s end-to-end (matches the precedent already at `apps/api/src/executions.execute.test.ts:49` and `app.test.ts:859`). `bun run test:unit` green twice in a row at this commit.
- Already on `origin/main`, top first: `d12cc48` (this prompt's prior revision), `e5f5eb5` (VIM-49 scaffold), `866b1bc` (doc rollover post-177b1eb), `177b1eb` (VIM-48 timeout follow-up #1), `9ac2ccc` (VIM-48 main implementation).
- Working tree expected clean except `.claude/worktrees/` (operational state, leave alone).

### Jira state

- **VIM-48** — Test matrix and flake hardening — still **To Do**. Needs To Do → In Progress → In Review → Done plus the closure comment below.
- **VIM-47** — M2 Release Candidate & Dogfood (Epic) — open. Don't transition until all three children are Done.
- **VIM-49** — M2 golden-path dogfood harness (8 pts) — **To Do**, blocked by VIM-48. Once VIM-48 is Done it's unblocked and you can start it.
- **VIM-50** — Roadmap and runbook cleanup (2 pts) — To Do, parallel-safe but the runbook content comes from VIM-49.
- **VIM-51** — Stretch instrumentation (5 pts) — To Do, blocked by VIM-49.

Cached transition IDs (verified in Sprint 6 close-out and confirmed unchanged): **11=To Do, 21=In Progress, 31=In Review, 41=Done**.

### Atlassian MCP

`mcp-remote` OAuth tokens for `https://mcp.atlassian.com/v1/mcp` are cached at `~/.mcp-auth/mcp-remote-0.1.37/`. They were valid as of 2026-04-28; mcp-remote refreshes them automatically. If the MCP server fails to start, the user can run `npx -y mcp-remote https://mcp.atlassian.com/v1/mcp` to re-trigger the OAuth dance.

### M2 milestone reference

Closure criteria are persisted as a comment on the VIM-47 epic (the description edit was harness-blocked at filing time):

> M2 is declared shipped when:
> 1. VIM-49 + VIM-48 + VIM-50 are Done.
> 2. `origin/main` has all Sprint 7 work pushed.
> 3. `bun run dogfood:m2` runs end-to-end on a clean machine without operator help.
> 4. `bun run verify:m2` is deterministic — failures are product, not harness.
> 5. `docs/runbooks/m2-golden-path.md` is the only doc a new operator needs.

Criterion 4 is now met; criterion 2 is partly met after this session's push.

---

## Process

### 1. Pre-flight (≤2 min)

```
cd /c/Users/ak/TaskGoblin
pwd                                       # /c/Users/ak/TaskGoblin
git status -s                             # only .claude/worktrees/ expected
git log --oneline -8                      # top: dd4aa2f, 3df9552, d12cc48, e5f5eb5, 866b1bc, 177b1eb, ec94283, 5ac38a5
git rev-list --count origin/main..HEAD    # expect 2
```

If the count is 2, ask the user to run **`! git push origin main`** to ship `3df9552` and `dd4aa2f`. The harness blocks `git push origin main` even in auto mode; do not retry the blocked push in a loop.

After the push lands, re-confirm:

```
git rev-list --count origin/main..HEAD    # expect 0 now
git ls-remote origin main                 # SHA should match dd4aa2f
```

If anything else is off (dirty tree, divergent SHA, unexpected commits), pause and surface to the user. Don't transition VIM-48 to Done against a tree that doesn't match what was claimed in the closure comment.

### 2. Verify the work before flipping VIM-48 to Done

`verify:m2` was green end-to-end at SHA `177b1eb` (per its commit message): typecheck + `test:unit` 471/2-skip in 94s + `test:serial` 471/2-skip in 206s + `test:postgres` 1-pass. If you trust the prior run, you can skip ahead. If you want a fresh re-run before transitioning Jira:

```
export PATH="/c/Users/ak/.bun/bin:$PATH" && bun run verify:m2
```

(`verify:m2` requires Docker — same docker-compose service that VIM-48 introduced. Allot ~7-8 minutes.)

If anything is off, pause and surface before transitioning the Jira ticket.

### 3. VIM-48 — flip and comment

```
mcp__atlassian__getJiraIssue VIM-48 responseContentFormat=markdown   # confirm still To Do
mcp__atlassian__transitionJiraIssue VIM-48 transition={"id":"21"}    # To Do -> In Progress
mcp__atlassian__transitionJiraIssue VIM-48 transition={"id":"31"}    # In Progress -> In Review
mcp__atlassian__transitionJiraIssue VIM-48 transition={"id":"41"}    # In Review -> Done
```

Post a closure comment via `mcp__atlassian__addCommentToJiraIssue` on VIM-48 with this body verbatim (only edit the SHAs if they differ from `9ac2ccc` / `177b1eb` / `3df9552`):

> Merged on `main` as `9ac2ccc` (`fix(VIM-48): stratify test matrix and harden carry-over flakes for M2`), follow-up `177b1eb` (`fix(VIM-48): drop tight 20s overrides on parallel-pool API tests`), and follow-up `3df9552` (`fix(VIM-48): drop remaining 20s overrides on test-runner/agent/planner`). ACs met:
>
> - Test-runner parallel-pool flake: fixed at root cause. `packages/db/src/testing.ts` now memoizes one migrated SQLite template per worker; `createIsolatedPrisma` copies the template main file instead of re-running the 799-line migration set per beforeEach.
> - `packages/db` `beforeEach` 30s timeout: fixed by the same template-DB change — the two flakes shared this single root cause.
> - `apps/api/src/app.test.ts` per-test 20s overrides on four execution-API tests (branch lifecycle, execution start, patch reject, verification command failure): removed in `177b1eb`. They had been tighter than the 30s global and tripped under parallel-pool contention on Windows after the template-DB speedup; inheriting the global restored deterministic green.
> - `packages/test-runner/src/index.test.ts`, `packages/planner/src/service.test.ts`, `packages/agent/src/execution.test.ts` per-test/per-hook 20s overrides: removed in `3df9552` (same pattern as `177b1eb`). The heavy `"allows approved command-backed items..."` test in test-runner kept an explicit `, 60000` because under parallel-pool load it genuinely runs >30s end-to-end; that's consistent with the existing 60s overrides at `apps/api/src/executions.execute.test.ts:49` and `app.test.ts:859`.
> - `projectManagerPack.test.ts` mirror byte-equality assertion: deleted. The mirror is doc-only with no runtime consumer and no generator script; it had been a stable false-positive across Sprints 4-6. Reduced to file-existence.
> - `app.test.ts > "dispatches approved visual items..."`: confirmed subsumed by VIM-39 (5/5 isolated runs + 1/1 alongside its 22 sibling tests). Removed from the active carry-over list in `docs/STATUS-2026-04-28.md`.
> - Stratified scripts shipped at root: `test:unit`, `test:serial` (`vitest --no-file-parallelism`), `test:postgres`, `verify:m2` (typecheck + the three test scripts).
> - `docker-compose.yml` at repo root (postgres:16-alpine on `127.0.0.1:55432`).
> - `scripts/test-postgres.ts` orchestrator (compose up → schema push → vitest → compose down).
> - `packages/db/src/postgres.smoke.test.ts` checked in, gated by `describe.skipIf(!isPostgres)`.
> - Root `README.md` Quality Checks section names `verify:m2` authoritative.
> - `apps/api/README.md` documents the docker-compose Postgres as canonical local Postgres for tests.
>
> Verification: `bun run verify:m2` green at `177b1eb` (typecheck + `test:unit` 471/2-skip in 94s + `test:serial` 471/2-skip in 206s + `test:postgres` 1-pass). Three back-to-back full suites at the prior SHA `9ac2ccc` also landed 471 pass / 2 skip / 0 fail deterministically.
>
> M2 closure criterion 4 (`bun run verify:m2` deterministic — failures are product, not harness) is now met.

### 4. Re-check parents and unblocks

- VIM-47 (epic) stays **Open**; do not transition. It closes only after VIM-48 + VIM-49 + VIM-50 are all Done.
- VIM-49 was blocked by VIM-48. Confirm `mcp__atlassian__getJiraIssue VIM-49 responseContentFormat=markdown` shows the inward block is now resolved (i.e. VIM-48 is Done from VIM-49's perspective). Once confirmed, VIM-49 is the next card to work on.
- VIM-51 stays blocked by VIM-49; don't touch.
- VIM-50 (runbook cleanup) is parallel-safe but needs VIM-49's runbook artifact to write against; don't start it yet.

### 5. Continue VIM-49 — steps 3-8 + orchestrator + bundle

VIM-49 = **M2 golden-path dogfood harness, minimum viable** (8 pts). The scaffold (`e5f5eb5`) and implementation pass 1 (`dd4aa2f`) have already landed:

- `apps/cli/src/dogfood.ts` — command predicate, argument parsing, artifact-bundle directory creation, manifest writer, summary formatter, named scenario step chain (`runM2GoldenPath`), step 1 (clean DB sanity-check via `GET /health`), step 2 (`POST /projects` with deterministic body), and helper utilities (`requestJson`/`postJson`/`getJson`/`finalizeRun`). Steps 3-8 each have their own function and throw `"VIM-49 step N (...) is not yet implemented"` so the next session knows exactly where to resume.
- `apps/cli/src/dogfood.test.ts` — 6/6 pass. Tests cover predicate, formatter, dry-run path, DATABASE_URL requirement, and the steps 1-2 happy path with mocked fetch. Add new tests as you implement each step.
- `apps/cli/src/dogfood-fixtures/index.html` — deterministic minimal fixture page.
- `apps/cli/src/index.ts` — dispatcher.
- `package.json` — `"dogfood:m2": "bun --filter @vimbuspromax3000/cli start dogfood"` (no docker-compose orchestration yet — that's part of the work below).
- `docs/runbooks/m2-golden-path.md` — stub flagged "VIM-49 in progress."

Read VIM-49 directly from Jira via `mcp__atlassian__getJiraIssue VIM-49 responseContentFormat=markdown` and cross-check against `docs/SPRINT-7-PLAN.md` (the "VIM-47 — M2 golden-path dogfood harness" section — note that the plan body uses pre-create placeholder labels; "VIM-47 in plan body" maps to **VIM-49 in Jira**, per the mapping table at the top of the plan).

Resume work in this order:

1. **Steps 3-8 in `apps/cli/src/dogfood.ts`** — replace each `throw "not yet implemented for step N"` in turn. The surface map embedded in the file header lists the API route and payload shape per step. Pay attention to the open design call called out in the file header: **step 5 (execute task) triggers the LLM-driven agent loop and needs either a stub model in the registry or a direct test-run dispatch path that bypasses the agent loop.** Decide between those two before writing step 5 — the choice shapes the deterministic-seed contract.
2. **Orchestrator script** at `scripts/dogfood-m2.ts` (analogous to `scripts/test-postgres.ts`): docker-compose `postgres` up → `prisma db push --schema .generated/schema.postgres.prisma` → spawn API server in Postgres mode → wait for health → invoke `bun apps/cli/src/index.ts dogfood --api-url ... --database-url ...` → docker-compose down. Then update root `package.json` `"dogfood:m2"` to `"bun scripts/dogfood-m2.ts"`.
3. **Artifact-bundle population** — extend `dogfood.ts` to write planner-payload.json, agent-step-log.jsonl, mcp-tool-call-log.jsonl, screenshots/, axe-results.json, evidence.json, benchmark-run.json (layout already documented in the runbook stub).
4. **Idempotency proof** in `dogfood.test.ts`: run twice against a clean state, assert the bundle contents are identical modulo timestamps and run IDs.
5. **Fill in the runbook** — replace the "filled in when VIM-49 lands" sections with concrete step-by-step inspection guidance.

Acceptance criteria summary (read the canonical version from Jira; this is a sketch):

- A single command `bun run dogfood:m2` runs a deterministic golden-path scenario from a clean state.
- Scenario steps: clean DB → create project → seed planner output (deterministic JSON, no LLM call) → approve task + verification plan → execute one task branch → run one browser/a11y/visual verification item against a checked-in fixture page → confirm `TestRun.evidenceJson` is persisted → hydrate a benchmark run from the resulting `taskExecutionId` and confirm the verdict.
- Uses Postgres mode (consumes the docker-compose Postgres VIM-48 shipped).
- Leaves a durable artifact bundle under `.artifacts/m2/<run-id>/` (scenario manifest, planner payload, agent step log, MCP tool-call log, screenshot(s), axe results, evidenceJson, benchmark run record).
- `docs/runbooks/m2-golden-path.md` documents how to run it and what each artifact means.
- Idempotent: two runs against the same clean state produce identical artifacts modulo timestamps and run IDs.

Out of scope (deferred to VIM-51 / Sprint 8): LangSmith trace link assertion, live SSE event-sequence assertions, integration with the live planner's 5-round interview, more verification dimensions, cloud deploy.

Surface (sketch — confirm against the canonical AC):

- `apps/cli/src/dogfood.ts` (new command).
- `apps/cli/src/dogfood.test.ts`.
- Fixture pages under `apps/cli/src/dogfood-fixtures/`.
- `docs/runbooks/m2-golden-path.md`.
- Reuses existing API endpoints — flag if `apps/api/src/app.ts` needs a change.

#### Execution mode for VIM-49

Worktree-agent fan-out is permitted now that VIM-48 is on `main`. Recommended: spawn one agent for the dogfood scenario implementation and one for the runbook stub. Don't spawn VIM-50 / VIM-51 in parallel — VIM-50 needs concrete runbook content from VIM-49, VIM-51 is blocked.

#### Jira hygiene as you go on VIM-49

- `transitionJiraIssue` `{"id":"21"}` (To Do → In Progress) when you start coding.
- `addCommentToJiraIssue` with status comments at significant decision points (scenario shape, fixture page choice, artifact-bundle layout).
- `transitionJiraIssue` `{"id":"31"}` (In Progress → In Review) when the merge candidate is ready.
- After merge: closure comment with merge SHA + ACs met, then `transitionJiraIssue` `{"id":"41"}`.

---

## Out of scope this session

- **VIM-50 implementation** — runbook cleanup. Needs concrete artifact content from VIM-49 first. Can scaffold the doc structure if VIM-49 is well in hand by mid-session.
- **VIM-51 stretch** — only after VIM-48 + VIM-49 land.
- **VIM-42** — Sprint 8 backlog (Postgres production hardening). Don't pull in.
- **Anything in the Sprint 8 backlog** (browser install hardening, LangSmith dataset linkage, PDF page diff, cloud deploy rehearsal, programmatic Postgres via testcontainers).
- **New planner / UI / cloud features.**
- **Squashing or rewriting** the existing commit chain. Fix-forward in new commits.

---

## Auto mode + ultrathink

Auto mode preferred. Make reasonable judgment calls without asking.

**Ultrathink** on:

1. The dogfood scenario shape. The AC is a chain of seven steps (clean DB → project → seeded planner → approvals → execution → verification → benchmark). Designing this so each step's failure mode is locally diagnosable matters more than minimizing line count — when this thing breaks in someone else's hand the operator should be able to point at *which* step regressed.
2. The artifact-bundle layout. The bundle is what an operator hands back when they say "verify:m2 broke for me." It should be git-friendly (text-first), bounded in size (cap screenshots / axe outputs at sensible limits), and self-describing (a manifest file that names every other file). Don't over-engineer; do design the layout intentionally.

**ultrathink**
