import type { DimensionResult, EvalContext, JudgeGenerator } from "../types";
import { DIMENSION_THRESHOLDS } from "../thresholds";
import { dimensionVerdict } from "../verdict";
import { evaluateToolUsageQualityRule } from "../rule-based/tool-usage-quality";
import { evaluateToolUsageQualityLlm } from "../llm-judges/tool-usage-quality-llm";

export async function evaluateToolUsageQuality(
  context: EvalContext,
  model: unknown,
  generator: JudgeGenerator,
  modelName: string,
): Promise<DimensionResult> {
  const threshold = DIMENSION_THRESHOLDS["tool_usage_quality"]!;

  const ruleResult = evaluateToolUsageQualityRule(context);

  if (ruleResult === null) {
    const score = 0;
    return {
      dimension: "tool_usage_quality",
      score,
      threshold,
      verdict: dimensionVerdict(score, threshold),
      evaluatorType: "hybrid",
      reasoning: "No MCP tool-use evidence was recorded for this execution.",
      modelName,
      promptVersion: "v1",
      evidenceJson: JSON.stringify({
        ruleScore: score,
        llmScore: null,
        finalScore: score,
        totalCalls: 0,
        missingToolUseEvidence: true,
      }),
    };
  }

  const llmResult = await evaluateToolUsageQualityLlm(context, model, generator);

  const score = Math.round(ruleResult.score * 0.6 + llmResult.score * 0.4);

  const reasoning = [
    `Rule-based (reliability/safety, 60%): score ${ruleResult.score} — ${ruleResult.reasoning}`,
    `LLM judge (tool selection/efficiency, 40%): score ${llmResult.score} — ${llmResult.reason}`,
  ].join(" | ");

  const evidenceJson = JSON.stringify({
    ruleScore: ruleResult.score,
    llmScore: llmResult.score,
    finalScore: score,
    weights: { rule: 0.6, llm: 0.4 },
    totalCalls: context.mcpCalls.length,
  });

  return {
    dimension: "tool_usage_quality",
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
