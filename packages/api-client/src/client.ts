import { getHealth } from "./endpoints/health";
import { createProject, listProjects } from "./endpoints/projects";
import { listSlots, testSlot, type TestSlotInput } from "./endpoints/modelSlots";
import { listTasks } from "./endpoints/tasks";
import {
  answerPlannerRun,
  createPlannerRun,
  generatePlannerRun,
  getPlannerRun,
} from "./endpoints/plannerRuns";
import { createApproval, listApprovals } from "./endpoints/approvals";
import {
  abandonBranch,
  createBranch,
  getBranch,
  type CreateBranchInput,
} from "./endpoints/branches";
import {
  getExecutionPatch,
  startExecution,
} from "./endpoints/executions";
import { listTestRuns, startTestRuns } from "./endpoints/testRuns";
import { listEvaluations, runEvaluation } from "./endpoints/evaluations";
import { getTaskVerification } from "./endpoints/verification";
import type { FetchLike, RequestContext } from "./http";
import type {
  ApiAnswerPlannerRunInput,
  ApiApproval,
  ApiBranch,
  ApiCreateApprovalInput,
  ApiCreatePlannerRunInput,
  ApiCreateProjectInput,
  ApiEvalRun,
  ApiExecution,
  ApiGeneratePlannerRunInput,
  ApiHealth,
  ApiListApprovalsFilter,
  ApiPatch,
  ApiPlannerRun,
  ApiProject,
  ApiSlot,
  ApiSlotTestResult,
  ApiTask,
  ApiTaskFilter,
  ApiTaskVerificationReview,
  ApiTestRun,
} from "./types";

export type CreateApiClientOptions = {
  baseUrl: string;
  fetch?: FetchLike;
};

export type ApiClient = {
  readonly baseUrl: string;
  health(signal?: AbortSignal): Promise<ApiHealth>;
  listProjects(signal?: AbortSignal): Promise<ApiProject[]>;
  createProject(input: ApiCreateProjectInput, signal?: AbortSignal): Promise<ApiProject>;
  listSlots(projectId: string, signal?: AbortSignal): Promise<ApiSlot[]>;
  testSlot(input: TestSlotInput, signal?: AbortSignal): Promise<ApiSlotTestResult>;
  listTasks(
    projectId: string,
    filter?: ApiTaskFilter,
    signal?: AbortSignal,
  ): Promise<ApiTask[]>;
  createPlannerRun(
    input: ApiCreatePlannerRunInput,
    signal?: AbortSignal,
  ): Promise<ApiPlannerRun>;
  getPlannerRun(plannerRunId: string, signal?: AbortSignal): Promise<ApiPlannerRun>;
  answerPlannerRun(
    input: ApiAnswerPlannerRunInput,
    signal?: AbortSignal,
  ): Promise<ApiPlannerRun>;
  generatePlannerRun(
    input: ApiGeneratePlannerRunInput,
    signal?: AbortSignal,
  ): Promise<ApiPlannerRun>;
  listApprovals(
    filter?: ApiListApprovalsFilter,
    signal?: AbortSignal,
  ): Promise<ApiApproval[]>;
  createApproval(
    input: ApiCreateApprovalInput,
    signal?: AbortSignal,
  ): Promise<ApiApproval>;
  startExecution(taskId: string, signal?: AbortSignal): Promise<ApiExecution>;
  getExecutionPatch(executionId: string, signal?: AbortSignal): Promise<ApiPatch>;
  createBranch(input: CreateBranchInput, signal?: AbortSignal): Promise<ApiBranch>;
  getBranch(taskId: string, signal?: AbortSignal): Promise<ApiBranch>;
  abandonBranch(taskId: string, signal?: AbortSignal): Promise<unknown>;
  startTestRuns(executionId: string, signal?: AbortSignal): Promise<ApiTestRun[]>;
  listTestRuns(executionId: string, signal?: AbortSignal): Promise<ApiTestRun[]>;
  listEvaluations(executionId: string, signal?: AbortSignal): Promise<ApiEvalRun[]>;
  runEvaluation(executionId: string, signal?: AbortSignal): Promise<ApiEvalRun>;
  getTaskVerification(
    taskId: string,
    signal?: AbortSignal,
  ): Promise<ApiTaskVerificationReview>;
};

export function createApiClient(options: CreateApiClientOptions): ApiClient {
  const ctx: RequestContext = {
    baseUrl: stripTrailingSlash(options.baseUrl),
    fetch: options.fetch ?? fetch,
  };

  return {
    baseUrl: ctx.baseUrl,
    health: (signal) => getHealth(ctx, signal),
    listProjects: (signal) => listProjects(ctx, signal),
    createProject: (input, signal) => createProject(ctx, input, signal),
    listSlots: (projectId, signal) => listSlots(ctx, projectId, signal),
    testSlot: (input, signal) => testSlot(ctx, input, signal),
    listTasks: (projectId, filter, signal) => listTasks(ctx, projectId, filter, signal),
    createPlannerRun: (input, signal) => createPlannerRun(ctx, input, signal),
    getPlannerRun: (plannerRunId, signal) => getPlannerRun(ctx, plannerRunId, signal),
    answerPlannerRun: (input, signal) => answerPlannerRun(ctx, input, signal),
    generatePlannerRun: (input, signal) => generatePlannerRun(ctx, input, signal),
    listApprovals: (filter, signal) => listApprovals(ctx, filter, signal),
    createApproval: (input, signal) => createApproval(ctx, input, signal),
    startExecution: (taskId, signal) => startExecution(ctx, taskId, signal),
    getExecutionPatch: (executionId, signal) => getExecutionPatch(ctx, executionId, signal),
    createBranch: (input, signal) => createBranch(ctx, input, signal),
    getBranch: (taskId, signal) => getBranch(ctx, taskId, signal),
    abandonBranch: (taskId, signal) => abandonBranch(ctx, taskId, signal),
    startTestRuns: (executionId, signal) => startTestRuns(ctx, executionId, signal),
    listTestRuns: (executionId, signal) => listTestRuns(ctx, executionId, signal),
    listEvaluations: (executionId, signal) => listEvaluations(ctx, executionId, signal),
    runEvaluation: (executionId, signal) => runEvaluation(ctx, executionId, signal),
    getTaskVerification: (taskId, signal) => getTaskVerification(ctx, taskId, signal),
  };
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
