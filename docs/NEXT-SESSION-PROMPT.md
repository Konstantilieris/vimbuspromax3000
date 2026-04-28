# Next Session — Verify and Ship Locally Drafted Sprint 6 Work

_Drafted 2026-04-28. Paste this into a fresh Claude Code session to continue Sprint 6._

---

## TL;DR

Sprint 6 was drafted in a single working tree (no worktree agents) and is now sitting locally as 8 commits on `main`, **8 commits ahead of `origin/main`**, **none verified by typecheck/tests**, **none reflected in Jira yet**. Your job this session is to validate, push, and close the loop in Jira — not to start new feature work.

The sequence below is "verify → file → ship → close out", not "spawn parallel agents and merge". The `docs/SPRINT-6-PROMPT.md` playbook (parallel worktree agents + merge cascade) is the *scenario that did not happen*; treat it as historical reference only.

---

## State at session start

### Repo
- Path: `C:\Users\ak\TaskGoblin` (TaskGoblin / VimbusProMax3000, Bun 1.3.13 monorepo).
- Branch: `main`, 8 commits ahead of `origin/main`.
- Working tree: only `.claude/worktrees/` should appear in `git status` (operational state, leave alone).

### Commits to verify and push (oldest → newest)

| SHA prefix | Subject | Jira ticket | Risk |
|---|---|---|---|
| `74e5762` | `chore(mcp): add project-level .mcp.json for atlassian + slack` | none | low — config only; first launch will prompt to approve project MCP |
| `88ecbbb` | `chore: add Sprint 6 deps and Postgres tooling scripts` | infra | medium — touches `bun.lock`, root + 3 package.json files; rerun `bun install` |
| `7a27ecb` | `feat(VIM-46): dual-client + Postgres LoopEventBus startup wiring` | **VIM-46** | medium — `apps/api` boots through `installDefaultLoopEventBus`; sqlite path must still work |
| `9550326` | `feat(VIM-39): browser MCP wrapper + a11y/visual verification dispatch` | **VIM-39** | high — adds Prisma migration `20260428150000_test_run_evidence_json`, new `taskgoblin-browser` MCP server, test-runner now dispatches a11y/visual instead of marking unsupported |
| `85c87db` | `feat(VIM-40): hydrate benchmark runs from execution telemetry` | **VIM-40** | medium — `POST /benchmarks/scenarios/:id/runs` and `GET /benchmarks/scenarios` change shape (hydration metadata, taskExecutionId support, 404/422 error paths) |
| `19b266b` | `feat(VIM-41): export LangSmith traces from execution agent` | **VIM-41** | medium — every execution completion now calls `exportExecutionLangSmithTrace`; ensure the env-disabled path still no-ops in tests |
| `b95ef26` | `docs: post-Sprint-5 status snapshot and Sprint 6 prompt` | none | none |
| `34972fe` | `chore(db): add push-postgres script and ignore generated postgres schema` | infra | none |

VIM-46 / VIM-39 / VIM-40 / VIM-41 are all still in **To Do** in Jira with no `sprint-6` label. They got committed without ever being transitioned.

### Pre-existing flakes (carry-overs — DO NOT try to fix in scope)

| Flake | Where |
|---|---|
| `packages/planner/src/projectManagerPack.test.ts:158` agent-mirror text drift | snapshot drift, stable failure |
| `packages/test-runner/src/index.test.ts` timing | non-deterministic under parallel pool |
| `apps/api/src/app.test.ts > "dispatches approved visual items..."` | pre-existing on main; **may or may not be subsumed by VIM-39's dispatch change** — verify behaviour, don't bundle |
| Occasional `db` repo `beforeEach` hook timeout | already at 30s; rare |

### Bun PATH on Windows bash

Bun is at `/c/Users/ak/.bun/bin/bun.exe` but **not on bash's PATH**. Every bun command needs:
```
export PATH="/c/Users/ak/.bun/bin:$PATH" && bun ...
```

### Bash CWD discipline

Always verify `pwd` and `cd /c/Users/ak/TaskGoblin` before running anything — the persistent shell can drift.

---

## Process

### 1. Pre-flight
```
cd /c/Users/ak/TaskGoblin
pwd                                       # confirm /c/Users/ak/TaskGoblin
git status -s                             # only .claude/worktrees/ expected
git log --oneline origin/main..HEAD       # confirm 8 commits ahead
git rev-list --count origin/main..HEAD    # expect 8
export PATH="/c/Users/ak/.bun/bin:$PATH" && bun install && bun run db:generate
```

If `db:generate` fails because of the new dual-client setup (sqlite + postgres), check `packages/db/scripts/generate-clients.ps1` — that's the new entry point for generating both clients.

### 2. Typecheck + targeted test passes (in this order)

```
export PATH="/c/Users/ak/.bun/bin:$PATH"

# Cheapest: typecheck the whole monorepo first.
bun run typecheck

# Then drill into the touched packages.
bun run test:vitest -- packages/observability
bun run test:vitest -- packages/agent
bun run test:vitest -- packages/benchmarks
bun run test:vitest -- packages/test-runner
bun run test:vitest -- packages/mcp-client
bun run test:vitest -- packages/verification
bun run test:vitest -- apps/api
bun run test:vitest -- apps/cli
```

