---
name: taskgoblin-jira-operator
description: Jira dry-run and ticket-creation workflow for TaskGoblin. Use when Codex needs to turn an approved TaskGoblin work breakdown into Jira items safely, with dry-run-first behavior and optional non-blocking Slack notifications.
---

# TaskGoblin Jira Operator

Default to dry-run. Only allow live Jira creation when the caller explicitly chooses create mode.

Requirements for live Jira work:

- Atlassian authentication through the plugin `.mcp.json` scaffold
- `.claude/agent-memory/project-manager/jira-config.md`

Slack is placeholder-only by default:

- active Slack MCP config is not shipped here,
- example scaffolding lives at `../../references/slack-mcp.example.json`,
- missing Slack config or tools must only produce warnings.

For the deep Jira-operator prompt, use `../../agents/pm-jira-operator.md`.
