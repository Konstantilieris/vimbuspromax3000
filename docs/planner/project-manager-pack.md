# Project Manager Pack

Core loop: `Planner -> Verification Contract -> Approval -> Execution -> Verified Output`.

## Purpose

The project-manager pack is a repo-local operator workflow stored under `.claude/agents`.

It exists to help an operator:

- discover scope,
- analyze the current codebase,
- turn work into epics, stories, and tasks,
- plan sprints and roadmaps,
- run Jira dry-runs,
- create Jira tickets only after explicit approval.

This pack is separate from TaskGoblin's product runtime. It is a planning companion for humans operating on this repo.

## Relationship To The DB-Backed Planner

TaskGoblin's product planner lives in `packages/planner` and persists proposed epics, tasks, and verification plans through the API and database.

The project-manager pack does **not** replace that runtime behavior.

It is an operator-side layer for PM-style planning and Jira workflows:

- it does not change `packages/planner`,
- it does not add runtime APIs,
- it does not add database schema,
- it does not become part of the execution loop in `packages/agent`.

Use the DB-backed planner when you want TaskGoblin-native planning records.

Use the project-manager pack when you want operator-driven planning, delivery breakdowns, sprint plans, roadmaps, or Jira operations around the repo.

## Source Of Truth

`.claude/agents` is the authoring source of truth for this pack.

The native Codex plugin mirrors the six PM agents under `plugins/taskgoblin-project-manager/agents`, but the source files that should be edited first live under `.claude/agents`.

## Source Pack Layout

Committed agent files:

- `.claude/agents/project-manager.md`
- `.claude/agents/pm-codebase-analyst.md`
- `.claude/agents/pm-work-breakdown.md`
- `.claude/agents/pm-sprint-planner.md`
- `.claude/agents/pm-roadmap-planner.md`
- `.claude/agents/pm-jira-operator.md`

Committed scaffolding:

- `.claude/agent-memory/project-manager/MEMORY.md`
- `.claude/agent-memory/project-manager/jira-config.template.md`
- `.claude/agent-memory/project-manager/team-defaults.template.md`
- `.claude/agent-memory/project-manager/slack-config.template.md`

Optional local, untracked config:

- `.claude/agent-memory/project-manager/jira-config.md`
- `.claude/agent-memory/project-manager/team-defaults.md`
- `.claude/agent-memory/project-manager/slack-config.md`

## Native Codex Mirror

Repo-local native Codex packaging lives at `plugins/taskgoblin-project-manager`.

It includes:

- mirrored plugin agents under `plugins/taskgoblin-project-manager/agents`
- native discovery skills under `plugins/taskgoblin-project-manager/skills`
- plugin manifest at `plugins/taskgoblin-project-manager/.codex-plugin/plugin.json`
- Atlassian MCP scaffold at `plugins/taskgoblin-project-manager/.mcp.json`
- Slack placeholder scaffolding at `plugins/taskgoblin-project-manager/references/slack-mcp.example.json`

The repo-local marketplace entry for that plugin lives at `.agents/plugins/marketplace.json`.

Native plugin behavior is split on purpose:

- plugin `agents/` are the mirrored deep prompts
- plugin `skills/` are the thin native Codex discovery and routing layer

This mirror does not change product runtime behavior. It packages the same operator-side workflow in a native Codex format.

## Expected Flow

Normal operator flow:

1. Discovery through `project-manager`
2. Codebase analysis through `pm-codebase-analyst`
3. Work breakdown through `pm-work-breakdown`
4. User approval of the exact breakdown
5. Jira dry-run through `pm-jira-operator`
6. User approval of the dry-run result
7. Live Jira creation through `pm-jira-operator` in `Mode: create`

Optional branches:

- sprint planning through `pm-sprint-planner`
- roadmap planning through `pm-roadmap-planner`

## External Connectors

Live Jira creation depends on Atlassian tools being installed, discoverable, and authenticated.

The native Codex plugin ships an active Atlassian scaffold in `plugins/taskgoblin-project-manager/.mcp.json` pointing at `https://mcp.atlassian.com/v1/mcp`.

Optional Slack notifications depend on:

- a verified Slack MCP configuration outside the default plugin `.mcp.json`,
- Slack tools being installed and discoverable,
- `slack-config.md` existing,
- Slack notifications being explicitly enabled there.

Slack stays placeholder-only by default. The native plugin ships only an example scaffold at `plugins/taskgoblin-project-manager/references/slack-mcp.example.json`.

If those connectors are missing, planning still works. Live operational steps must fail closed.

## Jira Safety Defaults

The pack enforces a dry-run-first rule:

- `pm-jira-operator` defaults to `Mode: dry-run` when the mode is missing,
- live Jira writes only happen when `Mode: create` is set explicitly,
- missing Jira config or missing Atlassian tools blocks live creation,
- the operator must approve the breakdown before dry-run, then approve the dry-run before create.

No prompt in this pack assumes:

- a project key,
- a Jira site URL,
- a story points field,
- a sprint board,
- a default channel for Slack.

## Slack Behavior

Slack is not a standalone planning agent in this repo.

It remains an optional post-create notification step owned by `pm-jira-operator`.

Rules:

- Slack only runs after successful Jira creation,
- Slack only runs when `slack-config.md` exists and enables notifications,
- Slack failures are warnings,
- Slack failures do not roll back Jira creation.

The native plugin intentionally does not add Slack to its active `.mcp.json` until a real connector target is chosen.

## Bootstrapping Local Config

1. Copy each template to its live local filename:
   - `jira-config.template.md` -> `jira-config.md`
   - `team-defaults.template.md` -> `team-defaults.md`
   - `slack-config.template.md` -> `slack-config.md`
2. Replace placeholders with real project-specific values.
3. Leave unknown fields blank or marked unsupported.
4. Keep Jira in dry-run mode until the Jira config is complete.
5. Keep Slack disabled until mappings and channels are verified.

## When To Use This Pack

Use it when the work is primarily operator-side planning or Jira coordination.

Do not confuse it with:

- `packages/planner` proposal generation,
- `apps/api` planner routes,
- `packages/agent` execution behavior,
- `packages/test-runner` verification execution.
