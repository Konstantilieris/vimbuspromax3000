import type { DimensionResult, EvalContext, JudgeGenerator } from "../types";
import { DIMENSION_THRESHOLDS } from "../thresholds";
import { dimensionVerdict } from "../verdict";
import { evaluateOutcomeCorrectnessRule } from "../rule-based/outcome-correctness";
import { evaluateOutcomeCorrectnessLlm } from "../llm-judges/outcome-correctness-llm";

export async function evaluateOutcomeCorrectness(
  context: EvalContext,
  model: unknown,
  generator: JudgeGenerator,
  modelName: string,
): Promise<DimensionResult> {
  const threshold = DIMENSION_THRESHOLDS["outcome_correctness"]!;

  const ruleResult = evaluateOutcomeCorrectnessRule(context);
  const llmResult = await evaluateOutcomeCorrectnessLlm(context, model, generator);

  const score = Math.round(ruleResult.score * 0.6 + llmResult.score * 0.4);

  const reasoning = [
    `Rule-based (test success rate, 60%): score ${ruleResult.score} — ${ruleResult.reasoning}`,
    `LLM judge (acceptance criteria coverage, 40%): score ${llmResult.score} — ${llmResult.reason}`,
  ].join(" | ");

  const evidenceJson = JSON.stringify({
    ruleScore: ruleResult.score,
    llmScore: llmResult.score,
    finalScore: score,
    weights: { rule: 0.6, llm: 0.4 },
  });

  return {
    dimension: "outcome_correctness",
    score,
    threshold,
    verdict: dimensionVerdict(score, threshold),
    evaluatorType: "hybrid",
    reasoning,
    modelName,
    promptVersion: "v1",
    evidenceJson,
  };
}
