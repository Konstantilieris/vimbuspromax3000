import { describe, expect, test } from "vitest";
import { normalizeGeneratedPlannerProposal } from "../service";
import { runOrchestrator } from "./orchestrator";
import {
  EQUIVALENCE_FIXTURES,
  buildFixtureDeps,
} from "./__fixtures__/equivalence";

/**
 * VIM-33 Sprint 3 equivalence harness.
 *
 * Locks the orchestrator's normalized output for the new per-agent fan-out
 * pipeline to the same `PlannerProposalInput` shape that the previous
 * monolithic single-generator path would have produced.
 *
 * For each fixture we:
 *
 *   1. Run the new fan-out orchestrator with canned per-agent payloads.
 *   2. Normalize the equivalent monolithic generator output through the same
 *      `normalizeGeneratedPlannerProposal` helper.
 *   3. Assert the two normalized proposals are structurally identical.
 *
 * If the fan-out introduces a regression in the persisted shape, this harness
 * will fail before any prompt-driven behavioural drift can sneak through.
 */
describe("VIM-33 Sprint 3 fan-out equivalence harness", () => {
  test("the corpus has at least 2 fixtures", () => {
    expect(EQUIVALENCE_FIXTURES.length).toBeGreaterThanOrEqual(2);
  });

  for (const fixture of EQUIVALENCE_FIXTURES) {
    test(`fan-out output equals pre-fan-out monolithic output [${fixture.name}]`, async () => {
      const deps = buildFixtureDeps(fixture);

      const fanOutResult = await runOrchestrator(deps, fixture.input);
      const monolithicProposal = normalizeGeneratedPlannerProposal(
        fixture.input.plannerRun.id,
        fixture.monolithic,
        { summaryFallback: `Plan for ${fixture.input.plannerRun.goal}` },
      );

      // Deep equality: every field of the persisted proposal must match.
      expect(fanOutResult.proposal).toEqual(monolithicProposal);
    });

    test(`fan-out output snapshot is stable [${fixture.name}]`, async () => {
      const deps = buildFixtureDeps(fixture);
      const fanOutResult = await runOrchestrator(deps, fixture.input);

      // Snapshot the full normalized proposal so future prompt or wiring drift
      // surfaces as a snapshot diff during code review.
      expect(fanOutResult.proposal).toMatchSnapshot();
    });
  }
});
