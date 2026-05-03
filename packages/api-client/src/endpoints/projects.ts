import { request, type RequestContext } from "../http";
import type { ApiCreateProjectInput, ApiProject } from "../types";

export function listProjects(ctx: RequestContext, signal?: AbortSignal): Promise<ApiProject[]> {
  return request<ApiProject[]>(ctx, "/projects", { signal });
}

export function createProject(
  ctx: RequestContext,
  input: ApiCreateProjectInput,
  signal?: AbortSignal,
): Promise<ApiProject> {
  return request<ApiProject>(ctx, "/projects", {
    method: "POST",
    body: input,
    signal,
  });
}
