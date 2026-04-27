import { describe, expect, test, vi } from "vitest";
import { runOrchestrator } from "./orchestrator";
import type { AgentInput, GeneratedPlannerProposal, PlannerAgentDeps } from "./types";

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
): PlannerAgentDeps {
  return {
    generator,
    slotResolver: async () => ({
      slotKey: "epic_planner_default",
      model: { kind: "fake" },
      concreteModelName: "fake/test",
    }),
  };
}

function buildHappyPathProposal(): GeneratedPlannerProposal {
  return {
    summary: "Sprint 2 happy path",
    epics: [
      {
        title: "Foundation Epic",
        goal: "Lay the foundation",
        tasks: [
          {
            title: "Wire pipeline",
            type: "backend",
            complexity: "medium",
            acceptance: ["pipeline wired"],
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
  };
}

describe("runOrchestrator", () => {
  test("threads epicPlanner -> taskWriter -> verificationDesigner -> reviewer and returns a normalized PlannerProposalInput", async () => {
    const generator = vi.fn(async () => ({
      object: buildHappyPathProposal(),
      reasoning: "fake-reasoning",
    }));
    const deps = buildDeps(generator);

    const result = await runOrchestrator(deps, buildAgentInput());

    // Sprint 2 calls the underlying generator exactly once (inside epicPlanner)
    // because taskWriter and verificationDesigner are pass-through / shaping
    // stages this sprint. Sprint 3 will increase this count.
    expect(generator).toHaveBeenCalledTimes(1);
    expect(result.reasoning).toBe("fake-reasoning");

    // The output must satisfy the same PlannerProposalInput contract that the
    // monolithic service used to produce -- the orchestrator just routes
    // through agents and re-uses normalizeGeneratedPlannerProposal.
    expect(result.proposal.plannerRunId).toBe("planner_run_orch1");
    expect(result.proposal.summary).toBe("Sprint 2 happy path");
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

  test("verification designer fallback fires when the generator omits verification, so the reviewer accepts on the first attempt", async () => {
    const generator = vi.fn(async () => ({
      object: {
        summary: "Auto-fallback path",
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
      } satisfies GeneratedPlannerProposal,
      reasoning: undefined,
    }));
    const deps = buildDeps(generator);

    const result = await runOrchestrator(deps, buildAgentInput());

    expect(generator).toHaveBeenCalledTimes(1);
    const items = result.proposal.epics[0]?.tasks[0]?.verificationPlan.items ?? [];
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.command).toBe("bun run test:vitest");
  });

  test("falls back to a summary derived from the planner run goal when the generator omits a summary", async () => {
    const generator = vi.fn(async () => ({
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
      } satisfies GeneratedPlannerProposal,
    }));
    const deps = buildDeps(generator);

    const result = await runOrchestrator(deps, buildAgentInput());

    expect(result.proposal.summary).toBe("Plan for Build the orchestrator");
  });
});
