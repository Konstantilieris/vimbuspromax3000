export const PRODUCT_NAME = "VimbusProMax3000";
export const PACKAGE_SCOPE = "@vimbuspromax3000";

function createEnumGuard<const TValues extends readonly string[]>(values: TValues) {
  const allowed = new Set<string>(values);

  return (value: string): value is TValues[number] => allowed.has(value);
}

export const TASK_STATUSES = [
  "draft",
  "planned",
  "awaiting_verification_approval",
  "ready",
  "executing",
  "testing",
  "awaiting_patch_approval",
  "verified",
  "completed",
  "failed",
  "abandoned",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const isTaskStatus = createEnumGuard(TASK_STATUSES);

export const PLANNER_RUN_STATUSES = [
  "interviewing",
  "generated",
  "approved",
  "rejected",
  "failed",
] as const;
export type PlannerRunStatus = (typeof PLANNER_RUN_STATUSES)[number];
export const isPlannerRunStatus = createEnumGuard(PLANNER_RUN_STATUSES);

export const VERIFICATION_PLAN_STATUSES = [
  "proposed",
  "approved",
  "rejected",
  "superseded",
] as const;
export type VerificationPlanStatus = (typeof VERIFICATION_PLAN_STATUSES)[number];
export const isVerificationPlanStatus = createEnumGuard(VERIFICATION_PLAN_STATUSES);

export const VERIFICATION_ITEM_KINDS = [
  "logic",
  "integration",
  "visual",
  "typecheck",
  "lint",
  "a11y",
  "evidence",
] as const;
export type VerificationItemKind = (typeof VERIFICATION_ITEM_KINDS)[number];
export const isVerificationItemKind = createEnumGuard(VERIFICATION_ITEM_KINDS);

export function isVerificationItemRunnableNow(command: string | null | undefined): boolean {
  return typeof command === "string" && command.trim().length > 0;
}

export function getVerificationDeferredReason(
  kind: VerificationItemKind | string,
  command: string | null | undefined,
): string | null {
  if (isVerificationItemRunnableNow(command)) return null;

  if (!isVerificationItemKind(kind)) {
    return "No shell command provided — this item is deferred and will not run through POST /executions/:id/test-runs.";
  }

  switch (kind) {
    case "visual":
      return "Visual checks require a shell command or are deferred to a later MCP-backed slice.";
    case "evidence":
      return "Evidence items require human review and cannot be executed by the command runner.";
    case "a11y":
      return "Accessibility checks require a shell command to be runnable now.";
    case "integration":
      return "Integration checks require a shell command to be runnable now.";
    default:
      return "No shell command provided — this item is deferred and will not run through POST /executions/:id/test-runs.";
  }
}

export const VERIFICATION_RUNNERS = [
  "vitest",
  "jest",
  "playwright",
  "tsc",
  "eslint",
  "custom",
] as const;
export type VerificationRunner = (typeof VERIFICATION_RUNNERS)[number];
export const isVerificationRunner = createEnumGuard(VERIFICATION_RUNNERS);

export const VERIFICATION_ITEM_STATUSES = [
  "proposed",
  "approved",
  "red",
  "running",
  "green",
  "failed",
  "skipped",
] as const;
export type VerificationItemStatus = (typeof VERIFICATION_ITEM_STATUSES)[number];
export const isVerificationItemStatus = createEnumGuard(VERIFICATION_ITEM_STATUSES);

export const EXECUTION_STATUSES = [
  "queued",
  "preparing_branch",
  "writing_tests",
  "confirming_red",
  "implementing",
  "verifying",
  "evaluating",
  "retrying",
  "patch_ready",
  "completed",
  "failed",
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];
export const isExecutionStatus = createEnumGuard(EXECUTION_STATUSES);

export const AGENT_STEP_STATUSES = [
  "started",
  "completed",
  "failed",
] as const;
export type AgentStepStatus = (typeof AGENT_STEP_STATUSES)[number];
export const isAgentStepStatus = createEnumGuard(AGENT_STEP_STATUSES);

export const BRANCH_STATES = [
  "created",
  "active",
  "dirty",
  "verified",
  "approved",
  "committed",
  "merged",
  "abandoned",
] as const;
export type BranchState = (typeof BRANCH_STATES)[number];
export const isBranchState = createEnumGuard(BRANCH_STATES);

export const TEST_RUN_STATUSES = [
  "running",
  "passed",
  "failed",
] as const;
export type TestRunStatus = (typeof TEST_RUN_STATUSES)[number];
export const isTestRunStatus = createEnumGuard(TEST_RUN_STATUSES);

export const PATCH_REVIEW_STATUSES = [
  "ready",
  "approved",
  "rejected",
] as const;
export type PatchReviewStatus = (typeof PATCH_REVIEW_STATUSES)[number];
export const isPatchReviewStatus = createEnumGuard(PATCH_REVIEW_STATUSES);

export const APPROVAL_SUBJECT_TYPES = [
  "planner_run",
  "epic",
  "task",
  "verification_plan",
  "verification_item_skip",
  "mutating_tool_call",
  "patch_review",
  "branch_abandon_reset",
  "model_provider",
] as const;
export type ApprovalSubjectType = (typeof APPROVAL_SUBJECT_TYPES)[number];
export const isApprovalSubjectType = createEnumGuard(APPROVAL_SUBJECT_TYPES);

export const APPROVAL_STATUSES = [
  "requested",
  "granted",
  "rejected",
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export const isApprovalStatus = createEnumGuard(APPROVAL_STATUSES);

export const EVALUATION_STATUSES = [
  "queued",
  "running",
  "passed",
  "warned",
  "failed",
] as const;
export type EvaluationStatus = (typeof EVALUATION_STATUSES)[number];
export const isEvaluationStatus = createEnumGuard(EVALUATION_STATUSES);

export const MCP_TOOL_CALL_STATUSES = [
  "requested",
  "approved",
  "blocked",
  "running",
  "succeeded",
  "failed",
] as const;
export type McpToolCallStatus = (typeof MCP_TOOL_CALL_STATUSES)[number];
export const isMcpToolCallStatus = createEnumGuard(MCP_TOOL_CALL_STATUSES);

export const MODEL_SLOT_KEYS = [
  "planner_fast",
  "planner_deep",
  "research",
  "verification_designer",
  "executor_default",
  "executor_strong",
  "reviewer",
  "vision",
] as const;
export type ModelSlotKey = (typeof MODEL_SLOT_KEYS)[number];
export const isModelSlotKey = createEnumGuard(MODEL_SLOT_KEYS);

export const MODEL_SLOTS = MODEL_SLOT_KEYS;
export type ModelSlot = ModelSlotKey;
export const isModelSlot = isModelSlotKey;

export const MODEL_CAPABILITIES = [
  "tools",
  "vision",
  "json",
  "streaming",
] as const;
export type ModelCapability = (typeof MODEL_CAPABILITIES)[number];
export const isModelCapability = createEnumGuard(MODEL_CAPABILITIES);

export const MODEL_PROVIDER_KINDS = [
  "gateway",
  "openai",
  "anthropic",
  "openai_compatible",
  "ollama",
] as const;
export type ModelProviderKind = (typeof MODEL_PROVIDER_KINDS)[number];
export const isModelProviderKind = createEnumGuard(MODEL_PROVIDER_KINDS);

export const MODEL_PROVIDER_AUTH_TYPES = [
  "none",
  "api_key",
] as const;
export type ModelProviderAuthType = (typeof MODEL_PROVIDER_AUTH_TYPES)[number];
export const isModelProviderAuthType = createEnumGuard(MODEL_PROVIDER_AUTH_TYPES);

export const MODEL_PROVIDER_STATUSES = [
  "pending_approval",
  "active",
  "disabled",
  "error",
] as const;
export type ModelProviderStatus = (typeof MODEL_PROVIDER_STATUSES)[number];
export const isModelProviderStatus = createEnumGuard(MODEL_PROVIDER_STATUSES);

export const MODEL_SECRET_STORAGE_TYPES = [
  "env",
] as const;
export type ModelSecretStorageType = (typeof MODEL_SECRET_STORAGE_TYPES)[number];
export const isModelSecretStorageType = createEnumGuard(MODEL_SECRET_STORAGE_TYPES);

export const MODEL_SECRET_REF_KINDS = [
  "provider_api_key",
] as const;
export type ModelSecretRefKind = (typeof MODEL_SECRET_REF_KINDS)[number];
export const isModelSecretRefKind = createEnumGuard(MODEL_SECRET_REF_KINDS);

export const MODEL_SECRET_REF_STATUSES = [
  "active",
  "missing",
  "disabled",
] as const;
export type ModelSecretRefStatus = (typeof MODEL_SECRET_REF_STATUSES)[number];
export const isModelSecretRefStatus = createEnumGuard(MODEL_SECRET_REF_STATUSES);

export const MODEL_COST_TIERS = [
  "low",
  "medium",
  "high",
] as const;
export type ModelCostTier = (typeof MODEL_COST_TIERS)[number];
export const isModelCostTier = createEnumGuard(MODEL_COST_TIERS);

export const MODEL_SPEED_TIERS = [
  "fast",
  "balanced",
  "slow",
] as const;
export type ModelSpeedTier = (typeof MODEL_SPEED_TIERS)[number];
export const isModelSpeedTier = createEnumGuard(MODEL_SPEED_TIERS);

export const MODEL_REASONING_TIERS = [
  "light",
  "standard",
  "strong",
] as const;
export type ModelReasoningTier = (typeof MODEL_REASONING_TIERS)[number];
export const isModelReasoningTier = createEnumGuard(MODEL_REASONING_TIERS);

export const DEFAULT_AGENT_ROLE_MODEL_SLOTS = {
  orchestrator: "planner_deep",
  context_ingest: "planner_fast",
  research: "research",
  interview: "planner_fast",
  epic_planner: "planner_deep",
  task_writer: "planner_deep",
  verification_designer: "verification_designer",
  executor: "executor_default",
  executor_repair: "executor_strong",
  reviewer: "reviewer",
  vision: "vision",
} as const satisfies Record<string, ModelSlotKey>;

export type ModelResolutionFailureCode =
  | "slot_missing"
  | "slot_unassigned"
  | "model_missing"
  | "model_disabled"
  | "provider_inactive"
  | "provider_secret_missing"
  | "capability_mismatch";

export type ModelResolutionRequest = {
  projectId: string;
  slotKey: ModelSlotKey;
  requiredCapabilities?: readonly ModelCapability[];
  taskExecutionId?: string;
};

export type ResolvedModelSnapshot = {
  slotKey: ModelSlotKey;
  providerId: string;
  providerKey: string;
  providerKind: ModelProviderKind;
  modelId: string;
  modelName: string;
  modelSlug: string;
  concreteModelName: string;
  usedFallback: boolean;
  requiredCapabilities: ModelCapability[];
};

export type ModelResolutionResult =
  | {
      ok: true;
      value: ResolvedModelSnapshot;
    }
  | {
      ok: false;
      code: ModelResolutionFailureCode;
      message: string;
      slotKey: ModelSlotKey;
    };

export const MODEL_DECISION_STATES = [
  "selected",
  "escalated",
  "stopped",
] as const;
export type ModelDecisionState = (typeof MODEL_DECISION_STATES)[number];
export const isModelDecisionState = createEnumGuard(MODEL_DECISION_STATES);

export const REGRESSION_STATUSES = [
  "baseline",
  "compared",
  "passed",
  "blocked",
] as const;
export type RegressionStatus = (typeof REGRESSION_STATUSES)[number];
export const isRegressionStatus = createEnumGuard(REGRESSION_STATUSES);

export const LOOP_EVENT_TYPES = [
  "planner.started",
  "planner.question",
  "planner.answer",
  "planner.proposed",
  "approval.requested",
  "approval.granted",
  "approval.rejected",
  "task.selected",
  "branch.created",
  "branch.switched",
  "agent.step.started",
  "agent.tool.requested",
  "agent.tool.completed",
  "mcp.tools.discovered",
  "mcp.tool.requested",
  "mcp.tool.blocked",
  "mcp.tool.completed",
  "model.resolution.requested",
  "model.resolution.succeeded",
  "model.resolution.failed",
  "model.fallback.used",
  "model.selected",
  "model.escalated",
  "test.started",
  "test.stdout",
  "test.stderr",
  "test.finished",
  "evaluation.started",
  "evaluation.result",
  "evaluation.finished",
  "benchmark.started",
  "benchmark.finished",
  "regression.compared",
  "regression.blocked",
  "langsmith.trace.linked",
  "patch.ready",
  "patch.approved",
  "task.completed",
  "task.failed",
] as const;
export type LoopEventType = (typeof LOOP_EVENT_TYPES)[number];
export const isLoopEventType = createEnumGuard(LOOP_EVENT_TYPES);

export type LoopEvent<TPayload = unknown> = {
  id: string;
  projectId: string;
  taskExecutionId?: string;
  type: LoopEventType;
  payload: TPayload;
  createdAt: string;
};
