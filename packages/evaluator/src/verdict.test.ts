import type { DimensionResult, EvalVerdict } from "./types";
import { computeAggregate } from "./verdict";

describe("computeAggregate", () => {
  test("proceeds when aggregate equals the proceed threshold", () => {
    expect(computeAggregate([result("execution_quality", 80)])).toEqual({
      aggregateScore: 80,
      decision: "proceed",
    });
  });

  test("warns when aggregate is below proceed but at least warn threshold", () => {
    expect(computeAggregate([result("execution_quality", 75)])).toEqual({
      aggregateScore: 75,
      decision: "warn",
    });
  });

  test("retries first non-hard aggregate failures", () => {
    expect(computeAggregate([result("execution_quality", 69, "fail")], { retryCount: 0 })).toEqual({
      aggregateScore: 69,
      decision: "retry",
    });
  });

  test("escalates repeated non-hard aggregate failures", () => {
    expect(computeAggregate([result("execution_quality", 69, "fail")], { retryCount: 1 })).toEqual({
      aggregateScore: 69,
      decision: "escalate",
    });
  });

  test("fails immediately when a hard-fail dimension fails", () => {
    expect(computeAggregate([result("outcome_correctness", 50, "fail")], { retryCount: 0 })).toEqual({
      aggregateScore: 50,
      decision: "fail",
    });
  });
});

function result(dimension: string, score: number, verdict: EvalVerdict = "pass"): DimensionResult {
  return {
    dimension,
    score,
    threshold: 75,
    verdict,
    evaluatorType: "rule_based",
    reasoning: "test result",
  };
}
