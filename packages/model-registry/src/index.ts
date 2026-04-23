import type { PrismaClient } from "@vimbuspromax3000/db/client";
import {
  MODEL_SLOT_KEYS,
  type ModelCapability,
  type ModelCostTier,
  type ModelProviderAuthType,
  type ModelProviderKind,
  type ModelProviderStatus,
  type ModelReasoningTier,
  type ModelSecretRefKind,
  type ModelSecretRefStatus,
  type ModelSecretStorageType,
  type ModelSlotKey,
  type ModelSpeedTier,
  isModelSlotKey,
} from "@vimbuspromax3000/shared";

export type CreateSecretRefInput = {
  projectId: string;
  kind: ModelSecretRefKind;
  label: string;
  storageType?: ModelSecretStorageType;
  reference: string;
  status?: ModelSecretRefStatus;
};

export type CreateProviderInput = {
  projectId: string;
  key: string;
  label: string;
  providerKind: ModelProviderKind;
  baseUrl?: string | null;
  authType: ModelProviderAuthType;
  secretRefId?: string | null;
  status?: ModelProviderStatus;
};

export type UpdateProviderInput = Partial<
  Pick<CreateProviderInput, "label" | "providerKind" | "baseUrl" | "authType" | "secretRefId" | "status">
>;

export type CreateModelInput = {
  providerId: string;
  name: string;
  slug: string;
  isEnabled?: boolean;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsJson?: boolean;
  supportsStreaming?: boolean;
  contextWindow?: number | null;
  costTier: ModelCostTier;
  speedTier: ModelSpeedTier;
  reasoningTier: ModelReasoningTier;
  metadataJson?: string | null;
};

export type UpdateModelInput = Partial<
  Pick<
    CreateModelInput,
    | "name"
    | "slug"
    | "isEnabled"
    | "supportsTools"
    | "supportsVision"
    | "supportsJson"
    | "supportsStreaming"
    | "contextWindow"
    | "costTier"
    | "speedTier"
    | "reasoningTier"
    | "metadataJson"
  >
>;

export type AssignSlotInput = {
  projectId: string;
  slotKey: ModelSlotKey;
  registeredModelId?: string | null;
  fallbackRegisteredModelId?: string | null;
  policyJson?: string | null;
};

export type SetupModelRegistryInput = {
  projectId?: string;
  projectName?: string;
  rootPath?: string;
  baseBranch?: string;
  secretLabel?: string;
  secretEnv?: string;
  providerKey: string;
  providerLabel?: string;
  providerKind: ModelProviderKind;
  baseUrl?: string | null;
  authType?: ModelProviderAuthType;
  providerStatus?: ModelProviderStatus;
  modelName: string;
  modelSlug: string;
  capabilities?: readonly ModelCapability[];
  contextWindow?: number | null;
  costTier?: ModelCostTier;
  speedTier?: ModelSpeedTier;
  reasoningTier?: ModelReasoningTier;
  slotKeys?: readonly ModelSlotKey[];
};

export type SlotModelCandidate = {
  id: string;
  name: string;
  slug: string;
  isEnabled: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsJson: boolean;
  supportsStreaming: boolean;
  provider: {
    id: string;
    key: string;
    label: string;
    providerKind: string;
    baseUrl: string | null;
    authType: string;
    status: string;
    secretRef: {
      id: string;
      label: string;
      storageType: string;
      reference: string;
      status: string;
    } | null;
  };
};

export type SlotBaseResolution = {
  id: string;
  projectId: string;
  slotKey: string;
  policyJson: string | null;
  primaryModel: SlotModelCandidate | null;
  fallbackModel: SlotModelCandidate | null;
};

const modelWithProvider = {
  provider: {
    include: {
      secretRef: true,
    },
  },
} as const;

const slotWithModels = {
  primaryModel: {
    include: modelWithProvider,
  },
  fallbackModel: {
    include: modelWithProvider,
  },
} as const;

export async function createSecretRef(prisma: PrismaClient, input: CreateSecretRefInput) {
  return prisma.projectSecretRef.create({
    data: {
      projectId: input.projectId,
      kind: input.kind,
      label: input.label,
      storageType: input.storageType ?? "env",
      reference: input.reference,
      status: input.status ?? "active",
    },
  });
}

export async function listSecretRefs(prisma: PrismaClient, projectId: string) {
  return prisma.projectSecretRef.findMany({
    where: { projectId },
    orderBy: [{ label: "asc" }],
  });
}

export async function createProvider(prisma: PrismaClient, input: CreateProviderInput) {
  return prisma.modelProvider.create({
    data: {
      projectId: input.projectId,
      key: input.key,
      label: input.label,
      providerKind: input.providerKind,
      baseUrl: input.baseUrl ?? null,
      authType: input.authType,
      secretRefId: input.secretRefId ?? null,
      status: input.status ?? "pending_approval",
    },
  });
}

