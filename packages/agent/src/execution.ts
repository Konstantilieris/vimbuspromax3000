import { spawnSync } from "node:child_process";
import type { PrismaClient } from "@vimbuspromax3000/db/client";
import {
  abandonTaskBranch as abandonTaskBranchRecord,
  appendLoopEvent,
  createAgentStep,
  createModelDecision,
  createTaskExecution,
  createTaskBranch,
  getEvalRunDetail,
  getLatestPatchReview,
  getTaskBranch,
  getTaskBranchDetail,
  getTaskExecutionContext,
  getTaskExecutionDetail,
  listEvalRunsForExecution,
  listLangSmithTraceLinks,
  setTaskStatus,
  updatePatchReview,
  updateTaskBranch,
  updateTaskExecution,
} from "@vimbuspromax3000/db";
import { createMcpService } from "@vimbuspromax3000/mcp-client";
import { nextExecutorSlot, resolveModelSlot } from "@vimbuspromax3000/policy-engine";
import type { ModelSlotKey } from "@vimbuspromax3000/shared";
import {
  runPostExecutionPipeline,
  type BenchmarkRunSummary,
  type EvalDecision,
  type EvalRunSummary,
  type PostExecutionPipelineDeps,
  type PostExecutionPipelineResult,
} from "./post-execution-pipeline";

export type EvaluationDimensionSummary = {
  dimension: string;
  score: number;
  threshold: number;
  verdict: string;
  reasoning: string;
};

export type LatestEvaluationSummary = {
  evalRunId: string;
  status: string;
  decision: EvalDecision | null;
  aggregateScore: number | null;
  threshold: number | null;
  finishedAt: Date | null;
  hardFailDimensions: string[];
  dimensions: EvaluationDimensionSummary[];
  benchmarkSummaries: Array<{
    scenarioId: string | null;
    scenarioName: string | null;
    verdict: string | null;
    aggregateScore: number | null;
  }>;
  langSmithTraceUrl: string | null;
};

export type PipelineStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export type ExecutionPatchReviewResult = {
  patchReview: NonNullable<Awaited<ReturnType<typeof getLatestPatchReview>>>;
  execution: NonNullable<Awaited<ReturnType<typeof getTaskExecutionDetail>>>;
  latestEvaluation: LatestEvaluationSummary | null;
  pipelineStatus: PipelineStatus;
};

export type ExecutionPipelineRunner = (input: { executionId: string }) => Promise<PostExecutionPipelineResult | null>;

export type ExecutionService = {
  getTaskBranch(taskId: string): Promise<Awaited<ReturnType<typeof getTaskBranchDetail>>>;
  prepareTaskBranch(input: { taskId: string }): Promise<Awaited<ReturnType<typeof getTaskBranchDetail>>>;
  abandonTaskBranch(input: { taskId: string }): Promise<Awaited<ReturnType<typeof getTaskBranchDetail>>>;
  startTaskExecution(input: { taskId: string }): Promise<Awaited<ReturnType<typeof getTaskExecutionDetail>>>;
  getExecutionPatchReview(executionId: string): Promise<ExecutionPatchReviewResult | null>;
  approveExecutionPatchReview(executionId: string): Promise<ExecutionPatchReviewResult>;
  rejectExecutionPatchReview(executionId: string): Promise<ExecutionPatchReviewResult>;
  runPostExecutionPipeline: ExecutionPipelineRunner;
};

export type ExecutionServiceOptions = {
  prisma: PrismaClient;
  env?: Record<string, string | undefined>;
  evaluator?: {
    runEvaluation: (executionId: string) => Promise<unknown>;
  };
  benchmarkRunner?: PostExecutionPipelineDeps["runBenchmarkScenario"];
  langSmithExporter?: PostExecutionPipelineDeps["exportLangSmith"];
  restartVerification?: (input: { executionId: string }) => Promise<unknown>;
  pipelineConfig?: {
    maxRetries?: number;
    maxEscalations?: number;
  };
};

