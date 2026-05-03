import { request, type RequestContext } from "../http";
import type {
  ApiAnswerPlannerRunInput,
  ApiCreatePlannerRunInput,
  ApiGeneratePlannerRunInput,
  ApiPlannerRun,
} from "../types";

export function createPlannerRun(
  ctx: RequestContext,
  input: ApiCreatePlannerRunInput,
  signal?: AbortSignal,
): Promise<ApiPlannerRun> {
  return request<ApiPlannerRun>(ctx, "/planner/runs", {
    method: "POST",
    body: {
      projectId: input.projectId,
      goal: input.goal,
      moduleName: input.moduleName,
      contextPath: input.contextPath,
    },
    signal,
  });
}

export function getPlannerRun(
  ctx: RequestContext,
  plannerRunId: string,
  signal?: AbortSignal,
): Promise<ApiPlannerRun> {
  return request<ApiPlannerRun>(
    ctx,
    `/planner/runs/${encodeURIComponent(plannerRunId)}`,
    { signal },
  );
}

export function answerPlannerRun(
  ctx: RequestContext,
  input: ApiAnswerPlannerRunInput,
  signal?: AbortSignal,
): Promise<ApiPlannerRun> {
  return request<ApiPlannerRun>(
    ctx,
    `/planner/runs/${encodeURIComponent(input.plannerRunId)}/answers`,
    {
      method: "POST",
      body: { answers: input.answers },
      signal,
    },
  );
}

export function generatePlannerRun(
  ctx: RequestContext,
  input: ApiGeneratePlannerRunInput,
  signal?: AbortSignal,
): Promise<ApiPlannerRun> {
  const body = input.seed === undefined ? {} : { seed: input.seed };
  return request<ApiPlannerRun>(
    ctx,
    `/planner/runs/${encodeURIComponent(input.plannerRunId)}/generate`,
    {
      method: "POST",
      body,
      signal,
    },
  );
}
