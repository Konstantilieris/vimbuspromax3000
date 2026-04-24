import {
  AGENT_STEP_STATUSES,
  DEFAULT_AGENT_ROLE_MODEL_SLOTS,
  MODEL_CAPABILITIES,
  MODEL_SLOT_KEYS,
  PATCH_REVIEW_STATUSES,
  PLANNER_RUN_STATUSES,
  PRODUCT_NAME,
  TASK_STATUSES,
  TEST_RUN_STATUSES,
  getVerificationDeferredReason,
  isAgentStepStatus,
  isLoopEventType,
  isModelCapability,
  isModelSlotKey,
  isPatchReviewStatus,
  isPlannerRunStatus,
  isTaskStatus,
  isTestRunStatus,
  isVerificationItemRunnableNow,
} from "./index";

describe("shared domain constants", () => {
  test("exports the VimbusProMax3000 product identity", () => {
    expect(PRODUCT_NAME).toBe("VimbusProMax3000");
  });

  test("exports core task status constants and guards", () => {
    expect(TASK_STATUSES).toContain("ready");
    expect(isTaskStatus("ready")).toBe(true);
    expect(isTaskStatus("not_a_status")).toBe(false);
    expect(PLANNER_RUN_STATUSES).toContain("interviewing");
    expect(isPlannerRunStatus("generated")).toBe(true);
  });

  test("exports execution-adjacent status guards", () => {
    expect(AGENT_STEP_STATUSES).toContain("started");
    expect(TEST_RUN_STATUSES).toContain("passed");
    expect(PATCH_REVIEW_STATUSES).toContain("approved");
    expect(isAgentStepStatus("started")).toBe(true);
    expect(isTestRunStatus("failed")).toBe(true);
    expect(isPatchReviewStatus("ready")).toBe(true);
  });

  test("exports loop event type guards", () => {
    expect(isLoopEventType("patch.ready")).toBe(true);
    expect(isLoopEventType("model.resolution.succeeded")).toBe(true);
    expect(isLoopEventType("unknown.event")).toBe(false);
  });

  test("exports model slot and capability guards", () => {
    expect(MODEL_SLOT_KEYS).toContain("executor_default");
    expect(MODEL_CAPABILITIES).toContain("tools");
    expect(isModelSlotKey("planner_deep")).toBe(true);
    expect(isModelCapability("json")).toBe(true);
    expect(isModelSlotKey("cheap")).toBe(false);
  });

  test("maps known agent roles to deterministic model slots", () => {
    expect(DEFAULT_AGENT_ROLE_MODEL_SLOTS.executor).toBe("executor_default");
    expect(DEFAULT_AGENT_ROLE_MODEL_SLOTS.reviewer).toBe("reviewer");
  });
});

describe("verification item runnability", () => {
  test("isVerificationItemRunnableNow returns true for a non-empty command", () => {
    expect(isVerificationItemRunnableNow("bun run test:vitest")).toBe(true);
    expect(isVerificationItemRunnableNow("bunx playwright test")).toBe(true);
  });

  test("isVerificationItemRunnableNow returns false for null, undefined, empty, or whitespace", () => {
    expect(isVerificationItemRunnableNow(null)).toBe(false);
    expect(isVerificationItemRunnableNow(undefined)).toBe(false);
    expect(isVerificationItemRunnableNow("")).toBe(false);
    expect(isVerificationItemRunnableNow("   ")).toBe(false);
  });

  test("getVerificationDeferredReason returns null when the item has a command", () => {
    expect(getVerificationDeferredReason("visual", "bunx playwright test")).toBeNull();
    expect(getVerificationDeferredReason("logic", "bun run test:vitest")).toBeNull();
    expect(getVerificationDeferredReason("evidence", "bun run collect-evidence")).toBeNull();
  });

  test("getVerificationDeferredReason returns kind-specific messages for deferred items", () => {
    expect(getVerificationDeferredReason("visual", null)).toContain("Visual checks");
    expect(getVerificationDeferredReason("evidence", null)).toContain("Evidence items");
    expect(getVerificationDeferredReason("a11y", null)).toContain("Accessibility checks");
    expect(getVerificationDeferredReason("integration", null)).toContain("Integration checks");
    expect(getVerificationDeferredReason("logic", null)).toContain("No shell command");
    expect(getVerificationDeferredReason("typecheck", null)).toContain("No shell command");
    expect(getVerificationDeferredReason("lint", null)).toContain("No shell command");
  });

  test("getVerificationDeferredReason handles unknown kinds defensively", () => {
    expect(getVerificationDeferredReason("unknown_kind", null)).toContain("No shell command");
  });
});