export function createExecutionService(options: ExecutionServiceOptions): ExecutionService {
  const prisma = options.prisma;
  const env = options.env ?? process.env;
  const mcpService = createMcpService({ prisma });
  const envMaxRetries = parsePositiveInt(env.VIMBUS_MAX_AUTO_RETRY_ATTEMPTS);
  const envMaxEscalations = parsePositiveInt(env.VIMBUS_MAX_AUTO_ESCALATION_ATTEMPTS);

  type AttemptInput = {
    executionId: string;
    taskId: string;
    projectId: string;
    complexity: string;
    branchId: string;
    rootPath: string;
    slotKey: ModelSlotKey;
    attempt: number;
    reason: string;
    startedAt: Date;
    emitTaskSelected: { branchName: string } | null;
    markBranchActive: boolean;
  };

  async function startExecutorAttempt(input: AttemptInput): Promise<void> {
    const resolution = await resolveModelSlot(
      prisma,
      {
        projectId: input.projectId,
        slotKey: input.slotKey,
        taskExecutionId: input.executionId,
      },
      env,
    );

    if (!resolution.ok) {
      await prisma.$transaction(async (tx) => {
        await updateTaskExecution(tx, input.executionId, {
          status: "failed",
          finishedAt: new Date(),
        });
        await setTaskStatus(tx, input.taskId, "failed");
        await appendLoopEvent(tx, {
          projectId: input.projectId,
          taskExecutionId: input.executionId,
          type: "task.failed",
          payload: {
            taskId: input.taskId,
            code: resolution.code,
            message: resolution.message,
          },
        });
      });

      throw new Error(`Execution model resolution failed: ${resolution.message}`);
    }

    const policyJson = JSON.stringify({
      modelResolution: resolution.value,
    });

    await prisma.$transaction(async (tx) => {
      await updateTaskExecution(tx, input.executionId, {
        status: "implementing",
        policyJson,
        startedAt: input.startedAt,
      });
      if (input.markBranchActive) {
        await updateTaskBranch(tx, input.branchId, {
          state: "active",
          currentHead: getHeadCommit(input.rootPath),
        });
      }
      await setTaskStatus(tx, input.taskId, "executing");
      await createModelDecision(tx, {
        projectId: input.projectId,
        taskExecutionId: input.executionId,
        attempt: input.attempt,
        complexityLabel: input.complexity,
        selectedSlot: input.slotKey,
        selectedModel: resolution.value.concreteModelName,
        reason: input.reason,
        state: "selected",
      });
      const agentStep = await createAgentStep(tx, {
        taskExecutionId: input.executionId,
        role: "executor",
        modelName: resolution.value.concreteModelName,
        status: "started",
        startedAt: input.startedAt,
        summary:
          input.attempt === 1
            ? "Minimal execution backend started."
            : `Executor attempt ${input.attempt} (${input.slotKey}).`,
      });

      if (input.emitTaskSelected) {
        await appendLoopEvent(tx, {
          projectId: input.projectId,
          taskExecutionId: input.executionId,
          type: "task.selected",
          payload: {
            taskId: input.taskId,
            branchName: input.emitTaskSelected.branchName,
          },
        });
      }

      await appendLoopEvent(tx, {
        projectId: input.projectId,
        taskExecutionId: input.executionId,
        type: "model.selected",
        payload: {
          taskId: input.taskId,
          slotKey: input.slotKey,
          selectedModel: resolution.value.concreteModelName,
          attempt: input.attempt,
        },
      });
      await appendLoopEvent(tx, {
        projectId: input.projectId,
        taskExecutionId: input.executionId,
        type: "agent.step.started",
        payload: {
          taskId: input.taskId,
          agentStepId: agentStep.id,
          role: "executor",
          modelName: resolution.value.concreteModelName,
        },
      });
    });
  }

  return {
    async getTaskBranch(taskId) {
      return getTaskBranchDetail(prisma, taskId);
    },

    async prepareTaskBranch(input) {
      const context = await requireReadyTaskContext(prisma, input.taskId);
      const project = context.epic.project;
      const derivedBranchName = deriveBranchName(project.branchNaming, {
        moduleName: context.epic.plannerRun?.moduleName ?? null,
        taskId: context.stableId,
        title: context.title,
      });

      assertGitRepository(project.rootPath);
      assertCleanWorktree(project.rootPath);
      assertLocalBranchExists(project.rootPath, project.baseBranch);
      assertValidBranchName(project.rootPath, derivedBranchName);

      const persistedBranch = await getTaskBranch(prisma, context.id);

      if (persistedBranch && persistedBranch.name !== derivedBranchName) {
        throw new Error(
          `Task ${context.id} already has persisted branch ${persistedBranch.name}, expected ${derivedBranchName}.`,
        );
      }

      const gitBranchExists = hasLocalBranch(project.rootPath, derivedBranchName);

      if (persistedBranch || gitBranchExists) {
        switchToBranch(project.rootPath, derivedBranchName);

        const currentHead = getHeadCommit(project.rootPath);
        ensureNotOnBaseBranch(project.rootPath, project.baseBranch);

        await prisma.$transaction(async (tx) => {
          if (persistedBranch) {
            await updateTaskBranch(tx, persistedBranch.id, {
              state: "created",
              currentHead,
              base: project.baseBranch,
            });
          } else {
            await createTaskBranch(tx, {
              taskId: context.id,
              name: derivedBranchName,
              base: project.baseBranch,
              state: "created",
              currentHead,
            });
          }

          await appendLoopEvent(tx, {
            projectId: project.id,
            type: "branch.switched",
            payload: {
              taskId: context.id,
              branchName: derivedBranchName,
              baseBranch: project.baseBranch,
            },
          });
        });

        return getTaskBranchDetail(prisma, context.id);
      }

      switchToBranch(project.rootPath, project.baseBranch);
      createAndSwitchToBranch(project.rootPath, derivedBranchName, project.baseBranch);

      const currentHead = getHeadCommit(project.rootPath);
      ensureNotOnBaseBranch(project.rootPath, project.baseBranch);

      await prisma.$transaction(async (tx) => {
        await createTaskBranch(tx, {
          taskId: context.id,
          name: derivedBranchName,
          base: project.baseBranch,
          state: "created",
          currentHead,
        });

        await appendLoopEvent(tx, {
          projectId: project.id,
          type: "branch.created",
          payload: {
            taskId: context.id,
            branchName: derivedBranchName,
            baseBranch: project.baseBranch,
          },
        });
        await appendLoopEvent(tx, {
          projectId: project.id,
          type: "branch.switched",
          payload: {
            taskId: context.id,
            branchName: derivedBranchName,
            baseBranch: project.baseBranch,
          },
        });
      });

      return getTaskBranchDetail(prisma, context.id);
    },

    async abandonTaskBranch(input) {
      const branch = await getTaskBranchDetail(prisma, input.taskId);

      if (!branch) {
        return null;
      }

      const project = branch.task.epic.project;
      assertGitRepository(project.rootPath);
      assertLocalBranchExists(project.rootPath, project.baseBranch);
      assertCleanWorktree(project.rootPath);

      if (getCurrentBranch(project.rootPath) === branch.name) {
        switchToBranch(project.rootPath, project.baseBranch);
      }

      await prisma.$transaction(async (tx) => {
        await abandonTaskBranchRecord(tx, input.taskId);
      });

      return getTaskBranchDetail(prisma, input.taskId);
    },

    async startTaskExecution(input) {
      const preparedBranch = await this.prepareTaskBranch({ taskId: input.taskId });

      if (!preparedBranch) {
        throw new Error(`Task ${input.taskId} branch could not be prepared.`);
      }

      const context = await requireReadyTaskContext(prisma, input.taskId);
      await mcpService.ensureProjectMcpSetup(context.epic.projectId);
      const project = context.epic.project;
      const branch = preparedBranch;
      const startedAt = new Date();
      const execution = await createTaskExecution(prisma, {
        taskId: context.id,
        branchId: branch.id,
        status: "queued",
        startedAt,
      });

      await startExecutorAttempt({
        executionId: execution.id,
        taskId: context.id,
        projectId: project.id,
        complexity: context.complexity,
        branchId: branch.id,
        rootPath: project.rootPath,
        slotKey: "executor_default",
        attempt: 1,
        reason: "Execution started for approved task.",
        startedAt,
        emitTaskSelected: { branchName: branch.name },
        markBranchActive: true,
      });

      const detail = await getTaskExecutionDetail(prisma, execution.id);

      if (!detail) {
        throw new Error(`Task execution ${execution.id} was not found after creation.`);
      }

      return detail;
    },

    async runPostExecutionPipeline({ executionId }) {
      if (!options.evaluator) {
        return null;
      }

      const execution = await getTaskExecutionDetail(prisma, executionId);

      if (!execution) {
        return null;
      }

      const projectId = execution.task.epic.project.id;
      const currentSlotKey: ModelSlotKey =
        execution.escalationLevel === 0 ? "executor_default" : "executor_strong";
      const next = nextExecutorSlot(currentSlotKey);
      const attempt = (execution.retryCount ?? 0) + (execution.escalationLevel ?? 0) + 1;

      const deps: PostExecutionPipelineDeps = {
        prisma,
        runEvaluation: async (id) => extractEvalSummary(await options.evaluator!.runEvaluation(id)),
        retryExecutor: async ({ slotKey, attempt: nextAttempt, reason }) => {
          await applyRetryStateUpdate(prisma, {
            executionId,
            taskId: execution.task.id,
            reason,
          });

          await startExecutorAttempt({
            executionId,
            taskId: execution.task.id,
            projectId,
            complexity: execution.task.complexity,
            branchId: execution.branch.id,
            rootPath: execution.task.epic.project.rootPath,
            slotKey,
            attempt: nextAttempt,
            reason:
              reason === "retry"
                ? "Auto-retry triggered by evaluator verdict."
                : "Auto-escalation triggered by evaluator verdict.",
            startedAt: new Date(),
            emitTaskSelected: null,
            markBranchActive: false,
          });

          if (options.restartVerification) {
            await options.restartVerification({ executionId });
          }
        },
        runBenchmarkScenario: options.benchmarkRunner,
        exportLangSmith: options.langSmithExporter,
      };

      return runPostExecutionPipeline(deps, {
        executionId,
        projectId,
        retryCount: execution.retryCount ?? 0,
        escalationLevel: execution.escalationLevel ?? 0,
        attempt,
        currentSlotKey,
        nextSlotKey: next,
        config: resolvePipelineConfig(prisma, execution, options.pipelineConfig, {
          envMaxRetries,
          envMaxEscalations,
        }),
      });
    },

    async getExecutionPatchReview(executionId) {
      const execution = await getTaskExecutionDetail(prisma, executionId);

      if (!execution) {
        return null;
      }

      const patchReview = await getLatestPatchReview(prisma, executionId);

      if (!patchReview) {
        return null;
      }

      const latestEvaluation = await loadLatestEvaluation(prisma, execution);
      const pipelineStatus = await derivePipelineStatus(prisma, executionId);

      return {
        patchReview,
        execution,
        latestEvaluation,
        pipelineStatus,
      };
    },

    async approveExecutionPatchReview(executionId) {
      const execution = await getRequiredExecutionWithPatch(prisma, executionId);
      const now = new Date();

      await prisma.$transaction(async (tx) => {
        await updatePatchReview(tx, execution.patchReview.id, {
          status: "approved",
          approvedAt: now,
        });
        await updateTaskBranch(tx, execution.execution.branch.id, {
          state: "approved",
          currentHead: getHeadCommit(execution.execution.task.epic.project.rootPath),
        });
        await updateTaskExecution(tx, execution.execution.id, {
          status: "completed",
          finishedAt: now,
        });
        await setTaskStatus(tx, execution.execution.task.id, "completed");
        await appendLoopEvent(tx, {
          projectId: execution.execution.task.epic.project.id,
          taskExecutionId: execution.execution.id,
          type: "patch.approved",
          payload: {
            taskId: execution.execution.task.id,
            patchReviewId: execution.patchReview.id,
          },
        });
        await appendLoopEvent(tx, {
          projectId: execution.execution.task.epic.project.id,
          taskExecutionId: execution.execution.id,
          type: "task.completed",
          payload: {
            taskId: execution.execution.task.id,
            patchReviewId: execution.patchReview.id,
          },
        });
      });

      const updatedExecution = await getTaskExecutionDetail(prisma, executionId);
      const updatedPatchReview = await getLatestPatchReview(prisma, executionId);

      if (!updatedExecution || !updatedPatchReview) {
        throw new Error(`Patch review ${execution.patchReview.id} was not found after approval.`);
      }

      const latestEvaluation = await loadLatestEvaluation(prisma, updatedExecution);
      const pipelineStatus = await derivePipelineStatus(prisma, executionId);

      return {
        patchReview: updatedPatchReview,
        execution: updatedExecution,
        latestEvaluation,
        pipelineStatus,
      };
    },

    async rejectExecutionPatchReview(executionId) {
      const execution = await getRequiredExecutionWithPatch(prisma, executionId);
      const now = new Date();

      await prisma.$transaction(async (tx) => {
        await updatePatchReview(tx, execution.patchReview.id, {
          status: "rejected",
        });
        await updateTaskExecution(tx, execution.execution.id, {
          status: "failed",
          finishedAt: now,
        });
        await setTaskStatus(tx, execution.execution.task.id, "failed");
        await appendLoopEvent(tx, {
          projectId: execution.execution.task.epic.project.id,
          taskExecutionId: execution.execution.id,
          type: "task.failed",
          payload: {
            taskId: execution.execution.task.id,
            patchReviewId: execution.patchReview.id,
            reason: "Patch review rejected.",
          },
        });
      });

      const updatedExecution = await getTaskExecutionDetail(prisma, executionId);
      const updatedPatchReview = await getLatestPatchReview(prisma, executionId);

      if (!updatedExecution || !updatedPatchReview) {
        throw new Error(`Patch review ${execution.patchReview.id} was not found after rejection.`);
      }

      const latestEvaluation = await loadLatestEvaluation(prisma, updatedExecution);
      const pipelineStatus = await derivePipelineStatus(prisma, executionId);

      return {
        patchReview: updatedPatchReview,
        execution: updatedExecution,
        latestEvaluation,
        pipelineStatus,
      };
    },
  };
}

