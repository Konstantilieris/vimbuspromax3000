import type { EvalContext } from "./types";
import { hashEvalInputs } from "./hash";

describe("hashEvalInputs", () => {
  test("ignores volatile child row ids", () => {
    const first = hashEvalInputs(makeContext("a"));
    const second = hashEvalInputs(makeContext("b"));

    expect(second).toBe(first);
  });

  test("changes when semantic execution state changes", () => {
    const first = hashEvalInputs(makeContext("a"));
    const changed = makeContext("b");
    changed.execution.testRuns[0]!.status = "failed";

    expect(hashEvalInputs(changed)).not.toBe(first);
  });
});

function makeContext(idSuffix: string): EvalContext {
  return {
    projectId: "project_1",
    execution: {
      id: "execution_1",
      status: "implementing",
      retryCount: 0,
      startedAt: null,
      testRuns: [
        {
          id: `test_run_${idSuffix}`,
          command: "bun run test:vitest",
          status: "passed",
          exitCode: 0,
        },
      ],
      agentSteps: [
        {
          id: `agent_step_${idSuffix}`,
          role: "executor",
          status: "completed",
          modelName: "anthropic:claude",
        },
      ],
      patchReviews: [],
      latestVerificationPlan: {
        id: `verification_plan_${idSuffix}`,
        status: "approved",
        approvedAt: new Date("2026-01-01T00:00:00.000Z"),
        items: [
          {
            id: `verification_item_${idSuffix}`,
            kind: "logic",
            runner: "custom",
            title: "run tests",
            description: "Run the focused tests.",
            command: "bun run test:vitest",
            status: "approved",
          },
        ],
      },
      branch: {
        name: "tg/test",
        base: "main",
      },
      task: {
        id: "task_1",
        title: "Implement feature",
        type: "backend",
        complexity: "medium",
        acceptanceJson: null,
        targetFilesJson: null,
        epic: {
          id: "epic_1",
          goal: "Ship feature",
          acceptanceJson: null,
          risksJson: null,
          tasks: [],
          plannerRun: {
            id: "planner_run_1",
            goal: "Plan feature",
            interviewJson: null,
          },
          project: {
            name: "Project",
            baseBranch: "main",
          },
        },
      },
    },
    mcpCalls: [
      {
        id: `mcp_call_${idSuffix}`,
        serverName: "taskgoblin-fs-git",
        toolName: "read_file",
        mutability: "read",
        status: "succeeded",
        approvalId: null,
        argumentsHash: "args_hash",
        latencyMs: 25,
      },
    ],
  };
}
