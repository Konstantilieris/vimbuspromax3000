import { request, type RequestContext } from "../http";
import type { ApiTask, ApiTaskFilter } from "../types";

export function listTasks(
  ctx: RequestContext,
  projectId: string,
  filter: ApiTaskFilter = {},
  signal?: AbortSignal,
): Promise<ApiTask[]> {
  return request<ApiTask[]>(ctx, "/tasks", {
    query: {
      projectId,
      plannerRunId: filter.plannerRunId,
      status: filter.status,
      epicId: filter.epicId,
    },
    signal,
  });
}
