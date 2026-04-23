# Evaluation Scoring

Core loop: `Planner -> Verification Contract -> Approval -> Execution -> Verified Output`.

## Score Scale

Scores use `0..100`.

| Range | Meaning |
|---|---|
| `90..100` | Strong pass. |
| `75..89` | Pass. |
| `60..74` | Warning; retry may be useful depending on task risk. |
| `1..59` | Fail. |
| `0` | Hard fail or non-evaluable output. |

## Default Thresholds

| Dimension | Pass threshold |
|---|---|
| `planner_quality` | 75 |
| `task_decomposition` | 75 |
| `verification_quality` | 80 |
| `execution_quality` | 75 |
| `outcome_correctness` | 85 |
| `tool_usage_quality` | 70 |
| `security_policy_compliance` | 100 |
| `regression_risk` | 75 |

## Aggregate Verdict

Patch review is allowed only when:

- all verification items pass or are operator-approved skips
- all hard-fail dimensions pass
- weighted evaluation score meets the policy threshold

## Retry and Escalation

If evaluation fails but the failure is recoverable, the execution loop retries with a stronger model slot or a refined instruction bundle. If the same dimension fails repeatedly, diminishing-returns detection stops retries and asks the operator for review.

