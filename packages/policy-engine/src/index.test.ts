import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { PrismaClient } from "@vimbuspromax3000/db/client";
import { createProject } from "@vimbuspromax3000/db";
import { createIsolatedPrisma, removeTempDir } from "@vimbuspromax3000/db/testing";
import { setupModelRegistry } from "@vimbuspromax3000/model-registry";
import {
  resolveModelSlot,
  resolveSlotForComplexity,
  type ComplexityAwareSlotInput,
} from "./index";

function build(overrides: Partial<ComplexityAwareSlotInput> = {}): ComplexityAwareSlotInput {
  return {
    requestedSlotKey: "executor_default",
    complexity: "medium",
    ...overrides,
  };
}

describe("resolveSlotForComplexity", () => {
  test("keeps non-executor slots untouched regardless of complexity", () => {
    const result = resolveSlotForComplexity(
      build({ requestedSlotKey: "planner_deep", complexity: "high" }),
    );

    expect(result.slotKey).toBe("planner_deep");
    expect(result.escalated).toBe(false);
    expect(result.reason).toContain("not an executor slot");
  });

  test("prefers executor_strong for high-complexity executor tasks", () => {
    const result = resolveSlotForComplexity(
      build({ requestedSlotKey: "executor_default", complexity: "high" }),
    );

    expect(result.slotKey).toBe("executor_strong");
    expect(result.escalated).toBe(true);
    expect(result.reason).toContain("complexity=high");
  });

  test("uses executor_default for medium-complexity executor tasks", () => {
    const result = resolveSlotForComplexity(
      build({ requestedSlotKey: "executor_default", complexity: "medium" }),
    );

    expect(result.slotKey).toBe("executor_default");
    expect(result.escalated).toBe(false);
  });

  test("uses executor_default for low-complexity executor tasks", () => {
    const result = resolveSlotForComplexity(
      build({ requestedSlotKey: "executor_default", complexity: "low" }),
    );

    expect(result.slotKey).toBe("executor_default");
    expect(result.escalated).toBe(false);
  });

  test("preserves executor_strong when caller already requested it", () => {
    const result = resolveSlotForComplexity(
      build({ requestedSlotKey: "executor_strong", complexity: "low" }),
    );

    expect(result.slotKey).toBe("executor_strong");
    expect(result.escalated).toBe(false);
  });

  test("treats unknown complexity labels as medium (no escalation)", () => {
    const result = resolveSlotForComplexity(
      build({ requestedSlotKey: "executor_default", complexity: "weird" }),
    );

    expect(result.slotKey).toBe("executor_default");
    expect(result.escalated).toBe(false);
  });

  test("treats null/undefined complexity as medium (no escalation)", () => {
    const result = resolveSlotForComplexity(
      build({ requestedSlotKey: "executor_default", complexity: null }),
    );

    expect(result.slotKey).toBe("executor_default");
    expect(result.escalated).toBe(false);
  });
});

