# Sprint 6 — Session Prompt

_Drafted 2026-04-28, immediately after Sprint 5 close-out. Paste this into a fresh Claude Code session to start Sprint 6._

---

## Context (read before starting)

You are running Sprint 6 of the Vimbus 1.0 roadmap. Repo: `C:\Users\ak\TaskGoblin` (TaskGoblin / VimbusProMax3000, Bun 1.3.13 monorepo). Jira project `VIM` on `apollonadmin.atlassian.net`, cloud `a9dc8917-e4cb-48be-bf4f-84b1f381906e`. Optional reading first: `docs/STATUS-2026-04-28.md` for the post-Sprint-5 picture.

### State at session start

Local `main` may or may not be pushed to `origin/main`. After Sprint 5 close-out (2026-04-28), local main was 13 commits ahead of `origin/main` and the user had not yet authorized the push. The first thing you do is check `git rev-list --count origin/main..HEAD` and act accordingly.

**Sprint 5 Done items** (already on local main):
- VIM-34 5-round interactive interview agent (merge `057a3df`)
- VIM-38 Dependency-map endpoint + CLI view (merge `056b457`)
- VIM-43 DB-MCP read-only wrapper (merge `2a77151`)
- VIM-45 Postgres `LISTEN`/`NOTIFY` adapter (merge `501fa73`)

**Sprint 5 housekeeping (already done in Jira):**
- VIM-29, VIM-32 → Done; epic VIM-24 ("Make execution actually execute" / M1) → Done
- VIM-25 epic ("Planner quality") → Done
- VIM-6 → Done (orphan; duplicate of VIM-40)
- VIM-7 → Done (orphan; duplicate of VIM-41)
- New ticket VIM-46 created for the Sprint 5 follow-up (Postgres adapter API wiring)

**Sprint 5 housekeeping note:**
- VIM-6 transitioned to Done, but the duplicate-of-VIM-40 closing comment was permission-denied by the harness. This is non-blocking.
- VIM-7's closing comment landed and the ticket is now Done.

### Worktree branches preserved (do NOT delete)

Sprint 1-5 worktree branches still exist locally for archival inspection:
- Sprint 4: `worktree-agent-a9fab153` (VIM-37), `worktree-agent-a2e53238` (VIM-31), `feat/VIM-44-evaluator-auto-flip-modeldecision` (VIM-44)
- Sprint 5: `worktree-agent-ad9e7b06` (VIM-45), `worktree-agent-a7ead433` (VIM-34), `worktree-agent-af7aba52` (VIM-38), `worktree-agent-a9ba006e` (VIM-43)

### Pre-existing flakes (carry-overs — DO NOT try to fix in story scope)

| Flake | Where |
|---|---|
| `packages/planner/src/projectManagerPack.test.ts:158` agent-mirror text drift | snapshot drift, stable failure |
| `packages/test-runner/src/index.test.ts` timing | non-deterministic under parallel pool |
| `apps/api/src/app.test.ts > "dispatches approved visual items..."` | pre-existing on main |
| Occasional `db` repo `beforeEach` hook timeout | already at 30s; rare |

If you have spare bandwidth at the very end, a small dedicated chore could investigate the test-runner flake — start with `vitest --pool=forks --poolOptions.forks.singleFork=true`. Don't bundle it into a story.

### Bun PATH on Windows bash

Bun is at `/c/Users/ak/.bun/bin/bun.exe` but **not on bash's PATH**. Every bun command needs:
```
export PATH="/c/Users/ak/.bun/bin:$PATH" && bun ...
```
Pass this constraint to every worktree agent you spawn — the Sprint 5 agents got it wrong on first attempt and lost a round-trip until they picked it up.

### Bash CWD discipline

The persistent bash CWD can drift into `.claude/worktrees/agent-XXXX/` when worktree agents run. Always verify `pwd` and `cd /c/Users/ak/TaskGoblin` before doing main-repo operations.

