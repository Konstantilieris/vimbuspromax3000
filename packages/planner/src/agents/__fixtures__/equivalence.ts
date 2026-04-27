import type {
  AgentInput,
  GeneratedPlannerProposal,
  PlannerAgentDeps,
} from "../types";

/**
 * Equivalence-harness fixture shape.
 *
 * Each fixture supplies:
 *
 *   - `name`: human-readable label
 *   - `input`: the AgentInput the orchestrator will receive
 *   - `epicPayload`, `taskPayload`, `verificationPayload`: canned per-agent
 *     generator outputs that, when assembled, are equivalent to the proposal
 *     that the pre-fan-out monolithic generator would have produced
 *   - `monolithic`: the equivalent monolithic generator output -- this is the
 *     baseline the fan-out pipeline must match after normalization
 */
export type EquivalenceFixture = {
  name: string;
  input: AgentInput;
  epicPayload: { object: unknown; reasoning?: string };
  taskPayload: { object: unknown; reasoning?: string };
  verificationPayload: { object: unknown; reasoning?: string };
  /**
   * The "single generator call" payload that the pre-fan-out monolithic
   * planner would have returned. Used to derive the equivalence baseline.
   */
  monolithic: GeneratedPlannerProposal;
};

function buildPlannerRun(
  overrides: Partial<{
    id: string;
    goal: string;
    moduleName: string | null;
    contextPath: string | null;
    interview: unknown;
  }> = {},
): AgentInput["plannerRun"] {
  return {
    id: overrides.id ?? "planner_run_fixture",
    goal: overrides.goal ?? "Ship the planner fan-out",
    project: {
      id: "project_fixture",
      name: "Fixture Project",
      rootPath: "/tmp/fixture",
      baseBranch: "main",
      branchNaming: "feature/{slug}",
    },
    moduleName: overrides.moduleName ?? null,
    contextPath: overrides.contextPath ?? null,
    interview: overrides.interview ?? { stage: "scoping" },
  } as unknown as AgentInput["plannerRun"];
}

/**
 * Fixture 1: simple two-epic plan with one task each. Exercises the basic
 * fan-out path where every agent stage produces structurally complete output.
 */
const FIXTURE_SIMPLE: EquivalenceFixture = (() => {
  const monolithic: GeneratedPlannerProposal = {
    summary: "Simple two-epic plan",
    epics: [
      {
        title: "Backend Foundation",
        goal: "Stand up the backend",
        acceptance: ["api boots"],
        risks: ["env drift"],
        tasks: [
          {
            title: "Boot the API server",
            type: "backend",
            complexity: "medium",
            acceptance: ["server starts on port 3000"],
            verificationPlan: {
              items: [
                {
                  kind: "logic",
                  title: "Boot smoke test",
                  description: "Vitest unit test for server boot.",
                  command: "bun run test:vitest",
                  testFilePath: "apps/api/src/app.test.ts",
                },
              ],
            },
          },
        ],
      },
      {
        title: "UI Slice",
        goal: "Render the task list",
        acceptance: ["task list visible"],
        tasks: [
          {
            title: "Render TaskList component",
            type: "frontend",
            complexity: "small",
            acceptance: ["component renders"],
            verificationPlan: {
              items: [
                {
                  kind: "logic",
                  title: "TaskList unit test",
                  description: "Vitest unit test for TaskList.",
                  command: "bun run test:vitest",
                  testFilePath: "src/components/TaskList.test.ts",
                },
              ],
            },
          },
        ],
      },
    ],
  };

  return {
    name: "simple-two-epic",
    input: {
      plannerRun: buildPlannerRun({ id: "planner_run_simple", goal: "Ship the simple plan" }),
      seed: 7,
    },
    epicPayload: {
      object: {
        summary: monolithic.summary,
        epics: monolithic.epics.map(({ tasks: _tasks, ...epic }) => epic),
      },
    },
    taskPayload: {
      object: {
        epics: monolithic.epics.map((epic) => ({
          title: epic.title,
          tasks: epic.tasks.map(({ verificationPlan: _v, ...task }) => task),
        })),
      },
    },
    verificationPayload: {
      object: {
        epics: monolithic.epics.map((epic) => ({
          title: epic.title,
          tasks: epic.tasks.map((task) => ({
            title: task.title,
            verificationPlan: task.verificationPlan,
          })),
        })),
      },
    },
    monolithic,
  };
})();

