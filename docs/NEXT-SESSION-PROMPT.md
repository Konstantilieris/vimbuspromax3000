# Next Session — Start Sprint 7 (M2 Release Candidate, kickoff)

_Drafted 2026-04-28 after Sprint 6 close-out. Supersedes the prior Sprint 6 verify-and-ship version of this file (preserved in git history at commits `0cee2c3` and `5317bda`)._

---

## TL;DR

Sprint 6 is verified, shipped, and closed in Jira. Sprint 7 = **M2 Release Candidate & Dogfood** (epic VIM-47). The slate is filed, the plan is locked, the test-matrix story (VIM-48) blocks everything else this sprint. Your job this session: push the 2 outstanding local commits, do pre-flight, then start VIM-48.

The Sprint 7 sequence is **VIM-48 first**, not parallel — the dogfood signal is meaningless without a deterministic test matrix. Don't fan out worktree agents on VIM-49 until VIM-48 is on `main`.

---

## State at session start

### Repo
- Path: `C:\Users\ak\TaskGoblin` (TaskGoblin / VimbusProMax3000, Bun 1.3.13 monorepo)
- Branch: `main`
- 2 commits ahead of `origin/main` (verify with `git rev-list --count origin/main..HEAD`):
  - `5317bda` — `fix(VIM-39): update test assertions and timeouts for Sprint 6` (mcp counts 3→5 / 7→12, app smoke timeout 30s→60s)
  - `b051ff6` — `docs(sprint-7): record actual Jira keys after filing` (key-mapping addendum on the plan)
- Working tree expected clean except `.claude/worktrees/` (operational state, leave alone)

### Jira state

**Sprint 6 — Done.** All four stories (VIM-46, VIM-39, VIM-40, VIM-41) carry the `sprint-6` label and have closure summary comments. Parent epics:
- **VIM-26** Operator Console & live ops — **Done** (epic-close comment posted)
- **VIM-27** Verification Breadth — **Done** (epic-close comment posted)
- **VIM-28** Observability & production hardening — **still Open**, only child remaining is VIM-42 (rescoped, see below)

**Sprint 7 — filed, all in To Do**:
- **VIM-47** (Epic) — M2 Release Candidate & Dogfood
- **VIM-48** (Story, 5 pts) — Test matrix and flake hardening
- **VIM-49** (Story, 8 pts) — M2 golden-path dogfood harness (minimum viable)
- **VIM-50** (Story, 2 pts) — Roadmap and runbook cleanup for M2
- **VIM-51** (Story, 5 pts, stretch) — M2 golden-path full instrumentation

Blocks links: VIM-48 → VIM-49, VIM-49 → VIM-51.

**Sprint 8 backlog:**
- **VIM-42** — Postgres production hardening (rescoped 8→5 pts; `sprint-8-backlog` label; comment with rescope rationale)

### M2 milestone

The closure criteria are persisted as a comment on VIM-47 (the epic description edit was harness-blocked at filing time — the comment is the source of truth until the description gets updated manually). Criteria:

> M2 is declared shipped when:
> 1. VIM-49 + VIM-48 + VIM-50 are Done.
> 2. `origin/main` has all Sprint 7 work pushed.
> 3. `bun run dogfood:m2` runs end-to-end on a clean machine without operator help.
> 4. `bun run verify:m2` is deterministic — failures are product, not harness.
> 5. `docs/runbooks/m2-golden-path.md` is the only doc a new operator needs.

### Plan source of truth

`docs/SPRINT-7-PLAN.md` is authoritative. The doc body uses pre-create placeholder keys (VIM-47 = dogfood, VIM-49 = runbook); the actual Jira keys shifted by one because Jira auto-assigned VIM-47 to the epic. The mapping table at the top of the plan resolves placeholders to real keys.

### Key Jira-key mapping reminder

| Plan label | Actual Jira key | Role |
|---|---|---|
| (new epic) | **VIM-47** | M2 Release Candidate & Dogfood (Epic) |
| VIM-48 | **VIM-48** | Test matrix and flake hardening |
| VIM-47 | **VIM-49** | M2 golden-path dogfood harness (minimum viable) |
| VIM-49 | **VIM-50** | Roadmap and runbook cleanup for M2 |
| VIM-50 | **VIM-51** | M2 golden-path full instrumentation (stretch) |

