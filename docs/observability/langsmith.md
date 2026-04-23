# LangSmith Observability

Core loop: `Planner -> Verification Contract -> Approval -> Execution -> Verified Output`.

## Purpose

LangSmith is the external observability and evaluation workspace for traces, datasets, and experiments. TaskGoblin remains runnable locally without LangSmith, but integration improves debugging and regression tracking.

## Trace Mapping

| TaskGoblin record | LangSmith concept |
|---|---|
| Planner run | Trace / run tree. |
| Agent step | Child run. |
| MCP tool call | Tool child run. |
| Evaluation run | Evaluation result on a run. |
| Benchmark scenario | Dataset example. |
| Regression comparison | Experiment comparison. |

## Stored Links

TaskGoblin stores LangSmith references in `LangSmithTraceLink`:

- local subject type and id
- trace URL
- dataset id
- experiment id
- run id
- sync status

## V1 Behavior

LangSmith export is optional. Local SQLite records remain canonical. If LangSmith is unavailable, execution and evaluation continue locally and sync can be retried later.

