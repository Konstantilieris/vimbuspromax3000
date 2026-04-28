import { spawnSync } from "node:child_process";
import type { PrismaClient } from "@vimbuspromax3000/db/client";
import {
  abandonTaskBranch as abandonTaskBranchRecord,
  appendLoopEvent,
  createAgentStep,
  createModelDecision,
  createTaskExecution,
  createTaskBranch,
  getLatestModelDecision,
  getLatestPatchReview,
  getTaskBranch,
  getTaskBranchDetail,
  getTaskExecutionContext,
  getTaskExecutionDetail,
  listLoopEvents,
  listMcpToolCallsForExecution,
  setTaskStatus,
  updateAgentStep,
  updatePatchReview,
  updateTaskBranch,
  updateTaskExecution,
} from "@vimbuspromax3000/db";
import { createMcpService } from "@vimbuspromax3000/mcp-client";
import {
  createLangSmithExporter,
  createLangSmithTraceLinkService,
  langSmithExporterConfigFromEnv,
  type LangSmithExporter,
  type LangSmithTraceExportInput,
  type LangSmithTraceLink,
  type LangSmithTraceLinkRepository,
} from "@vimbuspromax3000/observability";
import type { LoopEventType, ModelDecisionState } from "@vimbuspromax3000/shared";
import { resolveModelSlot, selectExecutorSlotForAttempt } from "@vimbuspromax3000/policy-engine";
import {
  runAgentLoop,
  type AgentGenerator,
  type AgentLoopResult,
  type ToolDef,
} from "./agentLoop";

/**
 * VIM-30 — typed payload returned by {@link ExecutionService.retryExecution}.
 *
 * `terminated` is `true` only when the attempt budget is exhausted (per
 * docs/policy/model-selection.md): the execution + task have been moved to
 * `failed` and a `task.failed` event has been emitted.
 */
export type RetryExecutionResult = {
  decision: {
    id: string;
    attempt: number;
    selectedSlot: string;
    selectedModel: string | null;
    reason: string;
    state: ModelDecisionState;
  };
  execution: NonNullable<Awaited<ReturnType<typeof getTaskExecutionDetail>>>;
  /** True when this retry exhausted the attempt budget. */
  terminated: boolean;
};

/**
 * VIM-30 — typed error surfaced when the retry endpoint cannot resolve the
 * required executor slot. The API maps this to HTTP 422 with the same
 * MODEL_SLOT_UNAVAILABLE code already used by the evaluator gate.
 */
export class RetryExecutionError extends Error {
  constructor(
    message: string,
    public readonly code: "EXECUTION_NOT_FOUND" | "MODEL_SLOT_UNAVAILABLE",
  ) {
    super(message);
    this.name = "RetryExecutionError";
  }
}

/**
 * VIM-31 — single-iteration outcome handed to the TDD loop wrapper.
 *
 * Mirrors the shape returned by `TestRunnerService.runExecutionVerificationIteration`
 * but stays decoupled from the `@vimbuspromax3000/test-runner` package so
 * the agent package keeps its existing dependency footprint (no circular
 * imports between agent / test-runner / evaluator).
 */
export type TddIterationOutcome = {
  iterationIndex: number;
  preRedAborted: boolean;
  abortCode?: string;
  hasFailure: boolean;
};

/**
 * VIM-31 — callback invoked once per TDD iteration. The host wires this
 * to `TestRunnerService.runExecutionVerificationIteration` (see
 * `apps/api` and CLI for production wiring).
 */
export type TddIterationRunner = (input: {
  executionId: string;
  iterationIndex: number;
}) => Promise<TddIterationOutcome>;

/**
 * VIM-31 — optional evaluator hook. When supplied, the loop wrapper calls
 * this between a failed `post_green` and the retry path so VIM-44's
 * evaluator can flip the latest ModelDecision to `stopped` and let
 * `retryExecution` advance the attempt window.
 *
 * Returns the verdict so the loop can short-circuit on `stop` without
 * forcing another retry.
 */
export type TddEvaluatorHook = (executionId: string) => Promise<{
  verdict?: "proceed" | "retry" | "stop";
}>;

