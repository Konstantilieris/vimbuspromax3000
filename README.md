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
- CLI execution surfaces for branch state, executions, test runs, events, MCP calls, and patch review.
- Richer verification contract metadata with explicit runnable/deferred signalling for non-command items.
- MCP client, server catalog, tool-call persistence, and minimal fs/git/shell wrapper approval gates.
- API smoke coverage for the local loop from task approval through command verification and patch approval.

### Not Built Yet

- HC-79 evaluation is Done in Jira and implemented on `origin/dev`, but it is not present on `main`; the next step is to land it on `main` or retarget/reopen the Jira state.
- HC-80 visual verification, HC-81 benchmark/regression gates, and HC-82 optional LangSmith export remain separate Nikos-owned later-slice Jira work.
- Broader browser/database MCP wrappers and non-command evidence execution remain outside the current `main` slice.
- Adaptive retry/escalation behavior remains blocked until evaluation is present on `main`.

Playwright is supported today only when it is stored as a normal shell command inside a verification item, such as `pnpm playwright test` or `bunx playwright test`. It is not a special backend runtime in the current `main` slice.

## Repository Layout

| Path | Purpose |
|---|---|
| `apps/api` | Hono API that owns planner, approval, execution, patch, and model-registry routes. |
| `apps/cli` | OpenTUI-based CLI entrypoint for planner/model plus execution, event, MCP-call, and patch-review surfaces. |
| `packages/agent` | Execution orchestration and runtime wiring for task startup and patch decisions. |
| `packages/db` | Prisma SQLite client, migrations, repositories, and test helpers. |
| `packages/model-registry` | Provider/model/slot registry and setup flows. |
| `packages/mcp-client` | MCP server catalog, tool validation, wrapper dispatch, and approval-gated calls. |
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

`bun run verify:m2` is the authoritative answer to "is the tree green?" It runs `typecheck`, the unit matrix in parallel, the same matrix again under single-fork (an audit pass that confirms no test depends on parallelism), and the Postgres-backed smoke under docker-compose. A green `verify:m2` is the per-PR and pre-release bar.

```bash
bun run verify:m2
```

For the M2 golden-path dogfood scenario (single-command end-to-end run that exercises the planner → approval → execute → verify → evidence → benchmark loop against the M2 release-candidate stack), see [docs/runbooks/m2-golden-path.md](docs/runbooks/m2-golden-path.md).

Faster, narrower checks for inner-loop work:

```bash
bun run typecheck       # type signatures only
bun run test:unit       # unit suite, parallel pool (fast inner loop)
bun run test:serial     # unit suite, single fork (run if you suspect a parallel-pool flake)
bun run test:postgres   # docker-compose Postgres + adapter smoke (requires Docker)
```

`test:postgres` runs `docker compose up -d --wait postgres`, pushes the Prisma schema, runs the Postgres-backed smoke, then tears the service down. The compose service binds `127.0.0.1:55432`. Docker is the only host-side prerequisite.

The legacy `test:vitest` and `test:vitest:postgres` scripts still work for ad-hoc invocations, but `verify:m2` is canonical.

## M2 Release Checklist

M2 ("Verifiable Execution at Scale") is declared shipped when all of the following are green:

- [x] VIM-48 + VIM-49 + VIM-50 are Done.
- [x] `origin/main` has all Sprint 7 work pushed.
- [ ] `bun run dogfood:m2` runs end-to-end on a clean machine without operator help.
- [x] `bun run verify:m2` is deterministic — failures are product, not harness.
- [x] `docs/runbooks/m2-golden-path.md` is the only doc a new operator needs.

Sprint 7 shipped the implementation surface for criteria 1, 2, 4, 5. Criterion 3 (`bun run dogfood:m2` reaching a `passed` verdict on a clean machine) requires the Sprint 8 Chromium environmental fix; M2 will be declared shipped once that lands. See `docs/STATUS-2026-04-29-SPRINT-7-CLOSED.md` and `docs/runbooks/m2-golden-path.md` (Troubleshooting section) for the gap details.

## How The Current Flow Works

1. Start a planner run and persist structured epics, tasks, and verification plans.
2. Approve the generated planner output so tasks can advance.
3. Approve a task's verification plan so the task becomes executable.
4. Start task execution, which prepares or switches to the isolated task branch and snapshots model policy.
5. Run approved verification items that have non-empty shell commands.
6. Persist test-run output, event history, MCP call metadata, and patch review metadata for operator review.
7. Inspect or act on execution, branch, test-run, event, MCP-call, and patch-review state from the CLI.

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

- Resolve HC-79's split state: Jira marks evaluation Done and `origin/dev` contains the implementation, but `main` does not.
- Keep HC-76 CLI console, HC-77 verification metadata, HC-78 MCP client/API, HC-91 wrapper gates, and HC-92 execution-loop smoke closed; do not duplicate those slices.
- Sequence HC-80 visual verification, HC-81 benchmark/regression gates, and HC-82 LangSmith export as separate Nikos-owned later slices.
- Use the canonical [MVP backlog dependency map](docs/execution/mvp-plan.md#backlog-dependency-map) for Jira link/order decisions.
- Add retry and escalation behavior only after evaluation is present on `main` and the operator surfaces can explain the outcome.

## Contribution / Repo Expectations

This is an active local-first workspace with evolving execution slices. The root README is the repo entrypoint; the deeper behavioral and architectural truth lives in `docs/`.

Before changing architecture or workflow behavior, read the documentation map in [docs/README.md](docs/README.md) and align changes with the current MVP status described in [docs/execution/mvp-plan.md](docs/execution/mvp-plan.md).
