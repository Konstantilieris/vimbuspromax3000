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
 * Planner orchestrator (VIM-33 Sprint 3).
 *
 * Threads:
 *
 *   epicPlanner -> taskWriter -> verificationDesigner -> reviewer
 *
 * Each agent now makes its own underlying generator call (3 total) and resolves
 * its own model slot via `slotResolver(<role>)`. The reviewer remains a
 * deterministic gate that may re-route to the verification designer up to
 * `REVIEWER_MAX_REROUTES` times.
 *
 * Returns a normalized `PlannerProposalInput` ready to be persisted by
 * `service.ts`. The output shape is intentionally identical to the previous
 * monolithic generator path so existing callers and tests in
 * `packages/planner/src/index.test.ts` keep passing without schema changes.
 */
export async function runOrchestrator(
  deps: PlannerAgentDeps,
  input: AgentInput,
): Promise<OrchestratorOutput> {
  const epicResult = await runEpicPlanner(deps, input);
  const taskResult = await runTaskWriter(deps, input, epicResult);
  const verificationResult = await runVerificationDesigner(deps, input, taskResult);
  const verdict = await runReviewer(deps, input, verificationResult, {
    redoUpstream: taskResult,
  });

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
