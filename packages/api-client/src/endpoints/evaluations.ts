import { request, type RequestContext } from "../http";
import type { ApiEvalRun } from "../types";

type ListEvalsResponse = { evalRuns: ApiEvalRun[] };
type RunEvalResponse = { evalRun: ApiEvalRun };

export async function listEvaluations(
  ctx: RequestContext,
  executionId: string,
  signal?: AbortSignal,
): Promise<ApiEvalRun[]> {
  const response = await request<ListEvalsResponse>(
    ctx,
    `/executions/${encodeURIComponent(executionId)}/evaluations`,
    { signal },
  );
  return response.evalRuns ?? [];
}

export async function runEvaluation(
  ctx: RequestContext,
  executionId: string,
  signal?: AbortSignal,
): Promise<ApiEvalRun> {
  const response = await request<RunEvalResponse>(
    ctx,
    `/executions/${encodeURIComponent(executionId)}/evaluations`,
    { method: "POST", body: {}, signal },
  );
  return response.evalRun;
}
