import type { DimensionResult, EvalDecision, EvalVerdict } from "./types";
import {
  AGGREGATE_PROCEED_THRESHOLD,
  AGGREGATE_WARN_THRESHOLD,
  DIMENSION_WEIGHTS,
  HARD_FAIL_DIMENSIONS,
} from "./thresholds";

export function dimensionVerdict(score: number, threshold: number): EvalVerdict {
  if (score >= threshold) return "pass";
  if (score >= 60) return "warn";
  return "fail";
}

export function computeAggregate(results: DimensionResult[], options: { retryCount?: number } = {}): {
  aggregateScore: number;
  decision: EvalDecision;
} {
  // Hard-fail check: any hard-fail dimension that fails → block immediately
  for (const result of results) {
    if (HARD_FAIL_DIMENSIONS.has(result.dimension) && result.verdict === "fail") {
      return {
        aggregateScore: result.score,
        decision: "fail",
      };
    }
  }

  // Weighted aggregate
  let weightedSum = 0;
  let totalWeight = 0;

  for (const result of results) {
    const weight = DIMENSION_WEIGHTS[result.dimension] ?? 1.0;
    weightedSum += result.score * weight;
    totalWeight += weight;
  }

  const aggregateScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;

  let decision: EvalDecision;
  if (aggregateScore >= AGGREGATE_PROCEED_THRESHOLD) {
    decision = "proceed";
  } else if (aggregateScore >= AGGREGATE_WARN_THRESHOLD) {
    decision = "warn";
  } else {
    decision = (options.retryCount ?? 0) === 0 ? "retry" : "escalate";
  }

  return { aggregateScore, decision };
}