type EvalRunDetailResult = NonNullable<Awaited<ReturnType<typeof getEvalRunDetail>>>;
type TaskExecutionDetail = NonNullable<Awaited<ReturnType<typeof getTaskExecutionDetail>>>;

function extractEvalSummary(value: unknown): EvalRunSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as EvalRunDetailResult;

  if (typeof candidate.id !== "string") {
    return null;
  }

  const decision = (candidate.verdict ?? null) as EvalDecision | null;
  const aggregateScore = candidate.aggregateScore ?? 0;
  const threshold = candidate.threshold ?? null;
  const results = candidate.results ?? [];
  const hardFailDimensions = results
    .filter((result) => result.verdict === "fail" && isHardFailDimension(result.dimension))
    .map((result) => result.dimension);

  return {
    id: candidate.id,
    decision: (decision ?? "fail") as EvalDecision,
    aggregateScore,
    threshold,
    hardFailDimensions,
  };
}

function isHardFailDimension(dimension: string): boolean {
  return ["outcome_correctness", "security_policy_compliance", "verification_quality"].includes(dimension);
}

async function applyRetryStateUpdate(
  prisma: PrismaClient,
  input: {
    executionId: string;
    taskId: string;
    reason: "retry" | "escalate";
  },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const current = await tx.taskExecution.findUnique({ where: { id: input.executionId } });

    if (!current) {
      throw new Error(`Task execution ${input.executionId} was not found while preparing retry state.`);
    }

    const retryCount = (current.retryCount ?? 0) + (input.reason === "retry" ? 1 : 0);
    const escalationLevel = (current.escalationLevel ?? 0) + (input.reason === "escalate" ? 1 : 0);

    await updateTaskExecution(tx, input.executionId, {
      status: "implementing",
      retryCount,
      escalationLevel,
      finishedAt: null,
    });

    await setTaskStatus(tx, input.taskId, "executing");

    const latestPlan = await tx.verificationPlan.findFirst({
      where: { taskId: input.taskId, status: "approved" },
      orderBy: [{ createdAt: "desc" }],
    });

    if (latestPlan) {
      await tx.verificationItem.updateMany({
        where: { planId: latestPlan.id },
        data: { status: "approved" },
      });
    }
  });
}

