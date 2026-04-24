import type { DimensionResult, EvalContext, JudgeGenerator } from "../types";
import { DIMENSION_THRESHOLDS } from "../thresholds";
import { dimensionVerdict } from "../verdict";

const SYSTEM_PROMPT = `You are a software quality evaluator. Your job is to assess whether an epic's tasks are well-decomposed.

Evaluate the task decomposition:
- Are tasks atomic and appropriately branch-sized?
- Is dependency ordering clear and correct?
- Are task types and complexity labels appropriate?
- Are there redundant, overlapping, or under-specified tasks?

Score on a 0-100 scale:
- 90-100: Tasks are well-decomposed, ordered, and scoped
- 75-89: Mostly good; minor ordering or scoping issues
- 60-74: Noticeable decomposition issues; some tasks too large or unclear
- <60: Poor decomposition; tasks are too broad, overlapping, or disordered

Return a JSON object with "score" (integer 0-100) and "reason" (concise explanation).`;

export async function evaluateTaskDecomposition(
  context: EvalContext,
  model: unknown,
  generator: JudgeGenerator,
  modelName: string,
): Promise<DimensionResult> {
  const threshold = DIMENSION_THRESHOLDS["task_decomposition"]!;
  const { epic } = context.execution.task;

  const taskSummary = epic.tasks.map((t) => ({
    stableId: t.stableId,
    title: t.title,
    type: t.type,
    complexity: t.complexity,
    orderIndex: t.orderIndex,
    requires: safeParseJson(t.requiresJson),
    acceptanceCriteria: safeParseJson(t.acceptanceJson),
  }));

  const prompt = [
    `Epic goal: ${epic.goal}`,
    ``,
    `Tasks (${taskSummary.length} total):`,
    JSON.stringify(taskSummary, null, 2),
    ``,
    `Are tasks atomic and branch-sized?`,
    `Is dependency ordering clear?`,
    `Are task types and complexity labels appropriate?`,
  ].join("\n");

  const result = await generator({ model, system: SYSTEM_PROMPT, prompt });

  return {
    dimension: "task_decomposition",
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
