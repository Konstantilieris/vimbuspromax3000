# Planner Pipeline

Core loop: `Planner -> Verification Contract -> Approval -> Execution -> Verified Output`.

## Basis

The TaskGoblin planner is based on the existing Dilos planner skill pattern:

```txt
context ingest -> research -> interview -> design/task writing -> review -> validation
```

TaskGoblin upgrades that pattern from Markdown-first output to DB-backed planning records.

## Pipeline

```txt
Planner Orchestrator
  |
  +-- Context Ingest
  +-- Research Agent
  +-- Interview Agent
  +-- Epic Planner Agent
  +-- Task Writer Agent
  +-- Verification Designer Agents
  |     +-- Logic Verification Designer
  |     +-- Visual Verification Designer
  |     +-- Static Verification Designer
  +-- Review Agent
  +-- Operator Approval
  +-- Persistence
```

## Persistence Rule

Planner output begins as proposed state. It is persisted as executable state only after operator approval.

Proposed records may be stored with `status = proposed` for review and replay, but tasks are not executable until their verification plans are approved.

For the current execution slice, planner output should strongly prefer command-backed verification items. Non-command visual or evidence items may still be proposed for future/manual review, but they are not runnable through `POST /executions/:id/test-runs`.

## Planner Outputs

- `PlannerRun`
- `Epic`
- `Task`
- `VerificationPlan`
- `VerificationItem`
- `SourceOfTruthAsset`
- `Approval`

## Review Gates

The review agent checks:

- every task belongs to an epic
- every implementation task has a verification plan
- verification items intended for the current runtime slice are command-backed
- non-command visual and evidence items are flagged as not runnable now
- source assets exist or are explicitly marked pending
- task dependencies are valid
- branch names are deterministic
- no task can execute before approval
- review does not assume MCP-backed verification execution in this slice
