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

### Sprint 2 close — in-process event bus + 3-pane live view

VIM-36 Sprint 2 swapped the Sprint 1 100ms poller for an in-process event bus
implemented in `packages/db/src/eventBus.ts`. `appendLoopEvent` publishes
synchronously after the row commits, so SSE subscribers see new events with
sub-millisecond latency (well inside the 200ms delivery acceptance criterion).

- The bus is a project-scoped (and optionally execution-scoped) listener
  registry exposed via `getDefaultLoopEventBus()`. Tests reset state via
  `resetDefaultLoopEventBus()`.
- The SSE handler in `apps/api/src/app.ts` subscribes once on connect, replays
  the database backlog (deduped against the bus stream), then drains a
  per-connection queue. A separate heartbeat timer enqueues a comment frame at
  `eventsSseConfig.heartbeatMs` (default 15s) so idle connections stay open.
- The 3-pane live view lives in `apps/cli/src/live.ts` and is wired into
  `apps/cli/src/index.ts`. The reducer (`applyLiveViewEvents`) and SSE frame
  parser (`parseSseFrames`) are pure so `apps/cli/src/live.test.ts` can
  snapshot the panes against a fixture event tape; the OpenTUI runtime
  mutates three pre-allocated `Text` nodes per update, so individual events do
  not trigger a full re-render of the screen tree.
- Future work: a Postgres `LISTEN/NOTIFY` adapter can plug in behind the same
  `LoopEventBus.subscribe` contract once the API has a multi-process
  deployment.
