# Next Session — Push VIM-48, finish Jira hygiene, then start VIM-49

_Drafted 2026-04-28 after VIM-48 was implemented and committed locally (SHA `9ac2ccc`). Supersedes the prior Sprint 7 kickoff version of this file (preserved in git history at commit `eb8e371`)._

---

## TL;DR

VIM-48 (test matrix + flake hardening) is **implementation-done and verified**. The work is committed locally as `9ac2ccc` but **not yet pushed**, and the Jira ticket is still in **To Do** because the Atlassian MCP tools weren't loaded in the prior session. Your job this session, in order:

1. Push `9ac2ccc` to `origin/main`.
2. Run VIM-48 through To Do → In Progress → In Review → Done in Jira, post the closure comment, and confirm VIM-49 is now unblocked (VIM-48 was its only blocker).
3. Start VIM-49 (M2 golden-path dogfood harness, 8 pts).

The Atlassian MCP server is configured in project `.mcp.json` via `mcp-remote`. If it isn't loaded automatically at session start, approve / re-authenticate it before doing the Jira work.

---

## State at session start

### Repo

- Path: `C:\Users\ak\TaskGoblin` (TaskGoblin / VimbusProMax3000, Bun 1.3.13 monorepo).
- Branch: `main`.
- Expected: **1 commit ahead** of `origin/main` — verify with `git rev-list --count origin/main..HEAD`.
- The unpushed commit is `9ac2ccc fix(VIM-48): stratify test matrix and harden carry-over flakes for M2`. Description should match the body that was committed; if it doesn't, something has changed, surface that to the user.
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
git log --oneline -5
git rev-list --count origin/main..HEAD    # expect 1
```

If the count is 1, ask the user to run **`! git push origin main`** to ship `9ac2ccc`. The harness blocks `git push origin main` even in auto mode; do not retry the blocked push in a loop.

After the push lands, re-confirm:

```
git rev-list --count origin/main..HEAD    # expect 0 now
git ls-remote origin main                 # SHA should match `9ac2ccc`
```

If the user has already pushed before opening this session, the count is 0 from the start; skip ahead.

### 2. Verify the work before flipping VIM-48 to Done

Before posting "ACs met," prove they're actually met on the current `main`:

```
export PATH="/c/Users/ak/.bun/bin:$PATH" && bun run typecheck
export PATH="/c/Users/ak/.bun/bin:$PATH" && bun run test:unit
export PATH="/c/Users/ak/.bun/bin:$PATH" && bun run test:postgres
```

(`test:postgres` requires Docker — same docker-compose service that VIM-48 introduced.)

If `verify:m2` was already green at commit time and you trust the prior run, you can skip the chain and rely on the prior result. If anything is off, surface it before transitioning the Jira ticket.

### 3. VIM-48 — flip and comment

```
mcp__atlassian__getJiraIssue VIM-48 responseContentFormat=markdown   # confirm still To Do
mcp__atlassian__transitionJiraIssue VIM-48 transition={"id":"21"}    # To Do -> In Progress
mcp__atlassian__transitionJiraIssue VIM-48 transition={"id":"31"}    # In Progress -> In Review
mcp__atlassian__transitionJiraIssue VIM-48 transition={"id":"41"}    # In Review -> Done
```

Post a closure comment via `mcp__atlassian__addCommentToJiraIssue` on VIM-48 with this body verbatim (only edit the SHA if the merge SHA is different from `9ac2ccc`):

> Merged on `main` as `9ac2ccc` (`fix(VIM-48): stratify test matrix and harden carry-over flakes for M2`). ACs met:
>
> - Test-runner parallel-pool flake: fixed at root cause. `packages/db/src/testing.ts` now memoizes one migrated SQLite template per worker; `createIsolatedPrisma` copies the template main file instead of re-running the 799-line migration set per beforeEach.
> - `packages/db` `beforeEach` 30s timeout: fixed by the same template-DB change — the two flakes shared this single root cause.
> - `projectManagerPack.test.ts` mirror byte-equality assertion: deleted. The mirror is doc-only with no runtime consumer and no generator script; it had been a stable false-positive across Sprints 4-6. Reduced to file-existence.
> - `app.test.ts > "dispatches approved visual items..."`: confirmed subsumed by VIM-39 (5/5 isolated runs + 1/1 alongside its 22 sibling tests). Removed from the active carry-over list in `docs/STATUS-2026-04-28.md`.
> - Stratified scripts shipped at root: `test:unit`, `test:serial` (`vitest --no-file-parallelism`), `test:postgres`, `verify:m2` (typecheck + the three test scripts).
> - `docker-compose.yml` at repo root (postgres:16-alpine on `127.0.0.1:55432`).
> - `scripts/test-postgres.ts` orchestrator (compose up → schema push → vitest → compose down).
> - `packages/db/src/postgres.smoke.test.ts` checked in, gated by `describe.skipIf(!isPostgres)`.
> - Root `README.md` Quality Checks section names `verify:m2` authoritative.
> - `apps/api/README.md` documents the docker-compose Postgres as canonical local Postgres for tests.
>
> Verification: `bun run verify:m2` green in 7m6s; three back-to-back full suites land 471 pass / 2 skip / 0 fail deterministically.
>
> M2 closure criterion 4 (`bun run verify:m2` deterministic — failures are product, not harness) is now met.

### 4. Re-check parents and unblocks

- VIM-47 (epic) stays **Open**; do not transition. It closes only after VIM-48 + VIM-49 + VIM-50 are all Done.
- VIM-49 was blocked by VIM-48. Confirm `mcp__atlassian__getJiraIssue VIM-49 responseContentFormat=markdown` shows the inward block is now resolved (i.e. VIM-48 is Done from VIM-49's perspective). Once confirmed, VIM-49 is the next card to work on.
- VIM-51 stays blocked by VIM-49; don't touch.
- VIM-50 (runbook cleanup) is parallel-safe but needs VIM-49's runbook artifact to write against; don't start it yet.

### 5. Start VIM-49

VIM-49 = **M2 golden-path dogfood harness, minimum viable** (8 pts). Read it directly from Jira via `mcp__atlassian__getJiraIssue VIM-49 responseContentFormat=markdown` and cross-check against `docs/SPRINT-7-PLAN.md` (the "VIM-47 — M2 golden-path dogfood harness" section — note that the plan body uses pre-create placeholder labels; "VIM-47 in plan body" maps to **VIM-49 in Jira**, per the mapping table at the top of the plan).

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
