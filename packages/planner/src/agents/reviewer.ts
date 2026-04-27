import type {
  AgentInput,
  PlannerAgentDeps,
  ReviewerVerdict,
  VerificationDesignerOutput,
} from "./types";
import { runVerificationDesigner } from "./verificationDesigner";

export const REVIEWER_MAX_REROUTES = 2;

export type ReviewerRedo = (
  current: VerificationDesignerOutput,
) => Promise<VerificationDesignerOutput>;

export type ReviewerOptions = {
  /**
   * Override for the reviewer's "re-route to verification designer" callback.
   * Defaults to invoking `runVerificationDesigner` with the orchestrator's
   * deps + input so production wiring stays one line. Tests inject a custom
   * redo to exercise the bounded-retry failure path without depending on the
   * Sprint 2 designer's deterministic fallback.
   */
  redo?: ReviewerRedo;
};

/**
 * Sprint 2 reviewer.
 *
 * Gate semantics (the only piece of real review logic this sprint):
 *
 *   - A proposal is rejected if any task is missing at least one verification
 *     item.
 *   - On rejection the reviewer re-routes back to the verification designer.
 *   - It will perform up to `REVIEWER_MAX_REROUTES` (= 2) re-routes before
 *     giving up and returning `{ ok: false, ... }`.
 *
 * Sprint 3 will replace this with a proper review prompt that also checks
 * acceptance criteria, branch policy, asset references, and operator gates.
 */
export async function runReviewer(
  deps: PlannerAgentDeps,
  input: AgentInput,
  upstream: VerificationDesignerOutput,
  options: ReviewerOptions = {},
): Promise<ReviewerVerdict> {
  const redo: ReviewerRedo =
    options.redo ?? ((current) => runVerificationDesigner(deps, input, current));

  let candidate = upstream;

  for (let attempt = 0; attempt <= REVIEWER_MAX_REROUTES; attempt += 1) {
    const missingTaskTitles = collectTasksMissingVerification(candidate);

    if (missingTaskTitles.length === 0) {
      return { ok: true, output: candidate };
    }

    if (attempt === REVIEWER_MAX_REROUTES) {
      return {
        ok: false,
        reason: `Reviewer rejected proposal after ${REVIEWER_MAX_REROUTES} re-routes: ${missingTaskTitles.length} task(s) still missing verification items.`,
        missingTaskTitles,
      };
    }

    candidate = await redo(candidate);
  }

  // Defensive: loop above always returns. This should be unreachable.
  return {
    ok: false,
    reason: "Reviewer exhausted re-routes without producing a verdict.",
    missingTaskTitles: collectTasksMissingVerification(candidate),
  };
}

export function collectTasksMissingVerification(
  output: VerificationDesignerOutput,
): string[] {
  const missing: string[] = [];

  for (const epic of output.generated.epics) {
    for (const task of epic.tasks) {
      const items = task.verificationPlan?.items ?? [];
      if (items.length === 0) {
        missing.push(task.title ?? "<untitled task>");
      }
    }
  }

  return missing;
}

/* eslint-disable @typescript-eslint/no-unused-vars */
function buildReviewerPrompt(): string {
  // TODO(VIM-33 Sprint 3): real reviewer prompt content.
  return "TODO: reviewer prompt";
}
/* eslint-enable @typescript-eslint/no-unused-vars */
