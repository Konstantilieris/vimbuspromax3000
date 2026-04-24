# TaskGoblin Documentation

TaskGoblin is a terminal-native, test-first, DB-backed execution system.

Core loop: `Planner -> Verification Contract -> Approval -> Execution -> Verified Output`.

## Reading Order

1. `product/prd.md` - product definition, MVP scope, and success metrics.
2. `product/principles.md` - operating rules that every subsystem must preserve.
3. `architecture/system-overview.md` - CLI, API, planner, policy, MCP, verification, evaluation, and observability.
4. `planner/planner-pipeline.md` - planner flow based on the existing Dilos planner skill, upgraded to DB-backed records.
5. `planner/project-manager-pack.md` - repo-local operator PM/Jira companion pack under `.claude/agents` plus native Codex mirror packaging.
6. `verification/verification-contract.md` - first-class verification model for logic, visual, static, and evidence checks.
7. `evaluation/evaluation-contract.md` - evaluation gate after verification and before patch review.
8. `architecture/mcp.md` - MCP-standardized tool layer.
9. `policy/model-selection.md` - adaptive model routing and retry escalation.
10. `data/prisma-schema-proposal.md` - proposed Prisma SQLite schema.
11. `benchmarks/regression-system.md` - benchmark baselines and regression gates.
12. `observability/langsmith.md` - optional LangSmith traces, datasets, and experiments.
13. `execution/mvp-plan.md` - canonical MVP tracker, current status, finish line, and next implementation sequence.

## Canonical Model

The database is canonical for epics, tasks, verification plans, approvals, execution state, branches, test runs, loop events, and patch reviews.

Markdown docs are bootstrap/design artifacts and later generated review views. Visual source-of-truth assets such as images and PDFs stay on disk; the database stores metadata, paths, hashes, and links to verification items.

## Documentation Map

| Area | Files |
|---|---|
| Product | `product/prd.md`, `product/principles.md` |
| Architecture | `architecture/system-overview.md`, `architecture/module-map.md`, `architecture/event-system.md`, `architecture/branch-policy.md`, `architecture/mcp.md`, `architecture/mcp-security.md` |
| Planner | `planner/planner-pipeline.md`, `planner/agent-roles.md`, `planner/interview-workflow.md`, `planner/project-manager-pack.md` |
| Verification | `verification/verification-contract.md`, `verification/tdd-execution-loop.md`, `verification/visual-source-of-truth.md` |
| Evaluation | `evaluation/evaluation-contract.md`, `evaluation/eval-dimensions.md`, `evaluation/scoring.md`, `evaluation/openevals.md` |
| Policy | `policy/model-selection.md` |
| Benchmarks | `benchmarks/benchmark-suite.md`, `benchmarks/regression-system.md` |
| Observability | `observability/langsmith.md` |
| Data | `data/prisma-schema-proposal.md`, `data/state-model.md` |
| Execution | `execution/mvp-plan.md`, `execution/cli-design.md`, `execution/api-contract.md` |

## V1 Defaults

- Runtime target: Bun workspace with TypeScript.
- API target: Hono.
- CLI target: OpenTUI.
- Agent runtime: Vercel AI SDK.
- Tool standard: MCP client plus allowlisted MCP servers.
- Evaluation: rule-based and OpenEvals-style LLM judges.
- Observability: local SQLite first, optional LangSmith export.
- Database target: Prisma with SQLite.
- Future database path: Postgres, after the local-first execution loop is stable.
