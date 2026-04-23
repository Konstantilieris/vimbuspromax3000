# VimbusProMax3000

VimbusProMax3000 is a terminal-native, test-first, DB-backed execution system implementing the TaskGoblin workflow concept already described across this repository's docs. It turns operator intent into structured plans, approved tasks, isolated execution branches, command-backed verification runs, and reviewable patch metadata. Core loop: `Planner -> Verification Contract -> Approval -> Execution -> Verified Output`.

## Why This Project

- Verification-first execution instead of prompt-first code mutation.
- Structured planner output stored as records, not loose prose.
- Branch-per-task isolation for reviewable diffs and bounded execution.
- Explicit approval gates for planning, verification, and patch acceptance.
- Policy-controlled model and tool usage instead of ad hoc runtime behavior.

## Current Status

### Works Today

- Planner run persistence, interview state capture, and proposal storage.
- Approval flows for planner output and verification plans.
- Local model registry basics for providers, models, slots, and preview resolution.
- Deterministic task branch creation and execution startup.
- Patch review metadata backed by git diff summary/state.
- Strict command-backed verification runs through `POST /executions/:id/test-runs`.

### Not Built Yet

- Full operator console beyond the current CLI bootstrap and command surfaces.
- MCP-backed verification and the broader MCP tool execution flow.
- Post-verification evaluation and adaptive retry/escalation behavior.
- Rich visual verification flows, source-of-truth asset handling, and non-command evidence execution.
- Benchmark/regression gates and optional LangSmith export.

Playwright is supported today only when it is stored as a normal shell command inside a verification item, such as `pnpm playwright test` or `bunx playwright test`. It is not a special backend runtime and is not executed through MCP in the current slice.

## Repository Layout

| Path | Purpose |
|---|---|
| `apps/api` | Hono API that owns planner, approval, execution, patch, and model-registry routes. |
| `apps/cli` | OpenTUI-based CLI entrypoint plus current command-oriented planner/model surfaces. |
| `packages/agent` | Execution orchestration and runtime wiring for task startup and patch decisions. |
| `packages/db` | Prisma SQLite client, migrations, repositories, and test helpers. |
| `packages/model-registry` | Provider/model/slot registry and setup flows. |
| `packages/planner` | Planner normalization, prompts, slot validation, and generation service. |
| `packages/policy-engine` | Slot resolution and policy selection logic. |
| `packages/shared` | Shared enums, guards, and domain constants. |
| `packages/test-runner` | Sequential command-backed verification runner and artifact capture. |

## Getting Started

### Prerequisites

- Bun `1.3.13`
- Git
- A local environment that can run the Bun workspace on your machine

### Install Dependencies

```bash
bun install
```

### Database Setup

The default database is local-first SQLite through Prisma config.

```bash
bun run db:generate
bun run db:migrate
```

### Run the API

```bash
bun run api
```

The API listens on `http://localhost:3000` by default.

### Run the CLI

```bash
bun run cli
```

### Quality Checks

```bash
bun run test:vitest
bun run typecheck
```

## How The Current Flow Works

1. Start a planner run and persist structured epics, tasks, and verification plans.
2. Approve the generated planner output so tasks can advance.
3. Approve a task's verification plan so the task becomes executable.
4. Start task execution, which prepares or switches to the isolated task branch and snapshots model policy.
5. Run approved verification items that have non-empty shell commands.
6. Persist test-run output and patch review metadata for operator review.

Today, this verification step is command-only. Approved visual and evidence items are runnable through the route only when they are backed by a non-empty command.

## Documentation Guide

Start with the full documentation index: [docs/README.md](docs/README.md)

Recommended follow-up reading:

- [System Overview](docs/architecture/system-overview.md)
- [Planner Pipeline](docs/planner/planner-pipeline.md)
- [Verification Contract](docs/verification/verification-contract.md)
- [API Contract](docs/execution/api-contract.md)
- [MVP Plan](docs/execution/mvp-plan.md)

## Roadmap / Next Slice

- Extend the CLI from planner/task approval commands into execution, events, test runs, and patch review views.
- Improve verification contract generation and planner/review feedback beyond the current persisted payload model.
- Layer in MCP-backed verification, evaluation, and richer visual flows after the execution loop is stable in the CLI.
- Add retry and escalation behavior after evaluation and operator-facing review surfaces are in place.

## Contribution / Repo Expectations

This is an active local-first workspace with evolving execution slices. The root README is the repo entrypoint; the deeper behavioral and architectural truth lives in `docs/`.

Before changing architecture or workflow behavior, read the documentation map in [docs/README.md](docs/README.md) and align changes with the current MVP status described in [docs/execution/mvp-plan.md](docs/execution/mvp-plan.md).
