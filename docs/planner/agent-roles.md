# Planner Agent Roles

Core loop: `Planner -> Verification Contract -> Approval -> Execution -> Verified Output`.

## Orchestrator

Coordinates the planner pipeline, owns state transitions, and asks the operator for approval. It does not invent specialist output when a specialist agent should produce it.

Default model slot: `planner_deep`.

## Context Ingest Agent

Reads operator notes, existing docs, paths, candidate tasks, screenshots, PDFs, and constraints. It normalizes them into structured planner context.

Default model slot: `planner_fast`.

## Research Agent

Investigates libraries, current patterns, likely pitfalls, and relevant APIs. For v1 it may use web research and official docs where current information matters.

Default model slot: `research`.

## Interview Agent

Runs the operator interview. It gathers scope, state, integrations, constraints, acceptance criteria, and non-goals.

Default model slot: `planner_fast`.

## Epic Planner Agent

Groups the work into epics with goals, risks, dependencies, and rollup acceptance criteria.

Default model slot: `planner_deep`.

## Task Writer Agent

Splits epics into executable tasks. Each task must be atomic enough for one branch and one verification boundary.

Default model slot: `planner_deep`.

## Verification Designer Agents

Create the verification plan before execution:

- logic and unit tests
- integration tests
- visual source-of-truth checks
- typecheck and lint checks
- accessibility checks
- evidence requirements

Default model slot: `verification_designer`.

## Review Agent

Performs final consistency review before approval. It checks that tasks, verification plans, assets, branch policy, and operator gates are complete.

Default model slot: `reviewer`.

## Operator-Side PM Pack

TaskGoblin also carries a repo-local PM/Jira companion pack under `.claude/agents`.

This pack is documented in [project-manager-pack.md](project-manager-pack.md) and includes:

- `project-manager`
- `pm-codebase-analyst`
- `pm-work-breakdown`
- `pm-sprint-planner`
- `pm-roadmap-planner`
- `pm-jira-operator`

These are operator-side planning agents for discovery, breakdowns, sprint and roadmap planning, and Jira workflows around this repo.

They do not replace the DB-backed planner roles above, they do not change `packages/planner`, and they are not part of the runtime execution loop.