function resolvePipelineConfig(
  _prisma: PrismaClient,
  execution: TaskExecutionDetail,
  optionConfig: ExecutionServiceOptions["pipelineConfig"],
  envFloors: { envMaxRetries: number | null; envMaxEscalations: number | null },
): { maxRetries: number; maxEscalations: number } {
  const projectConfig = parseAutoRetryConfig(execution.task.epic.project.autoRetryConfigJson);
  const maxRetries =
    projectConfig?.maxRetries ?? optionConfig?.maxRetries ?? envFloors.envMaxRetries ?? 1;
  const maxEscalations =
    projectConfig?.maxEscalations ?? optionConfig?.maxEscalations ?? envFloors.envMaxEscalations ?? 1;

  return { maxRetries, maxEscalations };
}

function parseAutoRetryConfig(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const cast = parsed as Record<string, unknown>;
      const maxRetries = typeof cast.maxRetries === "number" ? cast.maxRetries : undefined;
      const maxEscalations = typeof cast.maxEscalations === "number" ? cast.maxEscalations : undefined;

      return { maxRetries, maxEscalations };
    }
  } catch {
    return null;
  }

  return null;
}

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

async function loadLatestEvaluation(
  prisma: PrismaClient,
  execution: TaskExecutionDetail,
): Promise<LatestEvaluationSummary | null> {
  let evalRun: EvalRunDetailResult | null = null;

  if (execution.lastEvalRunId) {
    evalRun = await getEvalRunDetail(prisma, execution.lastEvalRunId);
  }

  if (!evalRun) {
    const runs = await listEvalRunsForExecution(prisma, execution.id);
    evalRun = runs.find((run) => run.benchmarkScenarioId === null) ?? null;
  }

  if (!evalRun) {
    return null;
  }

  const benchmarkRuns = await prisma.evalRun.findMany({
    where: {
      taskExecutionId: execution.id,
      benchmarkScenarioId: { not: null },
    },
    orderBy: [{ createdAt: "desc" }],
  });

  const scenarioIds = benchmarkRuns
    .map((run) => run.benchmarkScenarioId)
    .filter((id): id is string => Boolean(id));

  const scenarios = scenarioIds.length
    ? await prisma.benchmarkScenario.findMany({ where: { id: { in: scenarioIds } } })
    : [];

  const scenarioById = new Map(scenarios.map((scenario) => [scenario.id, scenario.name]));

  const langSmithLinks = await listLangSmithTraceLinks(prisma, {
    projectId: execution.task.epic.project.id,
    subjectType: "task_execution",
    subjectId: execution.id,
  });

  const exportedLink =
    langSmithLinks.find((link) => link.syncStatus === "exported") ??
    langSmithLinks.find((link) => link.traceUrl !== null) ??
    null;

  return {
    evalRunId: evalRun.id,
    status: evalRun.status,
    decision: (evalRun.verdict ?? null) as EvalDecision | null,
    aggregateScore: evalRun.aggregateScore ?? null,
    threshold: evalRun.threshold ?? null,
    finishedAt: evalRun.finishedAt ?? null,
    hardFailDimensions: (evalRun.results ?? [])
      .filter((result) => result.verdict === "fail" && isHardFailDimension(result.dimension))
      .map((result) => result.dimension),
    dimensions: (evalRun.results ?? []).map((result) => ({
      dimension: result.dimension,
      score: result.score,
      threshold: result.threshold,
      verdict: result.verdict,
      reasoning: result.reasoning,
    })),
    benchmarkSummaries: benchmarkRuns.map((run) => ({
      scenarioId: run.benchmarkScenarioId,
      scenarioName: run.benchmarkScenarioId ? scenarioById.get(run.benchmarkScenarioId) ?? null : null,
      verdict: run.verdict,
      aggregateScore: run.aggregateScore,
    })),
    langSmithTraceUrl: exportedLink?.traceUrl ?? null,
  };
}

