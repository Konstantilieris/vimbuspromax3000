# Audit Gap Closure Execution Plan

This plan closes six audit gaps: project picker, validation entity, keyboard layer, Playwright generation, execution gate, and Jira import.

## Working Assumptions

1. Promote `VerificationItem` semantics into a new first-class `Validation` table attached directly to `Task`. Keep `VerificationPlan` as a legacy compatibility layer during migration.
2. Use one validation status lifecycle: `proposed`, `approved`, `rejected`, `running`, `passed`, `failed`.
3. Stage generated Playwright specs at `apps/api/.artifacts/staging/playwright/<taskId>/<validationId>.spec.ts`. Move approved specs to `<project.rootPath>/tests/generated/<taskId>/<validationId>.spec.ts`.
4. `/execution:start` accepts both positional `<task-id>` and `--task-id`; the positional form is documented.
5. Keyboard model: `F1`-`F4` for pane switching, arrow keys plus `Enter` for list navigation, `Ctrl+K` for command palette, and `?` for help.
6. Jira import defaults to Jira Epic to `Epic`, Story/Task to `Task`, and a configurable acceptance-criteria field to `Validation[]`.
7. Jira import creates a `PlannerRun`, persists Epic/Task/Validation rows, then surfaces one `ReviewArtifact` for human approval before task readiness.

## Explicitly Out Of Scope

- Renaming package constants from `VimbusProMax3000` to `TaskGoblin`.
- Decomposing `apps/api/src/app.ts` into route modules.
- Consolidating duplicated CLI helpers.
- Cleaning stale documentation unrelated to this audit.

## Dependency Order

1. E1 Project picker and E2 keyboard layer can start immediately.
2. E3 Validation is the keystone for E4, E5, and E6.
3. E4 Playwright generation and E5 execution gate start after E3 foundation lands.
4. E6 Jira import starts after E3 and should merge after E5 gate semantics are present.

## Workstreams

### Workstream A: Project Picker And Cold Start

- Add `GET /projects/lookup?rootPath=...` with normalized path lookup.
- Make `POST /projects` idempotent by normalized `rootPath`.
- Add pure TUI picker state machine in `apps/cli/src/projectPicker.ts`.
- Add synchronous folder browser in `apps/cli/src/folderBrowser.ts`.
- Add local user state persistence in `apps/cli/src/userState.ts`.
- Wire startup to last-selected project, falling back to picker.
- Polish `/projects:create` so no-arg interactive use opens the folder browser.

### Workstream B: Keyboard Input Layer

- Add `apps/cli/src/keyDispatcher.ts`.
- Add central focus state in `apps/cli/src/focus.ts`.
- Wire OpenTUI or raw stdin key events into the dispatcher.
- Register `F1`-`F4` pane focus shortcuts.
- Add command palette from the slash-command registry.
- Wire existing live-view notification key handling.
- Add help overlay generated from dispatcher registrations.

### Workstream C: Validation Entity

- Add `Validation`, `ValidationTestType`, and `ValidationStatus` to Prisma.
- Add idempotent backfill from legacy `VerificationItem`.
- Add `validationRepository.ts` with list, create, get, approve, reject, and execution-result methods.
- Add validation API routes.
- Update planner persistence to write both legacy verification items and new validations.
- Add validation review artifacts.
- Add CLI validation commands.
- Derive task readiness from validations, with a legacy fallback.
- Document the entity in `docs/data/validation.md`.

### Workstream D: Playwright Spec Generation

- Add Playwright generator agent and system prompt.
- Add staging-file utilities.
- Add structured `ReviewArtifact.payloadJson`.
- Render code review artifacts in the browser.
- On artifact approval, move the staged spec into the project tree and update `Validation.testFilePath`.
- Add API and CLI generation commands.
- Teach the test runner to run approved Playwright validation specs.

### Workstream E: Execution Gate

- Replace legacy-only verification checks with validation-aware gate logic.
- Add serializable `ValidationGateError`.
- Return `412 Precondition Failed` from the API for validation-gate failures.
- Support positional task id in `/execution:start`.
- Format gate failures clearly in CLI output.

### Workstream F: Jira Import

- Add `packages/jira-adapter`.
- Add configurable Jira-to-internal mapping.
- Add Jira issue keys to `Epic` and `Task`, and Jira mapping JSON to `Project`.
- Upsert imported data idempotently and generate validations from acceptance criteria.
- Add import API and CLI commands.
- Add import summary review artifact.

## Global Definition Of Done

- All new unit and integration tests pass.
- `bun run typecheck` passes.
- A fresh user can start the API and TUI, choose or create a project, generate a plan, approve it, approve validations, and start execution.
- A Jira epic can be imported into a planner run with validations and a summary review artifact.
- A Playwright validation can generate, review, approve, move, and run a spec.

## Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| OpenTUI key API is insufficient | Keep dispatcher independent and fall back to raw stdin wiring. |
| Validation and legacy verification drift | Centralize dual-write in repository and planner persistence code. |
| Generated Playwright specs are imperfect | Require review before moving files into the project tree. |
| Jira API rate limits | Keep v1 import simple and add bounded retry/backoff in the adapter. |
| Filesystem errors during artifact approval | Surface clear errors and leave enough metadata to retry staging or approval. |