---

## Sprint 6 dates

2026-07-06 → 2026-07-19 (assuming the 2-week cadence). Adjust to actual calendar if running later.

## Sprint 6 — recommended slate

**Theme**: Finish the Postgres rollout, then close the verification gap.

| Order | Key | Pts | Story | Parent | Why now |
|---|---|---|---|---|---|
| 1 | **VIM-46** | 2 | Wire VIM-45 Postgres LoopEventBus adapter into API startup | VIM-26 | Smallest blast radius. Makes VIM-45's adapter real in production. |
| 2 | **VIM-39** | 8 | Browser-MCP wrapper + a11y/visual verification runtime | VIM-27 | Largest remaining MVP gap (`mvp-gap`). Execution loop has nothing browser-shaped to verify against today. |
| 3 | **VIM-40** | 5 | Benchmark hydration from execution telemetry | VIM-28 | Observability we need _before_ claiming planner-quality moved any needle. |
| Stretch | **VIM-41** | 5 | Real LangSmith trace export from agent steps | VIM-28 | If VIM-39 lands faster than expected. |

Total committed: **15 pts**. Stretch: **+5 pts**.

### Why **not** VIM-42 yet

VIM-42 ("Postgres adapter and production hardening", 8 pts, in VIM-28) was scoped before VIM-45 + VIM-46 existed. Re-scope it to "everything VIM-46 doesn't cover" (probably 3-5 pts), or fold VIM-46 into VIM-42 and drop VIM-46. Don't pull either into Sprint 6 without doing that scoping pass first — otherwise expect overlapping API-startup edits.

---

## Process

### 1. Pre-flight
```
cd /c/Users/ak/TaskGoblin
pwd                                       # confirm /c/Users/ak/TaskGoblin
git status -s
git log --oneline -5
git rev-list --count origin/main..HEAD    # is Sprint 5 still local?
export PATH="/c/Users/ak/.bun/bin:$PATH" && bun install && bun run db:generate && bun run typecheck
```

If `origin/main..HEAD` count > 0, **ask the user to authorize `! git push origin main`** before starting Sprint 6. The harness will block the push otherwise. If they have a permission rule by now, just push.

### 2. Surface overlap risk for Sprint 6

| Story | Surface | Overlap concern |
|---|---|---|
| VIM-46 | `apps/api/src/app.ts` (startup wiring), `apps/api/package.json` (add `pg`+`@types/pg`) | None within Sprint 6 if VIM-46 merges first. |
| VIM-39 | New `packages/mcp-client/src/wrappers/browser.ts`, possibly new `apps/api/src/` endpoint, `packages/verification/` runtime | Shares `apps/api/src/app.ts` with VIM-46 — merge VIM-46 first; VIM-39 rebases on top. Same Sprint 5 pattern. |
| VIM-40 | `packages/observability/`, `packages/db/src/repositories/` (BenchmarkScenario, RegressionBaseline writes) | Disjoint from VIM-39 / VIM-46. |
| VIM-41 (stretch) | `packages/observability/`, `packages/db/src/repositories/` (LangSmithTraceLink writes) | Shares `packages/observability/` with VIM-40 — VIM-40 first; VIM-41 rebases on top. |

### 3. Read VIM-39 and VIM-40 descriptions in pre-flight

Use `mcp__atlassian__getJiraIssue` for VIM-39 and VIM-40 (and VIM-41 if you intend to include it). The description style is `## Motivation / ## Affected paths / ## Acceptance criteria / ## How we'll verify / ## Dependency caveats`. If a description is thin, propose a minimal interpretation in your reply and ask the user to confirm before spawning the agent.

### 4. Load Sprint 6 in Jira
For each story you'll work:
- `mcp__atlassian__editJiraIssue` to add `sprint-6` label (preserve existing labels).
- `mcp__atlassian__transitionJiraIssue` with `{"id": "21"}` (To Do → In Progress).
- `mcp__atlassian__addCommentToJiraIssue` with `Loaded into Sprint 6 — 2026-07-06 to 2026-07-19.`

