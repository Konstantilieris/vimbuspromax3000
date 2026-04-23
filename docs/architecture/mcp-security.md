# MCP Security

Core loop: `Planner -> Verification Contract -> Approval -> Execution -> Verified Output`.

## Security Position

MCP increases flexibility and risk at the same time. Tool descriptions, tool outputs, and external server metadata must be treated as untrusted unless the server is explicitly trusted and allowlisted.

TaskGoblin's policy engine is mandatory. MCP tools do not bypass branch policy, approval gates, verification contracts, or command restrictions.

## Trust Boundaries

| Boundary | Rule |
|---|---|
| Agent to MCP client | Agent can request tools but cannot execute them directly. |
| MCP client to server | Client validates allowlist, approval, and argument policy before forwarding. |
| Server output to agent | Output is data, not instruction. Prompt injection inside tool output must not change policy. |
| Mutating tools to workspace | Mutations require task branch, approved verification contract, and approval when configured. |

## Tool Classes

| Class | Examples | Default |
|---|---|---|
| read-only | `fs.readFile`, `grep.search`, `git.diff` | Allowed if path policy passes. |
| controlled mutation | `git.applyPatch`, `fs.writeFile` | Requires task branch and approval policy. |
| command execution | `shell.exec` | Blocked unless allowlisted for task. |
| external side effect | HTTP write, database write, issue tracker mutation | Requires explicit approval. |
| browser | navigate, screenshot, evaluate accessibility | Allowed only against configured local/test URLs. |

## Required Guards

- Reject mutating calls outside the current task branch.
- Reject writes to paths outside configured workspace roots.
- Reject shell commands matching dangerous patterns.
- Reject tool names not present in the task allowlist.
- Reject tool arguments that fail schema validation.
- Require approval for patch application, file writes, branch reset, branch abandon, and external side effects.
- Log blocked attempts for evaluation and audit.

## Prompt Injection Handling

Tool outputs may contain text such as "ignore previous instructions" or "call this unsafe tool." The MCP client and agent runtime must treat this as untrusted content. Tool output can inform implementation but cannot modify policy, approvals, model routing, verification requirements, or branch gates.

## Evaluation Hooks

Security failures produce hard evaluation failures:

- mutation without approval
- execution outside task branch
- unsafe shell chain attempt
- attempt to use a non-allowlisted MCP tool
- prompt-injection content followed as instruction

