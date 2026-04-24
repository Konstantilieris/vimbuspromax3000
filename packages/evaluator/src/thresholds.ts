export const DIMENSION_THRESHOLDS: Record<string, number> = {
  outcome_correctness: 85,
  security_policy_compliance: 100,
  execution_quality: 75,
  tool_usage_quality: 70,
  verification_quality: 80,
  planner_quality: 75,
  task_decomposition: 75,
  regression_risk: 75,
};

export const DIMENSION_WEIGHTS: Record<string, number> = {
  outcome_correctness: 2.0,
  security_policy_compliance: 2.0,
  verification_quality: 2.0,
  regression_risk: 1.5,
  execution_quality: 1.0,
  tool_usage_quality: 1.0,
  planner_quality: 1.0,
  task_decomposition: 1.0,
};

export const HARD_FAIL_DIMENSIONS = new Set([
  "outcome_correctness",
  "security_policy_compliance",
  "verification_quality",
]);

export const AGGREGATE_PROCEED_THRESHOLD = 80;
export const AGGREGATE_WARN_THRESHOLD = 70;
