import { Hono } from "hono";
import { createExecutionService, type ExecutionService } from "@vimbuspromax3000/agent";
import {
  approveVerificationPlan,
  createApprovalDecision,
  createPlannerRun,
  createProject,
  createPrismaClient,
  getPlannerRunDetail,
  getTaskDetail,
  listApprovals,
  listLoopEvents,
  listProjects,
  listTasks,
  persistPlannerProposal,
  type PrismaClient,
  updatePlannerInterview,
} from "@vimbuspromax3000/db";
import {
  assignSlot,
  createModel,
  createProvider,
  createSecretRef,
  listModels,
  listProviders,
  listSecretRefs,
  listSlots,
  seedDefaultSlots,
  setupModelRegistry,
  testProviderConfig,
  updateModel,
  updateProvider,
} from "@vimbuspromax3000/model-registry";
import {
  createPlannerService,
  normalizePlannerProposalInput,
  type PlannerService,
} from "@vimbuspromax3000/planner";
import { resolveModelSlot } from "@vimbuspromax3000/policy-engine";
import {
  createTestRunnerService,
  isTestRunnerEligibilityError,
  type TestRunnerService,
} from "@vimbuspromax3000/test-runner";
import {
  isApprovalStatus,
  isApprovalSubjectType,
  isModelProviderKind,
  isModelSlotKey,
  isTaskStatus,
  type ApprovalStatus,
  type ApprovalSubjectType,
  type ModelCapability,
  type ModelProviderKind,
  type ModelSlotKey,
  type TaskStatus,
} from "@vimbuspromax3000/shared";

export const healthResponse = {
  status: "ok",
  service: "vimbuspromax3000-api",
  runtime: "bun",
} as const;

export type ApiAppOptions = {
  prisma?: PrismaClient;
  env?: Record<string, string | undefined>;
  plannerService?: PlannerService;
  executionService?: ExecutionService;
  testRunnerService?: TestRunnerService;
};

