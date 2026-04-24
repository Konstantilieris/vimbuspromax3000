---
name: jira-config
description: VimbusProMax3000 Jira configuration — issue types, field constraints, site URL, and logical project scope
type: reference
---

Jira site: apollonadmin.atlassian.net
Jira container project key: HC
Logical project: VimbusProMax3000 / TaskGoblin
Cloud ID: a9dc8917-e4cb-48be-bf4f-84b1f381906e

**Vimbus issue scope JQL:**
`project = HC AND (labels in (vimbuspromax3000, taskgoblin) OR summary ~ "Vimbus" OR text ~ "Vimbus" OR summary ~ "VimbusProMax3000" OR text ~ "VimbusProMax3000")`

**Aggelos open Vimbus dashboard JQL:**
`project = HC AND assignee = "Aggelos Konstantilieris" AND statusCategory != Done AND (labels in (vimbuspromax3000, taskgoblin) OR summary ~ "Vimbus" OR text ~ "Vimbus" OR summary ~ "VimbusProMax3000" OR text ~ "VimbusProMax3000") ORDER BY priority DESC, updated DESC`

**Available issue types:** Epic, Story, Task, Bug, Subtask

**Field constraints:**
- `story_points` field is NOT available on the HC project screen — do not include in `additional_fields`
- Story point estimates should be noted in the description body instead
- Labels are supported

**How to apply:** When creating Vimbus issues, create them in Jira project `HC`, add labels `vimbuspromax3000` and `taskgoblin`, use `apollonadmin.atlassian.net` as cloudId, and never include `story_points` in additional_fields.
