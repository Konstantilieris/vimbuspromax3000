import { describe, expect, test, vi } from "vitest";
import {
  ensureVerificationItems,
  runVerificationDesigner,
} from "./verificationDesigner";
import type {
  AgentInput,
  GeneratedPlannerProposal,
  PlannerAgentDeps,
  TaskWriterOutput,
} from "./types";

const FAKE_PLANNER_RUN = {
  id: "planner_run_verif1",
  goal: "Wire the verification designer",
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
  return { plannerRun: FAKE_PLANNER_RUN, seed: 17 };
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
        slotKey: "verification_designer",
        model: { kind: "fake", role },
        concreteModelName: `fake/${role}`,
      })),
  };
}

function buildUpstream(): TaskWriterOutput {
  return {
    summary: "Two epics, three tasks total",
    epics: [
      {
        title: "Epic A",
        goal: "A",
        tasks: [
          { title: "Task A1", type: "backend" },
          { title: "Task A2", type: "backend" },
        ],
      },
      {
        title: "Epic B",
        goal: "B",
        tasks: [{ title: "Task B1", type: "frontend" }],
      },
    ],
    reasoning: "from-task-writer",
  };
}

describe("runVerificationDesigner", () => {
  test("calls slotResolver with verification_designer role and the generator with task context", async () => {
    const slotResolver = vi.fn(async (role: string) => ({
      slotKey: "verification_designer" as const,
      model: { kind: "fake", role },
      concreteModelName: `fake/${role}`,
    }));
    const generator = vi.fn(async () => ({
      object: {
        epics: [
          {
            title: "Epic A",
            tasks: [
              {
                title: "Task A1",
                verificationPlan: {
                  items: [
                    {
                      kind: "logic",
                      title: "A1 unit test",
                      description: "Vitest unit test for A1.",
                      command: "bun run test:vitest",
                    },
                  ],
                },
              },
              {
                title: "Task A2",
                verificationPlan: {
                  items: [
                    {
                      kind: "typecheck",
                      title: "A2 typecheck",
                      description: "Typecheck for A2.",
                      command: "bun run typecheck",
                    },
                  ],
                },
              },
            ],
          },
          {
            title: "Epic B",
            tasks: [
              {
                title: "Task B1",
                verificationPlan: {
                  items: [
                    {
                      kind: "logic",
                      title: "B1 unit test",
                      description: "Vitest unit test for B1.",
                      command: "bun run test:vitest",
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      reasoning: "verification-reasoning",
    }));
    const deps = buildDeps(generator, slotResolver);

    const result = await runVerificationDesigner(deps, buildAgentInput(), buildUpstream());

    expect(slotResolver).toHaveBeenCalledTimes(1);
    expect(slotResolver).toHaveBeenCalledWith("verification_designer");
    expect(generator).toHaveBeenCalledTimes(1);

    const call = generator.mock.calls[0]![0]!;
    expect(call.seed).toBe(17);
    expect(call.system.toLowerCase()).toContain("verification");
    // Prompt should carry task titles so the model can write per-task items.
    expect(call.prompt).toContain("Task A1");
    expect(call.prompt).toContain("Task A2");
    expect(call.prompt).toContain("Task B1");

    expect(result.generated.summary).toBe("Two epics, three tasks total");
    expect(result.generated.epics[0]?.tasks[0]?.verificationPlan?.items).toHaveLength(1);
    expect(result.reasoning).toBe("verification-reasoning");
  });

  test("preserves task metadata (type) when the generator only returns verification plans", async () => {
    const generator = vi.fn(async () => ({
      object: {
        epics: [
          {
            title: "Epic A",
            tasks: [
              {
                title: "Task A1",
                verificationPlan: {
                  items: [
                    {
                      kind: "logic",
                      title: "A1 unit test",
                      description: "Unit test.",
                      command: "bun run test:vitest",
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    }));
    const upstream: TaskWriterOutput = {
      epics: [
        {
          title: "Epic A",
          goal: "A",
          acceptance: ["ship A"],
          tasks: [{ title: "Task A1", type: "backend", complexity: "medium", acceptance: ["done A1"] }],
        },
      ],
    };

    const result = await runVerificationDesigner(buildDeps(generator), buildAgentInput(), upstream);

    const task = result.generated.epics[0]?.tasks[0];
    expect(task?.type).toBe("backend");
    expect(task?.complexity).toBe("medium");
    expect(task?.acceptance).toEqual(["done A1"]);
    expect(task?.verificationPlan?.items?.[0]?.kind).toBe("logic");
  });

  test("injects fallback verification items when the generator omits them for a task (deterministic safety net)", async () => {
    const generator = vi.fn(async () => ({
      object: {
        epics: [
          {
            title: "Epic A",
            tasks: [{ title: "Task A1" }],
          },
        ],
      },
    }));
    const upstream: TaskWriterOutput = {
      epics: [
        { title: "Epic A", tasks: [{ title: "Task A1" }] },
      ],
    };

    const result = await runVerificationDesigner(buildDeps(generator), buildAgentInput(), upstream);

    const items = result.generated.epics[0]?.tasks[0]?.verificationPlan?.items ?? [];
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.command).toBe("bun run test:vitest");
  });
});

describe("ensureVerificationItems", () => {
  test("leaves tasks with non-empty verification items untouched", () => {
    const input: GeneratedPlannerProposal = {
      epics: [
        {
          title: "E",
          tasks: [
            {
              title: "T",
              verificationPlan: {
                items: [{ kind: "logic", title: "ok", description: "ok", command: "bun run test:vitest" }],
              },
            },
          ],
        },
      ],
    };

    expect(ensureVerificationItems(input)).toEqual(input);
  });

  test("injects a vitest fallback item for tasks missing verification", () => {
    const input: GeneratedPlannerProposal = {
      epics: [{ title: "E", tasks: [{ title: "Bare task" }] }],
    };
    const out = ensureVerificationItems(input);

    const items = out.epics[0]?.tasks[0]?.verificationPlan?.items ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]?.command).toBe("bun run test:vitest");
    expect(items[0]?.kind).toBe("logic");
  });
});
