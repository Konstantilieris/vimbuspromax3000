---
name: taskgoblin-codebase-analyst
description: Codebase analysis workflow for the TaskGoblin repository. Use when Codex needs to inspect affected apps, packages, docs, ownership boundaries, verification impact, or technical risk before planning TaskGoblin work.
---

# TaskGoblin Codebase Analyst

Analyze TaskGoblin using the canonical repo docs first:

- `README.md`
- `docs/architecture/system-overview.md`
- `docs/architecture/module-map.md`
- `docs/verification/verification-contract.md`
- `docs/execution/api-contract.md`

Treat `apps/`, `packages/`, and `docs/` as the primary analysis surfaces.

For the deep analyst prompt, use `../../agents/pm-codebase-analyst.md`.
