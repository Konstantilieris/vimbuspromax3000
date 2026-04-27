import { describe, expect, test, vi } from "vitest";
import { runTaskWriter } from "./taskWriter";
import type {
  AgentInput,
  EpicPlannerOutput,
  PlannerAgentDeps,
} from "./types";

const FAKE_PLANNER_RUN = {
  id: "planner_run_task1",
  goal: "Wire the task writer",
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
  return { plannerRun: FAKE_PLANNER_RUN, seed: 13 };
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

function buildUpstream(): EpicPlannerOutput {
  return {
    summary: "Epics summary",
    epics: [
      { title: "Epic A", goal: "Build A" },
      { title: "Epic B", goal: "Build B" },
    ],
    reasoning: "from-epic-planner",
  };
}

describe("runTaskWriter", () => {
  test("calls slotResolver with task_writer role and asks the generator to expand tasks for each epic", async () => {
    const slotResolver = vi.fn(async (role: string) => ({
      slotKey: "planner_deep" as const,
      model: { kind: "fake", role },
      concreteModelName: `fake/${role}`,
    }));
    const generator = vi.fn(async () => ({
      object: {
        epics: [
          {
            title: "Epic A",
            tasks: [
              { title: "Task A1", type: "backend", complexity: "medium", acceptance: ["done A1"] },
            ],
          },
          {
            title: "Epic B",
            tasks: [
              { title: "Task B1", type: "frontend", complexity: "small", acceptance: ["done B1"] },
              { title: "Task B2", type: "frontend", complexity: "small", acceptance: ["done B2"] },
            ],
          },
        ],
      },
      reasoning: "task-reasoning",
    }));
    const deps = buildDeps(generator, slotResolver);

    const result = await runTaskWriter(deps, buildAgentInput(), buildUpstream());

    expect(slotResolver).toHaveBeenCalledTimes(1);
    expect(slotResolver).toHaveBeenCalledWith("task_writer");
    expect(generator).toHaveBeenCalledTimes(1);

    const call = generator.mock.calls[0]![0]!;
    expect(call.seed).toBe(13);
    expect(call.system.toLowerCase()).toContain("task");
    // The task writer must not produce verification items.
    expect(call.system.toLowerCase()).not.toContain("verificationplan");
    // The prompt should carry the epics from upstream so the model can scope tasks.
    expect(call.prompt).toContain("Epic A");
    expect(call.prompt).toContain("Epic B");

    expect(result.summary).toBe("Epics summary");
    expect(result.epics).toHaveLength(2);
    expect(result.epics[0]?.title).toBe("Epic A");
    expect(result.epics[0]?.tasks).toHaveLength(1);
    expect(result.epics[1]?.tasks).toHaveLength(2);
    expect(result.reasoning).toBe("task-reasoning");
  });

  test("preserves epic skeleton metadata (goal, acceptance, risks) when the generator only emits new task arrays", async () => {
    const generator = vi.fn(async () => ({
      object: {
        epics: [
          {
            title: "Epic A",
            // generator returns tasks but omits goal/acceptance for this epic
            tasks: [{ title: "Task A1" }],
          },
        ],
      },
    }));
    const upstream: EpicPlannerOutput = {
      epics: [
        {
          title: "Epic A",
          goal: "preserved goal",
          acceptance: ["preserved acceptance"],
          risks: ["preserved risk"],
        },
      ],
    };

    const result = await runTaskWriter(buildDeps(generator), buildAgentInput(), upstream);

    expect(result.epics[0]?.goal).toBe("preserved goal");
    expect(result.epics[0]?.acceptance).toEqual(["preserved acceptance"]);
    expect(result.epics[0]?.risks).toEqual(["preserved risk"]);
    expect(result.epics[0]?.tasks[0]?.title).toBe("Task A1");
  });

  test("falls back to an empty task list when the generator omits tasks for an upstream epic", async () => {
    const generator = vi.fn(async () => ({ object: { epics: [] } }));
    const upstream: EpicPlannerOutput = {
      epics: [{ title: "Lonely Epic", goal: "goal" }],
    };

    const result = await runTaskWriter(buildDeps(generator), buildAgentInput(), upstream);

    expect(result.epics).toHaveLength(1);
    expect(result.epics[0]?.title).toBe("Lonely Epic");
    expect(result.epics[0]?.tasks).toEqual([]);
  });
});
