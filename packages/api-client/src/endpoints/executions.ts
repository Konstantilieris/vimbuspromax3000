import { request, type RequestContext } from "../http";
import type { ApiExecution, ApiPatch } from "../types";

export function startExecution(
  ctx: RequestContext,
  taskId: string,
  signal?: AbortSignal,
): Promise<ApiExecution> {
  return request<ApiExecution>(
    ctx,
    `/tasks/${encodeURIComponent(taskId)}/execute`,
    { method: "POST", body: {}, signal },
  );
}

export function getExecutionPatch(
  ctx: RequestContext,
  executionId: string,
  signal?: AbortSignal,
): Promise<ApiPatch> {
  return request<ApiPatch>(
    ctx,
    `/executions/${encodeURIComponent(executionId)}/patch`,
    { signal },
  );
}
