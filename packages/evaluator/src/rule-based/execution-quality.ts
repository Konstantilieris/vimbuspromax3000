import type { DimensionResult, EvalContext } from "../types";
import { DIMENSION_THRESHOLDS } from "../thresholds";
import { dimensionVerdict } from "../verdict";

export function evaluateExecutionQuality(context: EvalContext): DimensionResult {
  const threshold = DIMENSION_THRESHOLDS["execution_quality"]!;
  let score = 100;
  const issues: string[] = [];

  // Deduct for failed agent steps
  const failedSteps = context.execution.agentSteps.filter((s) => s.status === "failed");
  if (failedSteps.length > 0) {
    score -= failedSteps.length * 15;
    issues.push(`${failedSteps.length} failed agent step(s)`);
  }

  // Deduct for repeated identical failed MCP calls
  const failedCalls = context.mcpCalls.filter((c) => c.status === "failed");
  const failGroups = new Map<string, number>();
  for (const call of failedCalls) {
    const key = `${call.toolName}:${call.argumentsHash ?? ""}`;
    failGroups.set(key, (failGroups.get(key) ?? 0) + 1);
  }
  for (const [key, count] of failGroups) {
    if (count > 1) {
      score -= 10;
      issues.push(`Repeated failed calls to ${key.split(":")[0]} (${count}x)`);
    }
  }

  // Deduct for retries
  const retries = context.execution.retryCount;
  if (retries > 0) {
    score -= retries * 5;
    issues.push(`${retries} retry attempt(s)`);
  }

  score = Math.max(0, score);

  const evidenceJson = JSON.stringify({
    failedAgentSteps: failedSteps.length,
    repeatedFailedMcpGroups: failGroups.size,
    retryCount: retries,
  });

  return {
    dimension: "execution_quality",
    score,
    threshold,
    verdict: dimensionVerdict(score, threshold),
    evaluatorType: "rule_based",
    reasoning:
      issues.length === 0
        ? "Execution completed cleanly with no failures or retries."
        : `Quality issues: ${issues.join("; ")}`,
    evidenceJson,
  };
}
