import { request, type RequestContext } from "../http";
import type { ApiHealth } from "../types";

export function getHealth(ctx: RequestContext, signal?: AbortSignal): Promise<ApiHealth> {
  return request<ApiHealth>(ctx, "/health", { signal });
}
