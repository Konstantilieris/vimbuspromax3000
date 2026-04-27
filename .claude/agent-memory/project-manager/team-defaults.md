---
name: team-defaults
description: Starting defaults for sprint planning before real velocity data exists
type: project
---

- **Sprint length:** 2 weeks
- **Team size:** 2 developers (you + 1 codev)
- **Default velocity:** 20 points per sprint (conservative — update after first sprint)
- **Tech debt allocation:** 20% per sprint (4 points)
- **Unplanned work buffer:** 15% per sprint (3 points)
- **Available capacity per sprint:** ~13 points net

**Codebase:** VimbusProMax3000 / TaskGoblin, a Bun + TypeScript workspace with Hono API, OpenTUI CLI, Prisma SQLite persistence, planner, policy, model registry, execution agent, and command-backed test runner packages
**Architecture:** Verification-first execution loop — Planner → Verification Contract → Approval → Execution → Verified Output
**AI engine:** Vercel AI SDK runtime wiring with policy-selected model slots and tool-gated execution

**Jira container project key:** VIM
**Logical project scope:** VimbusProMax3000 / TaskGoblin (project is Vimbus-dedicated; no label filter required)
**Jira site URL:** https://apollonadmin.atlassian.net
**Cloud ID:** a9dc8917-e4cb-48be-bf4f-84b1f381906e

> Note: All numbers above are starting estimates. Update after first sprint retrospective.

## Team Members

- **Nikos Psycharis** — Jira display name "Nikos Psycharis", git email: n.psycharis@outlook.com — collaborator

- **Aggelos Konstantilieris** — Jira display name "Aggelos Konstantilieris", git email: aggeloskonstantilieris@gmail.com — default owner for this repo and dashboard identity

Both developers are capable of any task. Assignment rules (in priority order):

1. Existing Vimbus tickets keep their current assignee unless the user explicitly asks to rebalance

2. Architectural decisions, cross-cutting concerns → assign to Aggelos

3. All other work → assign to whoever has fewer open tickets in Jira (check via JQL before assigning)

4. If workload is equal → split evenly
