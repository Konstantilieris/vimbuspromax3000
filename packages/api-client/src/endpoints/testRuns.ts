import { request, type RequestContext } from "../http";
import type { ApiTestRun } from "../types";

export function listTestRuns(
  ctx: RequestContext,
  executionId: string,
  signal?: AbortSignal,
): Promise<ApiTestRun[]> {
  return request<ApiTestRun[]>(
    ctx,
    `/executions/${encodeURIComponent(executionId)}/test-runs`,
    { signal },
  );
}

export function startTestRuns(
  ctx: RequestContext,
  executionId: string,
  signal?: AbortSignal,
): Promise<ApiTestRun[]> {
  return request<ApiTestRun[]>(
    ctx,
    `/executions/${encodeURIComponent(executionId)}/test-runs`,
    { method: "POST", body: {}, signal },
  );
}
