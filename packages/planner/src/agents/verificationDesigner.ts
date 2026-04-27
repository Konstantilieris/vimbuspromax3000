import type { PlannerRunDetail } from "../service";
import type {
  AgentInput,
  GeneratedPlannerProposal,
  PlannerAgentDeps,
  TaskSkeleton,
  TaskWriterOutput,
  VerificationDesignerOutput,
} from "./types";

/**
 * Verification designer agent (VIM-33 Sprint 3).
 *
 * Reads the upstream task list and produces kind-specific verification items
 * for every task. Falls back to a deterministic vitest item when the model
 * fails to provide one for a task -- the reviewer gate enforces this invariant
 * and may re-route here up to twice.
 *
 * Resolves its own model slot via `slotResolver("verification_designer")`.
 */
export async function runVerificationDesigner(
  deps: PlannerAgentDeps,
  input: AgentInput,
  upstream: TaskWriterOutput,
): Promise<VerificationDesignerOutput> {
  const { model } = await deps.slotResolver("verification_designer");
  const result = await deps.generator({
    model,
    system: buildVerificationDesignerSystemPrompt(),
    prompt: buildVerificationDesignerPrompt(input.plannerRun, upstream),
    seed: input.seed,
  });

  const generated = (result.object ?? {}) as {
    epics?: Array<{
      title?: string;
      tasks?: Array<{
        title?: string;
        verificationPlan?: TaskSkeleton["verificationPlan"];
      }>;
    }>;
  };
  const generatedEpics = Array.isArray(generated.epics) ? generated.epics : [];
  const verificationByEpicAndTask = new Map<
    string,
    Map<string, TaskSkeleton["verificationPlan"]>
  >();

  for (const epic of generatedEpics) {
    if (!epic || typeof epic.title !== "string") continue;
    const inner = new Map<string, TaskSkeleton["verificationPlan"]>();
    verificationByEpicAndTask.set(epic.title, inner);

    if (Array.isArray(epic.tasks)) {
      for (const task of epic.tasks) {
        if (task && typeof task.title === "string" && task.verificationPlan) {
          inner.set(task.title, task.verificationPlan);
        }
      }
    }
  }

  const merged: GeneratedPlannerProposal = {
    summary: upstream.summary,
    epics: upstream.epics.map((epic) => {
      const verifTaskMap = epic.title
        ? verificationByEpicAndTask.get(epic.title)
        : undefined;

      return {
        ...epic,
        tasks: epic.tasks.map((task) => {
          const generatedPlan = task.title ? verifTaskMap?.get(task.title) : undefined;

          if (generatedPlan) {
            return { ...task, verificationPlan: generatedPlan };
          }

          return task;
        }),
      };
    }),
  };

  return {
    generated: ensureVerificationItems(merged),
    reasoning: result.reasoning,
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

export function buildVerificationDesignerSystemPrompt(): string {
  return [
    "You are TaskGoblin's verification designer agent.",
    "Given an approved set of tasks, produce a verification plan for each task.",
    "Every task must end up with at least one verification item.",
    "Prefer command-backed items that can run through POST /executions/:id/test-runs.",
    "A verification item is runnable now ONLY when it has a non-empty command field.",
    "Per-kind field guidance:",
    "- logic: set command (e.g. bun run test:vitest) and testFilePath.",
    "- integration: set command (e.g. bunx vitest run src/app.test.ts) and route.",
    "- typecheck: set command to bun run typecheck.",
    "- lint: set command to bun run lint or equivalent.",
    "- a11y: set command to a Playwright CLI command; set route and interaction.",
    "- visual: omit command if a shell equivalent does not exist; set route, interaction, expectedAssetId.",
    "- evidence: omit command; describe what the operator must inspect.",
    "Treat Playwright CLI as a normal shell command; do not assume MCP-backed browser execution.",
  ].join("\n");
}

export function buildVerificationDesignerPrompt(
  plannerRun: PlannerRunDetail,
  upstream: TaskWriterOutput,
): string {
  const lines: string[] = [];

  if (plannerRun.project?.name) {
    lines.push(`Project: ${plannerRun.project.name}`);
  }
  if (plannerRun.goal) {
    lines.push(`Goal: ${plannerRun.goal}`);
  }
  lines.push("");
  lines.push("Approved tasks (per epic):");

  for (const epic of upstream.epics) {
    lines.push(`Epic: ${epic.title ?? "<untitled epic>"}`);
    for (const task of epic.tasks) {
      lines.push(
        `  - ${task.title ?? "<untitled task>"} (type: ${task.type ?? "general"}, complexity: ${task.complexity ?? "medium"})`,
      );
    }
  }

  lines.push("");
  lines.push("Output guidance:");
  lines.push("- Return one verificationPlan per task, matched by epic title + task title.");
  lines.push("- Each verification item must have kind, title, description.");
  lines.push("- Items meant to run NOW must include a non-empty command.");

  return lines.join("\n");
}
