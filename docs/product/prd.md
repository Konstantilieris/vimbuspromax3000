# Product Requirements Document

Core loop: `Planner -> Verification Contract -> Approval -> Execution -> Verified Output`.

## Vision

TaskGoblin is a deterministic development loop that turns operator intent into approved epics, tasks, verification contracts, isolated task branches, and verified patches.

It exists to remove blind AI edits, invisible test generation, unclear success criteria, and mutation outside explicit tool boundaries.

## Goals

- Plan work through an interview-driven planner pipeline.
- Store epics, tasks, verification plans, approvals, and execution state in the database.
- Require verification contracts before implementation.
- Enforce test-driven development for bulk code generation.
- Execute each task on an isolated git branch.
- Standardize tool execution through MCP.
- Evaluate verified output before patch review.
- Adapt model selection through complexity, retry history, and evaluation results.
- Make logic, static, visual, and evidence checks visible in the operator console.

## Non-Goals

- No chat-first product surface for v1. The primary operator experience is the terminal UI.
- No multi-user hosted service in v1. SQLite is the local-first default.
- No direct file mutation by agents. All mutations go through tools and approvals.
- No task execution without an approved verification plan.

## Target Users

- Advanced solo developers.
- Systems engineers building constrained AI workflows.
- AI-assisted workflow builders who need replayable, reviewable execution.

## Differentiators

- Verification-first execution, not prompt-first execution.
- Planner-created tasks and verification contracts are structured records, not loose prose.
- MCP turns tools into a standard, policy-controlled execution surface.
- Evaluation turns pass/fail verification into a self-improving quality loop.
- Adaptive model routing improves cost and quality across retries.
- Visual source-of-truth assets are first-class verification inputs.
- Branch-per-task isolation creates reviewable diffs and rollback boundaries.
- Operator approval gates task persistence, verification, tool execution, and patch acceptance.

## Success Metrics

- Percentage of tasks completed without manual fix.
- Time to understand a failed task.
- Number of retries per task.
- Percentage of tasks with complete verification contracts.
- Operator trust, tracked through explicit approvals and rejected patches.

## MVP Scope

Phase 1:

- Documentation scaffold.
- Prisma SQLite schema.
- Core API and DB repositories.
- Planner run state model.
- Basic CLI layout.

Phase 2:

- Interview planner pipeline.
- Epic and task persistence.
- Verification plan generation.
- Operator approval gates.

Phase 3:

- Branch-per-task execution.
- Tool-bound agent runtime through Vercel AI SDK.
- Test runner events.
- Patch review and commit approval.

Phase 4:

- Visual source-of-truth checks.
- Replayable runs.
- Worktree support.
- Postgres-compatible schema hardening.
- LangSmith export.
- Benchmark and regression gates.
