---
name: jira-config
description: Vimbus Jira configuration — project key, issue types, field constraints, site URL, cloud ID
type: reference
---

Jira site: apollonadmin.atlassian.net
Jira container project key: VIM
Project id: 10099
Logical project: VimbusProMax3000 / TaskGoblin
Cloud ID: a9dc8917-e4cb-48be-bf4f-84b1f381906e
Project style: team-managed (next-gen software)

**Vimbus issue scope JQL:**
`project = VIM`

**Aggelos open Vimbus dashboard JQL:**
`project = VIM AND assignee = "Aggelos Konstantilieris" AND statusCategory != Done ORDER BY priority DESC, updated DESC`

**Available issue types:** Epic, Story, Task, Bug, Subtask, Feature

**Field constraints (verified via `getJiraIssueTypeMetaWithFields` against Epic/Story/Task/Bug create screens):**
- Story points: set via `customfield_10016` ("Story point estimate", number) — available on every checked issue type
- Sprint custom field `customfield_10020` exists on the create screen for every checked issue type, but **the Vimbus team does not use it.** Sprint membership is tracked via the `sprint-N` label convention (`sprint-5`, `sprint-6`, `sprint-7`, etc.). JQL `project = VIM AND sprint is not EMPTY` returns 0 issues across the project's history (verified 2026-04-29). When filing Vimbus tickets, apply the appropriate `sprint-N` label and omit `customfield_10020` from create payloads.
- Start date: `customfield_10015`; Team: `customfield_10001`; Flagged: `customfield_10021` (allowed value: "Impediment")
- `priority` is NOT on the create screen for any VIM issue type — omit it from create payloads (VIM is a team-managed project)
- Issue-type divergence: `parent` is available on Story/Task/Bug but NOT Epic; `customfield_10017` (Issue color) is Epic-only
- Labels are supported (optional; the project is Vimbus-dedicated, no label-based scoping required)
- Do not assume any other custom field is on the create screen without re-verifying via `getJiraIssueTypeMetaWithFields`

**How to apply:** When creating Vimbus issues, create them in Jira project `VIM`, use `apollonadmin.atlassian.net` as cloudId, set story points via `customfield_10016`, omit `priority` from create payloads, and don't assume any other field that hasn't been verified. No label filter is needed because VIM is dedicated to Vimbus work.

**Historical note:** Vimbus MVP work HC-76 through HC-99 originally lived in the multi-tenant `HC` (Holocomm) project, scoped via the labels `vimbuspromax3000` and `taskgoblin`. Those tickets remain closed in HC; all new Vimbus work goes to VIM.
