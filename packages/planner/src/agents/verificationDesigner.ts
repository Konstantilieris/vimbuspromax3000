import type {
  AgentInput,
  GeneratedPlannerProposal,
  PlannerAgentDeps,
  TaskWriterOutput,
  VerificationDesignerOutput,
} from "./types";

/**
 * Sprint 2 verification designer.
 *
 * NOTE: For Sprint 2 the monolithic generator call inside `epicPlanner` already
 * produces a full verification plan per task. This stage's only job today is
 * the deterministic safety net: ensure every task has at least one verification
 * item by injecting the project's standard fallback (`bun run test:vitest`)
 * when one is missing. The reviewer then checks the same invariant and may
 * re-route here up to twice if anything is still empty.
 *
 * Sprint 3 will:
 *
 *   1. Replace the placeholder prompt with the real verification-designer
 *      prompt from docs/planner/agent-roles.md.
 *   2. Call `deps.generator` per task to produce kind-specific verification
 *      items rather than relying on the monolithic call.
 */
export async function runVerificationDesigner(
  deps: PlannerAgentDeps,
  input: AgentInput,
  upstream: TaskWriterOutput,
): Promise<VerificationDesignerOutput> {
  // TODO(VIM-33 Sprint 3): call deps.generator per task with the verification-
  // designer prompt and merge results back. Sprint 2 only injects fallbacks.
  void deps;
  void input;

  return {
    generated: ensureVerificationItems(upstream.generated),
    reasoning: upstream.reasoning,
  };
}

export function ensureVerificationItems(
  generated: GeneratedPlannerProposal,
): GeneratedPlannerProposal {
  return {
    ...generated,
    epics: generated.epics.map((epic) => ({
      ...epic,
      tasks: epic.tasks.map((task) => {
        const existingItems = task.verificationPlan?.items ?? [];

        if (existingItems.length > 0) {
          return task;
        }

        return {
          ...task,
          verificationPlan: {
            ...(task.verificationPlan ?? {}),
            items: [buildFallbackVerificationItem(task.title ?? "task")],
          },
        };
      }),
    })),
  };
}

function buildFallbackVerificationItem(taskTitle: string) {
  return {
    kind: "logic",
    runner: "vitest",
    title: `${taskTitle} verification`,
    description: `Verify ${taskTitle} with a logic-level test.`,
    command: "bun run test:vitest",
  };
}

/* eslint-disable @typescript-eslint/no-unused-vars */
function buildVerificationDesignerPrompt(): string {
  // TODO(VIM-33 Sprint 3): real verification-designer prompt content.
  return "TODO: verification-designer prompt";
}
/* eslint-enable @typescript-eslint/no-unused-vars */