async function derivePipelineStatus(prisma: PrismaClient, executionId: string): Promise<PipelineStatus> {
  const rows = await prisma.loopEvent.findMany({
    where: { taskExecutionId: executionId },
    orderBy: [{ createdAt: "asc" }],
  });
  let status: PipelineStatus = "pending";

  for (const event of rows) {
    if (event.type === "patch.ready") {
      status = "running";
    } else if (event.type === "execution.evaluated") {
      status = "completed";
    } else if (event.type === "evaluation.failed" || event.type === "execution.retry.failed") {
      status = "failed";
    } else if (event.type === "execution.retry.scheduled" || event.type === "execution.escalation.scheduled") {
      status = "running";
    }
  }

  return status;
}

async function requireReadyTaskContext(prisma: PrismaClient, taskId: string) {
  const context = await getTaskExecutionContext(prisma, taskId);

  if (!context) {
    throw new Error(`Task ${taskId} was not found.`);
  }

  if (context.status !== "ready") {
    throw new Error(`Task ${taskId} must be ready before branch preparation or execution.`);
  }

  if (!context.latestVerificationPlan || context.latestVerificationPlan.status !== "approved") {
    throw new Error(`Task ${taskId} must have an approved verification plan before execution.`);
  }

  return context;
}

async function getRequiredExecutionWithPatch(prisma: PrismaClient, executionId: string) {
  const execution = await getTaskExecutionDetail(prisma, executionId);

  if (!execution) {
    throw new Error(`Task execution ${executionId} was not found.`);
  }

  const patchReview = await getLatestPatchReview(prisma, executionId);

  if (!patchReview) {
    throw new Error(`Task execution ${executionId} has no patch review.`);
  }

  return {
    execution,
    patchReview,
  };
}

