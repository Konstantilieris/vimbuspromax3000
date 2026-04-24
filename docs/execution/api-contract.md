# API Contract

Core loop: `Planner -> Verification Contract -> Approval -> Execution -> Verified Output`.

## Base

The API is a local Hono service. In this slice the CLI talks to it over HTTP and reads loop events through a JSON endpoint. SSE is deferred to the later operator-console slice.

## Local Execution-Loop Smoke

The repeatable CI/developer smoke path is covered by `apps/api/src/app.test.ts` as the HC-92 local operator smoke. It runs only against an isolated SQLite database and a temporary local git repository.

Expected happy-path sequence:

1. `POST /projects` creates a project with a local git root and `main` base branch.
2. `POST /model-setup` assigns `executor_default` to an env-backed active model.
3. `POST /planner/runs`, `POST /planner/runs/:id/answers`, and payload-backed `POST /planner/runs/:id/generate` create one task with a command-backed verification item.
4. `POST /approvals` grants planner approval, moving the task to `awaiting_verification_approval`.
5. `GET /tasks/:id/verification` shows the plan as fully runnable by the command runner.
6. `POST /tasks/:id/verification/approve` grants verification approval, moving the task to `ready`.
7. `POST /tasks/:id/branch` prepares and switches to a deterministic task branch.
8. `POST /tasks/:id/execute` starts execution, persists the model policy snapshot, model decision, agent step, and active branch state.
9. `POST /executions/:id/test-runs` runs the approved shell command, persists `TestRun` records, stdout/stderr logs, and `meta.json` under `.artifacts/executions/<execution-id>/test-runs/...`.
10. `GET /executions/:id/patch` exposes the ready patch review with a diff under `.taskgoblin/artifacts/executions/<execution-id>/patch/current.diff`.
11. `POST /executions/:id/patch/approve` marks the patch approved, execution completed, task completed, and branch approved.

Patch rejection is covered by the same API surface with `POST /executions/:id/patch/reject`, which marks the patch rejected and the execution/task failed. Representative verification failures are covered by command failure and unsupported approved-item tests: failed commands persist failed `TestRun` state and do not create patch review metadata, while approved non-command items return the strict `422` payload documented below before any command runs.

## Projects

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/projects` | List projects. |
| `POST` | `/projects` | Create a project. |

## Planner

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/planner/runs` | Start planner run. |
| `GET` | `/planner/runs/:id` | Fetch planner run state. |
| `POST` | `/planner/runs/:id/answers` | Submit structured interview answers and merge them into `PlannerRun.interviewJson`. |
| `POST` | `/planner/runs/:id/generate` | Persist payload-driven proposed epics, tasks, and verification plans. |
| `POST` | `/planner/runs/:id/review` | Run planner review. |

## Approvals

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/approvals` | Create approval decision for a subject. |
| `GET` | `/approvals?subjectType=&subjectId=` | List approvals for a subject. |

## Tasks

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/tasks` | List tasks with epic and status filters. |
| `GET` | `/tasks/:id` | Fetch task detail. |
| `POST` | `/tasks/:id/verification/approve` | Approve verification plan. |
| `POST` | `/tasks/:id/execute` | Start execution. |

## Branches

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/tasks/:id/branch` | Create or switch task branch. |
| `GET` | `/tasks/:id/branch` | Fetch branch state. |
| `POST` | `/tasks/:id/branch/abandon` | Abandon task branch. |

## Verification and Patch Review

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/executions/:id/test-runs` | Run approved command-backed verification items. |
| `GET` | `/executions/:id/test-runs` | List test runs. |
| `POST` | `/executions/:id/evaluations` | Run evaluation after verification. |
| `GET` | `/executions/:id/evaluations` | List evaluation runs and results. |
| `GET` | `/executions/:id/patch` | Fetch patch summary and diff metadata. |
| `POST` | `/executions/:id/patch/approve` | Approve patch. |
| `POST` | `/executions/:id/patch/reject` | Reject patch. |

### `POST /executions/:id/test-runs`

Current slice rules:

- Loads the execution, branch, task, and the latest approved verification plan for the task.
- Executes only approved verification items from that approved plan.
- An item is executable here only when it has a non-empty `command`.
- `kind` and `runner` do not make an item runnable by themselves.
- `visual` and `evidence` items are supported by this route only when they are command-backed.
- The route does not invoke MCP tools. Playwright is treated only as a shell command such as `pnpm playwright test`.
- Items run sequentially in `orderIndex` order.
- Artifacts are written under `.artifacts/executions/<execution-id>/test-runs/<orderIndex>-<item-id>/`.

Strict eligibility failures return `422`:

```json
{
  "code": "UNSUPPORTED_VERIFICATION_ITEMS",
  "message": "This execution contains approved verification items that cannot be run by the command runner.",
  "items": [
    {
      "id": "verification_item_123",
      "kind": "visual",
      "title": "login flow visual check"
    }
  ]
}
```

```json
{
  "code": "NO_APPROVED_VERIFICATION_ITEMS",
  "message": "This execution has no approved verification items to run.",
  "items": []
}
```

## MCP

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/mcp/servers` | List configured MCP servers. |
| `GET` | `/tasks/:id/mcp/tools` | List task-allowed MCP tools. |
| `GET` | `/executions/:id/mcp/calls` | List MCP tool calls for an execution. |
| `POST` | `/executions/:id/mcp/calls/:callId/approve` | Approve a blocked mutating tool call. |

## Model Registry

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/model-secret-refs` | List env-backed secret references for the active project. |
| `POST` | `/model-secret-refs` | Register an env-var reference without storing the secret value. |
| `POST` | `/model-setup` | Idempotently create/load a project, seed slots, register secret/provider/model, and assign slots. |
| `GET` | `/model-providers` | List registered model providers. |
| `POST` | `/model-providers` | Register a provider configuration. |
| `PATCH` | `/model-providers/:id` | Update provider metadata or status. |
| `POST` | `/model-providers/:id/test` | Validate provider config, env ref presence, and adapter support. |
| `GET` | `/models` | List registered models, optionally filtered by provider. |
| `POST` | `/models` | Register a model and its capabilities. |
| `PATCH` | `/models/:id` | Update model metadata, enabled state, or capabilities. |
| `GET` | `/model-slots` | List project slot assignments and fallback assignments. |
| `POST` | `/model-slots/:slot/assign` | Assign a primary and optional fallback model to a slot. |
| `POST` | `/model-slots/:slot/test` | Resolve a slot and report the concrete model or policy failure. |
| `POST` | `/model-policy/preview` | Preview slot resolution for required capabilities without starting execution. |

## Model Decisions

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/executions/:id/model-decisions` | List selected model slots and escalation reasons. |
| `POST` | `/executions/:id/retry` | Request a policy-controlled retry. |

## Benchmarks and Regression

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/benchmarks/scenarios` | List benchmark scenarios. |
| `POST` | `/benchmarks/scenarios/:id/run` | Run a benchmark scenario. |
| `POST` | `/regressions/compare` | Compare a run against a baseline. |
| `GET` | `/regressions/baselines` | List active baselines. |

## LangSmith

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/langsmith/links` | Store a trace, dataset, experiment, or run link. |
| `GET` | `/langsmith/links?subjectType=&subjectId=` | Fetch LangSmith links for a local subject. |

## Events

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/events?projectId=<id>` | List `LoopEvent` records as JSON. |

The current slice returns JSON event history ordered by creation time. SSE is intentionally deferred until the CLI operator-console slice.
