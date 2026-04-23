# Regression System

Core loop: `Planner -> Verification Contract -> Approval -> Execution -> Verified Output`.

## Purpose

The regression system prevents TaskGoblin from getting worse as planner prompts, policies, MCP servers, and evaluator rubrics evolve.

## Baselines

A regression baseline stores:

- benchmark scenario id
- run id
- aggregate score
- dimension scores
- tool sequence summary
- verification result summary
- model decision summary
- accepted timestamp

## Comparison

New runs compare against the active baseline.

Regression checks include:

- aggregate score delta
- hard-fail dimension failure
- tool usage quality drop
- added unsafe tool attempts
- verification quality drop
- increased retry count
- model cost increase without score improvement

## Blocking Rules

Regression gates block promotion when:

- any hard-fail dimension regresses to fail
- aggregate score drops below configured tolerance
- unsafe MCP call attempts appear
- verification passes but outcome correctness drops below threshold

