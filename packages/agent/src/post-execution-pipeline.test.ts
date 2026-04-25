import { describe, expect, it } from "vitest";
import { decideRetryAction } from "./post-execution-pipeline";

describe("decideRetryAction", () => {
  const baseInput = {
    decision: "retry" as const,
    retryCount: 0,
    escalationLevel: 0,
    attempt: 1,
    maxRetries: 1,
    maxEscalations: 1,
    currentSlotKey: "executor_default" as const,
    nextSlotKey: "executor_strong" as const,
  };

  it("retries on first retry verdict", () => {
    expect(decideRetryAction(baseInput)).toEqual({
      type: "retry",
      nextAttempt: 2,
      slotKey: "executor_default",
    });
  });

  it("escalates after retry budget exhausted", () => {
    expect(
      decideRetryAction({
        ...baseInput,
        decision: "retry",
        retryCount: 1,
      }),
    ).toEqual({
      type: "escalate",
      nextAttempt: 2,
      slotKey: "executor_strong",
    });
  });

  it("escalates directly on escalate verdict", () => {
    expect(
      decideRetryAction({
        ...baseInput,
        decision: "escalate",
        retryCount: 0,
      }),
    ).toEqual({
      type: "escalate",
      nextAttempt: 2,
      slotKey: "executor_strong",
    });
  });

  it("continues when both retry and escalation budgets exhausted", () => {
    expect(
      decideRetryAction({
        ...baseInput,
        decision: "retry",
        retryCount: 1,
        escalationLevel: 1,
      }),
    ).toEqual({ type: "continue" });
  });

  it("continues when no next slot is available", () => {
    expect(
      decideRetryAction({
        ...baseInput,
        decision: "escalate",
        nextSlotKey: null,
      }),
    ).toEqual({ type: "continue" });
  });

  it("continues on proceed/warn/fail verdicts regardless of budget", () => {
    for (const decision of ["proceed", "warn", "fail"] as const) {
      expect(
        decideRetryAction({
          ...baseInput,
          decision,
        }),
      ).toEqual({ type: "continue" });
    }
  });

  it("respects custom maxRetries", () => {
    expect(
      decideRetryAction({
        ...baseInput,
        decision: "retry",
        retryCount: 2,
        maxRetries: 3,
      }),
    ).toEqual({
      type: "retry",
      nextAttempt: 2,
      slotKey: "executor_default",
    });
  });
});