/**
 * VIM-31 — summary of one TDD loop. The acceptance criteria require that
 * each iteration writes two TestRun rows (red + green) with a monotonically
 * increasing `iterationIndex`; the loop here is the wrapper that increments
 * the index across iterations.
 */
export type TddLoopResult = {
  iterations: TddIterationOutcome[];
  outcome: "passed" | "tdd_invariant_violated" | "max_iterations" | "retry_terminated";
  /** Last iteration's outcome (for convenience). */
  lastIteration: TddIterationOutcome | null;
};

export type ExecutionService = {
  getTaskBranch(taskId: string): Promise<Awaited<ReturnType<typeof getTaskBranchDetail>>>;
  prepareTaskBranch(input: { taskId: string }): Promise<Awaited<ReturnType<typeof getTaskBranchDetail>>>;
  abandonTaskBranch(input: { taskId: string }): Promise<Awaited<ReturnType<typeof getTaskBranchDetail>>>;
  startTaskExecution(input: { taskId: string }): Promise<Awaited<ReturnType<typeof getTaskExecutionDetail>>>;
  /**
   * VIM-30 — drive an attempt-based retry on a task execution.
   *
   * Idempotent: while the latest {@link ModelDecision} for the execution is
   * still in state `selected`, calling this is a no-op that returns the
   * existing decision. To advance the attempt window, the caller (eval
   * gate) flips the latest decision's state to `stopped` after a failed
   * verification — then the next call allocates the next attempt.
   */
  retryExecution(executionId: string): Promise<RetryExecutionResult>;
  getExecutionPatchReview(
    executionId: string,
  ): Promise<{
    patchReview: NonNullable<Awaited<ReturnType<typeof getLatestPatchReview>>>;
    execution: NonNullable<Awaited<ReturnType<typeof getTaskExecutionDetail>>>;
  } | null>;
  approveExecutionPatchReview(
    executionId: string,
  ): Promise<{
    patchReview: NonNullable<Awaited<ReturnType<typeof getLatestPatchReview>>>;
    execution: NonNullable<Awaited<ReturnType<typeof getTaskExecutionDetail>>>;
  }>;
  rejectExecutionPatchReview(
    executionId: string,
  ): Promise<{
    patchReview: NonNullable<Awaited<ReturnType<typeof getLatestPatchReview>>>;
    execution: NonNullable<Awaited<ReturnType<typeof getTaskExecutionDetail>>>;
  }>;
  /**
   * VIM-31 — drive an iterative TDD red/green loop on top of the existing
   * agent execution + verification + retry primitives. Each iteration:
   *
   *   1. Calls the supplied `runIteration` callback (wired by the host to
   *      `TestRunnerService.runExecutionVerificationIteration`). That call
   *      writes two TestRun rows per command-backed item — one pre_red
   *      (against the empty / pre-edit branch state) and one post_green
   *      (after the agent loop applies its edits) — both tagged with the
   *      monotonically increasing `iterationIndex`.
   *   2. If the iteration aborts as `tdd_invariant_violated`, returns
   *      immediately. The agent loop should treat that as a planning bug.
   *   3. If `post_green` failed, calls the optional evaluator hook (which
   *      flips the latest ModelDecision to `stopped`), then dispatches to
   *      VIM-30's existing `retryExecution` path so the next iteration
   *      runs under the next attempt's slot.
   *   4. On `terminated` retry (attempt budget exhausted) or when the
   *      iteration succeeds, the loop stops.
   *
   * The wrapper is intentionally thin: it never edits the evaluator or
   * the retry transaction (those are owned by VIM-44 / VIM-30). It just
   * sequences the three public entry points already on this service +
   * the test-runner.
   */
  driveTddLoop(
    input: {
      executionId: string;
      maxIterations?: number;
    },
    callbacks: {
      runIteration: TddIterationRunner;
      evaluate?: TddEvaluatorHook;
    },
  ): Promise<TddLoopResult>;
};

/**
 * Inputs supplied to {@link CreateAgentGenerator} when an execution is about
 * to start its plan -> tool-call loop. Keeps the policy-resolved model
 * snapshot opaque so Sprint 2 can plug the real Vercel AI SDK behind this
 * factory without touching the execution service plumbing.
 */
export type AgentGeneratorContext = {
  taskExecutionId: string;
  projectId: string;
  taskId: string;
  modelName: string;
  toolCatalog: ToolDef[];
};