/**
 * Fixture 2: richer plan with kind-specific verification (logic + integration +
 * visual deferred item). Exercises preservation of per-kind metadata through
 * the fan-out path.
 */
const FIXTURE_RICH: EquivalenceFixture = (() => {
  const monolithic: GeneratedPlannerProposal = {
    summary: "Rich kind-specific plan",
    epics: [
      {
        title: "Tasks UI",
        goal: "Render and verify the task list",
        acceptance: ["task list visible", "screenshots stable"],
        risks: ["api shape drift"],
        tasks: [
          {
            title: "Render task list",
            type: "frontend",
            complexity: "medium",
            acceptance: ["list renders", "rows clickable"],
            targetFiles: ["src/components/TaskList.tsx"],
            requires: ["api: GET /tasks"],
            verificationPlan: {
              rationale: "Cover both unit-level rendering and integration shape.",
              items: [
                {
                  kind: "logic",
                  title: "Unit test render",
                  description: "Vitest unit test for the task list component.",
                  command: "bun run test:vitest",
                  testFilePath: "src/components/TaskList.test.ts",
                },
                {
                  kind: "integration",
                  title: "API integration check",
                  description: "Verify task list endpoint returns correct shape.",
                  command: "bunx vitest run apps/api/src/app.test.ts",
                  route: "/tasks",
                },
                {
                  kind: "visual",
                  title: "Screenshot comparison",
                  description: "Compare rendered task list against baseline.",
                  route: "/tasks",
                  interaction: "load and scroll to bottom",
                  expectedAssetId: "asset_task_list_baseline",
                },
              ],
            },
          },
        ],
      },
    ],
  };

  return {
    name: "rich-kind-specific",
    input: {
      plannerRun: buildPlannerRun({
        id: "planner_run_rich",
        goal: "Ship the rich plan",
        moduleName: "tasks-ui",
        interview: { stage: "design", surfaces: ["TaskList"] },
      }),
      seed: 11,
    },
    epicPayload: {
      object: {
        summary: monolithic.summary,
        epics: monolithic.epics.map(({ tasks: _tasks, ...epic }) => epic),
      },
    },
    taskPayload: {
      object: {
        epics: monolithic.epics.map((epic) => ({
          title: epic.title,
          tasks: epic.tasks.map(({ verificationPlan: _v, ...task }) => task),
        })),
      },
    },
    verificationPayload: {
      object: {
        epics: monolithic.epics.map((epic) => ({
          title: epic.title,
          tasks: epic.tasks.map((task) => ({
            title: task.title,
            verificationPlan: task.verificationPlan,
          })),
        })),
      },
    },
    monolithic,
  };
})();

export const EQUIVALENCE_FIXTURES: readonly EquivalenceFixture[] = [
  FIXTURE_SIMPLE,
  FIXTURE_RICH,
];

/**
 * Build a `PlannerAgentDeps` whose generator returns the canned per-agent
 * payloads in pipeline order: epicPlanner -> taskWriter -> verificationDesigner.
 */
export function buildFixtureDeps(fixture: EquivalenceFixture): PlannerAgentDeps {
  const payloads = [
    fixture.epicPayload,
    fixture.taskPayload,
    fixture.verificationPayload,
  ];
  let i = 0;

  return {
    generator: async () => {
      const next = payloads[i] ?? payloads[payloads.length - 1]!;
      i += 1;
      return next;
    },
    slotResolver: async (role) => ({
      slotKey: "planner_deep",
      model: { kind: "fixture", role },
      concreteModelName: `fixture/${role}`,
    }),
  };
}
