import {
  getVerificationDeferredReason,
  isVerificationItemRunnableNow,
  normalizeGeneratedPlannerProposal,
  normalizePlannerProposalInput,
  validatePlannerModelSlots,
} from "./index";

describe("verification runnability helpers", () => {
  test("re-exports isVerificationItemRunnableNow and getVerificationDeferredReason from shared", () => {
    expect(isVerificationItemRunnableNow("bun run test:vitest")).toBe(true);
    expect(getVerificationDeferredReason("visual", null)).toContain("Visual checks");
  });
});

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

  test("normalization preserves kind-specific fields for richer item metadata", () => {
    const proposal = normalizeGeneratedPlannerProposal("planner_run_xyz789", {
      epics: [
        {
          title: "UI Slice",
          tasks: [
            {
              title: "Render task list",
              verificationPlan: {
                items: [
                  {
                    kind: "logic",
                    title: "Unit test render",
                    description: "Vitest unit test for the task list component.",
                    command: "bun run test:vitest",
                    testFilePath: "src/components/TaskList.test.ts",
                  },
                  {
                    kind: "visual",
                    title: "Screenshot comparison",
                    description: "Compare rendered task list against baseline.",
                    route: "/tasks",
                    interaction: "load and scroll to bottom",
                    expectedAssetId: "asset_task_list_baseline",
                  },
                  {
                    kind: "integration",
                    title: "API integration check",
                    description: "Verify task list endpoint returns correct shape.",
                    command: "bunx vitest run apps/api/src/app.test.ts",
                    route: "/tasks",
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const items = proposal.epics[0]?.tasks[0]?.verificationPlan.items ?? [];
    expect(items).toHaveLength(3);

    const logicItem = items[0]!;
    expect(logicItem.kind).toBe("logic");
    expect(logicItem.command).toBe("bun run test:vitest");
    expect(logicItem.testFilePath).toBe("src/components/TaskList.test.ts");

    const visualItem = items[1]!;
    expect(visualItem.kind).toBe("visual");
    expect(visualItem.command).toBeNull();
    expect(visualItem.route).toBe("/tasks");
    expect(visualItem.interaction).toBe("load and scroll to bottom");
    expect(visualItem.expectedAssetId).toBe("asset_task_list_baseline");

    const integrationItem = items[2]!;
    expect(integrationItem.kind).toBe("integration");
    expect(integrationItem.command).toBe("bunx vitest run apps/api/src/app.test.ts");
    expect(integrationItem.route).toBe("/tasks");
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
