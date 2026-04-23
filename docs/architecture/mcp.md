# MCP Architecture

Core loop: `Planner -> Verification Contract -> Approval -> Execution -> Verified Output`.

## Purpose

TaskGoblin uses MCP to standardize the tool layer. The execution agent does not call local filesystem, git, shell, browser, or database helpers directly. It requests tools through the MCP client layer, and the policy engine decides which tools are available for the current task.

## Roles

| Role | TaskGoblin meaning |
|---|---|
| MCP host | TaskGoblin API and execution orchestrator. |
| MCP client | Runtime bridge inside `packages/mcp-client`. |
| MCP servers | Tool providers such as fs/git, shell, patch, browser, database, and HTTP/API servers. |
| Execution agent | Model-driven worker that receives an allowlisted tool catalog. |

## Runtime Flow

```txt
Execution Agent
  |
  v
MCP Client Layer
  |
  +-- list allowed tools
  +-- call tool with validated arguments
  +-- normalize result / error
  v
MCP Servers
  |
  +-- fs/git
  +-- shell
  +-- patch
  +-- browser/playwright
  +-- database
  +-- HTTP/API
```

## V1 Server Set

| Server | Tools |
|---|---|
| `taskgoblin-fs-git` | read file, grep, git status, git diff, apply patch. |
| `taskgoblin-shell` | approved command execution. |
| `taskgoblin-browser` | browser navigation, screenshot capture, accessibility checks. |
| `taskgoblin-db` | read-only project database inspection for planner/evaluator tasks. |

Implementation must verify exact SDK APIs and transport details against the official MCP TypeScript SDK before writing code. These docs define the architecture and contracts, not final SDK call signatures.

## Tool Discovery

At task start, the runtime asks the MCP client layer for tools allowed by the task policy. The agent only sees that filtered catalog.

Tool catalog entries must include:

- tool name
- server name
- input schema
- description
- mutability classification
- approval requirement
- task allowlist status

## Tool Call Logging

Every MCP tool call writes an `McpToolCall` record with:

- server and tool
- normalized arguments hash
- mutability classification
- approval id when required
- status
- latency
- result summary
- error summary

These records feed the `tool_usage_quality` evaluation dimension.