function deriveBranchName(
  template: string,
  input: {
    moduleName?: string | null;
    taskId: string;
    title: string;
  },
) {
  const values = {
    module: sanitizeBranchValue(input.moduleName ?? "", true),
    "task-id": sanitizeBranchValue(input.taskId, false),
    slug: sanitizeBranchValue(input.title, true),
  } as const;
  const segments = template
    .split("/")
    .map((segment) => replaceBranchTokens(segment, values))
    .filter(Boolean);
  const branchName = segments.join("/");

  if (!branchName) {
    throw new Error(`Branch naming template ${template} resolved to an empty branch name.`);
  }

  return branchName;
}

function replaceBranchTokens(
  segment: string,
  values: {
    module: string;
    "task-id": string;
    slug: string;
  },
) {
  const normalized = segment
    .replaceAll("<module>", values.module)
    .replaceAll("<task-id>", values["task-id"])
    .replaceAll("<slug>", values.slug);

  if (/<[^>]+>/.test(normalized)) {
    throw new Error(`Unsupported branch naming token in segment: ${segment}`);
  }

  return normalized.replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "").trim();
}

function sanitizeBranchValue(value: string, lowercase: boolean) {
  const normalized = (lowercase ? value.toLowerCase() : value)
    .trim()
    .replace(/[^a-zA-Z0-9._/-]+/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/-{2,}/g, "-")
    .replace(/^[-/]+|[-/]+$/g, "");

  return normalized;
}

