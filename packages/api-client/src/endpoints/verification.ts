import { request, type RequestContext } from "../http";
import type { ApiTaskVerificationReview } from "../types";

export function getTaskVerification(
  ctx: RequestContext,
  taskId: string,
  signal?: AbortSignal,
): Promise<ApiTaskVerificationReview> {
  return request<ApiTaskVerificationReview>(
    ctx,
    `/tasks/${encodeURIComponent(taskId)}/verification`,
    { signal },
  );
}
