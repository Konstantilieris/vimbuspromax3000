import type { EvalContext, JudgeGenerator } from "../types";

const SYSTEM_PROMPT = `You are a software quality evaluator. Your job is to assess whether MCP tools were used correctly and efficiently during task execution.

Evaluate tool selection and usage strategy:
- Were the right tools selected for each step?
- Was usage efficient (no unnecessary calls)?
- Were tool results actually used in subsequent steps?
- Were obvious tools missed?
- Was there unnecessary or redundant tool invocation?

Score on a 0-100 scale:
- 90-100: Optimal tool selection and efficient usage
- 75-89: Good usage with minor inefficiencies
- 60-74: Noticeable gaps or inefficiencies
- <60: Poor tool selection or significantly wasteful usage

Return a JSON object with "score" (integer 0-100) and "reason" (concise explanation).`;

export async function evaluateToolUsageQualityLlm(
  context: EvalContext,
  model: unknown,
  generator: JudgeGenerator,
): Promise<{ score: number; reason: string }> {
  const callSummary = context.mcpCalls.map((c) => ({
    serverName: c.serverName,
    toolName: c.toolName,
    mutability: c.mutability,
    status: c.status,
    approved: !!c.approvalId,
    latencyMs: c.latencyMs,
  }));

  const prompt = [
    `Task: ${context.execution.task.title}`,
    `Task type: ${context.execution.task.type}`,
    ``,
    `MCP tool calls made (${callSummary.length} total):`,
    JSON.stringify(callSummary, null, 2),
    ``,
    `Were the right tools selected? Was usage efficient?`,
    `Were tool results used properly? Were obvious tools missed?`,
  ].join("\n");

  return generator({ model, system: SYSTEM_PROMPT, prompt });
}