describe("resolveModelSlot complexity routing", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-policy-engine-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  });

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test("executor_default resolves to executor_strong when input.complexity is high", async () => {
    const env = { VIMBUS_POLICY_ENV: "present" };
    const project = await createProject(prisma, {
      name: "Policy Project",
      rootPath: tempDir,
    });

    await setupModelRegistry(prisma, {
      projectId: project.id,
      providerKey: "openai",
      providerKind: "openai",
      providerStatus: "active",
      secretEnv: "VIMBUS_POLICY_ENV",
      modelName: "GPT Default",
      modelSlug: "gpt-default",
      capabilities: ["json"],
      slotKeys: ["executor_default"],
    });
    await setupModelRegistry(prisma, {
      projectId: project.id,
      providerKey: "openai",
      providerKind: "openai",
      providerStatus: "active",
      secretEnv: "VIMBUS_POLICY_ENV",
      modelName: "GPT Strong",
      modelSlug: "gpt-strong",
      capabilities: ["json"],
      slotKeys: ["executor_strong"],
    });

    const result = await resolveModelSlot(
      prisma,
      {
        projectId: project.id,
        slotKey: "executor_default",
        requiredCapabilities: ["json"],
        complexity: "high",
      },
      env,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.slotKey).toBe("executor_strong");
      expect(result.value.concreteModelName).toBe("openai:gpt-strong");
    }

    const events = await prisma.loopEvent.findMany({
      where: { projectId: project.id, type: "model.resolution.requested" },
    });
    expect(events).toHaveLength(1);
    const payload = JSON.parse(events[0]!.payloadJson);
    expect(payload.escalated).toBe(true);
    expect(payload.requestedSlotKey).toBe("executor_default");
    expect(payload.slotKey).toBe("executor_strong");
    expect(payload.complexity).toBe("high");
  });

  test("complexity=high + attempt=1 stays on executor_strong (no further bump)", async () => {
    const env = { VIMBUS_POLICY_ENV: "present" };
    const project = await createProject(prisma, {
      name: "Policy Project Compose High",
      rootPath: tempDir,
    });

    await setupModelRegistry(prisma, {
      projectId: project.id,
      providerKey: "openai",
      providerKind: "openai",
      providerStatus: "active",
      secretEnv: "VIMBUS_POLICY_ENV",
      modelName: "GPT Default",
      modelSlug: "gpt-default",
      capabilities: ["json"],
      slotKeys: ["executor_default"],
    });
    await setupModelRegistry(prisma, {
      projectId: project.id,
      providerKey: "openai",
      providerKind: "openai",
      providerStatus: "active",
      secretEnv: "VIMBUS_POLICY_ENV",
      modelName: "GPT Strong",
      modelSlug: "gpt-strong",
      capabilities: ["json"],
      slotKeys: ["executor_strong"],
    });

    const result = await resolveModelSlot(
      prisma,
      {
        projectId: project.id,
        slotKey: "executor_default",
        requiredCapabilities: ["json"],
        complexity: "high",
        attempt: 1,
      },
      env,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.slotKey).toBe("executor_strong");
    }

    const events = await prisma.loopEvent.findMany({
      where: { projectId: project.id, type: "model.resolution.requested" },
    });
    expect(events).toHaveLength(1);
    const payload = JSON.parse(events[0]!.payloadJson);
    expect(payload.slotKey).toBe("executor_strong");
    expect(payload.escalated).toBe(true);
    expect(payload.attempt).toBe(1);
    // attempt=1 alone wouldn't escalate; escalation came from complexity.
    expect(payload.attemptEscalated).toBe(false);
  });

  test("complexity=low + attempt=3 escalates default → strong via attempt path", async () => {
    const env = { VIMBUS_POLICY_ENV: "present" };
    const project = await createProject(prisma, {
      name: "Policy Project Compose Attempt",
      rootPath: tempDir,
    });

    await setupModelRegistry(prisma, {
      projectId: project.id,
      providerKey: "openai",
      providerKind: "openai",
      providerStatus: "active",
      secretEnv: "VIMBUS_POLICY_ENV",
      modelName: "GPT Default",
      modelSlug: "gpt-default",
      capabilities: ["json"],
      slotKeys: ["executor_default"],
    });
    await setupModelRegistry(prisma, {
      projectId: project.id,
      providerKey: "openai",
      providerKind: "openai",
      providerStatus: "active",
      secretEnv: "VIMBUS_POLICY_ENV",
      modelName: "GPT Strong",
      modelSlug: "gpt-strong",
      capabilities: ["json"],
      slotKeys: ["executor_strong"],
    });

    const result = await resolveModelSlot(
      prisma,
      {
        projectId: project.id,
        slotKey: "executor_default",
        requiredCapabilities: ["json"],
        complexity: "low",
        attempt: 3,
      },
      env,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.slotKey).toBe("executor_strong");
      expect(result.value.concreteModelName).toBe("openai:gpt-strong");
    }

    const events = await prisma.loopEvent.findMany({
      where: { projectId: project.id, type: "model.resolution.requested" },
    });
    expect(events).toHaveLength(1);
    const payload = JSON.parse(events[0]!.payloadJson);
    expect(payload.slotKey).toBe("executor_strong");
    expect(payload.escalated).toBe(true);
    expect(payload.attempt).toBe(3);
    expect(payload.attemptEscalated).toBe(true);
    expect(payload.attemptReason).toBe("escalate_to_strong");
  });

  test("executor_default resolves to executor_default for medium complexity", async () => {
    const env = { VIMBUS_POLICY_ENV: "present" };
    const project = await createProject(prisma, {
      name: "Policy Project Default",
      rootPath: tempDir,
    });

    await setupModelRegistry(prisma, {
      projectId: project.id,
      providerKey: "openai",
      providerKind: "openai",
      providerStatus: "active",
      secretEnv: "VIMBUS_POLICY_ENV",
      modelName: "GPT Default",
      modelSlug: "gpt-default",
      capabilities: ["json"],
      slotKeys: ["executor_default"],
    });

    const result = await resolveModelSlot(
      prisma,
      {
        projectId: project.id,
        slotKey: "executor_default",
        requiredCapabilities: ["json"],
        complexity: "medium",
      },
      env,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.slotKey).toBe("executor_default");
      expect(result.value.concreteModelName).toBe("openai:gpt-default");
    }
  });
});
