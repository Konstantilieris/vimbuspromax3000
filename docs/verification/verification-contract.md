# Verification Contract

Core loop: `Planner -> Verification Contract -> Approval -> Execution -> Verified Output`.

## Definition

A verification contract is the approved definition of success for a task.

Execution cannot start until the task has an approved verification plan containing one or more verification items.

In the current backend slice, `POST /executions/:id/test-runs` runs only approved verification items that have a non-empty `command`.

## Verification Item Kinds

| Kind | Purpose |
|---|---|
| `logic` | Unit-level assertions, usually Vitest/Jest. |
| `integration` | Multi-module or API behavior. |
| `visual` | Screenshot, image, PDF, layout, or pixel comparison against source-of-truth assets. |
| `typecheck` | TypeScript compiler or equivalent static type gate. |
| `lint` | ESLint or formatting/static policy gate. |
| `a11y` | Accessibility checks such as focus, keyboard flow, ARIA, and axe. |
| `evidence` | Human-reviewable proof such as logs, network payloads, screenshots, or DB rows. |

## Statuses

| Status | Meaning |
|---|---|
| `proposed` | Generated but not approved. |
| `approved` | Operator approved the item. |
| `red` | Expected failing state was observed before implementation. |
| `running` | Verification is currently running. |
| `green` | Verification passed. |
| `failed` | Verification failed. |
| `skipped` | Operator-approved skip with reason. |

## Contract Fields

```ts
type VerificationItem = {
  id: string
  taskId: string
  kind: 'logic' | 'integration' | 'visual' | 'typecheck' | 'lint' | 'a11y' | 'evidence'
  runner?: 'vitest' | 'jest' | 'playwright' | 'tsc' | 'eslint' | 'custom'
  title: string
  description: string
  rationale: string
  command?: string
  testFilePath?: string
  route?: string
  interaction?: string
  expectedAssetId?: string
  status: string
}
```

SQLite v1 stores structured payload fields that vary by kind as JSON text columns.

## Current Execution Slice

- The command runner evaluates only approved items from the latest approved verification plan for the execution's task.
- `kind` is descriptive metadata. It does not grant executability by itself.
- `runner` is a hint for planners and operators. It does not grant executability by itself.
- `visual` and `evidence` items are not runnable through `POST /executions/:id/test-runs` unless they are command-backed.
- Playwright is currently supported only as a CLI command stored in `command`, such as `pnpm playwright test` or `bunx playwright test`.
- This route does not open MCP tool sessions or browser automation. MCP-backed visual verification is a later slice.
- If the latest approved plan has zero approved items, or any approved item has a blank command, the route rejects the whole run with `422`.
