# Validation Data Model

`Validation` is the first-class task-level acceptance check. It is attached
directly to `Task` and is intended to replace the legacy
`VerificationPlan -> VerificationItem` contract over time.

## Purpose

A validation records one check that must be approved before it is trusted and
then executed or reviewed during task delivery. Examples include unit checks,
Playwright specs, type checks, lint checks, visual checks, evidence review, and
manual acceptance checks.

SQLite v1 stores `testType` and `status` as strings, matching the rest of the
schema. Application code owns validation of those values.

## Core Fields

| Field | Meaning |
|---|---|
| `taskId` | Owning task. |
| `verificationItemId` | Optional legacy `VerificationItem` source during migration. |
| `testType` | Check category such as `logic`, `playwright`, `manual`, or `lint`. |
| `status` | Current lifecycle state. |
| `title` / `description` | Operator-facing check description. |
| `command` | Optional runnable shell command. |
| `testFilePath` | Optional project-relative generated test path. |
| `metadataJson` | Optional structured metadata as JSON text. |
| `approvalId` | Latest approval decision row for approve/reject actions. |
| `lastTaskExecutionId` / `lastTestRunId` | Latest execution context that produced the stored result. |
| `lastExitCode`, `resultSummary`, `resultJson`, `artifactPath` | Latest execution result snapshot. |

## Status Lifecycle

| Status | Meaning |
|---|---|
| `proposed` | Created by planner import, Jira import, a generator, or backfill. Not trusted for execution gates. |
| `approved` | Operator accepted the validation as part of the task contract. |
| `rejected` | Operator rejected the proposed validation. |
| `running` | The validation is currently executing or being evaluated. |
| `passed` | Latest execution satisfied the validation. |
| `failed` | Latest execution failed the validation. |

Normal flow:

1. Create validation as `proposed`.
2. Operator calls approve or reject.
3. Approved validations can be executed.
4. Execution stores `running`, then `passed` or `failed`.
5. A later generated replacement should create a new validation rather than
   mutating the historical check into a different contract.

## Legacy Rollout

The migration backfills one `Validation` row for each existing
`VerificationItem` and stores the old item id in `verificationItemId`.

Backfill maps legacy status values as follows:

| VerificationItem status | Validation status |
|---|---|
| `approved` | `approved` |
| `running` | `running` |
| `green` | `passed` |
| `red` / `failed` | `failed` |
| anything else | `proposed` |

For legacy Playwright-backed verification items, `testType` is stored as
`playwright`; otherwise it uses the legacy `kind`.

## Repository Contract

`validationRepository.ts` provides the foundation methods:

| Method | Effect |
|---|---|
| `listValidationsByTask` | Lists validations for one task with optional `status` and `testType` filters. |
| `createValidation` | Creates a proposed or pre-seeded validation. |
| `getValidation` | Reads one validation by id. |
| `createValidationReviewArtifact` | Creates a `ReviewArtifact` for a validation with markdown containing description, acceptance checklist, test type, and browser approve/reject paths. |
| `approveValidation` | Marks it `approved`, writes an `Approval`, and emits `approval.granted`. |
| `rejectValidation` | Marks it `rejected`, writes an `Approval`, and emits `approval.rejected`. |
| `setValidationExecutionResult` | Stores latest execution fields and moves status to `running`, `passed`, or `failed`. |

## Review Artifacts and Readiness

Validation review artifacts use `subjectType = validation` and `subjectId = Validation.id`.
Approving or rejecting those artifacts writes the `Approval` against the validation,
updates `Validation.status`, `approvalId`, `approvedAt`, and `rejectedAt`, and then
refreshes the owning task readiness.

Readiness is validation-first:

- If a task has no validation rows, readiness falls back to the approved legacy verification plan.
- If a task has validation rows, every validation must be `approved` for the task to be `ready`.
- Any `proposed` or `rejected` validation keeps or downgrades the task to `awaiting_verification_approval`.
