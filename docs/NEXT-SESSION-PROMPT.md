# Next Session — VIM-48 Jira hygiene, then VIM-49 end-to-end validation + bundle

_Drafted 2026-04-28; revised across multiple 2026-04-29 sessions. Latest revision after VIM-49 step-by-step implementation completed locally (all eight scenario steps wired + headless API route + docker-compose orchestrator). Supersedes the prior Sprint 7 kickoff version of this file (preserved in git history at commit `eb8e371`)._

---

## TL;DR

**VIM-48** (test matrix + flake hardening) — implementation-done, `verify:m2` deterministic at the merged tip. Two follow-up commits both on `origin/main` (`177b1eb`, `3df9552`). Jira ticket still in **To Do** because the Atlassian MCP tools weren't loaded in the prior sessions.

**VIM-49** (M2 golden-path dogfood harness, minimum viable) — all eight scenario steps implemented end-to-end against the API surface, the new `POST /tasks/:id/execute/headless` route is in (dogfood-only, bypasses the LLM-driven agent loop), and `scripts/dogfood-m2.ts` orchestrates docker-compose + schema reset + temp git repo + API spawn + CLI invoke + teardown. **The orchestrator has not yet been validated against a live environment.** The dogfood unit tests cover the HTTP request shape with mocked fetch (8/8 pass).

Three commits are ahead of `origin/main` and need pushing. Your job this session, in order:

1. Push the three local commits to `origin/main`.
2. Run VIM-48 through To Do → In Progress → In Review → Done in Jira and post the closure comment.
3. Validate the dogfood end-to-end: run `bun run dogfood:m2` against a clean Docker state and debug whatever surfaces (this is the first time the orchestrator runs against real infrastructure). Iterate until green.
4. Land what's left for VIM-49 minimum-viable closure (see "Remaining work" below).

The Atlassian MCP server is configured in project `.mcp.json` via `mcp-remote`. The user is promoting the project-level MCP so the server loads at session start — confirm `mcp__atlassian__*` tools are available via `ToolSearch` before starting Jira work, and if they aren't, run `npx -y mcp-remote https://mcp.atlassian.com/v1/mcp` to re-trigger the OAuth dance against the cached client at `~/.mcp-auth/`.

---

## State at session start

### Repo

- Path: `C:\Users\ak\TaskGoblin` (TaskGoblin / VimbusProMax3000, Bun 1.3.13 monorepo).
- Branch: `main`.
- Expected: **3 commits ahead** of `origin/main` — verify with `git rev-list --count origin/main..HEAD`.
- The unpushed commits, top first:
  - `c68effb feat(VIM-49): add dogfood-m2 orchestrator (single-command from clean state)` — `scripts/dogfood-m2.ts` brings docker-compose Postgres up, generates Prisma clients, force-resets the schema, prepares a deterministic temp git repo at `/tmp/vimbus-m2-dogfood/<runId>`, spawns the API in Postgres mode, polls `/health`, invokes the CLI, then kills the API and brings docker-compose down in `finally`. `package.json` `dogfood:m2` rewired from the CLI passthrough to this script. Not yet validated against a live environment — that's the first job this session.
  - `75aebdd feat(VIM-49): implement scenario steps 6-8 - all 8 steps now wired` — step 6 fires verification dispatch via `POST /executions/:id/test-runs`, step 7 decodes `TestRun.evidenceJson` from step 6's response, step 8 creates a benchmark scenario then hydrates a benchmark run from the executionId. `runM2GoldenPath` is now a complete chain returning a passed/failed verdict. 8/8 dogfood unit tests pass with mocked fetch.
  - `a5247a5 feat(VIM-49): add /tasks/:id/execute/headless route + implement step 5` — new dogfood-only API route in `apps/api/src/app.ts` that prepares the task branch and creates a `TaskExecution` row without invoking the LLM-driven agent loop or resolving a model slot. Production execution still flows through the sibling `POST /tasks/:id/execute`. CLI step 5 calls the new route. Integration test for the route deferred to the next-session pass when the live run validates the full path.