export async function listProviders(prisma: PrismaClient, projectId: string) {
  return prisma.modelProvider.findMany({
    where: { projectId },
    include: {
      secretRef: true,
      models: {
        orderBy: [{ slug: "asc" }],
      },
    },
    orderBy: [{ key: "asc" }],
  });
}

export async function updateProvider(prisma: PrismaClient, id: string, input: UpdateProviderInput) {
  return prisma.modelProvider.update({
    where: { id },
    data: input,
  });
}

export async function createModel(prisma: PrismaClient, input: CreateModelInput) {
  return prisma.registeredModel.create({
    data: {
      providerId: input.providerId,
      name: input.name,
      slug: input.slug,
      isEnabled: input.isEnabled ?? true,
      supportsTools: input.supportsTools ?? false,
      supportsVision: input.supportsVision ?? false,
      supportsJson: input.supportsJson ?? false,
      supportsStreaming: input.supportsStreaming ?? false,
      contextWindow: input.contextWindow ?? null,
      costTier: input.costTier,
      speedTier: input.speedTier,
      reasoningTier: input.reasoningTier,
      metadataJson: input.metadataJson ?? null,
    },
  });
}

export async function listModels(prisma: PrismaClient, projectId: string, providerId?: string) {
  return prisma.registeredModel.findMany({
    where: {
      providerId,
      provider: {
        projectId,
      },
    },
    include: {
      provider: true,
    },
    orderBy: [{ slug: "asc" }],
  });
}

export async function updateModel(prisma: PrismaClient, id: string, input: UpdateModelInput) {
  return prisma.registeredModel.update({
    where: { id },
    data: input,
  });
}

export async function seedDefaultSlots(prisma: PrismaClient, projectId: string) {
  return Promise.all(
    MODEL_SLOT_KEYS.map((slotKey) =>
      prisma.projectModelSlot.upsert({
        where: {
          projectId_slotKey: {
            projectId,
            slotKey,
          },
        },
        update: {},
        create: {
          projectId,
          slotKey,
        },
      }),
    ),
  );
}

export async function listSlots(prisma: PrismaClient, projectId: string) {
  await seedDefaultSlots(prisma, projectId);

  return prisma.projectModelSlot.findMany({
    where: { projectId },
    include: slotWithModels,
    orderBy: [{ slotKey: "asc" }],
  });
}

export async function assignSlot(prisma: PrismaClient, input: AssignSlotInput) {
  assertModelSlotKey(input.slotKey);

  return prisma.projectModelSlot.upsert({
    where: {
      projectId_slotKey: {
        projectId: input.projectId,
        slotKey: input.slotKey,
      },
    },
    update: {
      registeredModelId: input.registeredModelId ?? null,
      fallbackRegisteredModelId: input.fallbackRegisteredModelId ?? null,
      policyJson: input.policyJson ?? null,
    },
    create: {
      projectId: input.projectId,
      slotKey: input.slotKey,
      registeredModelId: input.registeredModelId ?? null,
      fallbackRegisteredModelId: input.fallbackRegisteredModelId ?? null,
      policyJson: input.policyJson ?? null,
    },
    include: slotWithModels,
  });
}

export async function setupModelRegistry(prisma: PrismaClient, input: SetupModelRegistryInput) {
  const project = await findOrCreateSetupProject(prisma, input);
  await seedDefaultSlots(prisma, project.id);

  const secretRef = input.secretEnv
    ? await prisma.projectSecretRef.upsert({
        where: {
          projectId_label: {
            projectId: project.id,
            label: input.secretLabel ?? `${input.providerKey} api key`,
          },
        },
        update: {
          kind: "provider_api_key",
          storageType: "env",
          reference: input.secretEnv,
          status: "active",
        },
        create: {
          projectId: project.id,
          kind: "provider_api_key",
          label: input.secretLabel ?? `${input.providerKey} api key`,
          storageType: "env",
          reference: input.secretEnv,
          status: "active",
        },
      })
    : null;

  const provider = await prisma.modelProvider.upsert({
    where: {
      projectId_key: {
        projectId: project.id,
        key: input.providerKey,
      },
    },
    update: {
      label: input.providerLabel ?? input.providerKey,
      providerKind: input.providerKind,
      baseUrl: input.baseUrl ?? null,
      authType: input.authType ?? (secretRef ? "api_key" : "none"),
      secretRefId: secretRef?.id ?? null,
      status: input.providerStatus ?? "pending_approval",
    },
    create: {
      projectId: project.id,
      key: input.providerKey,
      label: input.providerLabel ?? input.providerKey,
      providerKind: input.providerKind,
      baseUrl: input.baseUrl ?? null,
      authType: input.authType ?? (secretRef ? "api_key" : "none"),
      secretRefId: secretRef?.id ?? null,
      status: input.providerStatus ?? "pending_approval",
    },
  });

  const capabilities = new Set(input.capabilities ?? []);
  const model = await prisma.registeredModel.upsert({
    where: {
      providerId_slug: {
        providerId: provider.id,
        slug: input.modelSlug,
      },
    },
    update: {
      name: input.modelName,
      isEnabled: true,
      supportsTools: capabilities.has("tools"),
      supportsVision: capabilities.has("vision"),
      supportsJson: capabilities.has("json"),
      supportsStreaming: capabilities.has("streaming"),
      contextWindow: input.contextWindow ?? null,
      costTier: input.costTier ?? "medium",
      speedTier: input.speedTier ?? "balanced",
      reasoningTier: input.reasoningTier ?? "standard",
    },
    create: {
      providerId: provider.id,
      name: input.modelName,
      slug: input.modelSlug,
      isEnabled: true,
      supportsTools: capabilities.has("tools"),
      supportsVision: capabilities.has("vision"),
      supportsJson: capabilities.has("json"),
      supportsStreaming: capabilities.has("streaming"),
      contextWindow: input.contextWindow ?? null,
      costTier: input.costTier ?? "medium",
      speedTier: input.speedTier ?? "balanced",
      reasoningTier: input.reasoningTier ?? "standard",
    },
  });

  const slotKeys = input.slotKeys ?? ["executor_default"];
  const slots = await Promise.all(
    slotKeys.map((slotKey) =>
      assignSlot(prisma, {
        projectId: project.id,
        slotKey,
        registeredModelId: model.id,
      }),
    ),
  );

  return {
    project,
    secretRef,
    provider,
    model,
    slots,
  };
}

