import type { ModelSlotKey } from "@vimbuspromax3000/shared";
import { request, type RequestContext } from "../http";
import type { ApiSlot, ApiSlotTestResult } from "../types";

export function listSlots(
  ctx: RequestContext,
  projectId: string,
  signal?: AbortSignal,
): Promise<ApiSlot[]> {
  return request<ApiSlot[]>(ctx, "/model-slots", {
    query: { projectId },
    signal,
  });
}

export type TestSlotInput = {
  projectId: string;
  slot: ModelSlotKey;
  requiredCapabilities?: string[];
};

export function testSlot(
  ctx: RequestContext,
  input: TestSlotInput,
  signal?: AbortSignal,
): Promise<ApiSlotTestResult> {
  return request<ApiSlotTestResult>(ctx, `/model-slots/${encodeURIComponent(input.slot)}/test`, {
    method: "POST",
    body: {
      projectId: input.projectId,
      requiredCapabilities: input.requiredCapabilities ?? [],
    },
    signal,
  });
}
