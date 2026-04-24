---
name: jira-config
description: Template for local Jira configuration used by the project-manager agent pack
type: reference
---

Use this file as a local, untracked starter for `jira-config.md`.

## Required

- Jira site URL: `<your-site>.atlassian.net`
- Project key: `<PROJECT_KEY>`
- Cloud ID: `<optional-cloud-id>`

## Issue Types

- Epic: `<issue-type-name>`
- Story: `<issue-type-name>`
- Task: `<issue-type-name>`
- Bug: `<issue-type-name>`
- Subtask: `<issue-type-name>`

## Field Constraints

- Story points field: `<field-id or "unsupported">`
- Labels supported: `<yes/no>`
- Sprint assignment supported: `<yes/no>`
- Required custom fields:
  - `<field-name>`: `<field-id or rule>`

## Notes

- Known screen or workflow constraints:
  - `<constraint>`
- Default labels to apply:
  - `<label>`

## How to Apply

- Copy this file to `jira-config.md`.
- Replace every placeholder before any live Jira creation.
- If any required field is unknown, keep Jira work in dry-run mode.
