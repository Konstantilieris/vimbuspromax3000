# MVP Execution Plan

Core loop: `Planner -> Verification Contract -> Approval -> Execution -> Verified Output`.

This file is the canonical MVP tracker. Keep it current whenever implementation changes the real state of the repo.

## Current Position

Status: **CLI, verification, MCP, wrapper gates, and execution-loop smoke are complete on `main`; evaluation is the next reconciliation item**.

Completed foundations:

- Documentation scaffold and module map exist.
- Bun/TypeScript workspace exists.
- Hono API bootstrap exists.
- OpenTUI CLI bootstrap exists.
- Prisma SQLite schema and migrations exist.
- Shared domain constants and guards exist.
- Model registry primitive exists:
  - provider/model/slot/secret-ref schema
  - registry package
  - policy-engine slot resolution
  - Vercel AI SDK runtime factory
  - model API routes
  - API-backed `/models:*` CLI commands
  - planner slot validation guard
- Backend foundation exists:
  - core repositories for project, planner, task, approval, and events
  - project/planner/task/approval/event JSON API routes
  - isolated SQLite repository and API integration tests
- Planner vertical slice exists:
  - planner service package with Vercel AI SDK generation and planner-slot resolution
  - structured proposal normalization derived from `PlannerRun.interviewJson`
  - persistence-first proposal storage still handled by the repository layer
  - API-backed CLI commands for projects, planner runs, tasks, and approvals
  - planner approval flow that advances generated tasks to `awaiting_verification_approval`
  - planner normalization, API integration, and CLI smoke tests
- Execution backend foundation exists:
  - task-branch, task-execution, test-run, and patch-review repositories
  - deterministic branch preparation with base-branch safety gates and branch-name derivation
  - minimal execution orchestration in packages with policy snapshot, `ModelDecision`, and `AgentStep` persistence
  - strict command-only verification runner for approved items with sequential execution, 422 eligibility errors, and deterministic artifacts under `.artifacts/executions/<execution-id>/test-runs/...`
  - patch-review metadata routes backed by current git diff summary and approval/rejection state
  - isolated SQLite + git fixture tests for repositories, services, API integration, and happy-path execution
  - HC-92 API smoke covers the local operator loop from project/planner setup through verification approval, branch preparation, execution, command-backed verification artifacts, patch metadata, and patch approval; adjacent API tests cover patch rejection, command failure, and unsupported approved verification items
- CLI console slice exists:
  - HC-76 added execution, branch, test-run, event, MCP-call, and patch-review command surfaces in `apps/cli/src/execution.ts`
  - the dashboard exposes the execution command set
  - CLI smoke and formatter coverage live in `apps/cli/src/execution.test.ts`
- Verification contract slice exists:
  - HC-77 centralized runnability/deferred-reason rules in `packages/shared`
  - task detail and verification review API responses expose runnable/deferred metadata
  - unsupported non-command items remain explicit deferred work instead of pretending to run
- MCP runtime slice exists on `main`:
  - HC-78 added `packages/mcp-client`, MCP server/tool/call repository support, server catalog routes, and MCP call API coverage
  - HC-91 added minimal fs/git/shell wrappers, argument validation, mutability policy, approval gates, and wrapper service coverage

Jira/repo audit as of 2026-04-24:

| Issue | Jira status | Main repo state | Tracker status | Owner |
|---|---|---|---|---|
| HC-76 | Done | Landed on `main` as CLI execution console commands and tests. | done | Aggelos |
| HC-77 | Done | Landed on `main` as richer verification contract and runnability signalling. | done | Nikos |
| HC-78 | Done | Landed on `main` as MCP client, server catalog, API routes, and persistence. Wrapper gates landed separately in HC-91. | done | Nikos |
| HC-79 | Done | Implemented on `origin/dev` at `2c03c18`, but not present on `main`; `main` only has schema/docs for evaluation records. | next | Nikos |
| HC-80 | To Do | Not implemented on `main`; only schema/docs scaffolding exists for source assets and visual verification. | later | Nikos |
| HC-81 | To Do | Not implemented on `main`; only schema/docs scaffolding exists for benchmark and regression records. | later | Nikos |
| HC-82 | To Do | Not implemented on `main`; only schema/docs scaffolding exists for LangSmith trace links. | later | Nikos |
| HC-83 | To Do | Broader reconciliation/handoff remains open after this tracker update. | later | Aggelos |

