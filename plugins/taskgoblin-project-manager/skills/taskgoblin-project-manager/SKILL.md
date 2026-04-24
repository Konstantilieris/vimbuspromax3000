---
name: taskgoblin-project-manager
description: Operator-side PM planning and Jira workflow routing for the TaskGoblin repository. Use when Codex needs to discover scope, analyze the current codebase, prepare work breakdowns, plan sprints or roadmaps, or stage Jira dry-runs for TaskGoblin changes.
---

# TaskGoblin Project Manager

Ground the workflow in:

- `README.md`
- `docs/architecture/system-overview.md`
- `docs/architecture/module-map.md`
- `docs/planner/planner-pipeline.md`
- `docs/planner/agent-roles.md`
- `docs/verification/verification-contract.md`
- `docs/execution/api-contract.md`

This is operator-side tooling. It does not replace `packages/planner` or change TaskGoblin runtime behavior.

For the deep orchestration prompt, use `../../agents/project-manager.md`.

When local config exists, load it from `.claude/agent-memory/project-manager/`.