export function createApp(options: ApiAppOptions = {}) {
  const app = new Hono();
  const prisma = options.prisma ?? createPrismaClient();
  const env = options.env ?? process.env;
  const plannerService = options.plannerService ?? createPlannerService({ prisma, env });
  const executionService = options.executionService ?? createExecutionService({ prisma, env });
  const testRunnerService = options.testRunnerService ?? createTestRunnerService({ prisma });

  app.onError((error, context) =>
    context.json(
      {
        error: error.message,
      },
      400,
    ),
  );

  app.get("/health", (context) => context.json(healthResponse));

  app.get("/projects", async (context) => {
    return context.json(await listProjects(prisma));
  });

  app.post("/projects", async (context) => {
    const body = await context.req.json();
    const project = await createProject(prisma, {
      name: requireString(body.name, "name"),
      rootPath: requireString(body.rootPath, "rootPath"),
      baseBranch: optionalString(body.baseBranch),
      branchNaming: optionalString(body.branchNaming),
    });

    return context.json(project, 201);
  });

  app.post("/planner/runs", async (context) => {
    const body = await context.req.json();
    const plannerRun = await createPlannerRun(prisma, {
      projectId: requireString(body.projectId, "projectId"),
      goal: requireString(body.goal, "goal"),
      moduleName: optionalString(body.moduleName),
      contextPath: optionalString(body.contextPath),
    });

    return context.json(plannerRun, 201);
  });

  app.get("/planner/runs/:id", async (context) => {
    const plannerRun = await getPlannerRunDetail(prisma, context.req.param("id"));

    if (!plannerRun) {
      return context.json({ error: "Planner run was not found." }, 404);
    }

    return context.json(plannerRun);
  });

  app.post("/planner/runs/:id/answers", async (context) => {
    const body = await context.req.json();
    const answers = requireRecord(body.answers ?? body, "answers");
    const plannerRun = await updatePlannerInterview(prisma, {
      plannerRunId: context.req.param("id"),
      answers,
    });

    return context.json(plannerRun);
  });

  app.post("/planner/runs/:id/generate", async (context) => {
    const body = await context.req.json();

    if (hasPlannerProposalPayload(body)) {
      await persistPlannerProposal(prisma, normalizePlannerProposalInput(context.req.param("id"), body));

      const plannerRun = await getPlannerRunDetail(prisma, context.req.param("id"));

      if (!plannerRun) {
        return context.json({ error: "Planner run was not found." }, 404);
      }

      return context.json(plannerRun);
    }

    const result = await plannerService.generateAndPersist({
      plannerRunId: context.req.param("id"),
      seed: isRecord(body) ? optionalInteger(body.seed) : undefined,
    });

    return context.json(result.plannerRun);
  });

  app.get("/approvals", async (context) => {
    return context.json(
      await listApprovals(prisma, {
        projectId: context.req.query("projectId"),
        subjectType: optionalApprovalSubjectType(context.req.query("subjectType")),
        subjectId: context.req.query("subjectId"),
      }),
    );
  });

  app.post("/approvals", async (context) => {
    const body = await context.req.json();
    const approval = await createApprovalDecision(prisma, {
      projectId: requireString(body.projectId, "projectId"),
      subjectType: requireApprovalSubjectType(body.subjectType),
      subjectId: requireString(body.subjectId, "subjectId"),
      stage: requireString(body.stage, "stage"),
      status: requireApprovalStatus(body.status),
      operator: optionalString(body.operator),
      reason: optionalString(body.reason),
    });

    return context.json(approval, 201);
  });

  app.get("/tasks", async (context) => {
    return context.json(
      await listTasks(prisma, {
        projectId: requireProjectId(context.req.query("projectId")),
        plannerRunId: context.req.query("plannerRunId"),
        status: optionalTaskStatus(context.req.query("status")),
        epicId: context.req.query("epicId"),
      }),
    );
  });

  app.get("/tasks/:id", async (context) => {
    const task = await getTaskDetail(prisma, context.req.param("id"));

    if (!task) {
      return context.json({ error: "Task was not found." }, 404);
    }

    return context.json(task);
  });

  app.post("/tasks/:id/verification/approve", async (context) => {
    const body = await context.req.json();
    const task = await approveVerificationPlan(prisma, {
      taskId: context.req.param("id"),
      operator: optionalString(body.operator),
      reason: optionalString(body.reason),
      stage: optionalString(body.stage) ?? "verification_review",
    });

    if (!task) {
      return context.json({ error: "Task was not found." }, 404);
    }

    return context.json(task);
  });

  app.get("/tasks/:id/branch", async (context) => {
    const branch = await executionService.getTaskBranch(context.req.param("id"));

    if (!branch) {
      return context.json({ error: "Task branch was not found." }, 404);
    }

    return context.json(branch);
  });

  app.post("/tasks/:id/branch", async (context) => {
    return context.json(await executionService.prepareTaskBranch({ taskId: context.req.param("id") }));
  });

  app.post("/tasks/:id/branch/abandon", async (context) => {
    const branch = await executionService.abandonTaskBranch({ taskId: context.req.param("id") });

    if (!branch) {
      return context.json({ error: "Task branch was not found." }, 404);
    }

    return context.json(branch);
  });

  app.post("/tasks/:id/execute", async (context) => {
    return context.json(await executionService.startTaskExecution({ taskId: context.req.param("id") }), 201);
  });

  app.get("/executions/:id/test-runs", async (context) => {
    return context.json(await testRunnerService.listExecutionTestRuns(context.req.param("id")));
  });

  app.post("/executions/:id/test-runs", async (context) => {
    try {
      return context.json(await testRunnerService.runExecutionVerification({ executionId: context.req.param("id") }));
    } catch (error) {
      if (isTestRunnerEligibilityError(error)) {
        return context.json(
          {
            code: error.code,
            message: error.message,
            items: error.items,
          },
          error.statusCode,
        );
      }

      throw error;
    }
  });

  app.get("/executions/:id/patch", async (context) => {
    const patch = await executionService.getExecutionPatchReview(context.req.param("id"));

    if (!patch) {
      return context.json({ error: "Patch review was not found." }, 404);
    }

    return context.json(patch);
  });

  app.post("/executions/:id/patch/approve", async (context) => {
    return context.json(await executionService.approveExecutionPatchReview(context.req.param("id")));
  });

  app.post("/executions/:id/patch/reject", async (context) => {
    return context.json(await executionService.rejectExecutionPatchReview(context.req.param("id")));
  });

  app.get("/events", async (context) => {
    return context.json(
      await listLoopEvents(prisma, {
        projectId: requireProjectId(context.req.query("projectId")),
        taskExecutionId: context.req.query("taskExecutionId"),
        limit: optionalNumber(context.req.query("limit")),
      }),
    );
  });

  app.post("/model-setup", async (context) => {
    const body = await context.req.json();
    const setup = await setupModelRegistry(prisma, {
      projectId: body.projectId,
      projectName: body.projectName,
      rootPath: body.rootPath,
      baseBranch: body.baseBranch,
      secretLabel: body.secretLabel,
      secretEnv: body.secretEnv,
      providerKey: requireString(body.providerKey, "providerKey"),
      providerLabel: body.providerLabel,
      providerKind: requireProviderKind(body.providerKind),
      baseUrl: body.baseUrl ?? null,
      authType: body.authType,
      providerStatus: body.providerStatus,
      modelName: requireString(body.modelName, "modelName"),
      modelSlug: requireString(body.modelSlug, "modelSlug"),
      capabilities: normalizeCapabilities(body.capabilities),
      contextWindow: body.contextWindow ?? null,
      costTier: body.costTier,
      speedTier: body.speedTier,
      reasoningTier: body.reasoningTier,
      slotKeys: normalizeSlotKeys(body.slotKeys),
    });

    return context.json(setup, 201);
  });

  app.get("/model-secret-refs", async (context) => {
    const projectId = requireProjectId(context.req.query("projectId"));

    return context.json(await listSecretRefs(prisma, projectId));
  });

  app.post("/model-secret-refs", async (context) => {
    const body = await context.req.json();
    const secretRef = await createSecretRef(prisma, {
      projectId: requireString(body.projectId, "projectId"),
      kind: body.kind ?? "provider_api_key",
      label: requireString(body.label, "label"),
      storageType: body.storageType ?? "env",
      reference: requireString(body.reference, "reference"),
      status: body.status ?? "active",
    });

    return context.json(secretRef, 201);
  });

  app.get("/model-providers", async (context) => {
    const projectId = requireProjectId(context.req.query("projectId"));

    return context.json(await listProviders(prisma, projectId));
  });

  app.post("/model-providers", async (context) => {
    const body = await context.req.json();
    const provider = await createProvider(prisma, {
      projectId: requireString(body.projectId, "projectId"),
      key: requireString(body.key, "key"),
      label: requireString(body.label, "label"),
      providerKind: requireProviderKind(body.providerKind),
      baseUrl: body.baseUrl ?? null,
      authType: body.authType ?? "api_key",
      secretRefId: body.secretRefId ?? null,
      status: body.status ?? "pending_approval",
    });

    return context.json(provider, 201);
  });

  app.patch("/model-providers/:id", async (context) => {
    const body = await context.req.json();

    return context.json(await updateProvider(prisma, context.req.param("id"), body));
  });

  app.post("/model-providers/:id/test", async (context) => {
    return context.json(await testProviderConfig(prisma, context.req.param("id"), env));
  });

  app.get("/models", async (context) => {
    const projectId = requireProjectId(context.req.query("projectId"));
    const providerId = context.req.query("providerId");

    return context.json(await listModels(prisma, projectId, providerId));
  });

  app.post("/models", async (context) => {
    const body = await context.req.json();
    const model = await createModel(prisma, {
      providerId: requireString(body.providerId, "providerId"),
      name: requireString(body.name, "name"),
      slug: requireString(body.slug, "slug"),
      isEnabled: body.isEnabled,
      supportsTools: body.supportsTools,
      supportsVision: body.supportsVision,
      supportsJson: body.supportsJson,
      supportsStreaming: body.supportsStreaming,
      contextWindow: body.contextWindow ?? null,
      costTier: body.costTier ?? "medium",
      speedTier: body.speedTier ?? "balanced",
      reasoningTier: body.reasoningTier ?? "standard",
      metadataJson: body.metadataJson ?? null,
    });

    return context.json(model, 201);
  });

  app.patch("/models/:id", async (context) => {
    const body = await context.req.json();

    return context.json(await updateModel(prisma, context.req.param("id"), body));
  });

  app.get("/model-slots", async (context) => {
    const projectId = requireProjectId(context.req.query("projectId"));

    await seedDefaultSlots(prisma, projectId);

    return context.json(await listSlots(prisma, projectId));
  });

  app.post("/model-slots/:slot/assign", async (context) => {
    const slotKey = requireSlotKey(context.req.param("slot"));
    const body = await context.req.json();
    const slot = await assignSlot(prisma, {
      projectId: requireString(body.projectId, "projectId"),
      slotKey,
      registeredModelId: body.registeredModelId ?? null,
      fallbackRegisteredModelId: body.fallbackRegisteredModelId ?? null,
      policyJson: body.policyJson ?? null,
    });

    return context.json(slot);
  });

  app.post("/model-slots/:slot/test", async (context) => {
    const slotKey = requireSlotKey(context.req.param("slot"));
    const body = await context.req.json();

    return context.json(
      await resolveModelSlot(
        prisma,
        {
          projectId: requireString(body.projectId, "projectId"),
          slotKey,
          requiredCapabilities: normalizeCapabilities(body.requiredCapabilities),
          taskExecutionId: body.taskExecutionId,
        },
        env,
      ),
    );
  });

  app.post("/model-policy/preview", async (context) => {
    const body = await context.req.json();
    const slotKey = requireSlotKey(requireString(body.slotKey, "slotKey"));

    return context.json(
      await resolveModelSlot(
        prisma,
        {
          projectId: requireString(body.projectId, "projectId"),
          slotKey,
          requiredCapabilities: normalizeCapabilities(body.requiredCapabilities),
          taskExecutionId: body.taskExecutionId,
        },
        env,
      ),
    );
  });

  return app;
}

