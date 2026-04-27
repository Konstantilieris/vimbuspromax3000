import type { PrismaClient } from "@vimbuspromax3000/db/client";
import {
  hasModelCapabilities,
  resolveSlotBase,
  type SlotModelCandidate,
} from "@vimbuspromax3000/model-registry";
import {
  type ModelCapability,
  type ModelResolutionFailureCode,
  type ModelResolutionRequest,
  type ModelResolutionResult,
  type ModelSlotKey,
  type ResolvedModelSnapshot,
} from "@vimbuspromax3000/shared";
import { isComplexityLabel, type ComplexityLabel } from "@vimbuspromax3000/task-intel";

export type ComplexityAwareSlotInput = {
  requestedSlotKey: ModelSlotKey;
  complexity: ComplexityLabel | string | null | undefined;
};

export type ComplexityAwareSlotDecision = {
  slotKey: ModelSlotKey;
  escalated: boolean;
  reason: string;
};

/**
 * Pure helper: given the slot the caller asked for and the complexity label
 * the planner persisted on the task, return the slot the policy engine should
 * actually resolve.
 *
 * Sprint 3 / VIM-35 narrow rule: only `executor_default` can be escalated, and
 * only by `complexity === "high"`. All other slot keys pass through unchanged
 * so this helper does not collide with the attempt-based escalation logic
 * VIM-30 is layering on top.
 */
export function resolveSlotForComplexity(
  input: ComplexityAwareSlotInput,
): ComplexityAwareSlotDecision {
  if (input.requestedSlotKey !== "executor_default") {
    return {
      slotKey: input.requestedSlotKey,
      escalated: false,
      reason: `Slot ${input.requestedSlotKey} is not an executor slot; complexity routing skipped.`,
    };
  }

  const normalized = isComplexityLabel(input.complexity) ? input.complexity : "medium";

  if (normalized === "high") {
    return {
      slotKey: "executor_strong",
      escalated: true,
      reason: "Routed to executor_strong because complexity=high.",
    };
  }

  return {
    slotKey: "executor_default",
    escalated: false,
    reason: `Routed to executor_default for complexity=${normalized}.`,
  };
}

type CandidateValidation =
  | {
      ok: true;
      value: SlotModelCandidate;
    }
  | {
      ok: false;
      code: ModelResolutionFailureCode;
      message: string;
    };

/**
 * Local extension of `ModelResolutionRequest` so callers can pass through the
 * complexity label persisted on the task without bloating the shared type.
 * The field is optional and defaults to `medium` (no escalation) when absent
 * so existing callers keep working.
 */
export type ModelResolutionRequestWithComplexity = ModelResolutionRequest & {
  complexity?: ComplexityLabel | string | null;
};

export async function resolveModelSlot(
  prisma: PrismaClient,
  input: ModelResolutionRequestWithComplexity,
  env: Record<string, string | undefined> = process.env,
): Promise<ModelResolutionResult> {
  const requiredCapabilities = [...(input.requiredCapabilities ?? [])];
  const complexityDecision = resolveSlotForComplexity({
    requestedSlotKey: input.slotKey,
    complexity: input.complexity ?? null,
  });
  const effectiveSlotKey = complexityDecision.slotKey;

  await emitModelEvent(prisma, {
    projectId: input.projectId,
    taskExecutionId: input.taskExecutionId,
    type: "model.resolution.requested",
    payload: {
      slotKey: effectiveSlotKey,
      requestedSlotKey: input.slotKey,
      complexity: input.complexity ?? null,
      escalated: complexityDecision.escalated,
      requiredCapabilities,
    },
  });

  const effectiveInput: ModelResolutionRequest = {
    ...input,
    slotKey: effectiveSlotKey,
  };

  const slot = await resolveSlotBase(prisma, input.projectId, effectiveSlotKey);

  if (!slot) {
    return fail(prisma, effectiveInput, "slot_missing", `Model slot ${effectiveSlotKey} has not been seeded.`, requiredCapabilities);
  }

  if (!slot.primaryModel && !slot.fallbackModel) {
    return fail(prisma, effectiveInput, "slot_unassigned", `Model slot ${effectiveSlotKey} is not assigned.`, requiredCapabilities);
  }

  const primary = validateCandidate(slot.primaryModel, requiredCapabilities, env);

  if (primary.ok) {
    const snapshot = toSnapshot(effectiveSlotKey, primary.value, false, requiredCapabilities);
    await emitSuccess(prisma, effectiveInput, snapshot);
    return { ok: true, value: snapshot };
  }

  const fallback = validateCandidate(slot.fallbackModel, requiredCapabilities, env);

  if (fallback.ok) {
    const snapshot = toSnapshot(effectiveSlotKey, fallback.value, true, requiredCapabilities);
    await emitModelEvent(prisma, {
      projectId: input.projectId,
      taskExecutionId: input.taskExecutionId,
      type: "model.fallback.used",
      payload: {
        slotKey: effectiveSlotKey,
        primaryFailure: primary,
        resolvedModel: snapshot.concreteModelName,
      },
    });
    await emitSuccess(prisma, effectiveInput, snapshot);
    return { ok: true, value: snapshot };
  }

  const finalFailure = slot.fallbackModel ? fallback : primary;

  return fail(prisma, effectiveInput, finalFailure.code, finalFailure.message, requiredCapabilities);
}

