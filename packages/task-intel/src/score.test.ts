import { describe, expect, test } from "vitest";
import {
  COMPLEXITY_LABELS,
  scoreTaskComplexity,
  type TaskComplexityInput,
} from "./score";

function makeInput(overrides: Partial<TaskComplexityInput> = {}): TaskComplexityInput {
  return {
    estimatedLinesTouched: 0,
    fanOut: 0,
    verificationKinds: [],
    ...overrides,
  };
}

describe("scoreTaskComplexity", () => {
  test("returns one of the canonical labels", () => {
    const result = scoreTaskComplexity(makeInput());

    expect(COMPLEXITY_LABELS).toContain(result.label);
  });

  test("classifies a tiny single-file task as low", () => {
    const result = scoreTaskComplexity(
      makeInput({
        estimatedLinesTouched: 10,
        fanOut: 1,
        verificationKinds: ["logic"],
      }),
    );

    expect(result.label).toBe("low");
    expect(result.breakdown.lines).toBe(0);
    expect(result.breakdown.fanOut).toBe(0);
    expect(result.breakdown.verificationDiversity).toBe(0);
    expect(result.score).toBe(0);
  });

  test("classifies a moderate multi-file task as medium", () => {
    const result = scoreTaskComplexity(
      makeInput({
        estimatedLinesTouched: 120,
        fanOut: 3,
        verificationKinds: ["logic", "integration"],
      }),
    );

    expect(result.label).toBe("medium");
    // Medium fits in the 2-4 score band per the documented model-selection inputs.
    expect(result.score).toBeGreaterThanOrEqual(2);
    expect(result.score).toBeLessThan(5);
  });

  test("classifies a high-fanout task with broad verification as high", () => {
    const result = scoreTaskComplexity(
      makeInput({
        estimatedLinesTouched: 600,
        fanOut: 9,
        verificationKinds: ["logic", "integration", "visual", "evidence"],
      }),
    );

    expect(result.label).toBe("high");
    expect(result.breakdown.lines).toBe(2);
    expect(result.breakdown.fanOut).toBe(2);
    expect(result.breakdown.verificationDiversity).toBe(5);
    expect(result.score).toBe(9);
  });

  test("escalates to high when verification kinds span four distinct kinds even with small footprint", () => {
    const result = scoreTaskComplexity(
      makeInput({
        estimatedLinesTouched: 5,
        fanOut: 0,
        verificationKinds: ["logic", "integration", "visual", "evidence"],
      }),
    );

    expect(result.label).toBe("high");
    expect(result.breakdown.verificationDiversity).toBe(5);
  });

  test("ignores duplicate verification kinds when measuring diversity", () => {
    const result = scoreTaskComplexity(
      makeInput({
        estimatedLinesTouched: 0,
        fanOut: 0,
        verificationKinds: ["logic", "logic", "logic"],
      }),
    );

    expect(result.breakdown.verificationDiversity).toBe(0);
    expect(result.label).toBe("low");
  });

  test("treats negative or missing inputs as zero contributions", () => {
    const result = scoreTaskComplexity(
      makeInput({
        estimatedLinesTouched: -50,
        fanOut: -3,
        verificationKinds: [],
      }),
    );

    expect(result.breakdown.lines).toBe(0);
    expect(result.breakdown.fanOut).toBe(0);
    expect(result.breakdown.verificationDiversity).toBe(0);
    expect(result.label).toBe("low");
  });

  test("uses lines-touched alone to escalate to medium when fan-out and verification are minimal", () => {
    const result = scoreTaskComplexity(
      makeInput({
        estimatedLinesTouched: 250,
        fanOut: 1,
        verificationKinds: ["logic"],
      }),
    );

    expect(result.breakdown.lines).toBe(2);
    expect(result.label).toBe("medium");
  });

  test("uses fan-out alone to escalate to medium when other signals are minimal", () => {
    const result = scoreTaskComplexity(
      makeInput({
        estimatedLinesTouched: 10,
        fanOut: 7,
        verificationKinds: ["logic"],
      }),
    );

    expect(result.breakdown.fanOut).toBe(2);
    expect(result.label).toBe("medium");
  });

  test("breakdown values always sum to score", () => {
    const fixtures: TaskComplexityInput[] = [
      makeInput(),
      makeInput({
        estimatedLinesTouched: 50,
        fanOut: 2,
        verificationKinds: ["logic"],
      }),
      makeInput({
        estimatedLinesTouched: 700,
        fanOut: 12,
        verificationKinds: ["logic", "integration", "visual", "a11y", "evidence"],
      }),
    ];

    for (const fixture of fixtures) {
      const result = scoreTaskComplexity(fixture);
      const sum =
        result.breakdown.lines +
        result.breakdown.fanOut +
        result.breakdown.verificationDiversity;

      expect(sum).toBe(result.score);
    }
  });
});
