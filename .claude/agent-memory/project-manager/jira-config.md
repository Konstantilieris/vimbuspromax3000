---
name: jira-config
description: Vimbus Jira configuration — project key, issue types, field constraints, site URL, cloud ID
type: reference
---

Jira site: apollonadmin.atlassian.net
Jira container project key: VIM
Logical project: VimbusProMax3000 / TaskGoblin
Cloud ID: a9dc8917-e4cb-48be-bf4f-84b1f381906e
Project style: team-managed (next-gen software)

**Vimbus issue scope JQL:**
`project = VIM`

**Aggelos open Vimbus dashboard JQL:**
`project = VIM AND assignee = "Aggelos Konstantilieris" AND statusCategory != Done ORDER BY priority DESC, updated DESC`

**Available issue types:** Epic, Story, Task, Bug, Subtask, Feature

**Field constraints:**
- `story_points` field is NOT available on the VIM project screen — do not include in `additional_fields`
- Story point estimates should be noted in the description body instead
- Labels are supported (optional; the project is Vimbus-dedicated, no label-based scoping required)

**How to apply:** When creating Vimbus issues, create them in Jira project `VIM`, use `apollonadmin.atlassian.net` as cloudId, and never include `story_points` in additional_fields. No label filter is needed because VIM is dedicated to Vimbus work.

**Historical note:** Vimbus MVP work HC-76 through HC-99 originally lived in the multi-tenant `HC` (Holocomm) project, scoped via the labels `vimbuspromax3000` and `taskgoblin`. Those tickets remain closed in HC; all new Vimbus work goes to VIM.