function assertGitRepository(rootPath: string) {
  const result = runGit(rootPath, ["rev-parse", "--is-inside-work-tree"], true);

  if (result.status !== 0 || result.stdout.trim() !== "true") {
    throw new Error(`Project root ${rootPath} is not a git repository.`);
  }
}

function assertCleanWorktree(rootPath: string) {
  const result = runGit(rootPath, ["status", "--porcelain"]);

  if (result.stdout.trim().length > 0) {
    throw new Error("Branch preparation requires a clean git worktree.");
  }
}

function assertLocalBranchExists(rootPath: string, branchName: string) {
  if (!hasLocalBranch(rootPath, branchName)) {
    throw new Error(`Base branch ${branchName} was not found in the local repository.`);
  }
}

function assertValidBranchName(rootPath: string, branchName: string) {
  const result = runGit(rootPath, ["check-ref-format", "--branch", branchName], true);

  if (result.status !== 0) {
    throw new Error(`Derived branch name ${branchName} is not a valid git branch name.`);
  }
}

function hasLocalBranch(rootPath: string, branchName: string) {
  return runGit(rootPath, ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], true).status === 0;
}

function switchToBranch(rootPath: string, branchName: string) {
  runGit(rootPath, ["switch", branchName]);
}

function createAndSwitchToBranch(rootPath: string, branchName: string, baseBranch: string) {
  runGit(rootPath, ["switch", "-c", branchName, baseBranch]);
}

function ensureNotOnBaseBranch(rootPath: string, baseBranch: string) {
  const currentBranch = getCurrentBranch(rootPath);

  if (currentBranch === baseBranch) {
    throw new Error(`Execution cannot run directly on the base branch ${baseBranch}.`);
  }
}

function getCurrentBranch(rootPath: string) {
  return runGit(rootPath, ["branch", "--show-current"]).stdout.trim();
}

function getHeadCommit(rootPath: string) {
  return runGit(rootPath, ["rev-parse", "HEAD"]).stdout.trim();
}

function runGit(rootPath: string, args: string[], allowFailure = false) {
  const result = spawnSync("git", args, {
    cwd: rootPath,
    encoding: "utf8",
  });

  if (!allowFailure && result.status !== 0) {
    const stderr = result.stderr?.trim() ?? "";
    const stdout = result.stdout?.trim() ?? "";
    throw new Error(
      `git ${args.join(" ")} failed.\n${[stdout, stderr].filter(Boolean).join("\n")}`.trim(),
    );
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