function requireProjectId(projectId: string | undefined): string {
  if (!projectId) {
    throw new Error("projectId query parameter is required.");
  }

  return projectId;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${fieldName} is required.`);
  }

  return value;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  return value;
}

function optionalNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric query value: ${value}`);
  }

  return parsed;
}

function requireSlotKey(value: string): ModelSlotKey {
  if (!isModelSlotKey(value)) {
    throw new Error(`Unknown model slot: ${value}`);
  }

  return value;
}

function requireProviderKind(value: unknown): ModelProviderKind {
  const providerKind = requireString(value, "providerKind");

  if (!isModelProviderKind(providerKind)) {
    throw new Error(`Unknown model provider kind: ${providerKind}`);
  }

  return providerKind;
}

function requireApprovalSubjectType(value: unknown): ApprovalSubjectType {
  const subjectType = requireString(value, "subjectType");

  if (!isApprovalSubjectType(subjectType)) {
    throw new Error(`Unknown approval subject type: ${subjectType}`);
  }

  return subjectType;
}

function optionalApprovalSubjectType(value: string | undefined): ApprovalSubjectType | undefined {
  if (!value) {
    return undefined;
  }

  if (!isApprovalSubjectType(value)) {
    throw new Error(`Unknown approval subject type: ${value}`);
  }

  return value;
}

function requireApprovalStatus(value: unknown): ApprovalStatus {
  const status = requireString(value, "status");

  if (!isApprovalStatus(status)) {
    throw new Error(`Unknown approval status: ${status}`);
  }

  return status;
}

function optionalTaskStatus(value: string | undefined): TaskStatus | undefined {
  if (!value) {
    return undefined;
  }

  if (!isTaskStatus(value)) {
    throw new Error(`Unknown task status: ${value}`);
  }

  return value;
}

function normalizeCapabilities(value: unknown): ModelCapability[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((capability): capability is ModelCapability =>
    ["tools", "vision", "json", "streaming"].includes(String(capability)),
  );
}

function normalizeSlotKeys(value: unknown): ModelSlotKey[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter((slotKey): slotKey is ModelSlotKey => isModelSlotKey(String(slotKey)));
}

function requireRecord(value: unknown, fieldName: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }

  return value as Record<string, any>;
}

function optionalInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw new Error(`Expected an integer value, received ${String(value)}.`);
  }

  return parsed;
}

function hasPlannerProposalPayload(value: unknown): boolean {
  return isRecord(value) && "epics" in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const app = createApp();

export default app;
