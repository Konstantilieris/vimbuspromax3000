import type { EvalContext, JudgeGenerator } from "../types";

const SYSTEM_PROMPT = `You are a software quality evaluator. Your job is to assess whether an implementation actually satisfies its acceptance criteria.

Score on a 0-100 scale:
- 90-100: All acceptance criteria demonstrably met; test results show clear correctness
- 75-89: Most criteria met; minor gaps or weak evidence
- 60-74: Partial coverage; important criteria missing or tests too superficial
- <60: Significant gaps; acceptance criteria not satisfied

Return a JSON object with "score" (integer 0-100) and "reason" (concise explanation citing specific evidence).`;

export async function evaluateOutcomeCorrectnessLlm(
  context: EvalContext,
  model: unknown,
  generator: JudgeGenerator,
): Promise<{ score: number; reason: string }> {
  const acceptance = safeParseJson(context.execution.task.acceptanceJson) as unknown[];
  const testRunSummary = context.execution.testRuns.map((r) => ({
    command: r.command,
    status: r.status,
    exitCode: r.exitCode,
  }));
  const patchSummary = context.execution.patchReviews[0]?.summary ?? null;

  const prompt = [
    `Task: ${context.execution.task.title}`,
    `Task type: ${context.execution.task.type} | Complexity: ${context.execution.task.complexity}`,
    ``,
    `Acceptance criteria:`,
    JSON.stringify(acceptance, null, 2),
    ``,
    `Test run results (${context.execution.testRuns.length} total):`,
    JSON.stringify(testRunSummary, null, 2),
    patchSummary ? `\nPatch summary:\n${patchSummary}` : "",
    ``,
    `Does the implementation actually satisfy the acceptance criteria?`,
    `Are there gaps despite tests passing?`,
    `Do the test results genuinely demonstrate correctness for each criterion?`,
  ]
    .filter(Boolean)
    .join("\n");

  return generator({ model, system: SYSTEM_PROMPT, prompt });
}

function safeParseJson(value: string | null): unknown {
  if (!value) return [];
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
