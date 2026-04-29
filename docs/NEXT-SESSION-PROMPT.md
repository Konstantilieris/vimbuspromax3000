# Next Session — Sprint 8 Starter (Chromium fix → M2 declaration → VIM-51 stretch)

_Drafted 2026-04-29 after Sprint 7 close-out (VIM-48, VIM-49, VIM-50, VIM-47 epic all Done in Jira; doc snapshot at `docs/STATUS-2026-04-29-SPRINT-7-CLOSED.md`). Supersedes the prior Sprint 7 close runbook (preserved in git history)._

---

## TL;DR

Sprint 7 closed. **M2 declaration is deferred to Sprint 8.** Sprint 8's anchor task is the Playwright Chromium environmental fix; once that lands, re-run `bun run dogfood:m2` end-to-end to satisfy VIM-50's deferred operator-validation AC and produce a `passed` verdict, then declare M2 shipped.

There are **no open VIM-prefixed stories or tasks at session start** (the VIM-28 epic remains Open as a category container with no open children). Sprint 8 has no Jira sprint object — file work as fresh tickets with the `sprint-8` label, starting with the Chromium fix.

---

## State at session start

### Repo

- Path: `C:\Users\ak\TaskGoblin` (TaskGoblin / VimbusProMax3000, Bun 1.3.13 monorepo).
- Branch: `main`.
- Working tree expected clean except `.claude/worktrees/` (operational state, leave alone).
- `bun run verify:m2` should be green on first try; if it isn't, that's a regression to investigate before pulling new work.

### Jira

- All Sprint 7 children (VIM-48, VIM-49, VIM-50) and the VIM-47 epic are Done.
- VIM-42 is Done (rescoped, closed 2026-04-28). The `sprint-8-backlog` label on it is a label-only marker; ignore it as an open-work signal.
- VIM-51 sits in the backlog (Created, never moved into a sprint). Pull only after Chromium fix + M2 declaration.

### Atlassian MCP

The project's `.mcp.json` registers `atlassian` via `mcp-remote https://mcp.atlassian.com/v1/mcp`. Confirm before doing anything Jira:

```
ToolSearch(query="select:mcp__atlassian__getJiraIssue,mcp__atlassian__transitionJiraIssue,mcp__atlassian__addCommentToJiraIssue,mcp__atlassian__createJiraIssue", max_results=10)
```

If those tools come back, proceed. If not, refresh OAuth via `npx -y mcp-remote https://mcp.atlassian.com/v1/mcp` (interactive — user runs it) and restart the Claude Code session. Cached client info + tokens live at `~/.mcp-auth/mcp-remote-0.1.37/`.

Site / project config is unchanged from Sprint 7:

- Site: `apollonadmin.atlassian.net`
- Cloud ID: `a9dc8917-e4cb-48be-bf4f-84b1f381906e`
- Project key: `VIM`
- Style: team-managed (next-gen software). `priority` field is not on the create screen; omit from create payloads. Story points via `customfield_10016`.
- **Sprint tracking is label-based**, not via `customfield_10020`. JQL `project = VIM AND sprint is not EMPTY` returns 0 issues — the Vimbus project has no Jira Sprint objects, only the `sprint-N` label convention (`sprint-5`, `sprint-6`, `sprint-7`). Sprint 8 is a label, not a board sprint; there is no sprint ceremony to gate ticket filing. File the Chromium ticket below with the `sprint-8` label whenever the operator decides to start the sprint.

### Cached transition IDs

`11`=To Do, `21`=In Progress, `31`=In Review, `41`=Done.

---

## Process

### Day 1 — File the Chromium fix ticket

Title suggestion: **"Playwright Chromium environmental fix + dogfood smoke pre-flight"**.

