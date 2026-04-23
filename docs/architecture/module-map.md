# Module Map

Core loop: `Planner -> Verification Contract -> Approval -> Execution -> Verified Output`.

## Apps

| Module | Responsibility |
|---|---|
| `apps/cli` | OpenTUI operator console. |
| `apps/api` | Hono loop orchestrator and SSE event source. |

## Packages

| Package | Responsibility |
|---|---|
| `packages/shared` | Shared types, IDs, status constants, event contracts. |
| `packages/db` | Prisma client, migrations, repositories. |
| `packages/model-registry` | Provider, model, secret-ref, and slot-assignment repositories. |
| `packages/planner` | Planner orchestration, agent role prompts, interview state. |
| `packages/task-intel` | Complexity, risk, and scope analysis. |
| `packages/policy-engine` | Deterministic model slot resolution, approval rules, tool limits. |
| `packages/verification` | Verification contracts, item validators, source asset metadata. |
| `packages/agent` | Vercel AI SDK runtime provider factory and tool-call loop. |
| `packages/mcp-client` | MCP tool discovery, call forwarding, normalization, and logging. |
| `packages/mcp-server-fs-git` | Filesystem, grep, git status, git diff, and patch tools exposed as MCP. |
| `packages/mcp-server-shell` | Approved shell command execution exposed as MCP. |
| `packages/evaluator` | Rule-based and OpenEvals-style evaluation engine. |
| `packages/benchmarks` | Benchmark scenarios, baselines, and regression comparisons. |
| `packages/observability` | LangSmith export, trace links, and experiment metadata. |
| `packages/test-runner` | Command execution and structured test events. |

## Ownership Boundaries

Planner packages may propose records but do not execute tasks.

Agent packages may request MCP tools but do not directly mutate files.

MCP client and server packages may perform mutations only after branch, allowlist, and approval checks.

Verification packages define success. Executors consume verification contracts; they do not rewrite them during implementation.

Database repositories persist canonical state for all modules.

The model registry persists canonical provider/model/slot configuration. Runtime packages may build Vercel AI SDK provider instances from registry rows, but they must not bypass policy resolution with raw model strings.

Evaluator packages decide whether verified output is good enough for patch review. They cannot weaken verification requirements.
