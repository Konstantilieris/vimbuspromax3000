import type { DimensionResult, EvalContext, JudgeGenerator } from "../types";
import { DIMENSION_THRESHOLDS } from "../thresholds";
import { dimensionVerdict } from "../verdict";

const SYSTEM_PROMPT = `You are a software quality evaluator. Your job is to assess whether a verification plan is rigorous, well-targeted, and correctly executed.

Evaluate BOTH plan quality AND execution alignment:
- Are verification items specific and meaningful vs superficial?
- Do they actually prove the acceptance criteria?
- Are important verification steps missing?
- Do the executed test runs correspond to the verification plan?
- Are acceptance criteria genuinely covered by the items?

Score on a 0-100 scale:
- 90-100: Rigorous plan; all criteria covered; execution matches plan
- 75-89: Adequate plan; minor gaps; execution mostly aligned
- 60-74: Weak plan or partial execution; meaningful gaps
- <60: Superficial, incomplete, or misaligned verification

Return a JSON object with "score" (integer 0-100) and "reason" (concise explanation).`;

export async function evaluateVerificationQuality(
  context: EvalContext,
  model: unknown,
  generator: JudgeGenerator,
  modelName: string,
): Promise<DimensionResult> {
  const threshold = DIMENSION_THRESHOLDS["verification_quality"]!;
  const acceptance = safeParseJson(context.execution.task.acceptanceJson) as unknown[];
  const plan = context.execution.latestVerificationPlan;
  const planItems = plan?.items.map((i) => ({
    kind: i.kind,
    runner: i.runner,
    title: i.title,
    description: i.description,
    command: i.command ?? null,
    status: i.status,
  }));
  const testRunSummary = context.execution.testRuns.map((r) => ({
    command: r.command,
    status: r.status,
    exitCode: r.exitCode,
  }));

  const prompt = [
    `Task: ${context.execution.task.title}`,
    ``,
    `Acceptance criteria:`,
    JSON.stringify(acceptance, null, 2),
    ``,
    `Verification plan items (${planItems?.length ?? 0}):`,
    JSON.stringify(planItems ?? [], null, 2),
    ``,
    `Test runs executed (${testRunSummary.length}):`,
    JSON.stringify(testRunSummary, null, 2),
    ``,
    `Are the verification items specific enough to prove acceptance criteria?`,
    `Are important checks missing from the plan or execution?`,
    `Do the test runs correspond to the verification plan?`,
  ].join("\n");

  const result = await generator({ model, system: SYSTEM_PROMPT, prompt });

  return {
    dimension: "verification_quality",
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
