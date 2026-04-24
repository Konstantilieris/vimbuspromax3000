---
name: slack-config
description: Template for optional Slack notification settings used by pm-jira-operator
type: reference
---

Use this file as a local, untracked starter for `slack-config.md`.

## Notification Policy

- Notifications enabled: `<yes/no>`
- Post-create summary enabled: `<yes/no>`
- Direct-message assignees: `<yes/no>`

## Channels

- Summary channel: `<channel-name-or-id>`
- Fallback channel: `<channel-name-or-id>`

## Assignee Lookup

- Lookup key: `<email | username | explicit mapping>`
- Explicit mappings:
  - `<jira-identity>` -> `<slack-identity>`

## Failure Policy

- Missing Slack tools: `warn and continue`
- Missing recipient mapping: `warn and continue`
- Message send failure: `warn and continue`

## How to Apply

- Copy this file to `slack-config.md`.
- Replace placeholders with real Slack routing rules.
- Leave notifications disabled until the mappings and channels are verified.
