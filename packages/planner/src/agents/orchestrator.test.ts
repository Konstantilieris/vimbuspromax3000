import { describe, expect, test, vi } from "vitest";
import { runOrchestrator } from "./orchestrator";
import type { AgentInput, PlannerAgentDeps, PlannerAgentRole } from "./types";

const FAKE_PLANNER_RUN = {
  id: "planner_run_orch1",
  goal: "Build the orchestrator",
  project: {
    id: "project_test",
    name: "Test Project",
    rootPath: "/tmp/test",
    baseBranch: "main",
    branchNaming: "feature/{slug}",
  },
  moduleName: null,
  contextPath: null,
  interview: { stage: "scoping" },
} as unknown as AgentInput["plannerRun"];

function buildAgentInput(): AgentInput {
  return { plannerRun: FAKE_PLANNER_RUN, seed: 7 };
}

function buildDeps(
  generator: PlannerAgentDeps["generator"],
  slotResolver?: PlannerAgentDeps["slotResolver"],
): PlannerAgentDeps {
  return {
    generator,
    slotResolver:
      slotResolver ??
      (async (role) => ({
        slotKey: "planner_deep",
        model: { kind: "fake", role },
        concreteModelName: `fake/${role}`,
      })),
  };
}

/**
 * Build a generator that returns a different canned payload for each agent
 * stage in pipeline order: [epicPlanner, taskWriter, verificationDesigner].
 */
function stageGenerator(
  payloads: Array<{ object: unknown; reasoning?: string }>,
): PlannerAgentDeps["generator"] {
  let i = 0;
  return vi.fn(async () => {
    const next = payloads[i] ?? payloads[payloads.length - 1]!;
    i += 1;
    return next;
  });
}

describe("runOrchestrator", () => {
  test("makes 3 underlying generator calls (epicPlanner + taskWriter + verificationDesigner) and resolves per-agent slots", async () => {
    const slotResolver = vi.fn(async (role: PlannerAgentRole) => ({
      slotKey: "planner_deep" as const,
      model: { kind: "fake", role },
      concreteModelName: `fake/${role}`,
    }));
    const generator = stageGenerator([
      {
        object: {
          summary: "Sprint 3 happy path",
          epics: [{ title: "Foundation Epic", goal: "Lay the foundation" }],
        },
        reasoning: "epic-reasoning",
      },
      {
        object: {
          epics: [
            {
              title: "Foundation Epic",
              tasks: [
                {
                  title: "Wire pipeline",
                  type: "backend",
                  complexity: "medium",
                  acceptance: ["pipeline wired"],
                },
              ],
            },
          ],
        },
        reasoning: "task-reasoning",
      },
      {
        object: {
          epics: [
            {
              title: "Foundation Epic",
              tasks: [
                {
                  title: "Wire pipeline",
                  verificationPlan: {
                    items: [
                      {
                        kind: "logic",
                        title: "Pipeline unit test",
                        description: "Vitest unit test for the pipeline.",
                        command: "bun run test:vitest",
                        testFilePath: "packages/planner/src/agents/orchestrator.test.ts",
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
        reasoning: "verification-reasoning",
      },
    ]);
    const deps = buildDeps(generator, slotResolver);

    const result = await runOrchestrator(deps, buildAgentInput());

    // Per-agent fan-out: 3 underlying generator calls.
    expect(generator).toHaveBeenCalledTimes(3);
    // Per-agent slot routing: each role resolves its own slot.
    expect(slotResolver).toHaveBeenCalledTimes(3);
    expect(slotResolver.mock.calls.map((c) => c[0])).toEqual([
      "epic_planner",
      "task_writer",
      "verification_designer",
    ]);

    // The orchestrator returns the reasoning from the last accepted designer
    // output (the gate runs after the verification designer).
    expect(result.reasoning).toBe("verification-reasoning");

    // The output must satisfy the same PlannerProposalInput contract that the
    // monolithic service used to produce.
    expect(result.proposal.plannerRunId).toBe("planner_run_orch1");
    expect(result.proposal.summary).toBe("Sprint 3 happy path");
    expect(result.proposal.epics).toHaveLength(1);

    const epic = result.proposal.epics[0]!;
    expect(epic.title).toBe("Foundation Epic");
    expect(epic.key).toContain("PLAN-");
    expect(epic.tasks).toHaveLength(1);

    const task = epic.tasks[0]!;
    expect(task.title).toBe("Wire pipeline");
    expect(task.stableId).toContain("PLAN-");
    expect(task.verificationPlan.items).toHaveLength(1);
    expect(task.verificationPlan.items[0]?.command).toBe("bun run test:vitest");
  });

  test("verification designer fallback fires when the designer omits verification, so the reviewer accepts on the first attempt", async () => {
    const generator = stageGenerator([
      {
        object: {
          summary: "Auto-fallback path",
          epics: [{ title: "Epic with one bare task" }],
        },
      },
      {
        object: {
          epics: [
            {
              title: "Epic with one bare task",
              tasks: [{ title: "Task with no verification" }],
            },
          ],
        },
      },
      {
        object: {
          epics: [
            {
              title: "Epic with one bare task",
              tasks: [
                {
                  title: "Task with no verification",
                  // verificationPlan intentionally omitted
                },
              ],
            },
          ],
        },
      },
    ]);
    const deps = buildDeps(generator);

    const result = await runOrchestrator(deps, buildAgentInput());

    expect(generator).toHaveBeenCalledTimes(3);
    const items = result.proposal.epics[0]?.tasks[0]?.verificationPlan.items ?? [];
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.command).toBe("bun run test:vitest");
  });

  test("falls back to a summary derived from the planner run goal when the epic planner omits a summary", async () => {
    const generator = stageGenerator([
      {
        object: {
          epics: [{ title: "E", goal: "g" }],
        },
      },
      {
        object: {
          epics: [
            {
              title: "E",
              tasks: [{ title: "T" }],
            },
          ],
        },
      },
      {
        object: {
          epics: [
            {
              title: "E",
              tasks: [
                {
                  title: "T",
                  verificationPlan: {
                    items: [
                      {
                        kind: "logic",
                        title: "v",
                        description: "v",
                        command: "bun run test:vitest",
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    ]);
    const deps = buildDeps(generator);

    const result = await runOrchestrator(deps, buildAgentInput());

    expect(result.proposal.summary).toBe("Plan for Build the orchestrator");
  });
});
