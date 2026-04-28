import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  createExecutionService,
  createVercelAiSdkAgentGeneratorFactory,
  RetryExecutionError,
  type CreateAgentGenerator,
  type ExecutionService,
} from "@vimbuspromax3000/agent";
import {
  compareRegressionBaseline,
  scoreBenchmarkRun,
  type BenchmarkRunResult,
  type BenchmarkScenario as BenchmarkScenarioContract,
  type BenchmarkToolCall,
  type BenchmarkVerificationItemResult,
  type RegressionBaseline as RegressionBaselineContract,
} from "@vimbuspromax3000/benchmarks";
import {
  appendLoopEvent,
  approveVerificationPlan,
  approveSourceAsset,
  createApprovalDecision,
  createBenchmarkScenario,
  createEvalResult,
  createEvalRun,
  createLangSmithTraceLink,
  createMcpToolCall,
  createPlannerRun,
  createProject,
  createPrismaClient,
  createRegressionBaseline,
  getActiveRegressionBaseline,
  getBenchmarkScenario,
  getDefaultLoopEventBus,
  getEvalRun,
  getMcpToolCallDetail,
  getSourceAsset,
  getPlannerRunDetail,
  getTaskDetail,
  getTaskExecutionDetail,
  getTaskVerificationReview,
  listBenchmarkScenarios,
  listApprovals,
  listLangSmithTraceLinks,
  listLoopEvents,
  listMcpServers,
  listMcpToolCalls,
  listMcpToolCallsForExecution,
  listProjects,
  listProjectSourceAssets,
  listRegressionBaselines,
  listTaskMcpTools,
  listTaskSourceAssets,
  listVisualVerificationResults,
  listTasks,
  ingestProjectSourceAsset,
  persistPlannerProposal,
  setMcpServerCredential,
  type LoopEventBus,
  type PrismaClient,
  updateLangSmithTraceLink,
  updateMcpServerStatus,
  updatePlannerInterview,
  upsertMcpServer,
  upsertMcpTool,
} from "@vimbuspromax3000/db";
import {
  buildMcpServerSetupPlan,
  createMcpService,
  getStandardMcpServerDefinitions,
  probeStandardMcpServers,
  type McpServerDefinition,
  type McpServerSetupPayload,
} from "@vimbuspromax3000/mcp-client";
import { createEvaluatorService, EvaluatorError, type EvaluatorService } from "@vimbuspromax3000/evaluator";
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
  evaluateInterviewSubmission,
  getExpectedNextInterviewRound,
  INTERVIEW_ROUNDS,
  normalizeInterviewPayload,
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
  isLangSmithSubjectType,
  isLangSmithSyncStatus,
  isModelProviderKind,
  isMcpServerAuthType,
  isMcpServerStatus,
  isMcpServerTransport,
  isMcpServerTrustLevel,
  isModelSlotKey,
  isTaskStatus,
  type ApprovalStatus,
  type ApprovalSubjectType,
  type LangSmithSubjectType,
  type LangSmithSyncStatus,
  type ModelCapability,
  type ModelProviderKind,
  type McpServerAuthType,
  type McpServerStatus,
  type McpServerTransport,
  type McpServerTrustLevel,
  type ModelSlotKey,
  type TaskStatus,
} from "@vimbuspromax3000/shared";

export const healthResponse = {
  status: "ok",
  service: "vimbuspromax3000-api",
  runtime: "bun",
} as const;

export type EventsSseConfig = {
  /**
   * Heartbeat interval in milliseconds. The default keeps idle proxies and
   * load balancers happy without spamming the wire.
   */
  heartbeatMs?: number;
  /**
   * @deprecated since VIM-36 Sprint 2 — the SSE handler now consumes an
   * in-process event bus and no longer polls the repository. The option is
   * preserved so existing callers (notably the Sprint 1 SSE test that pinned
   * a fast heartbeat) keep type-checking.
   */
  pollIntervalMs?: number;
};

export type ApiAppOptions = {
  prisma?: PrismaClient;
  env?: Record<string, string | undefined>;
  plannerService?: PlannerService;
  executionService?: ExecutionService;
  testRunnerService?: TestRunnerService;
  evaluatorService?: EvaluatorService;
  eventsSseConfig?: EventsSseConfig;
  /**
   * VIM-36 Sprint 2 — inject a non-default event bus (mostly for tests). The
   * bus is the source of truth for live SSE pushes; production wiring keeps
   * the process-wide singleton from `getDefaultLoopEventBus()` so any
   * `appendLoopEvent` call (including from sibling packages and the VIM-30
   * retry route) lands on the same fan-out.
   */
  loopEventBus?: LoopEventBus;
  /**
   * VIM-29 Sprint 2 — overrides the agent generator factory wired into
   * `createExecutionService`. Tests inject a fake (or AI SDK
   * `MockLanguageModelV3`-backed) generator here so the loop runs end-to-end
   * without hitting a real provider. When absent, production boot defaults
   * to the Vercel AI SDK adapter resolved from prisma + env.
   */
  agentGeneratorFactory?: CreateAgentGenerator | null;
  /**
   * VIM-29 Sprint 2 — turn budget for the execution agent loop. Defaults to
   * {@link DEFAULT_AGENT_LOOP_MAX_TURNS} (mirroring the conservative default
   * documented in `docs/policy/model-selection.md`; the policy does not yet
   * pin a hard number so we keep the same 25-turn ceiling as Sprint 1).
   */
  agentLoopMaxTurns?: number;
};

const DEFAULT_EVENTS_HEARTBEAT_MS = 15_000;
const DEFAULT_AGENT_LOOP_MAX_TURNS = 25;

