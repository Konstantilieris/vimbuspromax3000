# Evaluation Contract

Core loop: `Planner -> Verification Contract -> Approval -> Execution -> Verified Output`.

## Purpose

Verification proves that required checks passed. Evaluation judges whether the task was planned, executed, and tooled well enough to proceed to patch review.

Evaluation runs after verification and before patch review.

## Inputs

An evaluation run receives:

- planner output
- epic and task records
- verification plan and item results
- branch and patch metadata
- MCP tool call logs
- model decisions and retry history
- test run summaries
- source-of-truth asset metadata
- operator approvals

## Outputs

Each evaluation produces an `EvalRun` and one or more `EvalResult` records.

```ts
type EvalResult = {
  dimension: string
  score: number
  threshold: number
  verdict: 'pass' | 'warn' | 'fail'
  reasoning: string
}
```

## Decision Gate

| Condition | Decision |
|---|---|
| Verification failed | Retry implementation or fail task. |
| Verification passed and evaluation passed | Move to patch review. |
| Verification passed but evaluation below threshold | Retry or escalate model. |
| Hard policy violation | Block patch review and mark execution failed. |

## Persistence

Evaluation results are stored in SQLite v1. JSON payloads are stored as text and validated in application code.

