import type { PrismaClient } from "@vimbuspromax3000/db/client";
import {
  appendLoopEvent,
  listBenchmarkScenarioDefinitions,
  type BenchmarkScenarioDefinition,
} from "@vimbuspromax3000/db";
import type { ModelSlotKey } from "@vimbuspromax3000/shared";

export type EvalDecision = "proceed" | "warn" | "retry" | "escalate" | "fail";

export type PostExecutionPipelineConfig = {
  maxRetries: number;
  maxEscalations: number;
};

export const DEFAULT_POST_EXECUTION_PIPELINE_CONFIG: PostExecutionPipelineConfig = {
  maxRetries: 1,
  maxEscalations: 1,
};

export type RetryAction =
  | { type: "continue" }
  | { type: "retry"; nextAttempt: number; slotKey: ModelSlotKey }
  | { type: "escalate"; nextAttempt: number; slotKey: ModelSlotKey };

export function decideRetryAction(input: {
  decision: EvalDecision;
  retryCount: number;
  escalationLevel: number;
  attempt: number;
  maxRetries: number;
  maxEscalations: number;
  currentSlotKey: ModelSlotKey;
  nextSlotKey: ModelSlotKey | null;
}): RetryAction {
  if (input.decision === "retry" && input.retryCount < input.maxRetries) {
    return {
      type: "retry",
      nextAttempt: input.attempt + 1,
      slotKey: input.currentSlotKey,
    };
  }

  if (
    (input.decision === "retry" || input.decision === "escalate") &&
    input.escalationLevel < input.maxEscalations &&
    input.nextSlotKey !== null
  ) {
    return {
      type: "escalate",
      nextAttempt: input.attempt + 1,
      slotKey: input.nextSlotKey,
    };
  }

  return { type: "continue" };
}

export type EvalRunSummary = {
  id: string;
  decision: EvalDecision;
  aggregateScore: number;
  threshold: number | null;
  hardFailDimensions: string[];
};

export type BenchmarkRunSummary = {
  scenarioId: string;
  scenarioName: string;
  evalRunId: string;
  verdict: string;
  aggregateScore: number;
};

export type PostExecutionPipelineDeps = {
  prisma: PrismaClient;
  runEvaluation: (executionId: string) => Promise<EvalRunSummary | null>;
  retryExecutor: (input: {
    executionId: string;
    slotKey: ModelSlotKey;
    attempt: number;
    reason: "retry" | "escalate";
  }) => Promise<void>;
  runBenchmarkScenario?: (input: {
    executionId: string;
    scenario: BenchmarkScenarioDefinition;
  }) => Promise<BenchmarkRunSummary>;
  exportLangSmith?: (input: {
    executionId: string;
    projectId: string;
    evalRunId: string;
    benchmarkRunIds: string[];
  }) => Promise<{ accepted: boolean; skipped: boolean; reason?: string }>;
};

export type PostExecutionPipelineInput = {
  executionId: string;
  projectId: string;
  retryCount: number;
  escalationLevel: number;
  attempt: number;
  currentSlotKey: ModelSlotKey;
  nextSlotKey: ModelSlotKey | null;
  config?: Partial<PostExecutionPipelineConfig>;
};

export type PipelinePhaseError = {
  phase: "evaluation" | "benchmark" | "langsmith";
  scenarioId?: string;
  message: string;
};

export type PostExecutionPipelineResult = {
  status: "completed" | "retried" | "escalated" | "failed" | "skipped";
  evalRunId: string | null;
  decision: EvalDecision | null;
  benchmarkRuns: BenchmarkRunSummary[];
  langSmithAccepted: boolean;
  errors: PipelinePhaseError[];
};

