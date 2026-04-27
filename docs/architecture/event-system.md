# Event System

Core loop: `Planner -> Verification Contract -> Approval -> Execution -> Verified Output`.

## Purpose

Loop events make the system observable. The API stores events in SQLite and streams them to the CLI through SSE.

## Event Shape

```ts
type LoopEvent = {
  id: string
  projectId: string
  taskExecutionId?: string
  type: string
  payload: unknown
  createdAt: string
}
```

SQLite v1 stores `payload` as JSON text. Application code validates payloads with TypeScript schemas before writing.

## Event Types

| Type | When emitted |
|---|---|
| `planner.started` | Planner run begins. |
| `planner.question` | Interview planner asks an operator question. |
| `planner.answer` | Operator answer is recorded. |
| `planner.proposed` | Epics, tasks, or verification plans are proposed. |
| `approval.requested` | Operator approval is required. |
| `approval.granted` | Approval is granted. |
| `approval.rejected` | Approval is rejected. |
| `task.selected` | Operator selects a task. |
| `branch.created` | Task branch is created. |
| `branch.switched` | Workspace switches to a task branch. |
| `agent.step.started` | Agent step begins. |
| `agent.step.completed` | Agent step finishes (status reflects success/failure and stop reason). |
| `agent.tool.requested` | Agent requests a tool call. |
| `agent.tool.completed` | Tool call completes. |
| `mcp.tools.discovered` | MCP client discovers the task-allowed tool catalog. |
| `mcp.tool.requested` | MCP tool call is requested. |
| `mcp.tool.blocked` | MCP tool call is blocked by policy. |
| `mcp.tool.completed` | MCP tool call completes. |
| `model.resolution.requested` | Policy starts resolving a slot for a planner or agent step. |
| `model.resolution.succeeded` | Policy resolves a slot to a concrete provider/model pair. |
| `model.resolution.failed` | Policy cannot resolve a valid model for the required slot/capabilities. |
| `model.fallback.used` | Policy selected a fallback registered model instead of the primary assignment. |
| `model.selected` | Policy selects a model slot for an attempt. |
| `model.escalated` | Retry policy escalates to a stronger model slot. |
| `test.started` | Test or verification command starts. |
| `test.stdout` | Test runner emits stdout. |
| `test.stderr` | Test runner emits stderr. |
| `test.finished` | Verification command exits. |
| `evaluation.started` | Evaluation run starts after verification. |
| `evaluation.result` | One evaluation dimension result is recorded. |
| `evaluation.finished` | Evaluation run finishes with pass, warn, or fail. |
| `benchmark.started` | Benchmark scenario run starts. |
| `benchmark.finished` | Benchmark scenario run finishes. |
| `regression.compared` | Run is compared against a baseline. |
| `regression.blocked` | Regression gate blocks promotion or patch review. |
| `langsmith.trace.linked` | Local run is linked to a LangSmith trace or experiment. |
| `patch.ready` | Diff is ready for review. |
| `patch.approved` | Operator approves patch. |
| `task.completed` | Task passes verification and patch approval. |
| `task.failed` | Task exhausts retry or fails a hard gate. |

## SSE Contract

The CLI subscribes to:

```txt
GET /events?projectId=<id>&stream=sse
```

The API emits standard SSE frames:

```txt
event: test.stdout
id: <loop-event-id>
data: {"taskExecutionId":"...","chunk":"..."}
```

Idle connections receive a `: heartbeat` comment frame every 15 seconds (configurable
through `ApiAppOptions.eventsSseConfig.heartbeatMs`) so reverse proxies and operator
TUIs do not idle-time the stream out. The heartbeat is an SSE comment, so EventSource
clients ignore it automatically.

The bare `GET /events?projectId=<id>` JSON list is **deprecated since VIM-36 Sprint 1**.
New callers should hit `GET /events/history?projectId=<id>` for the same JSON payload.
The deprecated path is kept until the existing CLI commands migrate.

Clients must treat the database as the recovery source after reconnect — both the SSE
backlog replay (the first frames after subscription) and `/events/history` read from
the same `LoopEvent` table.

### Sprint 1 push fallback (followups for Sprint 2)

VIM-36 Sprint 1 ships SSE on top of a 100ms repository poll keyed on `LoopEvent.id`.
That hits the ~200ms delivery target on local dev, but Sprint 2 should:

- Replace the poller with an in-process event bus that `appendLoopEvent` notifies
  directly, so writes propagate without the 100ms tail.
- Add a Postgres `LISTEN/NOTIFY` adapter once the API has a Postgres deployment, so
  multi-process API instances share one event source.
- Wire the 3-pane TUI live view (`apps/cli/src/live.ts` or equivalent) to consume
  `/events?stream=sse` and render the Tasks / Control / Logs split. The CLI is
  OpenTUI today (see `apps/cli/package.json`), so the live view will use OpenTUI
  primitives rather than Ink.
- Add a CLI snapshot test that replays a fixture event tape against the live view.
