import { request, type RequestContext } from "../http";
import type { ApiBranch } from "../types";

export type CreateBranchInput = {
  taskId: string;
  baseBranch?: string;
};

export function createBranch(
  ctx: RequestContext,
  input: CreateBranchInput,
  signal?: AbortSignal,
): Promise<ApiBranch> {
  const body = input.baseBranch ? { baseBranch: input.baseBranch } : {};
  return request<ApiBranch>(
    ctx,
    `/tasks/${encodeURIComponent(input.taskId)}/branch`,
    { method: "POST", body, signal },
  );
}

export function getBranch(
  ctx: RequestContext,
  taskId: string,
  signal?: AbortSignal,
): Promise<ApiBranch> {
  return request<ApiBranch>(
    ctx,
    `/tasks/${encodeURIComponent(taskId)}/branch`,
    { signal },
  );
}

export function abandonBranch(
  ctx: RequestContext,
  taskId: string,
  signal?: AbortSignal,
): Promise<unknown> {
  return request<unknown>(
    ctx,
    `/tasks/${encodeURIComponent(taskId)}/branch/abandon`,
    { method: "POST", body: {}, signal },
  );
}