export async function runPostExecutionPipeline(
  deps: PostExecutionPipelineDeps,
  input: PostExecutionPipelineInput,
): Promise<PostExecutionPipelineResult> {
  const config: PostExecutionPipelineConfig = {
    maxRetries: input.config?.maxRetries ?? DEFAULT_POST_EXECUTION_PIPELINE_CONFIG.maxRetries,
    maxEscalations: input.config?.maxEscalations ?? DEFAULT_POST_EXECUTION_PIPELINE_CONFIG.maxEscalations,
  };
  const errors: PipelinePhaseError[] = [];
  let evalSummary: EvalRunSummary | null = null;

  try {
    evalSummary = await deps.runEvaluation(input.executionId);
  } catch (error) {
    const message = errorMessage(error);
    errors.push({ phase: "evaluation", message });
    await appendLoopEvent(deps.prisma, {
      projectId: input.projectId,
      taskExecutionId: input.executionId,
      type: "evaluation.failed",
      payload: {
        executionId: input.executionId,
        message,
      },
    });

    return {
      status: "failed",
      evalRunId: null,
      decision: null,
      benchmarkRuns: [],
      langSmithAccepted: false,
      errors,
    };
  }

  if (!evalSummary) {
    return {
      status: "skipped",
      evalRunId: null,
      decision: null,
      benchmarkRuns: [],
      langSmithAccepted: false,
      errors,
    };
  }

  const action = decideRetryAction({
    decision: evalSummary.decision,
    retryCount: input.retryCount,
    escalationLevel: input.escalationLevel,
    attempt: input.attempt,
    maxRetries: config.maxRetries,
    maxEscalations: config.maxEscalations,
    currentSlotKey: input.currentSlotKey,
    nextSlotKey: input.nextSlotKey,
  });

  if (action.type === "retry" || action.type === "escalate") {
    await appendLoopEvent(deps.prisma, {
      projectId: input.projectId,
      taskExecutionId: input.executionId,
      type: action.type === "retry" ? "execution.retry.scheduled" : "execution.escalation.scheduled",
      payload: {
        executionId: input.executionId,
        evalRunId: evalSummary.id,
        decision: evalSummary.decision,
        attempt: action.nextAttempt,
        slotKey: action.slotKey,
      },
    });

    try {
      await deps.retryExecutor({
        executionId: input.executionId,
        slotKey: action.slotKey,
        attempt: action.nextAttempt,
        reason: action.type === "retry" ? "retry" : "escalate",
      });
    } catch (error) {
      const message = errorMessage(error);
      errors.push({ phase: "evaluation", message });
      await appendLoopEvent(deps.prisma, {
        projectId: input.projectId,
        taskExecutionId: input.executionId,
        type: "execution.retry.failed",
        payload: {
          executionId: input.executionId,
          attempt: action.nextAttempt,
          slotKey: action.slotKey,
          message,
        },
      });
    }

    return {
      status: action.type === "retry" ? "retried" : "escalated",
      evalRunId: evalSummary.id,
      decision: evalSummary.decision,
      benchmarkRuns: [],
      langSmithAccepted: false,
      errors,
    };
  }

  const benchmarkRuns: BenchmarkRunSummary[] = [];

  if (deps.runBenchmarkScenario) {
    let scenarios: BenchmarkScenarioDefinition[] = [];

    try {
      scenarios = await listBenchmarkScenarioDefinitions(deps.prisma, {
        projectId: input.projectId,
        status: "active",
      });
    } catch (error) {
      errors.push({ phase: "benchmark", message: `scenarios.list: ${errorMessage(error)}` });
    }

    for (const scenario of scenarios) {
      try {
        const benchmarkRun = await deps.runBenchmarkScenario({
          executionId: input.executionId,
          scenario,
        });
        benchmarkRuns.push(benchmarkRun);
      } catch (error) {
        const message = errorMessage(error);
        errors.push({ phase: "benchmark", scenarioId: scenario.id, message });
        await appendLoopEvent(deps.prisma, {
          projectId: input.projectId,
          taskExecutionId: input.executionId,
          type: "benchmark.failed",
          payload: {
            executionId: input.executionId,
            scenarioId: scenario.id,
            scenarioName: scenario.name,
            message,
          },
        });
      }
    }
  }

  let langSmithAccepted = false;

  if (deps.exportLangSmith) {
    try {
      const result = await deps.exportLangSmith({
        executionId: input.executionId,
        projectId: input.projectId,
        evalRunId: evalSummary.id,
        benchmarkRunIds: benchmarkRuns.map((run) => run.evalRunId),
      });
      langSmithAccepted = result.accepted;
    } catch (error) {
      const message = errorMessage(error);
      errors.push({ phase: "langsmith", message });
      await appendLoopEvent(deps.prisma, {
        projectId: input.projectId,
        taskExecutionId: input.executionId,
        type: "langsmith.export.failed",
        payload: {
          executionId: input.executionId,
          evalRunId: evalSummary.id,
          message,
        },
      });
    }
  }

  await appendLoopEvent(deps.prisma, {
    projectId: input.projectId,
    taskExecutionId: input.executionId,
    type: "execution.evaluated",
    payload: {
      executionId: input.executionId,
      evalRunId: evalSummary.id,
      decision: evalSummary.decision,
      aggregateScore: evalSummary.aggregateScore,
      benchmarkRunIds: benchmarkRuns.map((run) => run.evalRunId),
      langSmithAccepted,
      hardFailDimensions: evalSummary.hardFailDimensions,
      errors: errors.map(({ phase, scenarioId, message }) => ({ phase, scenarioId, message })),
    },
  });

  return {
    status: "completed",
    evalRunId: evalSummary.id,
    decision: evalSummary.decision,
    benchmarkRuns,
    langSmithAccepted,
    errors,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
