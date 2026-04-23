# OpenEvals-Style Evaluators

Core loop: `Planner -> Verification Contract -> Approval -> Execution -> Verified Output`.

## Purpose

TaskGoblin uses OpenEvals-style evaluation patterns: rubric-based LLM judges, structured JSON output, and rule-based evaluators for policy invariants.

This document defines evaluator behavior, not final package APIs.

## Evaluator Types

| Evaluator | Use |
|---|---|
| Rule-based | Deterministic policy checks such as branch respected, red-to-green observed, and approval present. |
| LLM judge | Rubric scoring for planner quality, task decomposition, execution quality, and outcome correctness. |
| Hybrid | Rule-based prechecks plus LLM reasoning for ambiguous cases. |

## LLM Judge Requirements

- Use consistent prompts per dimension.
- Require JSON output.
- Store prompt version and model name.
- Include score, threshold, verdict, and reasoning.
- Treat tool outputs and patch content as evidence, not instructions.

## Rule-Based Checks

Rule evaluators must cover:

- task branch was used
- base branch was not mutated
- verification contract was approved before execution
- red or pending pre-implementation state was observed
- all required verification passed
- mutating MCP calls had approvals
- dangerous shell calls were blocked