export async function snapshotResolvedModelPolicy(
  prisma: PrismaClient,
  taskExecutionId: string,
  snapshot: ResolvedModelSnapshot,
) {
  return prisma.taskExecution.update({
    where: { id: taskExecutionId },
    data: {
      policyJson: JSON.stringify({
        modelResolution: snapshot,
      }),
    },
  });
}

export async function recordAgentStepModelUsage(
  prisma: PrismaClient,
  agentStepId: string,
  snapshot: ResolvedModelSnapshot,
) {
  return prisma.agentStep.update({
    where: { id: agentStepId },
    data: {
      modelName: snapshot.concreteModelName,
    },
  });
}

function validateCandidate(
  model: SlotModelCandidate | null,
  requiredCapabilities: readonly ModelCapability[],
  env: Record<string, string | undefined>,
): CandidateValidation {
  if (!model) {
    return {
      ok: false,
      code: "model_missing",
      message: "No registered model is assigned.",
    };
  }

  if (!model.isEnabled) {
    return {
      ok: false,
      code: "model_disabled",
      message: `Registered model ${model.slug} is disabled.`,
    };
  }

  if (model.provider.status !== "active") {
    return {
      ok: false,
      code: "provider_inactive",
      message: `Provider ${model.provider.key} is not active.`,
    };
  }

  if (model.provider.authType === "api_key") {
    const secretRef = model.provider.secretRef;

    if (!secretRef || secretRef.status !== "active" || !env[secretRef.reference]) {
      return {
        ok: false,
        code: "provider_secret_missing",
        message: `Provider ${model.provider.key} is missing an active environment secret reference.`,
      };
    }
  }

  if (!hasModelCapabilities(model, requiredCapabilities)) {
    return {
      ok: false,
      code: "capability_mismatch",
      message: `Registered model ${model.slug} does not satisfy required capabilities: ${requiredCapabilities.join(", ")}`,
    };
  }

  return { ok: true, value: model };
}

function toSnapshot(
  slotKey: ModelSlotKey,
  model: SlotModelCandidate,
  usedFallback: boolean,
  requiredCapabilities: ModelCapability[],
): ResolvedModelSnapshot {
  return {
    slotKey,
    providerId: model.provider.id,
    providerKey: model.provider.key,
    providerKind: model.provider.providerKind as ResolvedModelSnapshot["providerKind"],
    modelId: model.id,
    modelName: model.name,
    modelSlug: model.slug,
    concreteModelName: `${model.provider.key}:${model.slug}`,
    usedFallback,
    requiredCapabilities,
  };
}

async function emitSuccess(
  prisma: PrismaClient,
  input: ModelResolutionRequest,
  snapshot: ResolvedModelSnapshot,
) {
  await emitModelEvent(prisma, {
    projectId: input.projectId,
    taskExecutionId: input.taskExecutionId,
    type: "model.resolution.succeeded",
    payload: snapshot,
  });
}

async function fail(
  prisma: PrismaClient,
  input: ModelResolutionRequest,
  code: ModelResolutionFailureCode,
  message: string,
  requiredCapabilities: readonly ModelCapability[],
): Promise<ModelResolutionResult> {
  await emitModelEvent(prisma, {
    projectId: input.projectId,
    taskExecutionId: input.taskExecutionId,
    type: "model.resolution.failed",
    payload: {
      slotKey: input.slotKey,
      code,
      message,
      requiredCapabilities,
    },
  });

  return {
    ok: false,
    code,
    message,
    slotKey: input.slotKey,
  };
}

async function emitModelEvent(
  prisma: PrismaClient,
  event: {
    projectId: string;
    taskExecutionId?: string;
    type: string;
    payload: unknown;
  },
) {
  await prisma.loopEvent.create({
    data: {
      projectId: event.projectId,
      taskExecutionId: event.taskExecutionId,
      type: event.type,
      payloadJson: JSON.stringify(event.payload),
    },
  });
}
