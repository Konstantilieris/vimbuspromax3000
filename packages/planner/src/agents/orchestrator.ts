import type { PlannerProposalInput } from "@vimbuspromax3000/db";
import { normalizeGeneratedPlannerProposal } from "../service";
import { runEpicPlanner } from "./epicPlanner";
import { runReviewer } from "./reviewer";
import { runTaskWriter } from "./taskWriter";
import type {
  AgentInput,
  OrchestratorOutput,
  PlannerAgentDeps,
} from "./types";
import { runVerificationDesigner } from "./verificationDesigner";

/**
 * Sprint 2 planner orchestrator.
 *
 * Threads:
 *
 *   epicPlanner -> taskWriter -> verificationDesigner -> reviewer
 *
 * and returns a normalized `PlannerProposalInput` ready to be persisted by
 * `service.ts`. The output shape is intentionally identical to the previous
 * monolithic generator path so existing tests in
 * `packages/planner/src/index.test.ts` keep passing without schema changes.
 */
export async function runOrchestrator(
  deps: PlannerAgentDeps,
  input: AgentInput,
): Promise<OrchestratorOutput> {
  const epicResult = await runEpicPlanner(deps, input);
  const taskResult = await runTaskWriter(deps, input, epicResult);
  const verificationResult = await runVerificationDesigner(deps, input, taskResult);
  const verdict = await runReviewer(deps, input, verificationResult);

  if (!verdict.ok) {
    throw new Error(verdict.reason);
  }

  const proposal: PlannerProposalInput = normalizeGeneratedPlannerProposal(
    input.plannerRun.id,
    verdict.output.generated,
    {
      summaryFallback: `Plan for ${input.plannerRun.goal}`,
    },
  );

  return {
    proposal,
    reasoning: verdict.output.reasoning,
  };
}