### Pre-existing carry-over flakes (these are VIM-48's primary targets, not "allow" anymore)

| Flake | Where | Sprint 7 directive |
|---|---|---|
| `projectManagerPack.test.ts:158` snapshot drift | `packages/planner` | **Fix** in VIM-48. Source markdown drifted; mirror is stale. Either regenerate the mirror or delete the test if the assertion is no longer meaningful. |
| `test-runner/src/index.test.ts` timing under parallel pool | `packages/test-runner` | **Fix or quarantine** in VIM-48. Passes 12/12 in isolation (88s); fails under parallel pool. Hypothesis: shared fs/db state across the parallel workers. Investigate before papering over with `singleFork`. |
| `app.test.ts > "dispatches approved visual items..."` | `apps/api` | **Likely already subsumed** by VIM-39's dispatch change (passed in the Sprint 6 verification re-run). Confirm in VIM-48; if subsumed, remove from the carry-over list. |
| Occasional `db` repo `beforeEach` hook timeout | `packages/db` | **Investigate, don't paper over.** Already at 30s; if it's still hitting that, there's a real issue. |

### Known infrastructure friction

- **Bun PATH on Windows bash** — bun lives at `/c/Users/ak/.bun/bin/bun.exe`, not on PATH. Every bun command needs `export PATH="/c/Users/ak/.bun/bin:$PATH" && bun ...`.
- **Bash CWD discipline** — always verify `pwd` and `cd /c/Users/ak/TaskGoblin` before main-repo operations (the persistent shell can drift when worktree agents run).
- **`.mcp.json` is now project-level** — atlassian (OAuth via mcp-remote) and slack (via `scripts/launch-slack-mcp.ps1`, sourcing creds from `.env.local`). First session start may prompt to approve project MCP servers.

---

## Process

### 1. Pre-flight (≤2 min)

```
cd /c/Users/ak/TaskGoblin
pwd                                       # confirm /c/Users/ak/TaskGoblin
git status -s                             # only .claude/worktrees/ expected
git log --oneline -8
git rev-list --count origin/main..HEAD    # expect 2
```

Ask the user to run **`! git push origin main`** to ship the 2 outstanding commits. The harness blocks `git push origin main` even in auto mode unless permitted. Do not retry the blocked push in a loop.

```
export PATH="/c/Users/ak/.bun/bin:$PATH" && bun install && bun run db:generate
bun run typecheck                         # should exit 0
```

### 2. Read VIM-48 from Jira

Use `mcp__atlassian__getJiraIssue` for VIM-48 with `responseContentFormat: "markdown"`. The description has `## Why`, `## Acceptance criteria`, `## Out of scope`, `## Surface` sections from `docs/SPRINT-7-PLAN.md`. Read alongside the plan doc to make sure they agree.

If you need to clarify, ask the user — don't invent acceptance criteria.

### 3. Choose execution mode for VIM-48

**Recommended: single-tree.** VIM-48 is small (5 pts), foundational, and you'll want fast iteration on the flake hunt. The worktree-agent fan-out adds branching overhead that doesn't pay off until VIM-49 (8 pts, larger surface).

If you do fan out: spawn one agent for VIM-48 only. Don't spawn VIM-49 / VIM-50 yet — VIM-49 needs VIM-48 merged, and VIM-50 needs concrete runbook content from VIM-49.

### 4. VIM-48 work plan (sketch — confirm against the Jira description)

Roughly in priority order:

1. **Diagnose the test-runner parallel-pool flake.** Start with: does it fail when you set `vitest --pool=forks --poolOptions.forks.singleFork=true`? If yes, the root cause is *not* parallelism — keep digging. If no, the cause is shared state across parallel workers; identify what's shared (filesystem, prisma client, ports?) before papering over.
2. **Diagnose the projectManagerPack snapshot drift.** Read `.claude/agents/pm-sprint-planner.md` (source) and `plugins/taskgoblin-project-manager/.../pm-sprint-planner.md` (mirror). Decide: regenerate mirror, or delete the assertion if the test's contract is no longer load-bearing.
3. **Stratify scripts.** Add at repo root:
   - `test:unit` — fast non-stateful matrix, parallel pool
   - `test:serial` — stateful tests requiring isolation, single fork
   - `test:postgres` — Postgres-backed paths via docker-compose
   - `verify:m2` — composite that runs all three in the right order
