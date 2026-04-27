import type {
  AgentStepStatus,
  ExecutionStatus,
  ModelDecisionState,
} from "@vimbuspromax3000/shared";
import type { DatabaseClient } from "./types";

export type CreateTaskExecutionInput = {
  taskId: string;
  branchId: string;
  status: ExecutionStatus;
  retryCount?: number;
  policyJson?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
};

export type UpdateTaskExecutionInput = {
  status?: ExecutionStatus;
  retryCount?: number;
  policyJson?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
};

export type ListTaskExecutionsInput = {
  taskId?: string;
  branchId?: string;
};

export type CreateAgentStepInput = {
  plannerRunId?: string | null;
  taskExecutionId?: string | null;
  role: string;
  modelName?: string | null;
  status: AgentStepStatus;
  inputHash?: string | null;
  outputPath?: string | null;
  summary?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
};

export type UpdateAgentStepInput = {
  modelName?: string | null;
  status?: AgentStepStatus;
  inputHash?: string | null;
  outputPath?: string | null;
  summary?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
};

export type CreateModelDecisionInput = {
  projectId: string;
  taskExecutionId?: string | null;
  attempt: number;
  complexityLabel: string;
  selectedSlot: string;
  selectedModel?: string | null;
  reason: string;
  state: ModelDecisionState;
  scoreJson?: string | null;
};

export async function createTaskExecution(db: DatabaseClient, input: CreateTaskExecutionInput) {
  return db.taskExecution.create({
    data: {
      taskId: input.taskId,
      branchId: input.branchId,
      status: input.status,
      retryCount: input.retryCount ?? 0,
      policyJson: input.policyJson ?? null,
      startedAt: input.startedAt ?? null,
      finishedAt: input.finishedAt ?? null,
    },
  });
}

export async function getTaskExecution(db: DatabaseClient, id: string) {
  return db.taskExecution.findUnique({
    where: { id },
  });
}

export async function listTaskExecutions(db: DatabaseClient, input: ListTaskExecutionsInput = {}) {
  return db.taskExecution.findMany({
    where: {
      taskId: input.taskId,
      branchId: input.branchId,
    },
    orderBy: [{ createdAt: "desc" }],
  });
}

export async function getTaskExecutionDetail(db: DatabaseClient, id: string) {
  const execution = await db.taskExecution.findUnique({
    where: { id },
    include: {
      task: {
        include: {
          epic: {
            include: {
              plannerRun: true,
              project: true,
            },
          },
          verificationPlans: {
            orderBy: [{ createdAt: "desc" }],
            take: 1,
            include: {
              items: {
                orderBy: [{ orderIndex: "asc" }],
              },
            },
          },
        },
      },
      branch: true,
      agentSteps: {
        orderBy: [{ createdAt: "desc" }],
      },
      patchReviews: {
        orderBy: [{ createdAt: "desc" }],
      },
      testRuns: {
        orderBy: [{ createdAt: "asc" }],
      },
    },
  });

  if (!execution) {
    return null;
  }

  return {
    ...execution,
    latestVerificationPlan: execution.task.verificationPlans[0] ?? null,
    latestAgentStep: execution.agentSteps[0] ?? null,
    latestPatchReview: execution.patchReviews[0] ?? null,
    policy: parseJson(execution.policyJson),
  };
}

export async function getExecutionVerificationRunContext(db: DatabaseClient, id: string) {
  const execution = await db.taskExecution.findUnique({
    where: { id },
    include: {
      task: {
        include: {
          epic: {
            include: {
              project: true,
            },
          },
          verificationPlans: {
            where: {
              status: "approved",
            },
            orderBy: [{ createdAt: "desc" }],
            take: 1,
            include: {
              items: {
                where: {
                  status: "approved",
                },
                orderBy: [{ orderIndex: "asc" }],
              },
            },
          },
        },
      },
      branch: true,
    },
  });

  if (!execution) {
    return null;
  }

  return {
    ...execution,
    latestApprovedVerificationPlan: execution.task.verificationPlans[0] ?? null,
    policy: parseJson(execution.policyJson),
  };
}

export async function updateTaskExecution(db: DatabaseClient, id: string, input: UpdateTaskExecutionInput) {
  return db.taskExecution.update({
    where: { id },
    data: {
      status: input.status,
      retryCount: input.retryCount,
      policyJson: input.policyJson,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
    },
  });
}

export async function createAgentStep(db: DatabaseClient, input: CreateAgentStepInput) {
  return db.agentStep.create({
    data: {
      plannerRunId: input.plannerRunId ?? null,
      taskExecutionId: input.taskExecutionId ?? null,
      role: input.role,
      modelName: input.modelName ?? null,
      status: input.status,
      inputHash: input.inputHash ?? null,
      outputPath: input.outputPath ?? null,
      summary: input.summary ?? null,
      startedAt: input.startedAt ?? null,
      finishedAt: input.finishedAt ?? null,
    },
  });
}

export async function updateAgentStep(db: DatabaseClient, id: string, input: UpdateAgentStepInput) {
  return db.agentStep.update({
    where: { id },
    data: {
      modelName: input.modelName,
      status: input.status,
      inputHash: input.inputHash,
      outputPath: input.outputPath,
      summary: input.summary,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
    },
  });
}

export async function createModelDecision(db: DatabaseClient, input: CreateModelDecisionInput) {
  return db.modelDecision.create({
    data: {
      projectId: input.projectId,
      taskExecutionId: input.taskExecutionId ?? null,
      attempt: input.attempt,
      complexityLabel: input.complexityLabel,
      selectedSlot: input.selectedSlot,
      selectedModel: input.selectedModel ?? null,
      reason: input.reason,
      state: input.state,
      scoreJson: input.scoreJson ?? null,
    },
  });
}

/**
 * VIM-30 — return the most recent {@link ModelDecision} for an execution,
 * ordered by attempt descending. Used by the retry runtime to decide whether
 * a duplicate POST should be a no-op (latest is still `selected`) or advance
 * the attempt window (latest is `stopped` / `escalated`).
 */
export async function getLatestModelDecision(db: DatabaseClient, taskExecutionId: string) {
  return db.modelDecision.findFirst({
    where: { taskExecutionId },
    orderBy: [{ attempt: "desc" }],
  });
}

/**
 * VIM-30 — list every {@link ModelDecision} for an execution, oldest first.
 * Useful for debugging + replay; not a hot path.
 */
export async function listModelDecisionsForExecution(db: DatabaseClient, taskExecutionId: string) {
  return db.modelDecision.findMany({
    where: { taskExecutionId },
    orderBy: [{ attempt: "asc" }],
  });
}

function parseJson(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
