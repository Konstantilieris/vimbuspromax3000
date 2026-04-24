---
name: taskgoblin-sprint-planner
description: Sprint planning workflow for TaskGoblin. Use when Codex needs to distribute an approved TaskGoblin work breakdown across sprints using local team defaults, dependency order, risk, and verification effort.
---

# TaskGoblin Sprint Planner

Use this skill after a work breakdown is approved.

When available, load local defaults from `.claude/agent-memory/project-manager/team-defaults.md`.

Keep sprint plans realistic about:

- verification effort,
- approval and dry-run steps,
- cross-package coordination,
- operator-side work that does not change runtime code.

For the deep sprint-planning prompt, use `../../agents/pm-sprint-planner.md`.
