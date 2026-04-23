# Interview Workflow

Core loop: `Planner -> Verification Contract -> Approval -> Execution -> Verified Output`.

## Purpose

The interview turns an operator goal into structured planning input. It should collect enough detail to generate epics, tasks, and verification plans without guessing high-impact product intent.

## Rounds

### 1. Scope

- What is being built?
- Who uses it?
- What is in scope?
- What is explicitly out of scope?

### 2. Domain and State

- What are the core entities?
- What lifecycle states exist?
- Which transitions are valid?
- Which transitions must be atomic or idempotent?

### 3. Interfaces

- Which CLI screens, API endpoints, files, or workflows are affected?
- Which external systems or libraries matter?
- Which source assets already exist?

### 4. Verification

- What logic tests prove correctness?
- What integration paths must run?
- What visual states need source-of-truth assets?
- What typecheck, lint, and accessibility checks are required?

### 5. Execution Policy

- What is the base branch?
- Should the task auto-create a branch?
- Which model slots should be used?
- Which tools require operator approval?

## Output

The interview produces structured requirements attached to the planner run. In SQLite v1 they are stored on `PlannerRun.interviewJson` as JSON text, while the question/answer history is recorded in `LoopEvent`.

The interview does not directly create executable tasks. The epic planner and task writer consume the interview output and generate proposals.