Type: Story (matches Sprint 7's VIM-48/49/50 convention).

Labels: `sprint-8`, `m2-blocker`. (`sprint-8` is a new label; mirrors the existing `sprint-5`/`sprint-6`/`sprint-7` convention. `m2-blocker` is also new — apply it to anything blocking M2 declaration.)

Story points: 3 (set via `customfield_10016`).

Parent epic: file under VIM-47 if reopened/extended for M2 declaration, or under VIM-28 (Observability & production hardening) as a residual hardening task. Recommendation: file as a top-level Story with `m2-blocker` label and no epic parent — the epic VIM-47 is already Done; reopening it for one ticket creates more confusion than value. The eventual M2 fixVersion will tie the Chromium ticket back to VIM-47 narratively.

Description (use verbatim, fill in actual file paths if you adjust the smoke fixture name):

> **Why:** M2 closure criterion 3 (`bun run dogfood:m2` reaches a `passed` verdict end-to-end on a clean machine) is currently blocked on the dev machine because Playwright's `chromium-headless-shell` hits a 180s launch timeout. The orchestrator and scenario are correct; the failure is environmental. M2 cannot be declared shipped until this is resolved.
>
> **Acceptance criteria:**
> - `playwright.chromium.launch()` succeeds on the dev machine (Windows) without 180s timeout.
> - New smoke fixture under `apps/cli/src/dogfood-fixtures/playwright-launch.smoke.ts` (or similar location consistent with the existing fixture layout) that drives only the launch step. Wire into `verify:m2` as a fast pre-flight (~5s when working) so the dogfood orchestrator fails fast on the smoke instead of spending 180s in the full scenario when Chromium is broken.
> - `docs/runbooks/m2-golden-path.md` Troubleshooting section updated with the resolution.
> - Re-run `bun run dogfood:m2` end-to-end and capture the resulting `passed` verdict in `.artifacts/m2/<run-id>/`. This run constitutes the operator-validation pass for VIM-50's deferred AC.
>
> **Out of scope:** Cross-platform CI matrix (Linux / macOS Playwright); browser version pinning beyond what Playwright already provides; visual-regression baseline updates.
>
> **Surface:** Playwright install state on the dev machine, new `apps/cli/src/dogfood-fixtures/playwright-launch.smoke.ts`, root `package.json` scripts, `docs/runbooks/m2-golden-path.md` Troubleshooting section.

### Day 2-N — Implement the Chromium fix

Standard worktree-agent flow. Three tasks in order:

1. Identify and resolve the Chromium launch timeout root cause on the dev machine. First-pass hypotheses ordered by likelihood: Windows Defender / antivirus interference (add Chromium path to exclusions); stale browser cache (`bun x playwright install chromium` to refresh); missing system dependencies (`bun x playwright install --with-deps chromium`). The runbook's Troubleshooting section already lists these in priority order — work through them.

2. Add the smoke fixture. Wire it into `verify:m2` so a broken Chromium fails fast. The smoke must launch and immediately close — no page navigation, no axe-core, just `playwright.chromium.launch()` + `browser.close()`.

3. Re-run `bun run dogfood:m2` end-to-end. Capture the run's `.artifacts/m2/<run-id>/` bundle path. Confirm `manifest.json`'s `verdict` is `passed`.

### After Chromium fix lands

1. **Closure comment on the new ticket** — standard "merged on main as `<sha>`, ACs met, smoke pre-flight wired, runbook troubleshooting updated, re-run passed verdict at `<bundle-path>`."

2. **Closure comment on VIM-50** (operator-validation AC):

   > Operator-validation AC satisfied by post-Chromium-fix re-run at SHA `<X>`. Verdict: `passed` end-to-end. Artifact bundle at `.artifacts/m2/<run-id>/`. Closes the deferred AC from Sprint 7's VIM-50 closure (operator validation interpreted as a post-Chromium-fix re-run; carried into Sprint 8 alongside the Chromium chore).

3. **Declare M2 shipped:**
   - Apply M2 fixVersion to VIM-48, VIM-49, VIM-50 (and the new Chromium-fix ticket if M2 fixVersion was already created in Sprint 7).
   - Post epic-level comment on VIM-47:

     > M2 milestone declared shipped at SHA `<X>`. All five closure criteria green:
     > 1. VIM-48 + VIM-49 + VIM-50 Done — yes (Sprint 7 close).
     > 2. `origin/main` has all M2 work pushed — yes.
     > 3. `bun run dogfood:m2` runs end-to-end on a clean machine, verdict `passed` — yes (post-Chromium-fix re-run, bundle at `<path>`).
     > 4. `bun run verify:m2` deterministic — yes.
     > 5. `docs/runbooks/m2-golden-path.md` is the only doc a new operator needs — yes.

4. **Update the README M2 Release Checklist** — flip criterion 3's `[ ]` to `[x]` and replace the deferral paragraph with a one-line "M2 declared shipped at SHA `<X>` on `<date>`."

5. **VIM-51 stretch** — pull only after the Chromium fix + M2 declaration land. Per `docs/SPRINT-7-PLAN.md`'s VIM-50 (now VIM-51 in actual Jira) section, the ACs are: LangSmith trace link assertion + `LangSmithTraceLink` row check; SSE event-sequence assertion against `/events`; multi-dimensional verification matrix; bundle additions for SSE event log and LangSmith trace URL; harness fails gracefully when LangSmith env is absent.

---

## Out of scope this session

- **Anything in the Sprint 8 backlog beyond the Chromium fix and VIM-51** — pull only if both land before mid-sprint.
  - LangSmith live export polish (~3 pts) — dataset/experiment linkage, redaction review.
  - Full PDF rendered-page diff (~5 pts) — previously deferred from visual verification.
  - Cloud deploy rehearsal (5-8 pts) — only after local M2 RC is stable.
  - Programmatic Postgres via testcontainers (~3 pts) — alternative to docker-compose if the latter proves friction-heavy.
  - Browser install / autosmoke hardening — substantially covered by the Chromium fix's smoke fixture.
- **Reopening Sprint 7 tickets.** Fix-forward in new commits; don't amend or rewrite the existing chain.
- **Squashing existing commits.**
- **README cleanup of the obsolete HC-79..HC-82 Roadmap section.** Separate doc-cleanup task; not Sprint 8 scope.
- **Raw curl / cached bearer token Jira ops** — the harness denied that path on 2026-04-28 with reason "credential exploration"; if MCP fails, surface to the user, do not fall back.

---

## Sprint 7 closure references

- **VIM-48** closure comment: see VIM-48 in Jira.
- **VIM-49** closure comment: see VIM-49 in Jira.
- **VIM-50** closure comment: see VIM-50 in Jira.
- **VIM-47** epic closure comment: see VIM-47 in Jira (M2 closure-criteria scoreboard).
- **Doc snapshot**: `docs/STATUS-2026-04-29-SPRINT-7-CLOSED.md`.
- **Runbook**: `docs/runbooks/m2-golden-path.md`.
- **Sprint 7 plan (historical)**: `docs/SPRINT-7-PLAN.md`.

---

## Auto mode + judgment notes

Auto mode preferred. Make reasonable judgment calls without asking.

### Why M2 was deferred (recap, so the next operator doesn't re-litigate it)

Sprint 7 close had two defensible reads of M2 closure criterion 3:

- **Option A (declare M2 shipped now):** The orchestrator runs end-to-end and exits cleanly without operator help. The "blocked" verdict on the dev machine is environmental — a different machine with working Chromium would produce `passed`. The harness fulfilled its contract.
- **Option B (defer M2 declaration to Sprint 8):** A "blocked" verdict on the dev machine is a meaningful gap; the M2 release candidate isn't truly green until at least one machine produces `passed` end-to-end.

The Sprint 7 close adopted Option B — the more honest read of criterion 3. The Chromium chore is genuinely small, and pairing it with VIM-50's deferred operator-validation AC produces the cleanest narrative: "M2 implementation surface complete in Sprint 7; M2 declared shipped in Sprint 8 after the Chromium environmental fix."

### Why VIM-50's operator-validation AC was deferred

The Vimbus team is one operator; the AC ("at least one team member who did not author VIM-49 successfully runs `bun run dogfood:m2` end-to-end on a clean checkout") is awkward for a one-person team. The Sprint 7 close adopted option (c) from the prior runbook's Ultrathink: defer VIM-50 closure's operator-validation AC into Sprint 8, paired with the Chromium fix. The post-Chromium-fix re-run is the operator-validation pass.

This means VIM-50 was closed in Sprint 7 with the operator-validation AC explicitly carried forward. The Day 1 actions above complete that carry-forward.

### Order-of-operations on Jira transitions

Cached transition IDs (11/21/31/41) are correct, but Jira sometimes refuses transitions if a required field gates the In Review or Done screen. If a transition fails: read the response, fix the gap (e.g., post the comment first if In Review requires a comment), retry. Don't loop blindly.

**ultrathink**