- Already on `origin/main`, top first: `128fceb` (steps 3-4 + step-5 design call), `0acda2f` (this prompt's prior revision), `dd4aa2f` (steps 1-2 + helper utilities), `3df9552` (VIM-48 follow-up #2), `d12cc48` (prompt revision earlier), `e5f5eb5` (VIM-49 scaffold), `866b1bc` (doc rollover post-177b1eb), `177b1eb` (VIM-48 follow-up #1), `9ac2ccc` (VIM-48 main implementation).
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
git log --oneline -10                     # top: c68effb, 75aebdd, a5247a5, 128fceb, 0acda2f, dd4aa2f, 3df9552, d12cc48, e5f5eb5, 866b1bc
git rev-list --count origin/main..HEAD    # expect 3
```

If the count is 3, ask the user to run **`! git push origin main`** to ship `a5247a5`, `75aebdd`, and `c68effb`. The harness blocks `git push origin main` even in auto mode; do not retry the blocked push in a loop.

After the push lands, re-confirm:

```
git rev-list --count origin/main..HEAD    # expect 0 now
git ls-remote origin main                 # SHA should match c68effb
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

### 5. VIM-49 — end-to-end validation and remaining work

VIM-49 = **M2 golden-path dogfood harness, minimum viable** (8 pts). All eight scenario steps + the new `POST /tasks/:id/execute/headless` API route + the `scripts/dogfood-m2.ts` orchestrator are committed (locally as of session start; on `origin/main` after step 1 above). The dogfood unit tests cover the HTTP request shape with mocked fetch (8/8 pass), but the orchestrator has **not** yet been run against a live environment.

Read VIM-49 directly from Jira via `mcp__atlassian__getJiraIssue VIM-49 responseContentFormat=markdown` and cross-check against `docs/SPRINT-7-PLAN.md` (the "VIM-47 — M2 golden-path dogfood harness" section — note that the plan body uses pre-create placeholder labels; "VIM-47 in plan body" maps to **VIM-49 in Jira**, per the mapping table at the top of the plan).

Resume work in this order:

1. **End-to-end validation of the orchestrator.** Run `bun run dogfood:m2` against a clean Docker state. Expect issues — this is the first time the orchestrator hits real infra. Likely surfaces:
   - The API spawn command (`bun --filter @vimbuspromax3000/api dev`) may not actually be `dev`; confirm against `apps/api/package.json` and adjust `scripts/dogfood-m2.ts` step e if needed.
   - `prisma db push --force-reset --accept-data-loss` syntax: confirm against the Prisma 7.8.0 docs; the current invocation should work but verify.
   - The temp git repo prep in step d may need adjustment if `prepareTaskBranch` (called from `/headless`) expects something specific in the working tree.
   - The test-runner's a11y dispatch (step 6) needs Chromium available to Playwright. If not installed, expect a clear error from the test-runner and either install Chromium or skip a11y dispatch in the dogfood path (whichever is cheaper).
   - The /headless route does git work (`prepareTaskBranch`); the temp repo's `main` branch must already exist.
2. **API integration test** for `POST /tasks/:id/execute/headless` in `apps/api/src/app.test.ts`. Pattern to follow: the existing tests use `seedExecutableTask` to set up an approved task on isolated prisma + initialized git repo, then call `api.fetch(new Request(...))`. Assert that the response is 201, the TaskExecution row exists, and no agent-loop side effects (no AgentStep row, no ModelDecision row).
3. **Artifact-bundle population.** Currently the bundle only contains `manifest.json`. Extend `apps/cli/src/dogfood.ts` (in `runM2GoldenPath`, after step 8 returns) to write:
   - `planner-payload.json` — the `buildDeterministicPlannerPayload` return value, captured before the POST in step 3.
   - `agent-step-log.jsonl` — one JSON object per line, fetched via a new GET endpoint or via `/events/history?taskExecutionId=…` filtered to `agent.step.*` types.
   - `mcp-tool-call-log.jsonl` — fetched via `GET /executions/:id/mcp/calls` (or whatever the canonical route is; verify against `apps/api/src/app.ts`).
   - `screenshots/` — copy from `.artifacts/executions/<executionId>/browser/...` (where the test-runner writes them per VIM-39).
   - `axe-results.json` — extract from the a11y `TestRun.evidenceJson` already decoded in step 7.
   - `evidence.json` — dump of all `TestRun.evidenceJson` payloads for the execution.
   - `benchmark-run.json` — the `{ run, evalRun }` object from step 8.
4. **Idempotency proof** in `apps/cli/src/dogfood.test.ts`: a fresh test that mocks fetch to return identical payloads twice (with `runId` differing across runs), runs the dogfood twice, asserts the bundle contents are byte-identical modulo `runId` and the timestamp fields in `manifest.json`.
5. **Fill in the runbook** at `docs/runbooks/m2-golden-path.md` — replace the "filled in when VIM-49 lands" sections with concrete step-by-step inspection guidance for each artifact in the bundle. Document the prerequisites (Docker, Bun, optional Chromium for a11y dispatch). Document the troubleshooting list discovered during step 1's end-to-end validation.

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
