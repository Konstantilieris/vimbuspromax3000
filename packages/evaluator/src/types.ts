export type EvalVerdict = "pass" | "warn" | "fail";
export type EvalDecision = "proceed" | "warn" | "retry" | "escalate" | "fail";

export type DimensionResult = {
  dimension: string;
  score: number;
  threshold: number;
  verdict: EvalVerdict;
  evaluatorType: "rule_based" | "llm_judge" | "hybrid";
  reasoning: string;
  modelName?: string | null;
  promptVersion?: string | null;
  evidenceJson?: string | null;
};

export type TestRunSummary = {
  id: string;
  command: string;
  status: string;
  exitCode: number | null;
};

export type AgentStepSummary = {
  id: string;
  role: string;
  status: string;
  modelName: string | null;
};

export type PatchReviewSummary = {
  id: string;
  status: string;
  summary: string | null;
  diffPath: string | null;
};

export type VerificationItemSummary = {
  id: string;
  kind: string;
  runner: string | null;
  title: string;
  description: string;
  command: string | null;
  status: string;
};

export type VerificationPlanSummary = {
  id: string;
  status: string;
  approvedAt: Date | null;
  items: VerificationItemSummary[];
};

export type McpCallSummary = {
  id: string;
  serverName: string;
  toolName: string;
  mutability: string;
  status: string;
  approvalId: string | null;
  argumentsHash: string | null;
  latencyMs: number | null;
};

export type EpicTaskSummary = {
  id: string;
  stableId: string;
  title: string;
  type: string;
  complexity: string;
  acceptanceJson: string | null;
  orderIndex: number;
  requiresJson: string | null;
};

export type EvalContext = {
  projectId: string;
  execution: {
    id: string;
    status: string;
    retryCount: number;
    startedAt: Date | null;
    testRuns: TestRunSummary[];
    agentSteps: AgentStepSummary[];
    patchReviews: PatchReviewSummary[];
    latestVerificationPlan: VerificationPlanSummary | null;
    branch: {
      name: string;
      base: string;
    };
    task: {
      id: string;
      title: string;
      type: string;
      complexity: string;
      acceptanceJson: string | null;
      targetFilesJson: string | null;
      epic: {
        id: string;
        goal: string;
        acceptanceJson: string | null;
        risksJson: string | null;
        tasks: EpicTaskSummary[];
        plannerRun: {
          id: string;
          goal: string;
          interviewJson: string | null;
        };
        project: {
          name: string;
          baseBranch: string;
        };
      };
    };
  };
  mcpCalls: McpCallSummary[];
};

export type JudgeGenerator = (input: {
  model: unknown;
  system: string;
  prompt: string;
}) => Promise<{ score: number; reason: string }>;
