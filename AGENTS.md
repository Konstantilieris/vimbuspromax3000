# TaskGoblin Agent Notes

## Jira Defaults

Before asking the user for Jira details, read local ignored env files in this order:

1. `.env.local`
2. `.env`

Use `TASKGOBLIN_JIRA_CLOUD_ID` first. If it is empty, use `TASKGOBLIN_JIRA_SITE_URL`.

If the user asks about previous HC work, check these Jira issues by default:

- `HC-76`
- `HC-77`
- `HC-78`
- `HC-86`
- `HC-87`
- `HC-88`
- `HC-89`
- `HC-90`
- `HC-91`

Only ask for Jira target details when both `TASKGOBLIN_JIRA_CLOUD_ID` and `TASKGOBLIN_JIRA_SITE_URL` are absent or empty.

## Slack Defaults

Before asking the user for Slack workspace details, read local ignored env files in this order:

1. `.env.local`
2. `.env`

Use `TASKGOBLIN_SLACK_TEAM_ID` for the default Slack workspace. Use `SLACK_BOT_TOKEN` only from ignored local env files or the configured Slack MCP server environment; never write Slack tokens to tracked files.