export async function resolveSlotBase(
  prisma: PrismaClient,
  projectId: string,
  slotKey: ModelSlotKey,
): Promise<SlotBaseResolution | null> {
  assertModelSlotKey(slotKey);

  return prisma.projectModelSlot.findUnique({
    where: {
      projectId_slotKey: {
        projectId,
        slotKey,
      },
    },
    include: slotWithModels,
  });
}

export function getModelCapabilities(model: {
  supportsTools: boolean;
  supportsVision: boolean;
  supportsJson: boolean;
  supportsStreaming: boolean;
}): ModelCapability[] {
  const capabilities: ModelCapability[] = [];

  if (model.supportsTools) {
    capabilities.push("tools");
  }
  if (model.supportsVision) {
    capabilities.push("vision");
  }
  if (model.supportsJson) {
    capabilities.push("json");
  }
  if (model.supportsStreaming) {
    capabilities.push("streaming");
  }

  return capabilities;
}

export function hasModelCapabilities(
  model: {
    supportsTools: boolean;
    supportsVision: boolean;
    supportsJson: boolean;
    supportsStreaming: boolean;
  },
  requiredCapabilities: readonly ModelCapability[] = [],
): boolean {
  const capabilities = new Set(getModelCapabilities(model));

  return requiredCapabilities.every((capability) => capabilities.has(capability));
}

export async function testProviderConfig(
  prisma: PrismaClient,
  providerId: string,
  env: Record<string, string | undefined> = process.env,
) {
  const provider = await prisma.modelProvider.findUnique({
    where: { id: providerId },
    include: { secretRef: true },
  });

  if (!provider) {
    return { ok: false as const, code: "provider_missing", message: "Provider was not found." };
  }

  if (provider.authType === "api_key" && !provider.secretRef) {
    return {
      ok: false as const,
      code: "secret_ref_missing",
      message: "Provider requires an API key secret reference.",
    };
  }

  if (provider.secretRef && !env[provider.secretRef.reference]) {
    return {
      ok: false as const,
      code: "env_missing",
      message: `Environment variable ${provider.secretRef.reference} is not set.`,
    };
  }

  return {
    ok: true as const,
    providerKind: provider.providerKind,
    message: "Provider configuration is valid.",
  };
}

async function findOrCreateSetupProject(prisma: PrismaClient, input: SetupModelRegistryInput) {
  if (input.projectId) {
    const project = await prisma.project.findUnique({
      where: { id: input.projectId },
    });

    if (!project) {
      throw new Error(`Project ${input.projectId} was not found.`);
    }

    return project;
  }

  const rootPath = input.rootPath ?? process.cwd();
  const existingProject = await prisma.project.findFirst({
    where: { rootPath },
    orderBy: [{ createdAt: "asc" }],
  });

  if (existingProject) {
    return existingProject;
  }

  return prisma.project.create({
    data: {
      name: input.projectName ?? "VimbusProMax3000",
      rootPath,
      baseBranch: input.baseBranch ?? "main",
    },
  });
}

function assertModelSlotKey(slotKey: string): asserts slotKey is ModelSlotKey {
  if (!isModelSlotKey(slotKey)) {
    throw new Error(`Unknown model slot: ${slotKey}`);
  }
}
