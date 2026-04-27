import type { PlannerRunDetail } from "../service";
import type {
  AgentInput,
  EpicPlannerOutput,
  EpicSkeleton,
  PlannerAgentDeps,
} from "./types";

/**
 * Epic planner agent (VIM-33 Sprint 3).
 *
 * Owns ONLY epic-level metadata: title, goal, acceptance, risks. Tasks and
 * verification items are produced downstream by the task writer and
 * verification designer respectively.
 *
 * Resolves its own model slot via `slotResolver("epic_planner")` so per-agent
 * slot routing flows through `resolveModelSlot` in the orchestrator wiring.
 */
export async function runEpicPlanner(
  deps: PlannerAgentDeps,
  input: AgentInput,
): Promise<EpicPlannerOutput> {
  const { model } = await deps.slotResolver("epic_planner");
  const result = await deps.generator({
    model,
    system: buildEpicPlannerSystemPrompt(),
    prompt: buildEpicPlannerPrompt(input.plannerRun),
    seed: input.seed,
  });

  const generated = (result.object ?? {}) as {
    summary?: string;
    epics?: EpicSkeleton[];
  };

  return {
    summary: generated.summary,
    epics: Array.isArray(generated.epics) ? generated.epics : [],
    reasoning: result.reasoning,
  };
}

export function buildEpicPlannerSystemPrompt(): string {
  return [
    "You are TaskGoblin's epic planner agent.",
    "Your sole responsibility is to group the operator goal into a small set of well-scoped epics.",
    "Return ONLY epic-level metadata: title, goal, acceptance criteria, and risks.",
    "Do NOT propose tasks. Do NOT propose verification plans. Downstream agents own those.",
    "Keep epics narrowly scoped, ordered, and grounded in the operator goal and interview JSON.",
    "Use concise titles. Acceptance and risks must be arrays of short strings.",
    "Avoid execution, branching, or patch-review epics -- those are out of scope for this slice.",
  ].join("\n");
}

export function buildEpicPlannerPrompt(plannerRun: PlannerRunDetail): string {
  const lines: string[] = [];

  if (plannerRun.project?.name) {
    lines.push(`Project: ${plannerRun.project.name}`);
  }
  if (plannerRun.project?.rootPath) {
    lines.push(`Root Path: ${plannerRun.project.rootPath}`);
  }
  if (plannerRun.project?.baseBranch) {
    lines.push(`Base Branch: ${plannerRun.project.baseBranch}`);
  }
  if (plannerRun.project?.branchNaming) {
    lines.push(`Branch Naming: ${plannerRun.project.branchNaming}`);
  }
  if (plannerRun.goal) {
    lines.push(`Goal: ${plannerRun.goal}`);
  }
  if (plannerRun.moduleName) {
    lines.push(`Module: ${plannerRun.moduleName}`);
  }
  if (plannerRun.contextPath) {
    lines.push(`Context Path: ${plannerRun.contextPath}`);
  }

  lines.push("Interview JSON:");
  lines.push(JSON.stringify(plannerRun.interview ?? {}, null, 2));
  lines.push("Output guidance:");
  lines.push("- Return only epic skeletons (no tasks, no verification items).");
  lines.push("- Each epic must have a concise title and a goal.");
  lines.push("- Use arrays of strings for acceptance and risks.");
  lines.push("- Order epics by dependency: foundation epics before extensions.");

  return lines.join("\n");
}
