import { createHash } from "node:crypto";
import type { EvalContext } from "./types";

export function hashEvalInputs(context: EvalContext): string {
  const payload = {
    executionId: context.execution.id,
    testRuns: context.execution.testRuns.map((r) => ({
      command: r.command,
      status: r.status,
      exitCode: r.exitCode,
    })),
    agentSteps: context.execution.agentSteps.map((s) => ({
      role: s.role,
      status: s.status,
      modelName: s.modelName,
    })),
    mcpCalls: context.mcpCalls.map((c) => ({
      serverName: c.serverName,
      toolName: c.toolName,
      mutability: c.mutability,
      status: c.status,
      approvalId: c.approvalId,
      argumentsHash: c.argumentsHash,
    })),
    retryCount: context.execution.retryCount,
    verificationPlan: context.execution.latestVerificationPlan
      ? {
          status: context.execution.latestVerificationPlan.status,
          approved: context.execution.latestVerificationPlan.approvedAt !== null,
          items: context.execution.latestVerificationPlan.items.map((item) => ({
            kind: item.kind,
            runner: item.runner,
            title: item.title,
            description: item.description,
            command: item.command,
            status: item.status,
          })),
        }
      : null,
  };

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