Immediate gap: HC-79 needs an explicit main-branch decision: merge/cherry-pick the completed `origin/dev` evaluation slice, or reopen/retarget the Jira work if that branch state is not intended for `main`. HC-80 through HC-82 remain separate Nikos-owned later-slice Jira work.

## MVP Finish Line

The MVP is done when a local operator can:

1. Create or load a project.
2. Register a Vercel AI SDK-backed provider and model.
3. Assign required model slots.
4. Start a planner run.
5. Approve generated epics, tasks, and verification plans.
6. Execute one approved task on an isolated branch.
7. Run approved command-backed verification items and persist deterministic test artifacts and results.
8. See model resolution, tool calls, test output, events, and patch state in the CLI.
9. Approve or reject the final patch.

Deferred from the current `main` finish line unless explicitly pulled forward:

- visual pixel-diff verification
- benchmark regression gates
- LangSmith export
- Postgres hardening
- smart model escalation beyond configured fallback slots

## Active Task List

Legend: `done`, `active`, `next`, `later`.

| Status | Area | Task |
|---|---|---|
| done | Docs | Create documentation scaffold and reading order. |
| done | Bootstrap | Initialize Bun workspace, TS config, API, CLI, Prisma, and Vitest. |
| done | Model Registry | Add provider/model/slot/secret schema, migration, shared types, registry package, and policy resolver. |
| done | Model Runtime | Add Vercel AI SDK runtime provider factory. |
| done | Model API/CLI | Add model CRUD/slot/preview routes and API-backed `/models:*` CLI commands. |
| done | Model Setup | Apply model-registry migration and add idempotent `/model-setup` plus `/models:setup`. |
| done | Model Tests | Add isolated SQLite API integration tests for provider/model/slot setup and resolution. |
| done | Data/API Foundation | Add repository layer for Project, PlannerRun, Epic, Task, VerificationPlan, Approval, and LoopEvent. |
| done | API Foundation | Implement project, planner, task, approval, verification approval, and JSON event routes. |
| done | CLI Planner Slice | Wire CLI project/planner/task/approval commands to `/projects`, `/planner/runs:*`, `/tasks`, and `/approvals`. |
| done | Planner | Implement AI-backed planner orchestration, slot resolution, structured proposal normalization, and persistence through the existing planner repositories. |
| done | Execution | Implement deterministic branch prep, minimal execution start, policy snapshot persistence, and execution routes. |
| done | Test Runner | Execute approved command-backed verification items only, reject unsupported items with 422 payloads, persist stdout/stderr paths plus deterministic artifacts, and emit loop events. |
| done | Patch Review | Persist diff summary metadata plus patch approval/rejection and completion state. |
| done | CLI Console | HC-76: extend CLI views to executions, events, test runs, MCP calls, and patch review. |
| done | Verification | HC-77: implement richer verification contract generation, planner/review feedback, and future non-command runtime handling beyond the current command-only slice. |
| done | MCP Client/API | HC-78: add MCP client, server catalog, tool-call persistence, and API routes. |
| done | MCP Wrapper Gates | HC-91: add minimal fs/git/shell wrappers with argument validation, mutability policy, and approval gates. |
| done | Execution Smoke | HC-92: add end-to-end API smoke from task approval through command verification and patch approval. |
| next | Evaluation | HC-79: reconcile Jira Done / `origin/dev` implementation with `main`, or retarget if the dev-branch slice should not land. |
| later | Visual | HC-80: add source asset ingestion, screenshot capture, and pixel/PDF checks. Nikos-owned Jira work. |
| later | Benchmarks | HC-81: add benchmark scenarios, regression baselines, and comparison gates. Nikos-owned Jira work. |
| later | Observability | HC-82: add optional LangSmith trace/dataset/export integration. Nikos-owned Jira work. |
| later | Handoff | HC-83: broader reconciliation and next execution-loop handoff remains open. |

## Recommended Next Sequence

1. Resolve HC-79's split state by either landing the completed `origin/dev` evaluation slice on `main` or updating Jira to show the work is not actually complete for `main`.
2. Keep HC-76, HC-77, HC-78, HC-91, and HC-92 closed; do not duplicate those slices in new follow-up tickets.
3. Sequence HC-80 visual verification, HC-81 benchmark/regression gates, and HC-82 LangSmith export as separate Nikos-owned later slices after the HC-79 decision.
4. Add retry/escalation behavior only after evaluation is present on `main` and operator-facing review surfaces can explain the decision.

## Backlog Dependency Map

Canonical Jira coordination:

