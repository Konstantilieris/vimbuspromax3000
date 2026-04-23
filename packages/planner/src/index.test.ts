import {
  normalizeGeneratedPlannerProposal,
  normalizePlannerProposalInput,
  validatePlannerModelSlots,
} from "./index";

describe("planner model slot validation", () => {
  test("fills known role defaults", () => {
    const result = validatePlannerModelSlots([{ role: "executor" }]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.requirements[0]?.slotKey).toBe("executor_default");
    }
  });

  test("rejects raw model names", () => {
    const result = validatePlannerModelSlots([
      {
        role: "executor",
        slotKey: "executor_default",
        modelName: "openai:gpt-5.4",
      },
    ]);

    expect(result.ok).toBe(false);
  });

  test("normalizes generated planner output into deterministic proposal records", () => {
    const proposal = normalizeGeneratedPlannerProposal(
      "planner_run_abc123",
      {
        epics: [
          {
            title: "Backend Foundation",
            tasks: [
              {
                title: "Persist planner proposal",
              },
            ],
          },
        ],
      },
      {
        summaryFallback: "Plan for backend foundation",
      },
    );

    expect(proposal.summary).toBe("Plan for backend foundation");
    expect(proposal.epics).toHaveLength(1);
    expect(proposal.epics[0]?.key).toContain("PLAN-ABC123");
    expect(proposal.epics[0]?.goal).toBe("Backend Foundation");
    expect(proposal.epics[0]?.tasks[0]?.stableId).toContain("PLAN-ABC123");
    expect(proposal.epics[0]?.tasks[0]?.complexity).toBe("medium");
    expect(proposal.epics[0]?.tasks[0]?.acceptance).toEqual([{ label: "Complete Persist planner proposal" }]);
    expect(proposal.epics[0]?.tasks[0]?.verificationPlan.items[0]).toMatchObject({
      kind: "logic",
      runner: "vitest",
      command: "bun run test:vitest",
    });
  });

  test("keeps strict payload normalization for persistence-first planner routes", () => {
    expect(() =>
      normalizePlannerProposalInput("planner_run_abc123", {
        summary: "Strict payload",
        epics: [
          {
            key: "epic-1",
            title: "Backend Foundation",
            goal: "Persist planner outputs",
            tasks: [
              {
                stableId: "task-1",
                title: "Persist proposal",
                type: "backend",
                complexity: "medium",
                acceptance: ["proposal persisted"],
                verificationPlan: {
                  items: [],
                },
              },
            ],
          },
        ],
      }),
    ).toThrow("verificationPlan.items");
  });
});
