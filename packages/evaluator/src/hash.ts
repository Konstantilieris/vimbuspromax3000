import { createHash } from "node:crypto";
import type { EvalContext } from "./types";

export function hashEvalInputs(context: EvalContext): string {
  const payload = {
    executionId: context.execution.id,
    testRuns: context.execution.testRuns.map((r) => ({ id: r.id, status: r.status, exitCode: r.exitCode })),
    agentSteps: context.execution.agentSteps.map((s) => ({ id: s.id, status: s.status })),
    mcpCalls: context.mcpCalls.map((c) => ({ id: c.id, status: c.status, approvalId: c.approvalId })),
    retryCount: context.execution.retryCount,
    verificationPlanId: context.execution.latestVerificationPlan?.id ?? null,
  };

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
