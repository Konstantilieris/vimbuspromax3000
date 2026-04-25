import type { DimensionResult, EvalContext, JudgeGenerator } from "../types";
import { DIMENSION_THRESHOLDS } from "../thresholds";
import { dimensionVerdict } from "../verdict";

const SYSTEM_PROMPT = `You are a software quality evaluator. Your job is to assess whether a planner captured the goal, constraints, risks, and acceptance criteria completely.

Evaluate the planning quality:
- Were the goal and constraints fully captured?
- Is acceptance criteria complete and verifiable?
- Are risks identified?
- Is the epic well-scoped and well-targeted?

Score on a 0-100 scale:
- 90-100: Complete, well-scoped plan with clear criteria and risks
- 75-89: Adequate plan; minor gaps in criteria or risk coverage
- 60-74: Partial coverage; important constraints or criteria missing
- <60: Significantly incomplete planning

Return a JSON object with "score" (integer 0-100) and "reason" (concise explanation).`;

export async function evaluatePlannerQuality(
  context: EvalContext,
  model: unknown,
  generator: JudgeGenerator,
  modelName: string,
): Promise<DimensionResult> {
  const threshold = DIMENSION_THRESHOLDS["planner_quality"]!;
  const { epic } = context.execution.task;
  const epicAcceptance = safeParseJson(epic.acceptanceJson) as unknown[];
  const epicRisks = safeParseJson(epic.risksJson) as unknown[];
  const taskAcceptance = safeParseJson(context.execution.task.acceptanceJson) as unknown[];
  const interview = safeParseJson(epic.plannerRun.interviewJson);

  const prompt = [
    `Project: ${epic.project.name}`,
    `Planner goal: ${epic.plannerRun.goal}`,
    interview ? `\nInterview context:\n${JSON.stringify(interview, null, 2)}` : "",
    ``,
    `Epic: ${epic.goal}`,
    `Epic acceptance criteria: ${JSON.stringify(epicAcceptance, null, 2)}`,
    `Epic risks: ${JSON.stringify(epicRisks, null, 2)}`,
    ``,
    `Task: ${context.execution.task.title} (${context.execution.task.type}, ${context.execution.task.complexity})`,
    `Task acceptance criteria: ${JSON.stringify(taskAcceptance, null, 2)}`,
    ``,
    `Did the planner fully capture the goal and constraints?`,
    `Is the acceptance criteria complete and verifiable?`,
    `Are risks adequately identified?`,
  ]
    .filter(Boolean)
    .join("\n");

  const result = await generator({ model, system: SYSTEM_PROMPT, prompt });

  return {
    dimension: "planner_quality",
    score: result.score,
    threshold,
    verdict: dimensionVerdict(result.score, threshold),
    evaluatorType: "llm_judge",
    reasoning: result.reason,
    modelName,
    promptVersion: "v1",
  };
}

function safeParseJson(value: string | null): unknown {
  if (!value) return [];
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
