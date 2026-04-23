# Model Selection Policy

Core loop: `Planner -> Verification Contract -> Approval -> Execution -> Verified Output`.

## Runtime Adapter

VimbusProMax3000 uses the Vercel AI SDK as the runtime model adapter layer. The local database registry remains authoritative for determinism: planner and executor code ask for a slot, the policy engine resolves that slot to a registered provider/model pair, and the agent runtime converts the resolved pair into a Vercel AI SDK model object.

Supported v1 provider kinds:

| Provider kind | AI SDK package |
|---|---|
| `gateway` | `@ai-sdk/gateway` |
| `openai` | `@ai-sdk/openai` |
| `anthropic` | `@ai-sdk/anthropic` |
| `openai_compatible` | `@ai-sdk/openai-compatible` |
| `ollama` | `@ai-sdk/openai-compatible` with a local base URL |

Secrets are stored as environment-variable references only. Database records may contain `OPENAI_API_KEY` or `AI_GATEWAY_API_KEY` as reference names, but never secret values.

## Model Slots

VimbusProMax3000 uses role slots instead of hardcoded model names:

| Slot | Use |
|---|---|
| `planner_fast` | Low-latency planning, normalization, and simple decomposition. |
| `planner_deep` | Complex plan synthesis and high-risk task decomposition. |
| `research` | Documentation and ecosystem research. |
| `verification_designer` | Test, evidence, and source-of-truth planning. |
| `executor_default` | Normal task execution. |
| `executor_strong` | High-complexity execution and repair. |
| `reviewer` | Final consistency and patch review. |
| `vision` | Screenshot, visual, and multimodal analysis. |

Each project has one `ProjectModelSlot` row per default slot. Slots can point to a primary `RegisteredModel` and an optional fallback `RegisteredModel`.

## Registry Records

The model registry is made of:

- `ModelProvider`: provider key, label, base URL, auth mode, secret ref, status, and approval state.
- `RegisteredModel`: provider-owned model id plus capability metadata.
- `ProjectModelSlot`: project slot assignment and optional fallback.
- `ProjectSecretRef`: env-var-backed secret reference.

## Complexity Inputs

The policy engine may score:

- estimated file count
- dependency count
- touched layers
- state changes
- frontend/backend/fullstack domain
- migration/auth/payment/security keywords
- MCP tool risk
- verification breadth

## Resolution

Slot resolution is deterministic:

1. Load the project slot row.
2. Check the primary registered model.
3. If the primary is unavailable or lacks a required capability, check the fallback.
4. Fail with a typed policy error if neither model is valid.

Required capabilities are enforced before any model call:

| Capability | Required by |
|---|---|
| `tools` | Agent steps that expose MCP or structured tools. |
| `json` | Planner, verification, reviewer, and policy-preview structured output. |
| `vision` | Visual verification and screenshot analysis. |
| `streaming` | Interactive CLI streaming views. |

Fallback usage is explicit. The engine emits `model.fallback.used` and records the fallback model in the execution snapshot.

## Stop Conditions

The execution loop stops when:

- max attempts is reached
- same evaluation dimension fails repeatedly
- verification failure is not changing across attempts
- hard policy violation occurs
- operator rejects the retry

## Persistence

Every execution stores `policyJson`, `retryCount`, and `ModelDecision` records. Every `AgentStep` stores the concrete resolved provider/model string in `modelName`. This allows deterministic replay and later evaluation of whether model routing was efficient.