- HC-76, HC-77, HC-78, HC-91, and HC-92 are done on `main`; do not create duplicate follow-up slices for those surfaces.
- HC-79 is the next decision gate: Jira marks it Done and `origin/dev` contains `2c03c18`, but `main` does not contain the evaluation implementation.
- HC-80, HC-81, and HC-82 remain Nikos-owned later slices and should not be reassigned as part of coordination cleanup.
- HC-83 is the umbrella handoff task; HC-84 and HC-85 provide the audit and tracker reconciliation trail; HC-93 records the dependency-map cleanup.

Hard dependency order:

| Blocker | Blocked | Reason |
|---|---|---|
| HC-79 | HC-81 | Benchmark/regression gates depend on evaluation outputs and dimensions. |
| HC-79 | HC-82 | LangSmith export links evaluation runs and related observability records. |
| HC-80 | HC-81 | Visual source-of-truth results feed benchmark/regression comparisons. |
| HC-81 | HC-82 | LangSmith export can mirror benchmark and regression artifacts after they exist. |
| HC-84 | HC-93 | The missing-commit audit defines the dependency-map inputs. |
| HC-85 | HC-93 | The canonical tracker update defines the current done/next/later state. |
| HC-92 | HC-93 | The execution-loop smoke closes the current main-backed MVP slice before backlog cleanup. |

## Phase 0 - Documentation

- Create this documentation scaffold.
- Validate that PRD, schema, planner, verification, branch, CLI, and API docs agree.

## Phase 1 - Repository Bootstrap

- Initialize Bun workspace.
- Add TypeScript config.
- Add Hono API app.
- Add OpenTUI CLI app.
- Add Prisma with SQLite.
- Add Vitest for packages.

## Phase 2 - Data and API

- Implement Prisma schema and migrations.
- Implement repository layer for projects, planner runs, epics, tasks, verification plans, approvals, branches, MCP tool calls, model decisions, eval runs, benchmark baselines, test runs, patch reviews, and loop events.
- Implement Hono routes for planner, approvals, tasks, execution, verification, MCP, evaluation, model decisions, benchmarks, regression, patch review, and SSE events.

## Phase 3 - Planner

- Implement context ingest.
- Implement interview workflow.
- Implement planner orchestration with Vercel AI SDK model slots.
- Persist proposed epics, tasks, and verification plans.
- Require approval before tasks become executable.

## Phase 4 - Execution

- Implement branch policy.
- Implement MCP client layer. Done for HC-78 on `main`.
- Wrap fs, git, and shell capabilities behind the minimal MCP wrapper gate. Done for HC-91 on `main`.
- Enforce MCP tool discovery, allowlists, argument validation, and approval policy. Minimal gate complete on `main`; broader browser/database wrappers remain future scope.
- Implement later-slice TDD loop extensions beyond the current command-only verification runner: richer verification materialization, confirm red or pending, implement, verify green.

## Phase 5 - Evaluation and Adaptive Execution

- Implement rule-based evaluators. HC-79 is Done in Jira and present on `origin/dev`, but not on `main`.
- Implement OpenEvals-style LLM judge prompts with JSON outputs. HC-79 is Done in Jira and present on `origin/dev`, but not on `main`.
- Add `planner_quality`, `task_decomposition`, `verification_quality`, `execution_quality`, `outcome_correctness`, `tool_usage_quality`, `security_policy_compliance`, and `regression_risk`.
- Run evaluation after verification and before patch review.
- Retry or escalate model when evaluation fails but policy allows recovery.
- Stop on hard policy violations, max attempts, or diminishing returns.

## Phase 6 - Operator Console

- Render task list, branch panel, verification contract, MCP tool usage, model decisions, test output, events, and patch review. Implemented for current main-backed surfaces by HC-76 and HC-92.
- Render evaluation scores and regression status after HC-79 is reconciled onto `main` and HC-81 exists.
- Support approval actions from the CLI. Implemented for current planner, verification, MCP-call, and patch-review surfaces.
- Stream live loop events through SSE.

## Phase 7 - Visual Verification

- HC-80 later slice: add source asset ingestion.
- HC-80 later slice: add screenshot capture and pixel diff integration.
- HC-80 later slice: add PDF render verification.
- HC-80 later slice: store visual result artifacts and hashes.

## Phase 8 - Benchmarks and LangSmith

- HC-81 later slice: add benchmark scenarios for planner, execution, MCP, unsafe tool blocking, and eval-driven retry.
- HC-81 later slice: store regression baselines and compare future runs.
- HC-82 later slice: add optional LangSmith trace, dataset, and experiment export.