Allow the four pre-existing flakes above. Anything else failing is on you to fix-forward (do **not** revert or squash existing commits — the history is already split by ticket).

If a fix is needed, commit it as a separate `fix(VIM-XX): ...` commit on top of the existing chain so the per-ticket attribution stays clean.

### 3. Smoke the new behaviour you can reach without spawning a browser

- **VIM-46**: confirm sqlite path still works by running the api test suite. The Postgres path is exercised by `apps/api/README.md`'s manual two-process smoke — run it only if user wants a full smoke; otherwise rely on `apps/api/src/loopEventBus.test.ts`.
- **VIM-39**: skip live browser smoke in this session (Playwright-Chromium download is heavy). Trust `packages/mcp-client/src/wrappers/browser.test.ts` + `packages/test-runner/src/index.test.ts`. The user can run the live smoke separately.
- **VIM-40**: hit `GET /benchmarks/scenarios?taskExecutionId=...` and `POST /benchmarks/scenarios/:id/runs` with a recorded execution to confirm hydration actually pulls calls + verification items. The new `bun start /benchmark` CLI command is the easiest harness.
- **VIM-41**: with `LANGSMITH_API_KEY` unset, the exporter must no-op silently. Confirm via the observability test suite.

### 4. Load Sprint 6 in Jira

Cached transition IDs: To Do→In Progress = **21**, In Progress→Done = **41**, In Review = **31**.

For each of VIM-46, VIM-39, VIM-40, VIM-41:
- `mcp__atlassian__editJiraIssue` to add the `sprint-6` label (preserve existing labels — fetch first, append).
- `mcp__atlassian__transitionJiraIssue` with `{"id": "21"}` (To Do → In Progress).
- `mcp__atlassian__addCommentToJiraIssue` with `Loaded into Sprint 6 — 2026-07-06 to 2026-07-19. Implementation already drafted on local main (commit <sha>).`

Then, immediately after, transition to **In Review** (`{"id": "31"}`) since the code is already written and waiting on verification.

If the harness denies any transition or label edit (Sprint 5 hit this on epics), surface the failure to the user for a manual flip. Don't retry destructively.

### 5. Push

The harness blocks `git push origin main` even in auto mode unless the user has granted permission. Ask the user to either:
- run `! git push origin main` themselves, or
- grant a permission rule, or
- have you push to a feature branch (`sprint-6-shipping`) and open a PR.

**Do not retry the blocked push in a loop.**

### 6. Close out per ticket

After verification + push, for each of VIM-46, VIM-39, VIM-40, VIM-41:
- `mcp__atlassian__addCommentToJiraIssue` with: merge SHA, files touched, tests added, ACs met, deferred follow-ups (if any).
- `mcp__atlassian__transitionJiraIssue` with `{"id": "41"}` (In Review → Done).

Then check the parent epics:
- **VIM-26 (Operator console & live ops)** — closes only if VIM-46 was the last open child. Per `docs/STATUS-2026-04-28.md`, VIM-46 was the only remaining open child. **Eligible to close.**
- **VIM-27 (Verification breadth)** — closes only if VIM-39 was the last open child. VIM-39 was the only child. **Eligible to close.**
- **VIM-28 (Observability & production hardening)** — VIM-40 + VIM-41 close in this sprint, but **VIM-42 is still open** and unaddressed. **Do NOT close.** Surface to user that VIM-42 needs the rescoping pass before any future sprint pulls it in (overlap with the VIM-46 wiring this sprint just landed).

If epic transitions are permission-blocked by the harness, surface that to the user for a manual flip.

### 7. Final summary to user

- Per-story result table (Story | Pts | Commit SHA | Tests added | Outcome).
- Pending push status.
- Two callouts:
  1. **VIM-42 needs scoping** before it can be pulled into Sprint 7 (now overlaps with VIM-46 + VIM-45).
  2. **The test-runner flake** (`packages/test-runner/src/index.test.ts` under parallel pool) is still unattended — file it as a small chore for whoever has slack.
- Recommendation for Sprint 7 — the rescoped VIM-42, the test-runner flake chore, and any orphan / surface follow-ups discovered during this session.

---

## Things explicitly **not** in scope this session

- **No new feature work.** Verify and ship what's already drafted.
- **No squashing or rewriting** the 8 existing commits. If you find a bug, fix it forward in a new commit.
- **No worktree-agent fan-out.** The `SPRINT-6-PROMPT.md` parallel-agent playbook does not apply because the work was done in a single tree.
- **No live Playwright/Chromium browser smoke** unless the user explicitly asks. Trust the unit tests.
- **No VIM-42 work.** It needs a scoping pass first.

---

## Auto mode + ultrathink

Auto mode preferred. **ultrathink** on the verification step in particular — the test-runner change in VIM-39 may interact with the pre-existing `apps/api/src/app.test.ts > "dispatches approved visual items..."` flake (it could now pass, or fail differently). Read carefully before deciding whether the failure is on-list or new.

**ultrathink**
