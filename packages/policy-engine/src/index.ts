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

export async function resolveModelSlot(
  prisma: PrismaClient,
  input: ModelResolutionRequest,
  env: Record<string, string | undefined> = process.env,
): Promise<ModelResolutionResult> {
  const requiredCapabilities = [...(input.requiredCapabilities ?? [])];

  await emitModelEvent(prisma, {
    projectId: input.projectId,
    taskExecutionId: input.taskExecutionId,
    type: "model.resolution.requested",
    payload: {
      slotKey: input.slotKey,
      requiredCapabilities,
    },
  });

  const slot = await resolveSlotBase(prisma, input.projectId, input.slotKey);

  if (!slot) {
    return fail(prisma, input, "slot_missing", `Model slot ${input.slotKey} has not been seeded.`, requiredCapabilities);
  }

  if (!slot.primaryModel && !slot.fallbackModel) {
    return fail(prisma, input, "slot_unassigned", `Model slot ${input.slotKey} is not assigned.`, requiredCapabilities);
  }

  const primary = validateCandidate(slot.primaryModel, requiredCapabilities, env);

  if (primary.ok) {
    const snapshot = toSnapshot(input.slotKey, primary.value, false, requiredCapabilities);
    await emitSuccess(prisma, input, snapshot);
    return { ok: true, value: snapshot };
  }

  const fallback = validateCandidate(slot.fallbackModel, requiredCapabilities, env);

  if (fallback.ok) {
    const snapshot = toSnapshot(input.slotKey, fallback.value, true, requiredCapabilities);
    await emitModelEvent(prisma, {
      projectId: input.projectId,
      taskExecutionId: input.taskExecutionId,
      type: "model.fallback.used",
      payload: {
        slotKey: input.slotKey,
        primaryFailure: primary,
        resolvedModel: snapshot.concreteModelName,
      },
    });
    await emitSuccess(prisma, input, snapshot);
    return { ok: true, value: snapshot };
  }

  const finalFailure = slot.fallbackModel ? fallback : primary;

  return fail(prisma, input, finalFailure.code, finalFailure.message, requiredCapabilities);
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

const EXECUTOR_SLOT_LADDER: ReadonlyArray<ModelSlotKey> = ["executor_default", "executor_strong"];

export function nextExecutorSlot(slotKey: ModelSlotKey): ModelSlotKey | null {
  const index = EXECUTOR_SLOT_LADDER.indexOf(slotKey);

  if (index === -1 || index === EXECUTOR_SLOT_LADDER.length - 1) {
    return null;
  }

  return EXECUTOR_SLOT_LADDER[index + 1] ?? null;
}
