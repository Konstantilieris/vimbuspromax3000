import { describe, expect, test } from "vitest";
import {
  REVIEWER_MAX_REROUTES,
  collectTasksMissingVerification,
  runReviewer,
} from "./reviewer";
import type {
  AgentInput,
  GeneratedPlannerProposal,
  PlannerAgentDeps,
  VerificationDesignerOutput,
} from "./types";

const FAKE_PLANNER_RUN: AgentInput["plannerRun"] = {
  id: "planner_run_test",
  goal: "Ship sprint 2",
} as unknown as AgentInput["plannerRun"];

function buildAgentInput(): AgentInput {
  return { plannerRun: FAKE_PLANNER_RUN, seed: 7 };
}

function buildDeps(generator: PlannerAgentDeps["generator"]): PlannerAgentDeps {
  return {
    generator,
    slotResolver: async () => ({
      slotKey: "epic_planner_default",
      model: { kind: "fake" },
      concreteModelName: "fake/test",
    }),
  };
}

function buildProposalWithMissingVerification(): GeneratedPlannerProposal {
  return {
    summary: "summary",
    epics: [
      {
        title: "Epic A",
        tasks: [
          {
            title: "Task with verification",
            verificationPlan: {
              items: [
                {
                  kind: "logic",
                  title: "ok",
                  description: "ok",
                  command: "bun run test:vitest",
                },
              ],
            },
          },
          {
            title: "Task missing verification",
            verificationPlan: { items: [] },
          },
        ],
      },
    ],
  };
}

describe("collectTasksMissingVerification", () => {
  test("returns titles of tasks with no verification items", () => {
    const output: VerificationDesignerOutput = {
      generated: buildProposalWithMissingVerification(),
    };

    expect(collectTasksMissingVerification(output)).toEqual([
      "Task missing verification",
    ]);
  });

  test("returns an empty list when every task has at least one item", () => {
    const output: VerificationDesignerOutput = {
      generated: {
        epics: [
          {
            title: "Epic",
            tasks: [
              {
                title: "T",
                verificationPlan: {
                  items: [
                    { kind: "logic", title: "ok", description: "ok" },
                  ],
                },
              },
            ],
          },
        ],
      },
    };

    expect(collectTasksMissingVerification(output)).toEqual([]);
  });
});

describe("runReviewer", () => {
  test("accepts immediately when every task already has a verification item", async () => {
    const deps = buildDeps(async () => {
      throw new Error("generator should not be called when reviewer accepts immediately");
    });
    const upstream: VerificationDesignerOutput = {
      generated: {
        epics: [
          {
            title: "E",
            tasks: [
              {
                title: "T",
                verificationPlan: {
                  items: [
                    { kind: "logic", title: "ok", description: "ok" },
                  ],
                },
              },
            ],
          },
        ],
      },
      reasoning: "no rerun",
    };

    const verdict = await runReviewer(deps, buildAgentInput(), upstream);

    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.output).toBe(upstream);
    }
  });

  test("re-routes to verificationDesigner when a task is missing verification, then accepts after the designer's deterministic fallback fills it", async () => {
    // The verification designer issues a generator call on redo; we return an
    // empty payload so the deterministic safety net (`ensureVerificationItems`)
    // injects the fallback vitest item. After a single re-route the reviewer
    // accepts.
    const deps = buildDeps(async () => ({ object: { epics: [] } }));
    const upstream: VerificationDesignerOutput = {
      generated: buildProposalWithMissingVerification(),
    };

    const verdict = await runReviewer(deps, buildAgentInput(), upstream);

    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      const items =
        verdict.output.generated.epics[0]?.tasks[1]?.verificationPlan?.items ?? [];
      expect(items.length).toBeGreaterThan(0);
      expect(items[0]?.command).toBe("bun run test:vitest");
    }
  });

  test("performs exactly REVIEWER_MAX_REROUTES re-routes before failing when the designer never fills items", async () => {
    expect(REVIEWER_MAX_REROUTES).toBe(2);

    let redoCalls = 0;
    const upstream: VerificationDesignerOutput = {
      generated: buildProposalWithMissingVerification(),
    };

    // Inject a redo that returns the same broken proposal every time, so the
    // reviewer must exhaust its re-route budget and reject.
    const redo = async (current: VerificationDesignerOutput): Promise<VerificationDesignerOutput> => {
      redoCalls += 1;
      return current;
    };

    const deps = buildDeps(async () => ({ object: {} }));
    const verdict = await runReviewer(deps, buildAgentInput(), upstream, { redo });

    expect(redoCalls).toBe(REVIEWER_MAX_REROUTES);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.missingTaskTitles).toEqual(["Task missing verification"]);
      expect(verdict.reason).toContain(`${REVIEWER_MAX_REROUTES} re-routes`);
    }
  });

  test("accepts after the designer fixes verification on the first re-route", async () => {
    let redoCalls = 0;
    const upstream: VerificationDesignerOutput = {
      generated: buildProposalWithMissingVerification(),
    };
    const fixed: VerificationDesignerOutput = {
      generated: {
        epics: [
          {
            title: "Epic A",
            tasks: [
              {
                title: "Task with verification",
                verificationPlan: {
                  items: [{ kind: "logic", title: "ok", description: "ok" }],
                },
              },
              {
                title: "Task missing verification",
                verificationPlan: {
                  items: [
                    {
                      kind: "logic",
                      title: "designer-injected",
                      description: "fallback",
                      command: "bun run test:vitest",
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    };

    const redo = async (): Promise<VerificationDesignerOutput> => {
      redoCalls += 1;
      return fixed;
    };

    const deps = buildDeps(async () => ({ object: {} }));
    const verdict = await runReviewer(deps, buildAgentInput(), upstream, { redo });

    expect(redoCalls).toBe(1);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.output).toBe(fixed);
    }
  });
});
