import type { PlannerRunDetail } from "../service";
import type { AgentInput, EpicPlannerOutput, GeneratedPlannerProposal, PlannerAgentDeps } from "./types";

/**
 * Sprint 2 epic planner.
 *
 * NOTE: The per-agent prompt below is a placeholder stub. Sprint 3 will replace
 * `buildEpicPlannerPrompt` and `buildEpicPlannerSystemPrompt` with the real
 * per-role prompts from docs/planner/agent-roles.md. For now the prompt content
 * mirrors the monolithic planner prompt so the underlying model still receives
 * the full operator context and can produce a complete proposal -- the other
 * agents in the pipeline are pass-through / shaping stages until prompts are
 * specialised next sprint.
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

  return {
    generated: result.object as GeneratedPlannerProposal,
    reasoning: result.reasoning,
  };
}

function buildEpicPlannerSystemPrompt() {
  // TODO(VIM-33 Sprint 3): replace with the real epic-planner prompt from
  // docs/planner/agent-roles.md. The text below is the monolithic planner
  // prompt preserved as a Sprint 2 fallback so existing tests keep passing.
  return [
    "You are TaskGoblin's planner service.",
    "Produce a software delivery proposal that can be persisted directly into SQLite planning records.",
    "Keep the output grounded in the operator goal and interview JSON.",
    "Every epic must include one or more tasks.",
    "Every task must include acceptance criteria and at least one verification item.",
    "Keep tasks narrowly scoped, ordered, and implementation-oriented.",
    "Do not include execution, branching, or patch-review tasks yet.",
    "Prefer repo-native verification commands such as bun run test:vitest and bun run typecheck when they fit.",
    "The current POST /executions/:id/test-runs slice executes only approved verification items with a non-empty shell command.",
    "Kind alone never makes a verification item runnable in this slice.",
    "Treat Playwright CLI as a normal shell command when needed; do not assume browser MCP or tool-session execution.",
    "If a visual or evidence check cannot be expressed as a shell command, it is not runnable by the current execution slice.",
    "Per-kind field guidance:",
    "- logic: set command (e.g. bun run test:vitest) and testFilePath pointing to the test file.",
    "- integration: set command (e.g. bunx vitest run src/app.test.ts) and route for the API or module under test.",
    "- typecheck: set command to bun run typecheck; no other required fields.",
    "- lint: set command to bun run lint or equivalent; no other required fields.",
    "- a11y: set command to a Playwright CLI command; set route and interaction describing the flow.",
    "- visual: omit command if a shell equivalent does not exist; set route, interaction, and expectedAssetId as deferred metadata for operator review.",
    "- evidence: omit command; set description to clearly state what the operator must inspect and where to find it.",
  ].join("\n");
}

function buildEpicPlannerPrompt(plannerRun: PlannerRunDetail) {
  // TODO(VIM-33 Sprint 3): replace with epic-planner-specific prompt that asks
  // ONLY for epics (no tasks, no verification). For Sprint 2 the monolithic
  // prompt is reused so the single generator call still returns the full
  // proposal shape downstream agents are wired to thread.
  const lines = [
    `Project: ${plannerRun.project.name}`,
    `Root Path: ${plannerRun.project.rootPath}`,
    `Base Branch: ${plannerRun.project.baseBranch}`,
    `Branch Naming: ${plannerRun.project.branchNaming}`,
    `Goal: ${plannerRun.goal}`,
  ];

  if (plannerRun.moduleName) {
    lines.push(`Module: ${plannerRun.moduleName}`);
  }

  if (plannerRun.contextPath) {
    lines.push(`Context Path: ${plannerRun.contextPath}`);
  }

  lines.push("Interview JSON:");
  lines.push(JSON.stringify(plannerRun.interview ?? {}, null, 2));
  lines.push("Output guidance:");
  lines.push("- Use concise epic and task titles.");
  lines.push("- Keep acceptance and risks specific.");
  lines.push("- Use arrays of strings for acceptance, risks, targetFiles, and requires.");
  lines.push("- Prefer command-backed verification items that can run through POST /executions/:id/test-runs.");
  lines.push("- A verification item is runnable NOW only when it has a non-empty command field.");
  lines.push("- Treat Playwright CLI as a normal shell command only; do not assume MCP-backed browser execution.");
  lines.push("- visual and evidence items without a shell command are valid deferred metadata but will NOT run.");
  lines.push("- logic: fill testFilePath. integration: fill route. a11y: fill route and interaction. visual: fill route, interaction, expectedAssetId.");

  return lines.join("\n");
}
