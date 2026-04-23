# TDD Execution Loop

Core loop: `Planner -> Verification Contract -> Approval -> Execution -> Verified Output`.

## Rule

Bulk code generation must be test-driven. The executor implements only after the task has an approved verification contract.

In the current backend slice, the verification runner is command-only: `POST /executions/:id/test-runs` executes approved items only when they have a non-empty shell command, and it does not invoke MCP tools.

## Task Loop

```txt
Select approved task
  |
  v
Create or switch task branch
  |
  v
Materialize verification first
  |
  v
Run verification and confirm red or pending state
  |
  v
Execute implementation through tools
  |
  v
Run verification until green or retry budget exhausted
  |
  v
Run evaluation
  |
  v
Policy decision: patch review, retry, escalate, or fail
  |
  v
Generate patch review
  |
  v
Operator approves patch
```

## Red-State Policy

For concrete logic and integration tests, the executor should create the test first and confirm it fails for the expected reason.

For the current command-only slice, executable verification means a deterministic shell command. Typecheck, lint, and Playwright CLI checks fit when they are expressed as commands. Non-command visual and evidence items are not runnable by this route and block the run until the plan is revised or a later runtime slice exists.

## Evaluation Gate

Evaluation runs after verification and before patch review. Passing tests are necessary but not sufficient; the evaluation engine also checks planning quality, execution quality, outcome correctness, MCP tool usage, security policy compliance, and regression risk.

If verification passes but evaluation fails below threshold, policy may retry the task or escalate the model. Hard policy violations block patch review.

## Retry Policy

Retries use the same verification contract. The executor may change implementation and test code it created, but it may not weaken or delete approved verification items without a new approval.

Retries also use the same evaluation dimensions. A retry can change implementation strategy and model slot, but cannot lower thresholds without operator approval.

## Completion Gate

A task is complete only when:

- all required verification items are green or explicitly skipped by operator approval
- no approved verification item is blocked on unsupported non-command runtime behavior
- evaluation passes required thresholds
- no hard security or MCP policy violation is present
- regression gate passes when a baseline exists
- branch diff is available
- operator approves the patch
- commit policy is satisfied