4. **Ship `docker-compose.yml`** at repo root for Postgres smoke (used by both VIM-48 and downstream by VIM-49).
5. **Document** in root `README.md` and `apps/api/README.md` which command is authoritative for "is the tree green."
6. **Confirm** the `dispatches approved visual items` flake is gone after VIM-39's change. If it is, remove from the carry-over list at the top of `docs/SPRINT-7-PLAN.md`.

### 5. Sprint 7 sequencing (don't break it)

```
VIM-48 (test matrix)         <-- you are here, day 1-3
   |
   v
VIM-48 merges to main        <-- day 4
   |
   +--> VIM-49 (dogfood, 8pt) <-- day 5-8
   |       |
   |       v
   |    VIM-49 merges          <-- day 9
   |       |
   |       v
   +--> VIM-50 (runbook, 2pt)  <-- day 10
           |
           v
        VIM-50 merges          <-- end of committed slate
           |
           v
        VIM-51 stretch?         <-- only if capacity remains
```

VIM-50 (runbook cleanup) is parallel-safe and could start as soon as VIM-49 has runbook content to document — typically late day 5 / day 6.

### 6. Jira hygiene as you go

For VIM-48:
- `mcp__atlassian__transitionJiraIssue` with `{"id": "21"}` (To Do → In Progress) when you start coding.
- `mcp__atlassian__addCommentToJiraIssue` with a status comment on each significant decision (flake root cause, script stratification approach).
- `mcp__atlassian__transitionJiraIssue` with `{"id": "31"}` (In Progress → In Review) when the PR / merge candidate is ready.
- `mcp__atlassian__addCommentToJiraIssue` with merge SHA + ACs met + tests added when merging.
- `mcp__atlassian__transitionJiraIssue` with `{"id": "41"}` (Done) after merge.

Cached transition IDs (verified in Sprint 6 close-out): 11=To Do, 21=In Progress, 31=In Review, 41=Done.

### 7. End-of-session summary expectations

When you stop, surface:
- VIM-48 status: Done / In Review / In Progress.
- Flake diagnosis findings (root cause for each, fix path chosen).
- Test scripts shipped (which of `test:unit` / `test:serial` / `test:postgres` / `verify:m2` exist).
- `docker-compose.yml` status.
- Next-session handoff: which sub-task to resume, or pivot to VIM-49 if VIM-48 is on `main`.

---

## Out of scope this session

- **VIM-49 implementation** — scaffolding only if you have time and VIM-48 is in review. No real dogfood until VIM-48 merges.
- **VIM-50 (runbook cleanup)** — needs concrete runbook content from VIM-49 first.
- **VIM-51 stretch** — only after VIM-48 + VIM-49 land.
- **VIM-42** — Sprint 8 backlog. Don't pull in.
- **Anything in Sprint 8 backlog** (browser install hardening, LangSmith dataset linkage, PDF page diff, cloud deploy rehearsal, programmatic Postgres via testcontainers).
- **Any new planner / UI / cloud features.**
- **Squashing or rewriting** the Sprint 5 / 6 / 7-prep commit chain. Fix-forward in new commits.

---

## Auto mode + ultrathink

Auto mode preferred. Make reasonable judgement calls without asking.

**Ultrathink** on:
1. The test-runner parallel-pool flake root cause. Don't accept the easy answer ("just use singleFork"); identify the shared resource. The decision shapes how every future test in the project gets written.
2. Whether VIM-48 should land docker-compose now or whether testcontainers (Sprint 8 backlog item) is a faster path. The plan picks docker-compose, but if you find evidence that testcontainers is meaningfully better for *this* repo, surface that as a Sprint 8 prioritization point.

**ultrathink**
