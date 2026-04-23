# System Overview

Core loop: `Planner -> Verification Contract -> Approval -> Execution -> Verified Output`.

## High-Level Architecture

```txt
OpenTUI CLI
  |
  | HTTP + SSE
  v
Hono API / Loop Orchestrator
  |
  +-- Planner System
  +-- Model Registry
  +-- Policy Engine (complexity + slot resolution)
  +-- Execution Agent (Vercel AI SDK)
  +-- MCP Client Layer
  |     +-- MCP Servers (fs/git, shell, patch, browser, database, HTTP/API)
  +-- Test Runner / Verification
  +-- Evaluation Engine (rule-based + OpenEvals-style judges)
  +-- Regression / Benchmark Engine
  +-- LangSmith Exporter
  +-- Prisma Repository
        |
        v
      SQLite
```

## Runtime Responsibilities

The CLI is the operator console. It renders epics, tasks, verification contracts, branch state, agent events, command-runner output, and patch review actions. Rich visual diff views remain a later slice.

The Hono API owns orchestration. It accepts planner and execution commands, persists state, enforces policy, and streams loop events to the CLI.

The planner system creates proposed epics, tasks, and verification contracts from interviews and project context.

The model registry stores providers, registered models, slot assignments, fallback assignments, and env-backed secret references.

The policy engine scores task complexity, resolves model slots to registered models, enforces capability requirements, enforces retry limits, and blocks unsafe tool usage.

The execution agent executes approved tasks through Vercel AI SDK model calls and MCP tool requests. It receives resolved provider/model decisions from policy and does not mutate files directly.

The MCP client layer discovers allowed MCP tools, validates calls against policy, normalizes results, and logs every tool call.

The test runner executes approved command-backed verification items only. It runs them sequentially, records stdout, stderr, exit code, timing, and result status, and writes deterministic artifacts under `.artifacts/executions/<execution-id>/test-runs/...`. It does not invoke MCP tools in this slice.

The evaluation engine runs after verification and before patch review. It scores planning, execution, outcome correctness, tool usage, security compliance, and regression risk.

The LangSmith exporter optionally mirrors traces, datasets, experiments, and evaluation results. Local SQLite remains canonical.

## Data Flow

1. Operator starts a planner run with a goal.
2. Planner interviews the operator and proposes epics, tasks, and verification plans.
3. Operator approves the plan.
4. API persists approved records to SQLite.
5. Operator starts a task.
6. Policy resolves required model slots to registered models and snapshots the decision.
7. Branch policy creates or switches to the task branch.
8. Executor writes tests or verification files first where applicable.
9. Test runner confirms red or pending verification state for command-backed verification only.
10. Executor implements through approved MCP tools.
11. Test runner verifies green by running approved shell commands, including Playwright CLI when specified as a command.
12. Evaluation engine scores the verified output.
13. If verification or evaluation fails, policy retries or escalates according to configured slots until stop conditions are reached.
14. If verification and evaluation pass, operator reviews and approves the patch.
