import type { DimensionResult, EvalContext, JudgeGenerator } from "../types";
import { DIMENSION_THRESHOLDS } from "../thresholds";
import { dimensionVerdict } from "../verdict";

const SYSTEM_PROMPT = `You are a software quality evaluator. Your job is to assess the regression risk of a code change.

Evaluate how likely this change is to degrade existing behavior:
- Are critical or widely-used files touched?
- Is the test coverage adequate for the changed area?
- Is the change well-scoped or does it have broad side effects?
- Are there signs of incomplete refactors or risky structural changes?

Score on a 0-100 scale (higher = lower risk):
- 90-100: Isolated change with strong test coverage; low regression risk
- 75-89: Mostly safe; minor coverage gaps or moderate scope
- 60-74: Moderate risk; coverage gaps or broad scope
- <60: High regression risk; critical paths touched with weak coverage

Return a JSON object with "score" (integer 0-100) and "reason" (concise explanation).`;

export async function evaluateRegressionRisk(
  context: EvalContext,
  model: unknown,
  generator: JudgeGenerator,
  modelName: string,
): Promise<DimensionResult> {
  const threshold = DIMENSION_THRESHOLDS["regression_risk"]!;
  const targetFiles = safeParseJson(context.execution.task.targetFilesJson) as string[];
  const patchReview = context.execution.patchReviews[0] ?? null;
  const testRunSummary = context.execution.testRuns.map((r) => ({
    command: r.command,
    status: r.status,
    exitCode: r.exitCode,
  }));

  const prompt = [
    `Task: ${context.execution.task.title}`,
    `Task type: ${context.execution.task.type} | Complexity: ${context.execution.task.complexity}`,
    targetFiles.length > 0 ? `\nTarget files:\n${JSON.stringify(targetFiles, null, 2)}` : "",
    patchReview?.summary ? `\nPatch summary:\n${patchReview.summary}` : "",
    ``,
    `Test results (${testRunSummary.length} test runs):`,
    JSON.stringify(testRunSummary, null, 2),
    ``,
    `How likely is this change to degrade existing behavior?`,
    `Are critical paths touched? Is test coverage adequate for the changed area?`,
  ]
    .filter(Boolean)
    .join("\n");

  const result = await generator({ model, system: SYSTEM_PROMPT, prompt });

  return {
    dimension: "regression_risk",
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
