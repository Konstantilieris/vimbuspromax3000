# Product Principles

Core loop: `Planner -> Verification Contract -> Approval -> Execution -> Verified Output`.

## Verification Before Execution

Every implementation task requires an approved verification contract before any code mutation is allowed.

The contract defines what will be checked: logic tests, integration tests, visual source-of-truth assets, typecheck, lint, accessibility, and evidence.

## Structured Plans Are Canonical

The database is canonical for planning and execution state.

Generated Markdown may be used for human review, Git history, and audit reports, but runtime decisions come from structured records.

## Agents Do Not Define Success

Planner agents may propose epics, tasks, tests, and visual checks. The operator approves them. Executor agents must satisfy the approved contract and cannot redefine it while executing.

## No Mutation Without Boundary and Approval

Agents can read freely through approved read tools. Mutating tools require explicit boundaries:

- task branch exists
- current branch matches the task branch
- verification contract is approved
- tool call policy allows the action
- operator approval exists when required

## Everything Is Observable

Every planner decision, approval, tool call, branch state change, test run, patch, and failure is stored as structured state and emitted as a loop event.

## MCP Is a Tool Boundary

MCP standardizes tools, but it does not relax safety. MCP tool discovery, argument validation, allowlists, branch checks, and approvals are policy-controlled before any tool call reaches a server.

## Evaluation Before Patch Review

Verification passing is necessary but not sufficient. The evaluation engine checks outcome quality, tool usage, security policy compliance, and regression risk before patch review is allowed.

## Task Isolation

Each task is an isolated execution unit backed by its own git branch.

V1 uses one working tree and switches branches. Later versions create one git worktree per task.

## Test-Driven Bulk Code

For implementation work, the execution loop must create or select verification first, confirm a red or pending state where applicable, implement, and then prove green before patch approval.
