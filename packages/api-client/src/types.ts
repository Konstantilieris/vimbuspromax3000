import type { ModelSlotKey } from "@vimbuspromax3000/shared";

export type ApiHealth = {
  status: string;
};

export type ApiProject = {
  id: string;
  name: string;
  rootPath: string;
  baseBranch: string;
};

export type ApiCreateProjectInput = {
  name: string;
  rootPath: string;
  baseBranch?: string;
  branchNaming?: string;
};

export type ApiProvider = {
  key: string;
};

export type ApiModel = {
  id: string;
  name: string;
  slug: string;
  provider?: ApiProvider | null;
};

export type ApiSlot = {
  slotKey: ModelSlotKey;
  primaryModel?: ApiModel | null;
  fallbackModel?: ApiModel | null;
};

export type ApiTaskEpic = {
  id: string;
  key: string;
  title: string;
};

export type ApiTask = {
  id: string;
  stableId: string;
  title: string;
  status: string;
  type?: string;
  complexity?: string;
  orderIndex?: number;
  epic?: ApiTaskEpic | null;
};

export type ApiTaskFilter = {
  plannerRunId?: string;
  status?: string;
  epicId?: string;
};

export type ApiSlotTestResult =
  | {
      ok: true;
      value: { concreteModelName: string; usedFallback: boolean };
    }
  | {
      ok: false;
      code?: string;
      message?: string;
    };

export type AuthSource = "env" | "claude-cli" | "interactive";

export type AuthStatus =
  | { found: true; source: AuthSource }
  | { found: false; reason: string };

export type ApiPlannerProposalSummary = {
  epicCount: number;
  taskCount: number;
  verificationPlanCount: number;
};

export type ApiPlannerEpic = {
  key: string;
  title: string;
  tasks: ApiTask[];
};

export type ApiPlannerRunStatus =
  | "interviewing"
  | "ready_to_generate"
  | "generating"
  | "ready"
  | "approved"
  | "failed"
  | string;

export type ApiPlannerRun = {
  id: string;
  projectId: string;
  status: ApiPlannerRunStatus;
  goal: string;
  moduleName?: string | null;
  contextPath?: string | null;
  summary?: string | null;
  interview?: Record<string, unknown>;
  proposalSummary?: ApiPlannerProposalSummary;
  approvals?: ApiApproval[];
  epics?: ApiPlannerEpic[];
};

export type ApiCreatePlannerRunInput = {
  projectId: string;
  goal: string;
  moduleName?: string;
  contextPath?: string;
};

export type ApiAnswerPlannerRunInput = {
  plannerRunId: string;
  answers: Record<string, unknown>;
};

export type ApiGeneratePlannerRunInput = {
  plannerRunId: string;
  seed?: number;
};

export type ApiApprovalSubjectType =
  | "planner_run"
  | "task"
  | "execution"
  | "patch_review"
  | "verification_plan"
  | "source_of_truth_asset"
  | string;

export type ApiApprovalStatus = "granted" | "denied" | "pending" | string;

export type ApiApproval = {
  id: string;
  subjectType: ApiApprovalSubjectType;
  subjectId: string;
  stage: string;
  status: ApiApprovalStatus;
  operator?: string | null;
  reason?: string | null;
};

export type ApiCreateApprovalInput = {
  projectId: string;
  subjectType: ApiApprovalSubjectType;
  subjectId: string;
  stage: string;
  status: ApiApprovalStatus;
  operator?: string;
  reason?: string;
};

export type ApiListApprovalsFilter = {
  projectId?: string;
  subjectType?: ApiApprovalSubjectType;
  subjectId?: string;
};

export type ApiBranch = {
  id: string;
  taskId: string;
  branchName: string;
  state: string;
  baseBranch: string;
};

export type ApiExecution = {
  id: string;
  taskId: string;
  status: string;
  branchName?: string | null;
  createdAt: string;
};

export type ApiTestRun = {
  id: string;
  executionId: string;
  status: string;
  orderIndex: number;
  command?: string | null;
  exitCode?: number | null;
  stdout?: string | null;
  stderr?: string | null;
};

export type ApiPatch = {
  executionId: string;
  status: string;
  approvalStatus?: string | null;
  filesChanged?: number | null;
  linesAdded?: number | null;
  linesRemoved?: number | null;
  diffSummary?: string | null;
};

export type ApiEvalResult = {
  dimension: string;
  score: number;
  threshold: number;
  verdict: string;
  reasoning?: string | null;
};

export type ApiEvalRun = {
  id: string;
  status: string;
  verdict?: string | null;
  aggregateScore?: number | null;
  threshold?: number | null;
  finishedAt?: string | null;
  createdAt?: string | null;
  results?: ApiEvalResult[];
};

export type ApiVerificationItem = {
  id: string;
  name: string;
  status: string;
  orderIndex: number;
  runnableNow?: boolean;
  command?: string | null;
  description?: string | null;
};

export type ApiVerificationPlan = {
  id: string;
  taskId: string;
  status: string;
  items: ApiVerificationItem[];
};

export type ApiVerificationSummary = {
  totalCount: number;
  runnableCount: number;
  deferredCount: number;
  allRunnableNow: boolean;
};

export type ApiTaskVerificationReview = {
  taskId: string;
  plan: ApiVerificationPlan | null;
  summary: ApiVerificationSummary | null;
};
