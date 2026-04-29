# M2 Golden Path Runbook

> **Status:** Stub. VIM-49 (M2 dogfood harness, minimum viable) is in progress; this runbook is filled in as the harness lands. Do not rely on it for an actual operator handoff yet.

## What this runbook is for

The M2 milestone is "Verifiable Execution at Scale." Closure criterion 5 (per the VIM-47 epic) says: **`docs/runbooks/m2-golden-path.md` is the only doc a new operator needs.** This runbook covers running the deterministic golden-path scenario from a clean checkout and inspecting the resulting artifact bundle.

## Prerequisites

- Bun `1.3.13` on PATH.
- Docker (any recent version that supports `docker compose up --wait`).
- The repository at a clean working tree on a known SHA.
- Optional: Playwright / Chromium for the visual verification step. The harness will refuse to start if it can't find a Chromium it can drive.

## Running the dogfood harness

```bash
bun run dogfood:m2
```

This single command:

1. Brings the docker-compose `postgres` service up and waits for it to be healthy.
2. Pushes the Prisma schema into the Postgres database.
3. Starts the API in Postgres mode against the same database.
4. Drives the deterministic golden-path scenario via the CLI dogfood command.
5. Writes a self-contained artifact bundle under `.artifacts/m2/<run-id>/`.
6. Stops the API and tears the docker-compose service down.

A green run exits 0 with no operator interaction required. A red run exits non-zero and leaves the artifact bundle in place for inspection.

## Artifact bundle layout

```
.artifacts/m2/<run-id>/
├── manifest.json           # scenario metadata: run id, SHA, durations, verdict
├── planner-payload.json    # the deterministic seed used in step 3 of the scenario
├── agent-step-log.jsonl    # AgentStep rows for this taskExecutionId
├── mcp-tool-call-log.jsonl # McpToolCall rows for this taskExecutionId
├── screenshots/            # PNGs from the visual verification step
├── axe-results.json        # axe-core output from the a11y verification step
├── evidence.json           # TestRun.evidenceJson, copied verbatim
└── benchmark-run.json      # the BenchmarkScenarioRun row(s) hydrated post-execution
```

Two runs against the same clean state produce identical bundle contents modulo timestamps and the run id.

## What each step proves

(Filled in when VIM-49 lands.)

## Troubleshooting

(Filled in when VIM-49 lands. Common failure modes will include: docker compose startup timeout, API health-check failure, Chromium missing for visual verification, Postgres schema push divergence.)

## Out of scope for the minimum-viable harness

These extensions are tracked under VIM-51 (M2 golden-path full instrumentation, stretch):

- LangSmith trace link assertion.
- SSE event-sequence assertion against `/events`.
- Multi-dimensional verification matrix.

Those are not required for the M2 release-candidate gate; this runbook will not document them until VIM-51 lands.