Cached transition IDs: To Do→In Progress = **21**, In Progress→Done = **41**, In Review = **31**.

### 5. Spawn parallel worktree agents
Use the `Agent` tool with `subagent_type: "general-purpose"`, `isolation: "worktree"`, `run_in_background: true`. Each prompt **must include**:

- The Bun PATH note (`export PATH="/c/Users/ak/.bun/bin:$PATH" && bun ...`).
- "DO NOT cd out of your worktree, DO NOT create a new feature branch — commit on the harness-assigned `worktree-agent-XXXX` branch."
- A strict no-touch list naming the surfaces of every sibling agent.
- Pre-existing flakes list (DO NOT try to fix).
- Commit prefix convention `feat(VIM-XX):`, `test(VIM-XX):`, `refactor(VIM-XX):` with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
- "DO NOT push. DO NOT open a PR. DO NOT delete worktree branches."
- Final report shape: branch name, commit SHAs + subjects, files touched (added vs modified), test counts, `bun run typecheck` status, ACs covered vs deferred, merge-time concerns.

### 6. Merge cascade (foreground, after agents finish)
Recommended order:
1. **VIM-46** (smallest, foundational for VIM-39's `apps/api/src/app.ts` rebase).
2. **VIM-39** (largest, rebases on VIM-46's startup wiring).
3. **VIM-40** (disjoint).
4. **VIM-41 stretch** (rebases on VIM-40 if both included).

Use `git merge --no-ff worktree-agent-XXXX -m "chore(VIM-XX): merge sprint-6 branch worktree-agent-XXXX (<short summary>)"`.

After each merge:
- `bun run test:vitest -- <touched packages>` should pass (allow the listed pre-existing flakes).
- `bun run typecheck` should exit 0.

Sprint 4 / 5 lesson: one Sprint 4 agent committed to `feat/VIM-44-...` instead of the harness-assigned worktree branch. Before merging, run:
```
git log --oneline --all | grep -iE 'VIM-(39|40|41|46)' | head -20
```
to find where each agent's commits actually landed. Cross-check with the agent's reported branch name.

### 7. Push
The harness blocks `git push origin main` even with auto mode unless the user grants permission. Ask the user to run `! git push origin main`, add a permission rule, or you push to a feature branch + open a PR. **Do NOT keep retrying the blocked push.**

### 8. Close-out per ticket
- `mcp__atlassian__addCommentToJiraIssue` with branch + merge SHA + ACs met + tests added + deferred follow-ups.
- `mcp__atlassian__transitionJiraIssue` with `{"id": "41"}`.

After all Sprint 6 stories close, check parent epics:
- VIM-26 (Operator console & live ops) — closes only when VIM-46 is the last open child.
- VIM-27 (Verification breadth) — closes only when VIM-39 is the last open child.
- VIM-28 (Observability & production hardening) — closes only after VIM-40, VIM-41, and VIM-42 are all Done.

Note: epic transitions may be permission-blocked by the harness — surface that to the user for a manual flip rather than retrying.

### 9. Final summary to user
- Per-story result table (Story | Pts | Branch | Merge SHA | Tests added | Outcome).
- Pending push count + commit list.
- Recommendation for Sprint 7 — likely VIM-41 (if not landed in Sprint 6), the rescoped VIM-42, the test-runner flake chore, and any new follow-ups discovered during Sprint 6.

---

## Auto mode + ultrathink

Auto mode preferred. Spawn multiple agents in parallel. Ultrathink reasoning on the design choices for VIM-39 in particular — the browser-MCP surface is novel for this repo, so the agent's design choice on a11y harness (axe-core vs Pa11y vs custom Lighthouse runner) and visual-diff strategy (pixel diff vs perceptual hashing vs bounding-box) materially shapes downstream verification work.

**ultrathink**
