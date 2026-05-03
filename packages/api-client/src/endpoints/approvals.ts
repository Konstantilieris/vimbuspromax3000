import { request, type RequestContext } from "../http";
import type {
  ApiApproval,
  ApiCreateApprovalInput,
  ApiListApprovalsFilter,
} from "../types";

export function listApprovals(
  ctx: RequestContext,
  filter: ApiListApprovalsFilter = {},
  signal?: AbortSignal,
): Promise<ApiApproval[]> {
  return request<ApiApproval[]>(ctx, "/approvals", {
    query: {
      projectId: filter.projectId,
      subjectType: filter.subjectType,
      subjectId: filter.subjectId,
    },
    signal,
  });
}

export function createApproval(
  ctx: RequestContext,
  input: ApiCreateApprovalInput,
  signal?: AbortSignal,
): Promise<ApiApproval> {
  return request<ApiApproval>(ctx, "/approvals", {
    method: "POST",
    body: {
      projectId: input.projectId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      stage: input.stage,
      status: input.status,
      operator: input.operator,
      reason: input.reason,
    },
    signal,
  });
}
