# MVP Execution Plan

Core loop: `Planner -> Verification Contract -> Approval -> Execution -> Verified Output`.

This file is the canonical MVP tracker. Keep it current whenever implementation changes the real state of the repo.

## Current Position

Status: **CLI console and verification slices complete; MCP is next**.

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

Immediate gap: MCP client and tool-call approval gates are next. Evaluation, visual verification, and non-command evidence execution remain deferred.

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

Out of MVP unless explicitly pulled forward:

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
| done | CLI Console | Extend CLI views to executions, events, and patch review. |
| done | Verification | Implement richer verification contract generation, planner/review feedback, and future non-command runtime handling beyond the current command-only slice. |
| later | MCP | Add MCP client and minimal fs/git/shell server wrappers with approval gates. |
| later | Evaluation | Add rule-based evaluation after verification and before patch review. |
| later | Visual | Add source asset ingestion, screenshot capture, and pixel/PDF checks. |
| later | Benchmarks | Add benchmark scenarios, regression baselines, and comparison gates. |
| later | Observability | Add optional LangSmith trace/dataset/export integration. |

## Recommended Next Sequence

1. Extend the CLI from planner/task/approval commands into execution, events, test runs, and patch review views.
2. Materialize richer verification contracts beyond persisted planner payloads, including better planner/review feedback and future non-command item handling.
3. Layer in MCP-backed verification, evaluation, and richer visual flows after the backend execution loop is stable in the CLI.
4. Add retry/escalation behavior only after the evaluation and operator surfaces exist.

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
- Implement MCP client layer.
- Wrap fs, grep, git, patch, shell, browser, and database capabilities as MCP servers.
- Enforce MCP tool discovery, allowlists, argument validation, and approval policy.
- Implement later-slice TDD loop extensions beyond the current command-only verification runner: richer verification materialization, confirm red or pending, implement, verify green.

## Phase 5 - Evaluation and Adaptive Execution

- Implement rule-based evaluators.
- Implement OpenEvals-style LLM judge prompts with JSON outputs.
- Add `planner_quality`, `task_decomposition`, `verification_quality`, `execution_quality`, `outcome_correctness`, `tool_usage_quality`, `security_policy_compliance`, and `regression_risk`.
- Run evaluation after verification and before patch review.
- Retry or escalate model when evaluation fails but policy allows recovery.
- Stop on hard policy violations, max attempts, or diminishing returns.

## Phase 6 - Operator Console

- Render task list, branch panel, verification contract, MCP tool usage, model decisions, evaluation scores, regression status, test output, events, and patch review.
- Support approval actions from the CLI.
- Stream live loop events through SSE.

## Phase 7 - Visual Verification

- Add source asset ingestion.
- Add screenshot capture and pixel diff integration.
- Add PDF render verification.
- Store visual result artifacts and hashes.

## Phase 8 - Benchmarks and LangSmith

- Add benchmark scenarios for planner, execution, MCP, unsafe tool blocking, and eval-driven retry.
- Store regression baselines and compare future runs.
- Add optional LangSmith trace, dataset, and experiment export.