export function createApp(options: ApiAppOptions = {}) {
  const app = new Hono();
  const prisma = options.prisma ?? createPrismaClient();
  const env = options.env ?? process.env;
  const plannerService = options.plannerService ?? createPlannerService({ prisma, env });
  const agentLoopMaxTurns = options.agentLoopMaxTurns ?? DEFAULT_AGENT_LOOP_MAX_TURNS;
  // Sprint 2: caller opts in. Tests + the existing app.test.ts smoke pass
  // `null` (or simply omit the option) to keep the loop disabled and exercise
  // only the branch/model/approval gates. The production boot file
  // (`apps/api/src/index.ts`) explicitly wires
  // `createVercelAiSdkAgentGeneratorFactory` so the loop runs against a real
  // provider when starting the server.
  const agentGeneratorFactory =
    options.agentGeneratorFactory === null ? undefined : options.agentGeneratorFactory;
  const executionService =
    options.executionService ??
    createExecutionService({
      prisma,
      env,
      agentGeneratorFactory,
      agentLoopMaxTurns,
    });
  const testRunnerService = options.testRunnerService ?? createTestRunnerService({ prisma });
  const mcpService = createMcpService({ prisma });
  const evaluatorService = options.evaluatorService ?? createEvaluatorService({ prisma, env });
  const eventsHeartbeatMs = options.eventsSseConfig?.heartbeatMs ?? DEFAULT_EVENTS_HEARTBEAT_MS;
  const loopEventBus = options.loopEventBus ?? getDefaultLoopEventBus();

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
    // VIM-34 — 5-round interview state machine. The planner service exposes a
    // pure evaluator (`evaluateInterviewSubmission`) that decides accept vs
    // out-of-order based on which round names are already persisted on
    // `interviewJson`. Out-of-order submissions return 422 + the expected next
    // round so the CLI can re-prompt; on accept, we emit `planner.question`
    // followed by `planner.answer` for each round, in order.
    const plannerRunId = context.req.param("id");
    const body = await context.req.json();

    const existing = await getPlannerRunDetail(prisma, plannerRunId);
    if (!existing) {
      return context.json({ error: "Planner run was not found." }, 404);
    }

    const currentInterview = (existing.interview ?? {}) as Record<string, unknown>;
    const expectedNextBefore = getExpectedNextInterviewRound(currentInterview);
    const submission = normalizeInterviewPayload(body, {
      expectedNextRound: expectedNextBefore,
    });

    if (!submission) {
      return context.json(
        {
          error: "invalid_payload",
          expectedNextRound: expectedNextBefore,
          rounds: INTERVIEW_ROUNDS,
        },
        422,
      );
    }

    const decision = evaluateInterviewSubmission(currentInterview, submission);
    if (!decision.ok) {
      return context.json(
        {
          error: decision.reason,
          expectedNextRound: decision.expectedNextRound,
          submittedRound: decision.submittedRound,
        },
        422,
      );
    }

    // Apply each accepted round one at a time so persistence + events are
    // observably ordered: planner.question (round opened) → planner.answer
    // (round persisted). `updatePlannerInterview` does the merge + answer
    // event in a single repo call; we layer the question event in front.
    let plannerRun: Awaited<ReturnType<typeof updatePlannerInterview>> | null = null;
    for (const entry of decision.appliedRounds) {
      await appendLoopEvent(prisma, {
        projectId: existing.projectId,
        type: "planner.question",
        payload: {
          plannerRunId,
          round: entry.round,
        },
      });
      plannerRun = await updatePlannerInterview(prisma, {
        plannerRunId,
        answers: { [entry.round]: entry.answer },
      });
    }

    if (!plannerRun) {
      // Should be unreachable — evaluateInterviewSubmission rejects an empty
      // submission before we get here. Defensive guard for type narrowing.
      return context.json({ error: "missing_answer", expectedNextRound: expectedNextBefore }, 422);
    }

    // Re-read so the response includes the planner-run detail shape (project,
    // proposalSummary, approvals) the CLI/dashboard already render.
    const updated = await getPlannerRunDetail(prisma, plannerRunId);
    return context.json({
      ...(updated ?? plannerRun),
      expectedNextRound: decision.expectedNextRound,
    });
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
    const subjectType = requireApprovalSubjectType(body.subjectType);
    const status = requireApprovalStatus(body.status);
    const approval = await createApprovalDecision(prisma, {
      projectId: requireString(body.projectId, "projectId"),
      subjectType,
      subjectId: requireString(body.subjectId, "subjectId"),
      stage: requireString(body.stage, "stage"),
      status,
      operator: optionalString(body.operator),
      reason: optionalString(body.reason),
    });

    if (subjectType === "source_of_truth_asset" && status === "granted") {
      const asset = await approveSourceAsset(prisma, approval.subjectId);

      await appendLoopEvent(prisma, {
        projectId: asset.projectId,
        type: "asset.approved",
        payload: {
          sourceAssetId: asset.id,
          approvalId: approval.id,
          taskId: asset.taskId,
          verificationItemId: asset.verificationItemId,
        },
      });
    }

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

  app.get("/tasks/:id/verification", async (context) => {
    const review = await getTaskVerificationReview(prisma, context.req.param("id"));

    if (!review) {
      return context.json({ error: "Task was not found." }, 404);
    }

    return context.json(review);
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

  app.post("/projects/:id/source-assets", async (context) => {
    const body = await context.req.json();
    const project = await prisma.project.findUnique({
      where: { id: context.req.param("id") },
    });

    if (!project) {
      return context.json({ error: "Project was not found." }, 404);
    }

    const asset = await ingestProjectSourceAsset(prisma, {
      projectId: project.id,
      projectRoot: project.rootPath,
      relativePath: requireString(body.relativePath, "relativePath"),
      taskId: optionalString(body.taskId) ?? null,
      verificationItemId: optionalString(body.verificationItemId) ?? null,
      comparisonMode: optionalString(body.comparisonMode) ?? null,
      status: "proposed",
      setAsExpectedAsset: body.setAsExpectedAsset === true,
    });

    await appendLoopEvent(prisma, {
      projectId: project.id,
      type: "asset.ingested",
      payload: {
        sourceAssetId: asset.id,
        relativePath: asset.relativePath,
        taskId: asset.taskId,
        verificationItemId: asset.verificationItemId,
        sha256: asset.sha256,
      },
    });

    return context.json(asset, 201);
  });

  app.get("/projects/:id/source-assets", async (context) => {
    return context.json(
      await listProjectSourceAssets(prisma, {
        projectId: context.req.param("id"),
        taskId: context.req.query("taskId"),
        verificationItemId: context.req.query("verificationItemId"),
        status: context.req.query("status"),
      }),
    );
  });

  app.get("/tasks/:id/source-assets", async (context) => {
    return context.json(await listTaskSourceAssets(prisma, context.req.param("id")));
  });

  app.post("/source-assets/:id/approve", async (context) => {
    const asset = await approveSourceAsset(prisma, context.req.param("id"));

    await appendLoopEvent(prisma, {
      projectId: asset.projectId,
      type: "asset.approved",
      payload: {
        sourceAssetId: asset.id,
        taskId: asset.taskId,
        verificationItemId: asset.verificationItemId,
      },
    });

    return context.json(asset);
  });

  app.get("/source-assets/:id/visual-results", async (context) => {
    const asset = await getSourceAsset(prisma, context.req.param("id"));

    if (!asset) {
      return context.json({ error: "Source asset was not found." }, 404);
    }

    return context.json(
      await prisma.visualVerificationResult.findMany({
        where: {
          sourceAssetId: asset.id,
          verificationItemId: context.req.query("verificationItemId"),
        },
        orderBy: [{ createdAt: "asc" }],
      }),
    );
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
    const task = await prisma.task.findUnique({
      where: { id: context.req.param("id") },
      include: { epic: true },
    });

    if (!task) {
      return context.json({ error: "Task was not found." }, 404);
    }

    const mcpPrerequisites = await getMcpPrerequisiteFailure(prisma, task.epic.projectId);

    if (mcpPrerequisites) {
      return context.json(mcpPrerequisites, 409);
    }

    return context.json(await executionService.startTaskExecution({ taskId: context.req.param("id") }), 201);
  });

  app.post("/mcp/setup", async (context) => {
    const body = await optionalJsonBody(context.req);
    const projectId = requireString(context.req.query("projectId") ?? body.projectId, "projectId");
    const requestedServers = normalizeStringList(body.servers);
    const definitions = filterMcpDefinitions(getStandardMcpServerDefinitions(), requestedServers).map((definition) =>
      body.activate === true ? { ...definition, status: "active" as const } : definition,
    );
    const existingServers = await listMcpServers(prisma, projectId);
    const plan = buildMcpServerSetupPlan({
      projectId,
      definitions,
      existingServers,
    });
    const created = [];
    const updated = [];

    for (const payload of plan.create) {
      created.push(await persistMcpServerSetupPayload(prisma, payload));
    }

    for (const entry of plan.update) {
      updated.push(await persistMcpServerSetupPayload(prisma, entry.payload));
    }

    const servers = await listMcpServers(prisma, projectId);

    return context.json(
      {
        projectId,
        created,
        updated,
        unchanged: plan.unchanged,
        servers,
      },
      201,
    );
  });

  app.post("/mcp/probe", async (context) => {
    const body = await optionalJsonBody(context.req);
    const requestedServers = normalizeStringList(body.servers);
    const definitions = filterMcpDefinitions(getStandardMcpServerDefinitions(), requestedServers);

    return context.json(
      await probeStandardMcpServers({
        definitions,
        env,
      }),
    );
  });

  app.get("/mcp/servers", async (context) => {
    const servers = await listMcpServers(prisma, requireProjectId(context.req.query("projectId")));

    return context.json({
      servers: servers.map(formatMcpServer),
    });
  });

  app.post("/mcp/servers", async (context) => {
    const body = await context.req.json();
    const server = await persistMcpServerSetupPayload(prisma, normalizeMcpServerPayload(body));

    if (server && hasMcpCredentialBody(body)) {
      return context.json(await persistMcpServerCredentialFromBody(prisma, server.id, body), 201);
    }

    return context.json(server, 201);
  });

  app.patch("/mcp/servers/:id", async (context) => {
    const existing = await prisma.mcpServer.findUnique({
      where: { id: context.req.param("id") },
    });

    if (!existing) {
      return context.json({ error: "MCP server was not found." }, 404);
    }

    const body = await context.req.json();
    const server = await persistMcpServerSetupPayload(
      prisma,
      normalizeMcpServerPayload({
        ...body,
        projectId: existing.projectId,
        name: body.name ?? existing.name,
      }),
    );

    if (server && hasMcpCredentialBody(body)) {
      return context.json(await persistMcpServerCredentialFromBody(prisma, server.id, body));
    }

    return context.json(server);
  });

  app.post("/mcp/servers/:id/enable", async (context) => {
    return context.json(
      await updateMcpServerStatus(prisma, context.req.param("id"), {
        status: "active",
        lastVerifiedAt: new Date(),
        lastError: null,
      }),
    );
  });

  app.post("/mcp/servers/:id/disable", async (context) => {
    return context.json(
      await updateMcpServerStatus(prisma, context.req.param("id"), {
        status: "disabled",
        lastError: null,
      }),
    );
  });

  app.post("/mcp/servers/:id/credential", async (context) => {
    const body = await context.req.json();

    return context.json(
      await persistMcpServerCredentialFromBody(prisma, context.req.param("id"), body),
    );
  });

  app.post("/mcp/servers/:id/secret", async (context) => {
    const body = await context.req.json();

    return context.json(
      await persistMcpServerCredentialFromBody(prisma, context.req.param("id"), {
        ...body,
        credentialEnv: body.credentialEnv ?? body.reference ?? body.env,
        credentialLabel: body.credentialLabel ?? body.label,
      }),
    );
  });

  app.get("/tasks/:id/mcp/tools", async (context) => {
    const tools = await listTaskMcpTools(prisma, context.req.param("id"));

    if (!tools) {
      return context.json({ error: "Task was not found." }, 404);
    }

    return context.json({
      tools: tools.map(formatMcpTool),
    });
  });

  app.get("/executions/:id/mcp/calls", async (context) => {
    const execution = await getTaskExecutionDetail(prisma, context.req.param("id"));

    if (!execution) {
      return context.json({ error: "Execution was not found." }, 404);
    }

    const calls = await listMcpToolCallsForExecution(prisma, execution.id);
    const status = context.req.query("status");
    const limit = optionalNumber(context.req.query("limit")) ?? calls.length;

    return context.json({
      calls: calls
        .filter((call) => !status || call.status === status)
        .slice(0, limit)
        .map(formatMcpCall),
    });
  });

  app.post("/executions/:id/mcp/calls", async (context) => {
    const body = await context.req.json();
    const execution = await getTaskExecutionDetail(prisma, context.req.param("id"));

    if (!execution) {
      return context.json({ error: "Task execution was not found." }, 404);
    }

    const rawArgs = body.args ?? body.arguments ?? {};
    const call = await mcpService.createToolCall({
      projectId: execution.task.epic.project.id,
      taskExecutionId: execution.id,
      serverName: requireString(body.serverName, "serverName"),
      toolName: requireString(body.toolName, "toolName"),
      args: requireRecord(rawArgs, "args"),
    });

    return context.json({ call: formatMcpCall(call) }, 201);
  });

  app.post("/executions/:executionId/mcp/calls/:callId/approve", async (context) => {
    const execution = await getTaskExecutionDetail(prisma, context.req.param("executionId"));

    if (!execution) {
      return context.json({ error: "Execution was not found." }, 404);
    }

    const call = await getMcpToolCallDetail(prisma, context.req.param("callId"));

    if (!call) {
      return context.json({ error: "MCP tool call was not found." }, 404);
    }

    if (call.taskExecutionId !== execution.id) {
      return context.json(
        { error: "Tool call does not belong to this execution.", code: "CALL_NOT_IN_EXECUTION" },
        422,
      );
    }

    if (!(call.tool?.approvalRequired ?? false)) {
      return context.json({ error: "Tool call does not require approval.", code: "APPROVAL_NOT_REQUIRED" }, 422);
    }

    if (call.status !== "requested") {
      return context.json({ error: "Tool call is not in requested state.", code: "CALL_NOT_PENDING" }, 422);
    }

    const body = await context.req.json();
    const updated = await mcpService.approveToolCall(call.id, {
      operator: requireString(body.operator, "operator"),
      reason: optionalString(body.reason),
      projectId: execution.task.epic.project.id,
    });
    const callDto = formatMcpCall(updated);

    return context.json({
      id: callDto.id,
      status: callDto.status,
      call: callDto,
    });
  });

  app.post("/executions/:id/mcp/calls/:callId/execute", async (context) => {
    const execution = await getTaskExecutionDetail(prisma, context.req.param("id"));

    if (!execution) {
      return context.json({ error: "Execution was not found." }, 404);
    }

    const call = await getMcpToolCallDetail(prisma, context.req.param("callId"));

    if (!call) {
      return context.json({ error: "Tool call was not found." }, 404);
    }

    if (call.taskExecutionId !== execution.id) {
      return context.json(
        { error: "Tool call does not belong to this execution.", code: "CALL_NOT_IN_EXECUTION" },
        422,
      );
    }

    const result = await mcpService.executeToolCall(call.id);
    const payload = result.ok
      ? { call: formatMcpCall(result.call), result: result.result }
      : { call: formatMcpCall(result.call), error: result.error };

    return context.json(payload, result.status === "blocked" ? 422 : 200);
  });

  app.get("/executions/:id/test-runs", async (context) => {
    return context.json(await testRunnerService.listExecutionTestRuns(context.req.param("id")));
  });

  app.get("/executions/:id/visual-results", async (context) => {
    return context.json(
      await listVisualVerificationResults(prisma, {
        taskExecutionId: context.req.param("id"),
        status: context.req.query("status"),
      }),
    );
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
    const result = await executionService.rejectExecutionPatchReview(context.req.param("id"));
    // VIM-37 — operator notification: a patch rejection is operator-actionable,
    // so surface it on the LoopEventBus alongside the existing task.failed
    // event the execution service emits.
    await appendLoopEvent(prisma, {
      projectId: result.execution.task.epic.project.id,
      taskExecutionId: result.execution.id,
      type: "operator.notification",
      payload: {
        severity: "error",
        subjectType: "patch_review",
        subjectId: result.patchReview.id,
      },
    });
    return context.json(result);
  });

  // VIM-30: attempt-based retry with same-slot retry, escalation to
  // executor_strong on the second failure, and terminal task.failed on the
  // third. Idempotent within an attempt window — see
  // ExecutionService.retryExecution doc for the contract.
  app.post("/executions/:id/retry", async (context) => {
    try {
      const result = await executionService.retryExecution(context.req.param("id"));
      // VIM-37 — operator notification: surface escalation to a stronger
      // slot (info) and terminal attempt-budget exhaustion (error). A
      // same-slot retry is routine and does not raise a notification.
      const projectId = result.execution.task.epic.project.id;
      if (result.terminated) {
        await appendLoopEvent(prisma, {
          projectId,
          taskExecutionId: result.execution.id,
          type: "operator.notification",
          payload: {
            severity: "error",
            subjectType: "task_execution",
            subjectId: result.execution.id,
          },
        });
      } else if (result.decision.state === "escalated") {
        await appendLoopEvent(prisma, {
          projectId,
          taskExecutionId: result.execution.id,
          type: "operator.notification",
          payload: {
            severity: "info",
            subjectType: "task_execution",
            subjectId: result.execution.id,
          },
        });
      }
      return context.json(result);
    } catch (error) {
      if (error instanceof RetryExecutionError) {
        if (error.code === "EXECUTION_NOT_FOUND") {
          return context.json({ code: error.code, message: error.message }, 404);
        }
        if (error.code === "MODEL_SLOT_UNAVAILABLE") {
          return context.json({ code: error.code, message: error.message }, 422);
        }
      }
      throw error;
    }
  });

  app.get("/events", async (context) => {
    const projectId = requireProjectId(context.req.query("projectId"));
    const taskExecutionId = context.req.query("taskExecutionId");
    const streamMode = context.req.query("stream");

    if (streamMode === "sse") {
      // VIM-36 Sprint 2: SSE live stream backed by an in-process event bus.
      // `appendLoopEvent` publishes synchronously after the row commits, so
      // new events land here within the same tick (well under the 200ms
      // delivery acceptance budget). The 100ms poller from Sprint 1 is gone;
      // a future Postgres LISTEN/NOTIFY adapter can plug in behind the same
      // `loopEventBus.subscribe` contract.
      return streamSSE(context, async (sse) => {
        const seenEventIds = new Set<string>();
        type Pending =
          | { kind: "event"; event: import("@vimbuspromax3000/shared").LoopEvent }
          | { kind: "heartbeat" };
        const queue: Pending[] = [];
        let resolveWaiter: (() => void) | undefined;

        const wakeWaiter = () => {
          const resolve = resolveWaiter;
          resolveWaiter = undefined;
          resolve?.();
        };

        const enqueue = (item: Pending) => {
          queue.push(item);
          wakeWaiter();
        };

        const unsubscribe = loopEventBus.subscribe(
          { projectId, taskExecutionId },
          (event) => {
            if (seenEventIds.has(event.id)) return;
            seenEventIds.add(event.id);
            enqueue({ kind: "event", event });
          },
        );

        // Heartbeat is independent of event traffic so idle proxies stay
        // happy. A `setInterval` is fine because we tear it down on abort.
        const heartbeatTimer = setInterval(() => {
          enqueue({ kind: "heartbeat" });
        }, eventsHeartbeatMs);

        // Replay backlog so reconnecting clients don't lose context. The
        // event-system contract (docs/architecture/event-system.md) treats
        // the database as the recovery source after reconnect. We do this
        // AFTER subscribing so any concurrent insert is captured by the bus
        // and de-duped via `seenEventIds`.
        const backlog = await listLoopEvents(prisma, {
          projectId,
          taskExecutionId,
          limit: 200,
        });
        for (const event of backlog) {
          if (seenEventIds.has(event.id)) continue;
          seenEventIds.add(event.id);
          await sse.writeSSE({
            event: event.type,
            id: event.id,
            data: JSON.stringify(event),
          });
        }

        const aborted = () => sse.aborted || sse.closed;

        try {
          while (!aborted()) {
            if (queue.length === 0) {
              await new Promise<void>((resolve) => {
                resolveWaiter = resolve;
                // Race against abort so a closing client doesn't wedge here.
                const abortPoll = setInterval(() => {
                  if (aborted()) {
                    clearInterval(abortPoll);
                    wakeWaiter();
                  }
                }, 50);
                // Cleanup the abort poll once the waiter resolves normally.
                const originalResolve = resolveWaiter;
                resolveWaiter = () => {
                  clearInterval(abortPoll);
                  originalResolve?.();
                };
              });
            }

            while (queue.length > 0 && !aborted()) {
              const next = queue.shift()!;
              if (next.kind === "heartbeat") {
                // SSE comment frame: clients ignore it, but it keeps proxies
                // and load balancers from idling the connection out.
                await sse.write(": heartbeat\n\n");
              } else {
                await sse.writeSSE({
                  event: next.event.type,
                  id: next.event.id,
                  data: JSON.stringify(next.event),
                });
              }
            }
          }
        } finally {
          clearInterval(heartbeatTimer);
          unsubscribe();
        }
      });
    }

    // @deprecated since VIM-36 Sprint 1 — prefer GET /events/history for the
    // JSON list response. This bare /events JSON path is kept for backwards
    // compatibility with existing CLI callers and will be removed once they
    // migrate.
    return context.json(
      await listLoopEvents(prisma, {
        projectId,
        taskExecutionId,
        limit: optionalNumber(context.req.query("limit")),
      }),
    );
  });

  app.get("/events/history", async (context) => {
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

  app.get("/benchmarks/scenarios", async (context) => {
    return context.json(
      await listBenchmarkScenarios(prisma, {
        projectId: requireProjectId(context.req.query("projectId")),
        status: context.req.query("status"),
      }),
    );
  });

  app.post("/benchmarks/scenarios", async (context) => {
    const body = await context.req.json();
    const scenario = await createBenchmarkScenario(prisma, {
      projectId: requireString(body.projectId, "projectId"),
      name: requireString(body.name, "name"),
      goal: requireString(body.goal, "goal"),
      status: optionalString(body.status) ?? "active",
      fixturePath: optionalString(body.fixturePath) ?? null,
      expectedToolsJson: JSON.stringify(normalizeStringList(body.expectedTools)),
      forbiddenToolsJson: JSON.stringify(normalizeStringList(body.forbiddenTools)),
      thresholdsJson: JSON.stringify({
        ...requireRecord(body.thresholds ?? {}, "thresholds"),
        expectedVerificationItems: normalizeStringList(body.expectedVerificationItems),
        passThreshold: optionalNumberValue(body.passThreshold),
        aggregateWarnThreshold: optionalNumberValue(body.aggregateWarnThreshold),
        dimensions: isRecord(body.dimensions) ? body.dimensions : undefined,
      }),
    });

    return context.json(scenario, 201);
  });

  app.post("/benchmarks/scenarios/:id/run", async (context) => {
    const body = await optionalJsonBody(context.req);
    const scenarioRecord = await getBenchmarkScenario(prisma, context.req.param("id"));

    if (!scenarioRecord) {
      return context.json({ error: "Benchmark scenario was not found." }, 404);
    }

    const toolCalls =
      Array.isArray(body.toolCalls) && body.toolCalls.length > 0
        ? (body.toolCalls as BenchmarkToolCall[])
        : await loadBenchmarkToolCalls(prisma, {
            projectId: scenarioRecord.projectId,
            taskExecutionId: optionalString(body.taskExecutionId),
          });
    const run = scoreBenchmarkRun(toBenchmarkScenarioContract(scenarioRecord), {
      scenarioId: scenarioRecord.id,
      runId: optionalString(body.runId) ?? crypto.randomUUID(),
      toolCalls,
      verificationItems: normalizeBenchmarkVerificationItems(body.verificationItems),
      dimensionEvidence: requireRecord(body.dimensionEvidence ?? {}, "dimensionEvidence"),
      retryCount: optionalInteger(body.retryCount),
      modelCost: optionalNumberValue(body.modelCost),
      metadata: requireRecord(body.metadata ?? {}, "metadata"),
    });
    const evalRun = await persistBenchmarkEvalRun(prisma, scenarioRecord.projectId, run, {
      taskExecutionId: optionalString(body.taskExecutionId) ?? null,
    });

    await appendLoopEvent(prisma, {
      projectId: scenarioRecord.projectId,
      taskExecutionId: optionalString(body.taskExecutionId),
      type: "benchmark.finished",
      payload: {
        benchmarkScenarioId: scenarioRecord.id,
        evalRunId: evalRun.id,
        aggregateScore: run.aggregateScore,
        verdict: run.verdict,
      },
    });

    return context.json({ run, evalRun }, 201);
  });

  app.get("/regressions/baselines", async (context) => {
    return context.json(
      await listRegressionBaselines(prisma, {
        projectId: requireProjectId(context.req.query("projectId")),
        benchmarkScenarioId: context.req.query("benchmarkScenarioId"),
        status: context.req.query("status"),
      }),
    );
  });

  app.post("/regressions/baselines", async (context) => {
    const body = await context.req.json();
    const projectId = requireString(body.projectId, "projectId");
    const benchmarkScenarioId = requireString(body.benchmarkScenarioId, "benchmarkScenarioId");
    const evalRun = await getEvalRun(prisma, requireString(body.evalRunId, "evalRunId"));

    if (!evalRun) {
      return context.json({ error: "Eval run was not found." }, 404);
    }

    const baseline = await createRegressionBaseline(prisma, {
      projectId,
      benchmarkScenarioId,
      evalRunId: evalRun.id,
      status: optionalString(body.status) ?? "baseline",
      aggregateScore: evalRun.aggregateScore ?? 0,
      dimensionScoresJson: JSON.stringify(
        evalRun.results.map((result) => ({
          dimension: result.dimension,
          score: result.score,
          hardFail: result.threshold >= 85,
        })),
      ),
      toolSummaryJson: optionalJsonString(body.toolSummary),
      modelSummaryJson: optionalJsonString(body.modelSummary),
    });

    return context.json(baseline, 201);
  });

  app.post("/regressions/compare", async (context) => {
    const body = await context.req.json();
    const projectId = requireString(body.projectId, "projectId");
    const benchmarkScenarioId = requireString(body.benchmarkScenarioId, "benchmarkScenarioId");
    const baselineRecord = body.baselineId
      ? await prisma.regressionBaseline.findUnique({ where: { id: requireString(body.baselineId, "baselineId") } })
      : await getActiveRegressionBaseline(prisma, { projectId, benchmarkScenarioId });
    const candidateEvalRun = await getEvalRun(prisma, requireString(body.evalRunId, "evalRunId"));
    const scenarioRecord = await getBenchmarkScenario(prisma, benchmarkScenarioId);

    if (!baselineRecord) {
      return context.json({ error: "Regression baseline was not found." }, 404);
    }
    if (!candidateEvalRun) {
      return context.json({ error: "Candidate eval run was not found." }, 404);
    }
    if (!scenarioRecord) {
      return context.json({ error: "Benchmark scenario was not found." }, 404);
    }

    const comparison = compareRegressionBaseline(
      toRegressionBaselineContract(baselineRecord),
      toBenchmarkRunResultFromEvalRun(toBenchmarkScenarioContract(scenarioRecord), candidateEvalRun),
      {
        aggregateDropTolerance: optionalNumberValue(body.aggregateDropTolerance),
        modelCostIncreaseTolerance: optionalNumberValue(body.modelCostIncreaseTolerance),
        blockOnRetryIncrease: body.blockOnRetryIncrease === true,
      },
    );

    await appendLoopEvent(prisma, {
      projectId,
      type: comparison.status === "blocked" ? "regression.blocked" : "regression.compared",
      payload: comparison,
    });

    return context.json(comparison);
  });

  app.post("/langsmith/links", async (context) => {
    const body = await context.req.json();
    const link = await createLangSmithTraceLink(prisma, {
      projectId: requireString(body.projectId, "projectId"),
      subjectType: requireLangSmithSubjectType(body.subjectType),
      subjectId: requireString(body.subjectId, "subjectId"),
      traceUrl: optionalString(body.traceUrl) ?? null,
      datasetId: optionalString(body.datasetId) ?? null,
      experimentId: optionalString(body.experimentId) ?? null,
      runId: optionalString(body.runId) ?? null,
      syncStatus: optionalLangSmithSyncStatus(body.syncStatus) ?? "linked",
    });

    return context.json(link, 201);
  });

  app.get("/langsmith/links", async (context) => {
    return context.json(
      await listLangSmithTraceLinks(prisma, {
        projectId: requireProjectId(context.req.query("projectId")),
        subjectType: optionalLangSmithSubjectType(context.req.query("subjectType")),
        subjectId: context.req.query("subjectId"),
        syncStatus: optionalLangSmithSyncStatus(context.req.query("syncStatus")),
      }),
    );
  });

  app.patch("/langsmith/links/:id", async (context) => {
    const body = await context.req.json();

    return context.json(
      await updateLangSmithTraceLink(prisma, context.req.param("id"), {
        traceUrl: "traceUrl" in body ? optionalString(body.traceUrl) ?? null : undefined,
        datasetId: "datasetId" in body ? optionalString(body.datasetId) ?? null : undefined,
        experimentId: "experimentId" in body ? optionalString(body.experimentId) ?? null : undefined,
        runId: "runId" in body ? optionalString(body.runId) ?? null : undefined,
        syncStatus: optionalLangSmithSyncStatus(body.syncStatus),
      }),
    );
  });

  app.post("/executions/:id/evaluations", async (context) => {
    const execution = await getTaskExecutionDetail(prisma, context.req.param("id"));

    if (!execution) {
      return context.json({ error: "Execution was not found." }, 404);
    }

    try {
      const evalRun = await evaluatorService.runEvaluation(context.req.param("id"));
      // VIM-37 — operator notification: a `warn` verdict means the operator
      // should review before proceeding. `proceed` and `fail` are already
      // covered by the existing event tape (`evaluation.finished` +
      // `task.failed`), so we only surface the ambiguous middle band here.
      if (evalRun && evalRun.verdict === "warn") {
        await appendLoopEvent(prisma, {
          projectId: execution.task.epic.project.id,
          taskExecutionId: execution.id,
          type: "operator.notification",
          payload: {
            severity: "warn",
            subjectType: "eval_run",
            subjectId: evalRun.id,
          },
        });
      }
      return context.json({ evalRun });
    } catch (err) {
      if (err instanceof EvaluatorError && err.code === "MODEL_SLOT_UNAVAILABLE") {
        return context.json({ code: err.code, message: err.message }, 422);
      }
      throw err;
    }
  });

  app.get("/executions/:id/evaluations", async (context) => {
    const execution = await getTaskExecutionDetail(prisma, context.req.param("id"));

    if (!execution) {
      return context.json({ error: "Execution was not found." }, 404);
    }

    const evalRuns = await evaluatorService.listEvalRuns(context.req.param("id"));
    return context.json({ evalRuns });
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

function formatMcpServer(server: {
  id: string;
  name: string;
  transport: string;
  endpoint?: string | null;
  trustLevel: string;
  status: string;
  authType?: string | null;
  credentialRefId?: string | null;
  lastVerifiedAt?: Date | string | null;
  lastError?: string | null;
  tools?: unknown[];
}) {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    endpoint: server.endpoint ?? null,
    trustLevel: server.trustLevel,
    status: server.status,
    authType: server.authType ?? "none",
    credentialRefId: server.credentialRefId ?? null,
    lastVerifiedAt: server.lastVerifiedAt ?? null,
    lastError: server.lastError ?? null,
    toolCount: server.tools?.length ?? 0,
  };
}

function formatMcpTool(tool: {
  id?: string;
  name: string;
  description?: string | null;
  mutability: string;
  approvalRequired: boolean;
  inputSchemaJson?: string | null;
  status?: string | null;
  server: { name: string };
}) {
  return {
    id: tool.id,
    serverName: tool.server.name,
    name: tool.name,
    description: tool.description ?? null,
    mutability: tool.mutability,
    approvalRequired: tool.approvalRequired,
    inputSchema: parseJsonObject(tool.inputSchemaJson),
    status: tool.status ?? "active",
  };
}

function formatMcpCall(call: {
  id: string;
  taskExecutionId?: string | null;
  serverName: string;
  toolName: string;
  mutability: string;
  status: string;
  approvalId?: string | null;
  argumentsHash?: string | null;
  latencyMs?: number | null;
  resultSummary?: string | null;
  errorSummary?: string | null;
  createdAt: Date;
  finishedAt?: Date | null;
  tool?: { approvalRequired: boolean } | null;
}) {
  return {
    id: call.id,
    executionId: call.taskExecutionId ?? null,
    serverName: call.serverName,
    toolName: call.toolName,
    mutability: call.mutability,
    status: call.status,
    approvalId: call.approvalId ?? null,
    requiresApproval: call.tool?.approvalRequired ?? call.mutability !== "read",
    argumentsHash: call.argumentsHash ?? null,
    latencyMs: call.latencyMs ?? null,
    resultSummary: call.resultSummary ?? null,
    errorSummary: call.errorSummary ?? null,
    createdAt: call.createdAt,
    finishedAt: call.finishedAt ?? null,
  };
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

async function optionalJsonBody(request: { json(): Promise<unknown> }): Promise<Record<string, any>> {
  try {
    const body = await request.json();

    return isRecord(body) ? (body as Record<string, any>) : {};
  } catch {
    return {};
  }
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}

function optionalNumberValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected a numeric value, received ${String(value)}.`);
  }

  return parsed;
}

function optionalJsonString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return JSON.stringify(value);
}

function filterMcpDefinitions(
  definitions: readonly McpServerDefinition[],
  serverNames: readonly string[],
): McpServerDefinition[] {
  if (serverNames.length === 0) {
    return [...definitions];
  }

  const requested = new Set(serverNames);
  return definitions.filter((definition) => requested.has(definition.name));
}

async function persistMcpServerSetupPayload(prisma: PrismaClient, payload: McpServerSetupPayload) {
  const server = await upsertMcpServer(prisma, {
    projectId: payload.projectId,
    name: payload.name,
    transport: payload.transport,
    endpoint: payload.endpoint,
    trustLevel: payload.trustLevel,
    status: payload.status,
    authType: payload.authType,
    credentialEnv: payload.credentialEnv,
    credentialLabel: payload.credentialLabel,
    configJson: JSON.stringify(payload.config),
  });

  for (const tool of payload.tools) {
    await upsertMcpTool(prisma, {
      serverId: server.id,
      name: tool.name,
      description: tool.description,
      mutability: tool.mutability,
      approvalRequired: tool.approvalRequired,
      inputSchemaJson: JSON.stringify(tool.inputSchema),
      status: tool.status,
    });
  }

  return prisma.mcpServer.findUnique({
    where: { id: server.id },
    include: { tools: { orderBy: [{ name: "asc" }] }, credentialRef: true },
  });
}

async function persistMcpServerCredentialFromBody(
  prisma: PrismaClient,
  serverId: string,
  body: Record<string, any>,
) {
  const server = await prisma.mcpServer.findUnique({
    where: { id: serverId },
  });

  if (!server) {
    throw new Error("MCP server was not found.");
  }

  return setMcpServerCredential(prisma, server.id, {
    authType: requireMcpServerAuthType(body.authType ?? (body.clear === true ? "none" : "env_passthrough")),
    credentialRefId:
      body.clear === true ? null : optionalString(body.credentialRefId) ?? optionalString(body.secretRefId) ?? null,
    credentialEnv: body.clear === true ? null : optionalString(body.credentialEnv) ?? optionalString(body.secretEnv),
    credentialLabel: optionalString(body.credentialLabel) ?? optionalString(body.secretLabel),
    credentialStatus: optionalString(body.credentialStatus) ?? optionalString(body.status),
  });
}

function hasMcpCredentialBody(body: Record<string, any>) {
  return Boolean(
    body.credentialRefId ||
      body.secretRefId ||
      body.credentialEnv ||
      body.secretEnv ||
      body.clear === true,
  );
}

function normalizeMcpServerPayload(body: Record<string, any>): McpServerSetupPayload {
  const projectId = requireString(body.projectId, "projectId");
  const name = requireString(body.name, "name");
  const config = isRecord(body.config) ? body.config : {};

  return {
    projectId,
    name,
    label: optionalString(body.label) ?? name,
    transport: requireMcpServerTransport(body.transport ?? "stdio"),
    endpoint: optionalString(body.endpoint) ?? null,
    trustLevel: requireMcpServerTrustLevel(body.trustLevel ?? "trusted"),
    status: requireMcpServerStatus(body.status ?? "active"),
    authType: requireMcpServerAuthType(body.authType ?? "none"),
    config,
    tools: normalizeMcpServerTools(body.tools),
  };
}

function normalizeMcpServerTools(value: unknown): McpServerSetupPayload["tools"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((tool) => {
    if (!isRecord(tool)) {
      throw new Error("MCP server tools must be objects.");
    }

    return {
      name: requireString(tool.name, "tool.name"),
      description: optionalString(tool.description) ?? "",
      mutability: normalizeToolMutability(tool.mutability),
      approvalRequired: tool.approvalRequired === true,
      inputSchema: isRecord(tool.inputSchema) ? tool.inputSchema : {},
      status: tool.status === "disabled" ? "disabled" : "active",
    };
  });
}

function normalizeToolMutability(value: unknown): "read" | "write" | "execute" {
  if (value === "write" || value === "execute") {
    return value;
  }

  return "read";
}

function requireMcpServerTransport(value: unknown): McpServerTransport {
  const transport = requireString(value, "transport");

  if (!isMcpServerTransport(transport)) {
    throw new Error(`Unknown MCP server transport: ${transport}`);
  }

  return transport;
}

function requireMcpServerTrustLevel(value: unknown): McpServerTrustLevel {
  const trustLevel = requireString(value, "trustLevel");

  if (!isMcpServerTrustLevel(trustLevel)) {
    throw new Error(`Unknown MCP server trust level: ${trustLevel}`);
  }

  return trustLevel;
}

function requireMcpServerStatus(value: unknown): McpServerStatus {
  const status = requireString(value, "status");

  if (!isMcpServerStatus(status)) {
    throw new Error(`Unknown MCP server status: ${status}`);
  }

  return status;
}

function requireMcpServerAuthType(value: unknown): McpServerAuthType {
  const authType = requireString(value, "authType");

  if (!isMcpServerAuthType(authType)) {
    throw new Error(`Unknown MCP server auth type: ${authType}`);
  }

  return authType;
}

async function getMcpPrerequisiteFailure(prisma: PrismaClient, projectId: string) {
  const servers = await listMcpServers(prisma, projectId);
  const activeServers = servers.filter((server) => server.status === "active");
  const unhealthyServers = servers.filter((server) => !["active", "disabled"].includes(server.status));

  if (servers.length === 0) {
    return {
      code: "MCP_SETUP_REQUIRED",
      message: "MCP setup must be completed before task execution starts.",
    };
  }

  if (activeServers.length === 0) {
    return {
      code: "MCP_ACTIVE_SERVER_REQUIRED",
      message: "At least one MCP server must be active before task execution starts.",
      servers,
    };
  }

  if (unhealthyServers.length > 0) {
    return {
      code: "MCP_HEALTH_CHECK_FAILED",
      message: "MCP servers must be active or disabled before task execution starts.",
      servers: unhealthyServers,
    };
  }

  return null;
}

function toBenchmarkScenarioContract(record: {
  id: string;
  name: string;
  goal: string;
  expectedToolsJson: string | null;
  forbiddenToolsJson: string | null;
  thresholdsJson: string | null;
}): BenchmarkScenarioContract {
  const thresholds = parseJsonObject(record.thresholdsJson);

  return {
    id: record.id,
    name: record.name,
    goal: record.goal,
    expectedTools: parseJsonStringList(record.expectedToolsJson),
    forbiddenTools: parseJsonStringList(record.forbiddenToolsJson),
    expectedVerificationItems: normalizeStringList(thresholds.expectedVerificationItems),
    passThreshold: optionalNumberValue(thresholds.passThreshold),
    aggregateWarnThreshold: optionalNumberValue(thresholds.aggregateWarnThreshold),
    dimensions: isRecord(thresholds.dimensions) ? thresholds.dimensions : undefined,
  };
}

function normalizeBenchmarkVerificationItems(value: unknown): BenchmarkVerificationItemResult[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    if (!isRecord(item)) {
      throw new Error("Benchmark verification items must be objects.");
    }

    const status = String(item.status ?? "passed");
    if (!["passed", "failed", "skipped", "blocked"].includes(status)) {
      throw new Error(`Unknown benchmark verification status: ${status}`);
    }

    return {
      name: requireString(item.name, "verificationItems.name"),
      status: status as BenchmarkVerificationItemResult["status"],
      approvedSkip: item.approvedSkip === true,
    };
  });
}

async function loadBenchmarkToolCalls(
  prisma: PrismaClient,
  input: { projectId: string; taskExecutionId?: string },
): Promise<BenchmarkToolCall[]> {
  const calls = await listMcpToolCalls(prisma, {
    projectId: input.projectId,
    taskExecutionId: input.taskExecutionId,
    limit: 1000,
  });

  return calls.map((call) => ({
    name: call.toolName,
    server: call.serverName,
    status: call.status as BenchmarkToolCall["status"],
    approved: Boolean(call.approvalId) || call.status === "approved" || call.status === "succeeded",
    mutates: call.mutability !== "read",
    reason: call.errorSummary ?? undefined,
  }));
}

async function persistBenchmarkEvalRun(
  prisma: PrismaClient,
  projectId: string,
  run: BenchmarkRunResult,
  input: { taskExecutionId?: string | null },
) {
  const evalRun = await createEvalRun(prisma, {
    projectId,
    taskExecutionId: input.taskExecutionId ?? null,
    benchmarkScenarioId: run.scenarioId,
    status: run.verdict === "blocked" ? "failed" : run.verdict,
    aggregateScore: Math.round(run.aggregateScore),
    threshold: 75,
    verdict: run.verdict,
    inputHash: run.runId,
    startedAt: new Date(),
    finishedAt: new Date(),
  });

  for (const score of run.dimensionScores) {
    await createEvalResult(prisma, {
      evalRunId: evalRun.id,
      dimension: score.dimension,
      score: Math.round(score.score),
      threshold: score.passThreshold,
      verdict: score.passed ? "passed" : "failed",
      evaluatorType: "rule",
      reasoning: `Rule-based benchmark score for ${score.dimension}.`,
      evidenceJson: JSON.stringify({
        hardFail: score.hardFail,
        weight: score.weight,
        toolSequenceSummary: run.toolSequenceSummary,
        verificationSummary: run.verificationSummary,
        unsafeMcpAttempts: run.unsafeMcpAttempts,
      }),
    });
  }

  const stored = await getEvalRun(prisma, evalRun.id);

  if (!stored) {
    throw new Error(`Eval run ${evalRun.id} was not found after benchmark persistence.`);
  }

  return stored;
}

function toRegressionBaselineContract(record: {
  benchmarkScenarioId: string;
  evalRunId: string;
  aggregateScore: number;
  dimensionScoresJson: string;
  toolSummaryJson: string | null;
  modelSummaryJson: string | null;
}): RegressionBaselineContract {
  const toolSummary = parseJsonObject(record.toolSummaryJson);
  const modelSummary = parseJsonObject(record.modelSummaryJson);

  return {
    scenarioId: record.benchmarkScenarioId,
    runId: record.evalRunId,
    aggregateScore: record.aggregateScore,
    dimensionScores: parseJsonArray(record.dimensionScoresJson) as RegressionBaselineContract["dimensionScores"],
    toolSequenceSummary: normalizeStringList(toolSummary.toolSequenceSummary),
    verificationSummary: isRecord(toolSummary.verificationSummary)
      ? (toolSummary.verificationSummary as RegressionBaselineContract["verificationSummary"])
      : undefined,
    unsafeMcpAttempts: Array.isArray(toolSummary.unsafeMcpAttempts)
      ? (toolSummary.unsafeMcpAttempts as RegressionBaselineContract["unsafeMcpAttempts"])
      : undefined,
    retryCount: optionalInteger(modelSummary.retryCount),
    modelCost: optionalNumberValue(modelSummary.modelCost),
  };
}

function toBenchmarkRunResultFromEvalRun(
  scenario: BenchmarkScenarioContract,
  evalRun: NonNullable<Awaited<ReturnType<typeof getEvalRun>>>,
): BenchmarkRunResult {
  const dimensionScores = evalRun.results.map((result) => ({
    dimension: result.dimension as BenchmarkRunResult["dimensionScores"][number]["dimension"],
    score: result.score,
    passThreshold: result.threshold,
    hardFail: result.threshold >= 85,
    passed: result.score >= result.threshold,
    weight: 1,
  }));
  const allRequiredPassed = (evalRun.verdict ?? "failed") === "passed";

  return {
    scenarioId: scenario.id,
    runId: evalRun.id,
    aggregateScore: evalRun.aggregateScore ?? 0,
    verdict: (evalRun.verdict as BenchmarkRunResult["verdict"] | null) ?? "failed",
    dimensionScores,
    toolSequenceSummary: [],
    verificationSummary: {
      total: 0,
      passed: allRequiredPassed ? 1 : 0,
      failed: allRequiredPassed ? 0 : 1,
      skipped: 0,
      blocked: 0,
      missingExpectedItems: [],
      allRequiredPassed,
    },
    unsafeMcpAttempts: [],
    retryCount: 0,
    modelCost: 0,
    metadata: {},
  };
}

function parseJsonStringList(value: string | null): string[] {
  return normalizeStringList(parseJsonValue(value));
}

function parseJsonObject(value: string | null | undefined): Record<string, any> {
  const parsed = parseJsonValue(value);

  return isRecord(parsed) ? (parsed as Record<string, any>) : {};
}

function parseJsonArray(value: string | null | undefined): unknown[] {
  const parsed = parseJsonValue(value);

  return Array.isArray(parsed) ? parsed : [];
}

function parseJsonValue(value: string | null | undefined): unknown {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function requireLangSmithSubjectType(value: unknown): LangSmithSubjectType {
  const subjectType = requireString(value, "subjectType");

  if (!isLangSmithSubjectType(subjectType)) {
    throw new Error(`Unknown LangSmith subject type: ${subjectType}`);
  }

  return subjectType;
}

function optionalLangSmithSubjectType(value: string | undefined): LangSmithSubjectType | undefined {
  if (!value) {
    return undefined;
  }

  return requireLangSmithSubjectType(value);
}

function optionalLangSmithSyncStatus(value: unknown): LangSmithSyncStatus | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const syncStatus = requireString(value, "syncStatus");

  if (!isLangSmithSyncStatus(syncStatus)) {
    throw new Error(`Unknown LangSmith sync status: ${syncStatus}`);
  }

  return syncStatus;
}

const app = createApp();

export default app;
