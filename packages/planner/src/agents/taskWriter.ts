import type { PlannerRunDetail } from "../service";
import type {
  AgentInput,
  EpicPlannerOutput,
  EpicSkeleton,
  PlannerAgentDeps,
  TaskSkeleton,
  TaskWriterOutput,
} from "./types";

/**
 * Task writer agent (VIM-33 Sprint 3).
 *
 * Splits the upstream epic skeletons into atomic tasks. Each task carries
 * title, type, complexity, acceptance, target files, and required inputs --
 * but NOT verification plans (those are the verification designer's job).
 *
 * Resolves its own model slot via `slotResolver("task_writer")`.
 */
export async function runTaskWriter(
  deps: PlannerAgentDeps,
  input: AgentInput,
  upstream: EpicPlannerOutput,
): Promise<TaskWriterOutput> {
  const { model } = await deps.slotResolver("task_writer");
  const result = await deps.generator({
    model,
    system: buildTaskWriterSystemPrompt(),
    prompt: buildTaskWriterPrompt(input.plannerRun, upstream),
    seed: input.seed,
  });

  const generated = (result.object ?? {}) as {
    epics?: Array<{ title?: string; tasks?: TaskSkeleton[] }>;
  };
  const generatedEpics = Array.isArray(generated.epics) ? generated.epics : [];

  // Merge: keep epic skeletons from upstream (goal/acceptance/risks etc.) and
  // overlay the tasks the model produced. We match by title; if the model
  // returned a different set of epics we still keep the upstream skeletons so
  // downstream stages can reason about what the operator agreed to.
  const epicsByTitle = new Map<string, { title?: string; tasks?: TaskSkeleton[] }>();
  for (const epic of generatedEpics) {
    if (epic && typeof epic.title === "string") {
      epicsByTitle.set(epic.title, epic);
    }
  }

  const epics: TaskWriterOutput["epics"] = upstream.epics.map((epic) => {
    const generatedEpic = epic.title ? epicsByTitle.get(epic.title) : undefined;
    const tasks: TaskSkeleton[] = Array.isArray(generatedEpic?.tasks)
      ? generatedEpic!.tasks!
      : [];

    return mergeEpicWithTasks(epic, tasks);
  });

  return {
    summary: upstream.summary,
    epics,
    reasoning: result.reasoning,
  };
}

function mergeEpicWithTasks(
  skeleton: EpicSkeleton,
  tasks: TaskSkeleton[],
): EpicSkeleton & { tasks: TaskSkeleton[] } {
  return { ...skeleton, tasks };
}

export function buildTaskWriterSystemPrompt(): string {
  return [
    "You are TaskGoblin's task writer agent.",
    "Given a set of approved epic skeletons, split each epic into atomic tasks.",
    "Each task must be small enough for one branch and one verification boundary.",
    "Return tasks with title, type, complexity, acceptance, targetFiles, and requires only.",
    "Do NOT include verification items -- the verification designer handles that.",
    "Keep titles concise and acceptance specific.",
    "Use arrays of strings for acceptance, targetFiles, and requires.",
    "Order tasks within each epic by dependency: foundation tasks before extensions.",
  ].join("\n");
}

export function buildTaskWriterPrompt(
  plannerRun: PlannerRunDetail,
  upstream: EpicPlannerOutput,
): string {
  const lines: string[] = [];

  if (plannerRun.project?.name) {
    lines.push(`Project: ${plannerRun.project.name}`);
  }
  if (plannerRun.project?.rootPath) {
    lines.push(`Root Path: ${plannerRun.project.rootPath}`);
  }
  if (plannerRun.goal) {
    lines.push(`Goal: ${plannerRun.goal}`);
  }
  lines.push("");
  lines.push("Approved epic skeletons:");
  lines.push(JSON.stringify(upstream.epics, null, 2));
  lines.push("");
  lines.push("Output guidance:");
  lines.push("- Return one tasks[] per epic, matched by epic title.");
  lines.push("- Each task: title, type (e.g. backend, frontend, infra, docs), complexity (small|medium|large), acceptance, targetFiles, requires.");
  lines.push("- Do not include verificationPlan; the verification designer fills it next.");

  return lines.join("\n");
}
