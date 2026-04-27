import type { AgentInput, EpicPlannerOutput, PlannerAgentDeps, TaskWriterOutput } from "./types";

/**
 * Sprint 2 task writer.
 *
 * NOTE: This is a pass-through stage in Sprint 2. The monolithic generator
 * call inside `epicPlanner` already produces tasks alongside epics, so the task
 * writer simply forwards that output. Sprint 3 will:
 *
 *   1. Replace the placeholder prompt below with a real task-writer prompt
 *      from docs/planner/agent-roles.md.
 *   2. Switch `epicPlanner` to produce ONLY epics, then have this stage call
 *      `deps.generator` per epic to expand tasks.
 *
 * `deps` and `input` are intentionally accepted (and `deps` is referenced via
 * a noop assertion) so the signature is stable for Sprint 3.
 */
export async function runTaskWriter(
  deps: PlannerAgentDeps,
  input: AgentInput,
  upstream: EpicPlannerOutput,
): Promise<TaskWriterOutput> {
  // TODO(VIM-33 Sprint 3): call deps.generator with the per-epic task-writer
  // prompt and merge results back. For now we trust epicPlanner's monolithic
  // output and keep `deps` / `input` referenced so the signature is stable.
  void deps;
  void input;

  return upstream;
}

/* eslint-disable @typescript-eslint/no-unused-vars */
function buildTaskWriterPrompt(): string {
  // TODO(VIM-33 Sprint 3): real task-writer prompt content.
  return "TODO: task-writer prompt";
}
/* eslint-enable @typescript-eslint/no-unused-vars */
