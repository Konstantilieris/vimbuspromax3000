import {
  DEFAULT_AGENT_ROLE_MODEL_SLOTS,
  type ModelSlotKey,
  isModelSlotKey,
} from "@vimbuspromax3000/shared";

export type PlannerAgentRole = keyof typeof DEFAULT_AGENT_ROLE_MODEL_SLOTS;

export type PlannerModelSlotRequirement = {
  role: PlannerAgentRole | string;
  slotKey?: string;
  modelName?: string;
};

export type PlannerSlotValidationResult =
  | {
      ok: true;
      requirements: Array<PlannerModelSlotRequirement & { slotKey: ModelSlotKey }>;
    }
  | {
      ok: false;
      errors: string[];
    };

export function getDefaultSlotForAgentRole(role: PlannerAgentRole): ModelSlotKey {
  return DEFAULT_AGENT_ROLE_MODEL_SLOTS[role];
}

export function validatePlannerModelSlots(
  requirements: readonly PlannerModelSlotRequirement[],
): PlannerSlotValidationResult {
  const errors: string[] = [];
  const normalized: Array<PlannerModelSlotRequirement & { slotKey: ModelSlotKey }> = [];

  for (const requirement of requirements) {
    if (requirement.modelName) {
      errors.push(`${requirement.role} uses raw model name ${requirement.modelName}; planner output must use slotKey.`);
    }

    const slotKey = requirement.slotKey ?? defaultSlotForUnknownRole(requirement.role);

    if (!slotKey || !isModelSlotKey(slotKey)) {
      errors.push(`${requirement.role} is missing a valid model slot.`);
      continue;
    }

    normalized.push({ ...requirement, slotKey });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, requirements: normalized };
}

function defaultSlotForUnknownRole(role: string): ModelSlotKey | undefined {
  if (role in DEFAULT_AGENT_ROLE_MODEL_SLOTS) {
    return DEFAULT_AGENT_ROLE_MODEL_SLOTS[role as PlannerAgentRole];
  }

  return undefined;
}
