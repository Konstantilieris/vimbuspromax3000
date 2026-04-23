# CLI Design

Core loop: `Planner -> Verification Contract -> Approval -> Execution -> Verified Output`.

## Layout

```txt
+----------------------+---------------------------+----------------------+
| Epics / Tasks        | Control Panel             | Eval / Tools / Logs  |
|                      |                           |                      |
| Epic A               | Selected Task             | eval.result          |
|  A1 ready            | Verification Contract     | mcp.tool.completed   |
|  A2 executing        | Branch + Model            | patch.ready          |
| Epic B               | Approval Actions          | regression.blocked   |
+----------------------+---------------------------+----------------------+
```

## Primary Views

| View | Purpose |
|---|---|
| Tasks | Browse epics, tasks, statuses, dependencies, and branch state. |
| Planner | Run interview, review proposed epics/tasks, approve plan. |
| Verification | Inspect verification plan, source assets, commands, routes, and evidence. |
| Execution | Watch agent steps, tool calls, branch state, and current patch. |
| MCP Tools | Inspect discovered tools, allowlist status, blocked calls, latency, and failures. |
| Models | Show providers, registered models, slot assignments, fallback assignments, selected model slot, attempt number, escalation reason, and stop condition. |
| Tests | Live stdout/stderr and result history. |
| Evaluation | Show dimension scores, thresholds, verdicts, and retry/escalation decisions. |
| Regression | Show benchmark baseline comparison and blocking regression details. |
| Patch Review | Diff summary, files changed, approval/reject actions. |

## Commands

| Command | Action |
|---|---|
| `/plan` | Start or resume planner run. |
| `/approve:plan` | Approve planner output for persistence/execution. |
| `/approve:verification` | Approve selected task verification plan. |
| `/execute` | Start selected ready task. |
| `/test` | Run selected task verification. |
| `/eval` | Run or view evaluation for the current execution. |
| `/mcp:tools` | Show task-allowed MCP tools. |
| `/mcp:calls` | Show MCP call history. |
| `/model:decisions` | Show model routing and retry decisions. |
| `/models` | Show provider, model, slot, and fallback configuration. |
| `/models:add-provider` | Register a Vercel AI SDK provider configuration using an env secret reference. |
| `/models:add-model` | Register a model under a provider with declared capabilities. |
| `/models:assign-slot` | Assign a registered model and optional fallback to a slot. |
| `/models:test` | Validate provider config and slot resolution without spending tokens by default. |
| `/models:setup` | Bootstrap project, provider, model, and slot assignment through the API. |
| `/benchmark` | Run selected benchmark scenario. |
| `/regression` | Compare a run against baseline. |
| `/branch:diff` | Show current task branch diff. |
| `/branch:commit` | Commit approved patch. |
| `/branch:abandon` | Mark branch abandoned. |
| `/patch:approve` | Approve current patch. |
| `/patch:reject` | Reject current patch with reason. |

## Display Rules

The CLI must always show the selected task's branch name, base branch, verification status, and next required approval.

The CLI must not hide failed checks. Failures are the main product surface.

## Models View

The Models view displays:

- provider key, label, provider kind, approval status, runtime status, and secret reference label
- registered model name, slug, enabled state, cost/speed/reasoning tiers, and capabilities
- all default slots, primary assignments, fallback assignments, and unresolved-slot failures
- selected task slot requirements and the policy preview result

Setup flow:

1. Register or choose an env secret reference.
2. Register a provider kind supported by Vercel AI SDK.
3. Register one or more models manually or from gateway discovery.
4. Assign primary and fallback models to project slots.
5. Run `/models:test` to verify deterministic resolution.
