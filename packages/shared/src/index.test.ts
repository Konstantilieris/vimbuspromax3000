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
  isAgentStepStatus,
  isLoopEventType,
  isModelCapability,
  isModelSlotKey,
  isPatchReviewStatus,
  isPlannerRunStatus,
  isTaskStatus,
  isTestRunStatus,
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
