import { describe, expect, test, vi } from "vitest";
import { runEpicPlanner } from "./epicPlanner";
import type { AgentInput, PlannerAgentDeps } from "./types";

const FAKE_PLANNER_RUN = {
  id: "planner_run_epic1",
  goal: "Ship the epic-planner fan-out",
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
  return { plannerRun: FAKE_PLANNER_RUN, seed: 11 };
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

describe("runEpicPlanner", () => {
  test("calls slotResolver with the epic_planner role and the generator with epic-only output", async () => {
    const slotResolver = vi.fn(async (role: string) => ({
      slotKey: "planner_deep" as const,
      model: { kind: "fake", role },
      concreteModelName: `fake/${role}`,
    }));
    const generator = vi.fn(async () => ({
      object: {
        summary: "Epics only",
        epics: [
          { title: "E1", goal: "Goal 1", acceptance: ["ship E1"] },
          { title: "E2", goal: "Goal 2" },
        ],
      },
      reasoning: "epic-reasoning",
    }));
    const deps = buildDeps(generator, slotResolver);

    const result = await runEpicPlanner(deps, buildAgentInput());

    expect(slotResolver).toHaveBeenCalledTimes(1);
    expect(slotResolver).toHaveBeenCalledWith("epic_planner");
    expect(generator).toHaveBeenCalledTimes(1);

    const call = generator.mock.calls[0]![0]!;
    expect(call.seed).toBe(11);
    expect(call.system.toLowerCase()).toContain("epic");
    expect(call.prompt).toContain("Ship the epic-planner fan-out");

    expect(result.summary).toBe("Epics only");
    expect(result.epics).toHaveLength(2);
    expect(result.epics[0]?.title).toBe("E1");
    expect(result.reasoning).toBe("epic-reasoning");
  });

  test("returns an empty epic list when the generator emits no epics so downstream stages can fail loudly", async () => {
    const generator = vi.fn(async () => ({ object: {} }));
    const result = await runEpicPlanner(buildDeps(generator), buildAgentInput());

    expect(result.epics).toEqual([]);
  });
});
