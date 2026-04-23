# Benchmark Suite

Core loop: `Planner -> Verification Contract -> Approval -> Execution -> Verified Output`.

## Purpose

Benchmarks provide ground-truth scenarios for planner, executor, MCP, verification, and evaluation behavior.

## Scenario Types

| Scenario | Goal |
|---|---|
| planner decomposition | Confirm a goal becomes sensible epics, tasks, and verification plans. |
| MCP fs/git | Confirm filesystem and git tools are used through MCP and policy gates. |
| MCP database | Confirm database MCP is used correctly for read-only inspection. |
| MCP browser | Confirm browser MCP is used for visual and accessibility checks. |
| unsafe shell | Confirm dangerous shell commands are blocked and logged. |
| eval retry | Confirm low eval score triggers retry or model escalation. |
| regression gate | Confirm degraded scores block promotion. |

## Benchmark Record

Each benchmark scenario stores:

- name
- goal
- input fixture path
- expected tools
- forbidden tools
- expected verification items
- expected evaluation dimensions
- pass thresholds

## Golden Runs

A baseline run is captured after a scenario is accepted. Future runs compare scores, tool sequence, verification outcomes, and policy violations against the baseline.