export type CreateAgentGenerator = (
  context: AgentGeneratorContext,
) => AgentGenerator | Promise<AgentGenerator>;

export function createExecutionService(options: {
  prisma: PrismaClient;
  env?: Record<string, string | undefined>;
  /**
   * Sprint 1 wiring hook. When a factory is supplied, `startTaskExecution`
   * drives a {@link runAgentLoop} after branch prep, model resolution, and
   * the initial agent-step persistence. When absent (default), execution
   * still completes its existing setup but skips the loop — preserving the
   * pre-VIM-29 behaviour and keeping every existing API/test green.
   */
  agentGeneratorFactory?: CreateAgentGenerator;
  /** Optional override for the loop turn budget. Default 25 (see policy doc). */
  agentLoopMaxTurns?: number;
  /** Optional LangSmith exporter override for tests and controlled integrations. */
  langSmithExporter?: LangSmithExporter;
}): ExecutionService {
  const prisma = options.prisma;
  const env = options.env ?? process.env;
  const mcpService = createMcpService({ prisma });
  const agentGeneratorFactory = options.agentGeneratorFactory;
  const agentLoopMaxTurns = options.agentLoopMaxTurns;
  const langSmithExporter =
    options.langSmithExporter ?? createLangSmithExporter(langSmithExporterConfigFromEnv(env));

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

      const resolution = await resolveModelSlot(
        prisma,
        {
          projectId: project.id,
          slotKey: "executor_default",
          taskExecutionId: execution.id,
        },
        env,
      );

      if (!resolution.ok) {
        await prisma.$transaction(async (tx) => {
          await updateTaskExecution(tx, execution.id, {
            status: "failed",
            finishedAt: new Date(),
          });
          await setTaskStatus(tx, context.id, "failed");
          await appendLoopEvent(tx, {
            projectId: project.id,
            taskExecutionId: execution.id,
            type: "task.failed",
            payload: {
              taskId: context.id,
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
        await updateTaskExecution(tx, execution.id, {
          status: "implementing",
          policyJson,
          startedAt,
        });
        await updateTaskBranch(tx, branch.id, {
          state: "active",
          currentHead: getHeadCommit(project.rootPath),
        });
        await setTaskStatus(tx, context.id, "executing");
        await createModelDecision(tx, {
          projectId: project.id,
          taskExecutionId: execution.id,
          attempt: 1,
          complexityLabel: context.complexity,
          selectedSlot: "executor_default",
          selectedModel: resolution.value.concreteModelName,
          reason: "Execution started for approved task.",
          state: "selected",
        });
        const agentStep = await createAgentStep(tx, {
          taskExecutionId: execution.id,
          role: "executor",
          modelName: resolution.value.concreteModelName,
          status: "started",
          startedAt,
          summary: "Minimal execution backend started.",
        });

        await appendLoopEvent(tx, {
          projectId: project.id,
          taskExecutionId: execution.id,
          type: "task.selected",
          payload: {
            taskId: context.id,
            branchName: branch.name,
          },
        });
        await appendLoopEvent(tx, {
          projectId: project.id,
          taskExecutionId: execution.id,
          type: "model.selected",
          payload: {
            taskId: context.id,
            slotKey: "executor_default",
            selectedModel: resolution.value.concreteModelName,
            attempt: 1,
          },
        });
        await appendLoopEvent(tx, {
          projectId: project.id,
          taskExecutionId: execution.id,
          type: "agent.step.started",
          payload: {
            taskId: context.id,
            agentStepId: agentStep.id,
            role: "executor",
            modelName: resolution.value.concreteModelName,
          },
        });
      });

      // Sprint 1 wiring: drive the agent loop only when a generator factory is
      // configured. This keeps existing branch/model/approval gates intact.
      if (agentGeneratorFactory) {
        const toolCatalog = await loadProjectToolCatalog(mcpService, project.id);
        const generator = await agentGeneratorFactory({
          taskExecutionId: execution.id,
          projectId: project.id,
          taskId: context.id,
          modelName: resolution.value.concreteModelName,
          toolCatalog,
        });

        const loopResult: AgentLoopResult = await runAgentLoop({
          taskExecutionId: execution.id,
          projectId: project.id,
          agentRole: "executor",
          modelName: resolution.value.concreteModelName,
          toolCatalog,
          generator,
          maxTurns: agentLoopMaxTurns,
          repository: {
            createAgentStep: (input) =>
              createAgentStep(prisma, {
                taskExecutionId: input.taskExecutionId,
                role: input.role,
                modelName: input.modelName ?? null,
                status: input.status,
                summary: input.summary ?? null,
                startedAt: input.startedAt,
              }),
            updateAgentStep: async (id, input) => {
              await updateAgentStep(prisma, id, {
                status: input.status,
                summary: input.summary ?? null,
                finishedAt: input.finishedAt ?? null,
              });
            },
            appendLoopEvent: async (input) => {
              await appendLoopEvent(prisma, {
                projectId: input.projectId,
                taskExecutionId: input.taskExecutionId,
                type: input.type as LoopEventType,
                payload: input.payload,
              });
            },
          },
          mcpService: {
            createToolCall: (input) =>
              mcpService.createToolCall({
                projectId: input.projectId,
                taskExecutionId: input.taskExecutionId ?? null,
                serverName: input.serverName,
                toolName: input.toolName,
                args: input.args,
              }),
            executeToolCall: async (callId) => {
              const result = await mcpService.executeToolCall(callId);
              if (result.ok) {
                return {
                  ok: true as const,
                  status: "succeeded" as const,
                  callId,
                  summary: result.call.resultSummary ?? null,
                };
              }
              return {
                ok: false as const,
                status: result.status,
                callId,
                error: result.error,
              };
            },
          },
        });

        if (loopResult.stopReason !== "finalize") {
          // Surface non-finalize stop reasons via the existing failure event,
          // but leave the execution row in `implementing` so downstream
          // verification + patch review gates remain authoritative.
          await appendLoopEvent(prisma, {
            projectId: project.id,
            taskExecutionId: execution.id,
            type: "task.failed",
            payload: {
              taskId: context.id,
              code: loopResult.stopReason.toUpperCase(),
              message: `Agent loop stopped after ${loopResult.turns} turn(s) with reason ${loopResult.stopReason}.`,
            },
          });
        }
      }

      const detail = await getTaskExecutionDetail(prisma, execution.id);

      if (!detail) {
        throw new Error(`Task execution ${execution.id} was not found after creation.`);
      }

      await exportExecutionLangSmithTrace({
        prisma,
        exporter: langSmithExporter,
        execution: detail,
      });

      return detail;
    },

    async retryExecution(executionId) {
      const detail = await getTaskExecutionDetail(prisma, executionId);
      if (!detail) {
        throw new RetryExecutionError(
          `Task execution ${executionId} was not found.`,
          "EXECUTION_NOT_FOUND",
        );
      }

      const projectId = detail.task.epic.project.id;
      const taskId = detail.task.id;
      const complexityLabel = detail.task.complexity;

      const latestDecision = await getLatestModelDecision(prisma, executionId);

      // Idempotency: latest decision still active for the in-flight attempt.
      if (latestDecision && latestDecision.state === "selected") {
        return {
          decision: toDecisionDTO(latestDecision),
          execution: detail,
          terminated: false,
        };
      }

      // Compute the next attempt = (highest known attempt) + 1. The initial
      // execution writes attempt=1 from `startTaskExecution`; if no row yet
      // exists, the first retry seeds attempt=2 to keep the contract that
      // attempt=1 belongs to the initial run.
      const nextAttempt = (latestDecision?.attempt ?? 1) + 1;
      const slotChoice = selectExecutorSlotForAttempt(nextAttempt);

      if (slotChoice.kind === "fail") {
        // Terminal: persist a stopped decision, fail the task + execution,
        // and emit task.failed via the existing event mechanism. The sibling
        // VIM-36 agent owns the underlying transport refactor; we keep using
        // appendLoopEvent so the 100ms poller picks the event up.
        const finishedAt = new Date();
        const terminalSlot = latestDecision?.selectedSlot ?? "executor_strong";
        let terminalDecisionId = "";

        await prisma.$transaction(async (tx) => {
          const created = await createModelDecision(tx, {
            projectId,
            taskExecutionId: executionId,
            attempt: nextAttempt,
            complexityLabel,
            selectedSlot: terminalSlot,
            selectedModel: null,
            reason: slotChoice.reason,
            state: "stopped",
          });
          terminalDecisionId = created.id;
          await updateTaskExecution(tx, executionId, {
            status: "failed",
            retryCount: nextAttempt - 1,
            finishedAt,
          });
          await setTaskStatus(tx, taskId, "failed");
          await appendLoopEvent(tx, {
            projectId,
            taskExecutionId: executionId,
            type: "task.failed",
            payload: {
              taskId,
              code: "MAX_ATTEMPTS_EXCEEDED",
              message: `Task ${taskId} exhausted retry budget after ${nextAttempt - 1} attempt(s).`,
              attempt: nextAttempt,
            },
          });
        });

        const refreshed = await getTaskExecutionDetail(prisma, executionId);
        if (!refreshed) {
          throw new Error(`Task execution ${executionId} disappeared after failure transition.`);
        }

        return {
          decision: {
            id: terminalDecisionId,
            attempt: nextAttempt,
            selectedSlot: terminalSlot,
            selectedModel: null,
            reason: slotChoice.reason,
            state: "stopped",
          },
          execution: refreshed,
          terminated: true,
        };
      }

      // Non-terminal: resolve the slot, persist the decision, bump retryCount.
      const resolution = await resolveModelSlot(
        prisma,
        {
          projectId,
          slotKey: slotChoice.slotKey,
          taskExecutionId: executionId,
        },
        env,
      );

      if (!resolution.ok) {
        throw new RetryExecutionError(
          `Cannot retry: model slot ${slotChoice.slotKey} unavailable (${resolution.code}: ${resolution.message})`,
          "MODEL_SLOT_UNAVAILABLE",
        );
      }

      const decisionState: ModelDecisionState =
        slotChoice.reason === "escalate_to_strong" ? "escalated" : "selected";

      let createdDecisionId = "";
      const concreteModelName = resolution.value.concreteModelName;

      await prisma.$transaction(async (tx) => {
        const created = await createModelDecision(tx, {
          projectId,
          taskExecutionId: executionId,
          attempt: nextAttempt,
          complexityLabel,
          selectedSlot: slotChoice.slotKey,
          selectedModel: concreteModelName,
          reason: slotChoice.reason,
          state: decisionState,
        });
        createdDecisionId = created.id;
        await updateTaskExecution(tx, executionId, {
          retryCount: nextAttempt - 1,
        });
        await appendLoopEvent(tx, {
          projectId,
          taskExecutionId: executionId,
          type: "model.selected",
          payload: {
            taskId,
            slotKey: slotChoice.slotKey,
            selectedModel: concreteModelName,
            attempt: nextAttempt,
            reason: slotChoice.reason,
          },
        });
        if (slotChoice.reason === "escalate_to_strong") {
          await appendLoopEvent(tx, {
            projectId,
            taskExecutionId: executionId,
            type: "model.escalated",
            payload: {
              taskId,
              fromSlot: latestDecision?.selectedSlot ?? "executor_default",
              toSlot: slotChoice.slotKey,
              attempt: nextAttempt,
              selectedModel: concreteModelName,
            },
          });
        }
      });

      const refreshed = await getTaskExecutionDetail(prisma, executionId);
      if (!refreshed) {
        throw new Error(`Task execution ${executionId} disappeared after retry persistence.`);
      }

      return {
        decision: {
          id: createdDecisionId,
          attempt: nextAttempt,
          selectedSlot: slotChoice.slotKey,
          selectedModel: concreteModelName,
          reason: slotChoice.reason,
          state: decisionState,
        },
        execution: refreshed,
        terminated: false,
      };
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

      return {
        patchReview,
        execution,
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

      return {
        patchReview: updatedPatchReview,
        execution: updatedExecution,
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

      return {
        patchReview: updatedPatchReview,
        execution: updatedExecution,
      };
    },

    async driveTddLoop(input, callbacks) {
      const maxIterations = input.maxIterations ?? 3;
      const iterations: TddIterationOutcome[] = [];
      const service = this;
      let lastIteration: TddIterationOutcome | null = null;

      for (let iterationIndex = 1; iterationIndex <= maxIterations; iterationIndex += 1) {
        const outcome = await callbacks.runIteration({
          executionId: input.executionId,
          iterationIndex,
        });

        iterations.push(outcome);
        lastIteration = outcome;

        if (outcome.preRedAborted) {
          // TDD invariant violation — the loop stops without retrying.
          return {
            iterations,
            outcome: "tdd_invariant_violated",
            lastIteration,
          };
        }

        if (!outcome.hasFailure) {
          return {
            iterations,
            outcome: "passed",
            lastIteration,
          };
        }

        // post_green failed — feed VIM-30's retry path. The optional
        // evaluator hook lets VIM-44's evaluator flip the latest
        // ModelDecision to `stopped` so retryExecution allocates the next
        // attempt; without it, retryExecution stays idempotent on a
        // `selected` decision and the loop will stall — that is intentional
        // and matches the existing single-shot semantics.
        if (callbacks.evaluate) {
          const verdict = await callbacks.evaluate(input.executionId);
          if (verdict.verdict === "stop") {
            return {
              iterations,
              outcome: "retry_terminated",
              lastIteration,
            };
          }
        }

        const retry = await service.retryExecution(input.executionId);
        if (retry.terminated) {
          return {
            iterations,
            outcome: "retry_terminated",
            lastIteration,
          };
        }
      }

      return {
        iterations,
        outcome: "max_iterations",
        lastIteration,
      };
    },
  };
}

function toDecisionDTO(decision: {
  id: string;
  attempt: number;
  selectedSlot: string;
  selectedModel: string | null;
  reason: string;
  state: string;
}): RetryExecutionResult["decision"] {
  return {
    id: decision.id,
    attempt: decision.attempt,
    selectedSlot: decision.selectedSlot,
    selectedModel: decision.selectedModel,
    reason: decision.reason,
    state: decision.state as ModelDecisionState,
  };
}

async function loadProjectToolCatalog(
  mcpService: ReturnType<typeof createMcpService>,
  projectId: string,
): Promise<ToolDef[]> {
  const tools = await mcpService.listProjectTools(projectId);
  return tools
    .filter((tool) => tool.status === "active")
    .map<ToolDef>((tool) => ({
      serverName: tool.server.name,
      toolName: tool.name,
      description: tool.description ?? undefined,
      mutability: tool.mutability as ToolDef["mutability"],
      approvalRequired: tool.approvalRequired,
      inputSchema: parseToolSchema(tool.inputSchemaJson),
    }));
}

function parseToolSchema(value: string | null | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to empty schema.
  }
  return {};
}

type TaskExecutionDetail = NonNullable<Awaited<ReturnType<typeof getTaskExecutionDetail>>>;
type McpToolCallForExecution = Awaited<ReturnType<typeof listMcpToolCallsForExecution>>[number];
type LoopEventRecord = Awaited<ReturnType<typeof listLoopEvents>>[number];

async function exportExecutionLangSmithTrace(input: {
  prisma: PrismaClient;
  exporter: LangSmithExporter;
  execution: TaskExecutionDetail;
}) {
  if (!input.exporter.enabled) {
    return;
  }

  const projectId = input.execution.task.epic.project.id;
  const [mcpCalls, events] = await Promise.all([
    listMcpToolCallsForExecution(input.prisma, input.execution.id),
    listLoopEvents(input.prisma, {
      projectId,
      taskExecutionId: input.execution.id,
      limit: 1_000,
    }),
  ]);

  const service = createLangSmithTraceLinkService({
    repository: createPrismaLangSmithTraceLinkRepository(input.prisma),
    eventSink: {
      async append(event) {
        await appendLoopEvent(input.prisma, {
          projectId: event.projectId,
          taskExecutionId: event.subjectType === "task_execution" ? event.subjectId : undefined,
          type: event.type,
          payload: event.payload,
        });
      },
    },
    exporter: input.exporter,
    onExportError(error) {
      void emitLangSmithExportWarning(input.prisma, {
        projectId,
        taskExecutionId: input.execution.id,
        error,
      });
    },
  });

  await service.exportTrace({
    projectId,
    ...buildExecutionTraceExportInput(input.execution, mcpCalls, events),
  });
}

function buildExecutionTraceExportInput(
  execution: TaskExecutionDetail,
  mcpCalls: McpToolCallForExecution[],
  events: LoopEventRecord[],
): LangSmithTraceExportInput {
  const orderedAgentSteps = [...execution.agentSteps].sort(compareByStartOrCreateTime);
  const toolCallsByStepId = groupToolCallsByAgentStep(mcpCalls, events, orderedAgentSteps);
  const rootStartedAt = execution.startedAt ?? execution.createdAt;
  const rootFinishedAt =
    execution.finishedAt ??
    latestDate([
      ...orderedAgentSteps.map((step) => step.finishedAt ?? step.startedAt ?? step.createdAt),
      ...mcpCalls.map((call) => call.finishedAt ?? call.createdAt),
      execution.createdAt,
    ]) ??
    new Date();

  return {
    runName: `Task execution ${execution.task.stableId}`,
    runType: "chain",
    subjectType: "task_execution",
    subjectId: execution.id,
    startedAt: rootStartedAt,
    finishedAt: rootFinishedAt,
    error: execution.status === "failed" ? `Execution failed: ${execution.task.title}` : null,
    inputs: {
      task: {
        id: execution.task.id,
        stableId: execution.task.stableId,
        title: execution.task.title,
        type: execution.task.type,
        complexity: execution.task.complexity,
      },
      branch: {
        id: execution.branch.id,
        name: execution.branch.name,
        base: execution.branch.base,
      },
      policy: execution.policy,
    },
    outputs: {
      status: execution.status,
      retryCount: execution.retryCount,
      latestAgentStepId: execution.latestAgentStep?.id ?? null,
      latestPatchReviewId: execution.latestPatchReview?.id ?? null,
    },
    metadata: {
      projectId: execution.task.epic.project.id,
      projectName: execution.task.epic.project.name,
      taskId: execution.task.id,
      stableId: execution.task.stableId,
      branchId: execution.branch.id,
    },
    childRuns: orderedAgentSteps.map((step, index) => ({
      runName: `Agent step ${index + 1}: ${step.role}`,
      runType: step.modelName ? "llm" : "chain",
      startedAt: step.startedAt ?? step.createdAt,
      finishedAt: step.finishedAt ?? step.startedAt ?? step.createdAt,
      error: step.status === "failed" ? step.summary ?? "Agent step failed." : null,
      inputs: {
        role: step.role,
        modelName: step.modelName,
        inputHash: step.inputHash,
      },
      outputs: {
        status: step.status,
        summary: step.summary,
        outputPath: step.outputPath,
      },
      metadata: {
        agentStepId: step.id,
        taskExecutionId: execution.id,
        role: step.role,
        modelName: step.modelName,
      },
      childRuns: (toolCallsByStepId.get(step.id) ?? []).map((call) => ({
        runName: `MCP ${call.serverName}/${call.toolName}`,
        runType: "tool",
        startedAt: call.createdAt,
        finishedAt: call.finishedAt ?? call.createdAt,
        error:
          call.status === "failed" || call.status === "blocked"
            ? call.errorSummary ?? `MCP tool call ${call.status}.`
            : null,
        inputs: {
          serverName: call.serverName,
          toolName: call.toolName,
          arguments: parseJsonOrNull(call.argumentsJson),
          argumentsHash: call.argumentsHash,
        },
        outputs: {
          status: call.status,
          resultSummary: call.resultSummary,
          errorSummary: call.errorSummary,
          latencyMs: call.latencyMs,
        },
        metadata: {
          mcpToolCallId: call.id,
          taskExecutionId: execution.id,
          mutability: call.mutability,
          approvalId: call.approvalId,
        },
      })),
    })),
  };
}

function groupToolCallsByAgentStep(
  mcpCalls: McpToolCallForExecution[],
  events: LoopEventRecord[],
  agentSteps: Array<{ id: string; startedAt: Date | null; finishedAt: Date | null; createdAt: Date }>,
) {
  const stepIdByCallId = new Map<string, string>();
  let activeAgentStepId: string | null = null;

  for (const event of events) {
    const payload = asRecord(event.payload);

    if (event.type === "agent.step.started") {
      activeAgentStepId = asString(payload.agentStepId) ?? activeAgentStepId;
      continue;
    }

    if (event.type === "mcp.tool.requested") {
      const callId = asString(payload.callId);
      if (callId && activeAgentStepId) {
        stepIdByCallId.set(callId, activeAgentStepId);
      }
      continue;
    }

    if (event.type === "agent.step.completed") {
      const completedStepId = asString(payload.agentStepId);
      if (!completedStepId || completedStepId === activeAgentStepId) {
        activeAgentStepId = null;
      }
    }
  }

  const grouped = new Map<string, McpToolCallForExecution[]>();
  const orderedCalls = [...mcpCalls].sort(compareByCreateTime);

  for (const call of orderedCalls) {
    const stepId = stepIdByCallId.get(call.id) ?? findStepIdForToolCall(call, agentSteps);
    if (!stepId) {
      continue;
    }

    const calls = grouped.get(stepId) ?? [];
    calls.push(call);
    grouped.set(stepId, calls);
  }

  return grouped;
}

function findStepIdForToolCall(
  call: McpToolCallForExecution,
  agentSteps: Array<{ id: string; startedAt: Date | null; finishedAt: Date | null; createdAt: Date }>,
) {
  const callTime = call.createdAt.getTime();

  for (const step of agentSteps) {
    const start = (step.startedAt ?? step.createdAt).getTime();
    const end = (step.finishedAt ?? step.startedAt ?? step.createdAt).getTime();

    if (callTime >= start && callTime <= end) {
      return step.id;
    }
  }

  return null;
}

function createPrismaLangSmithTraceLinkRepository(prisma: PrismaClient): LangSmithTraceLinkRepository {
  return {
    async create(input) {
      const link = await prisma.langSmithTraceLink.create({
        data: input,
      });
      return toLangSmithTraceLink(link);
    },
    async list(filter) {
      const links = await prisma.langSmithTraceLink.findMany({
        where: {
          projectId: filter.projectId,
          subjectType: filter.subjectType,
          subjectId: filter.subjectId,
          syncStatus: filter.syncStatus,
        },
        orderBy: [{ createdAt: "desc" }],
      });
      return links.map(toLangSmithTraceLink);
    },
    async update(id, input) {
      const link = await prisma.langSmithTraceLink.update({
        where: { id },
        data: input,
      });
      return toLangSmithTraceLink(link);
    },
  };
}

function toLangSmithTraceLink(link: {
  id: string;
  projectId: string;
  subjectType: string;
  subjectId: string;
  traceUrl: string | null;
  datasetId: string | null;
  experimentId: string | null;
  runId: string | null;
  syncStatus: string;
  createdAt: Date;
  updatedAt: Date;
}): LangSmithTraceLink {
  return link as LangSmithTraceLink;
}

async function emitLangSmithExportWarning(
  prisma: PrismaClient,
  input: {
    projectId: string;
    taskExecutionId: string;
    error: unknown;
  },
) {
  try {
    await appendLoopEvent(prisma, {
      projectId: input.projectId,
      taskExecutionId: input.taskExecutionId,
      type: "operator.notification",
      payload: {
        severity: "warn",
        subjectType: "task_execution",
        subjectId: input.taskExecutionId,
        code: "LANGSMITH_EXPORT_FAILED",
        message: `LangSmith trace export failed: ${formatUnknownError(input.error)}`,
      },
    });
  } catch {
    // Export warning delivery is best-effort and must not affect execution.
  }
}

function compareByStartOrCreateTime(
  left: { startedAt: Date | null; createdAt: Date },
  right: { startedAt: Date | null; createdAt: Date },
) {
  return (left.startedAt ?? left.createdAt).getTime() - (right.startedAt ?? right.createdAt).getTime();
}

function compareByCreateTime(left: { createdAt: Date }, right: { createdAt: Date }) {
  return left.createdAt.getTime() - right.createdAt.getTime();
}

function latestDate(values: Array<Date | null | undefined>) {
  return values.reduce<Date | null>((latest, value) => {
    if (!value) {
      return latest;
    }
    if (!latest || value.getTime() > latest.getTime()) {
      return value;
    }
    return latest;
  }, null);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function parseJsonOrNull(value: string | null) {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function formatUnknownError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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
