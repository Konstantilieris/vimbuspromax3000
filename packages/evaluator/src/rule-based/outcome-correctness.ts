import type { EvalContext } from "../types";

export function evaluateOutcomeCorrectnessRule(context: EvalContext): { score: number; reasoning: string } {
  const runs = context.execution.testRuns;

  if (runs.length === 0) {
    return { score: 0, reasoning: "No test runs found. Cannot verify outcome correctness." };
  }

  const passed = runs.filter((r) => r.exitCode === 0).length;
  const total = runs.length;
  const score = Math.round((passed / total) * 100);

  return {
    score,
    reasoning: `${passed}/${total} test runs passed (exit code 0).`,
  };
}
