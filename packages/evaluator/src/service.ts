import { generateObject } from "ai";
import type { PrismaClient } from "@vimbuspromax3000/db/client";
import {
  appendLoopEvent,
  createEvalResult,
  createEvalRun,
  getEvalRunDetail,
  getLatestCompletedEvalRun,
  getTaskExecutionDetail,
  listEvalRuns,
  listMcpToolCallsForExecution,
  updateEvalRun,
} from "@vimbuspromax3000/db";
import { resolveModelSlot } from "@vimbuspromax3000/policy-engine";
import { createAiSdkLanguageModel, toRuntimeProviderConfig } from "@vimbuspromax3000/agent";
import type { EvalContext, JudgeGenerator } from "./types";
import { DIMENSION_THRESHOLDS, AGGREGATE_PROCEED_THRESHOLD } from "./thresholds";
import { computeAggregate, dimensionVerdict } from "./verdict";
import { hashEvalInputs } from "./hash";
import { judgeOutputSchema } from "./llm-judges/shared";
import { evaluateSecurityPolicyCompliance } from "./rule-based/security-policy-compliance";
import { evaluateExecutionQuality } from "./rule-based/execution-quality";
import { evaluateOutcomeCorrectness } from "./hybrid/outcome-correctness";
import { evaluateToolUsageQuality } from "./hybrid/tool-usage-quality";
import { evaluateVerificationQuality } from "./llm-judges/verification-quality";
import { evaluatePlannerQuality } from "./llm-judges/planner-quality";
import { evaluateTaskDecomposition } from "./llm-judges/task-decomposition";
import { evaluateRegressionRisk } from "./llm-judges/regression-risk";

export class EvaluatorError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "EvaluatorError";
  }
}

export type EvaluatorServiceOptions = {
  prisma: PrismaClient;
  env?: Record<string, string | undefined>;
  generator?: JudgeGenerator;
};

export function createEvaluatorService(options: EvaluatorServiceOptions) {
  const { prisma, env = process.env } = options;
  const generator: JudgeGenerator = options.generator ?? defaultJudgeGenerator;

  return {
    async runEvaluation(executionId: string) {
      const execution = await getTaskExecutionDetail(prisma, executionId);
      if (!execution) {
        throw new EvaluatorError(`Execution ${executionId} not found.`, "EXECUTION_NOT_FOUND");
      }

      const mcpCalls = await listMcpToolCallsForExecution(prisma, executionId);
      const projectId = execution.task.epic.project.id;

      // Build EvalContext
      const epicTasks = await prisma.task.findMany({
        where: { epicId: execution.task.epicId },
        orderBy: [{ orderIndex: "asc" }],
      });

      const context: EvalContext = {
        projectId,
        execution: {
          id: execution.id,
          status: execution.status,
          retryCount: execution.retryCount,
          startedAt: execution.startedAt,
          testRuns: execution.testRuns.map((r) => ({
            id: r.id,
            command: r.command,
            status: r.status,
            exitCode: r.exitCode,
          })),
          agentSteps: execution.agentSteps.map((s) => ({
            id: s.id,
            role: s.role,
            status: s.status,
            modelName: s.modelName,
          })),
          patchReviews: execution.patchReviews.map((p) => ({
            id: p.id,
            status: p.status,
            summary: p.summary,
            diffPath: p.diffPath,
          })),
          latestVerificationPlan: execution.latestVerificationPlan
            ? {
                id: execution.latestVerificationPlan.id,
                status: execution.latestVerificationPlan.status,
                approvedAt: execution.latestVerificationPlan.approvedAt ?? null,
                items: execution.latestVerificationPlan.items.map((i) => ({
                  id: i.id,
                  kind: i.kind,
                  runner: i.runner,
                  title: i.title,
                  description: i.description,
                  command: i.command,
                  status: i.status,
                })),
              }
            : null,
          branch: {
            name: execution.branch.name,
            base: execution.branch.base,
          },
          task: {
            id: execution.task.id,
            title: execution.task.title,
            type: execution.task.type,
            complexity: execution.task.complexity,
            acceptanceJson: execution.task.acceptanceJson,
            targetFilesJson: execution.task.targetFilesJson,
            epic: {
              id: execution.task.epic.id,
              goal: execution.task.epic.goal,
              acceptanceJson: execution.task.epic.acceptanceJson,
              risksJson: execution.task.epic.risksJson,
              tasks: epicTasks.map((t) => ({
                id: t.id,
                stableId: t.stableId,
                title: t.title,
                type: t.type,
                complexity: t.complexity,
                acceptanceJson: t.acceptanceJson,
                orderIndex: t.orderIndex,
                requiresJson: t.requiresJson,
              })),
              plannerRun: {
                id: execution.task.epic.plannerRun?.id ?? "",
                goal: execution.task.epic.plannerRun?.goal ?? "",
                interviewJson: execution.task.epic.plannerRun?.interviewJson ?? null,
              },
              project: {
                name: execution.task.epic.project.name,
                baseBranch: execution.task.epic.project.baseBranch,
              },
            },
          },
        },
        mcpCalls: mcpCalls.map((c) => ({
          id: c.id,
          serverName: c.serverName,
          toolName: c.toolName,
          mutability: c.mutability,
          status: c.status,
          approvalId: c.approvalId,
          argumentsHash: c.argumentsHash,
          latencyMs: c.latencyMs,
        })),
      };

      // Idempotency: return existing completed run if inputs haven't changed
      const inputHash = hashEvalInputs(context);
      const existing = await getLatestCompletedEvalRun(prisma, executionId, inputHash);
      if (existing) {
        return existing;
      }

      // Resolve reviewer model — skipped when a custom generator is injected (tests)
      let model: unknown;
      let modelName: string;

      if (options.generator !== undefined) {
        model = null;
        modelName = "mock";
      } else {
        const resolution = await resolveModelSlot(
          prisma,
          { projectId, slotKey: "reviewer", requiredCapabilities: ["json"] },
          env,
        );

        if (!resolution.ok) {
          throw new EvaluatorError(
            `Cannot run evaluation: reviewer model slot is unavailable (${resolution.code}: ${resolution.message})`,
            "MODEL_SLOT_UNAVAILABLE",
          );
        }

        const snapshot = resolution.value;
        model = await loadReviewerModel(prisma, snapshot, env);
        modelName = snapshot.concreteModelName;
      }

      // Create EvalRun
      const evalRun = await createEvalRun(prisma, {
        projectId,
        taskExecutionId: executionId,
        status: "running",
        inputHash,
      });

      try {
        // Run rule-based evaluators
        const securityResult = evaluateSecurityPolicyCompliance(context);
        const executionResult = evaluateExecutionQuality(context);

        // Run hybrid and LLM judges in parallel
        const [outcomeResult, toolUsageResult, verificationResult, plannerResult, decompositionResult, regressionResult] =
          await Promise.all([
            evaluateOutcomeCorrectness(context, model, generator, modelName),
            evaluateToolUsageQuality(context, model, generator, modelName),
            evaluateVerificationQuality(context, model, generator, modelName),
            evaluatePlannerQuality(context, model, generator, modelName),
            evaluateTaskDecomposition(context, model, generator, modelName),
            evaluateRegressionRisk(context, model, generator, modelName),
          ]);

        // Persist all results
        const allResults = [
          outcomeResult,
          securityResult,
          executionResult,
          verificationResult,
          plannerResult,
          decompositionResult,
          regressionResult,
        ];

        // tool_usage_quality may be null (not_applicable when no MCP calls)
        if (toolUsageResult !== null) {
          allResults.push(toolUsageResult);
        }

        for (const result of allResults) {
          await createEvalResult(prisma, {
            evalRunId: evalRun.id,
            dimension: result.dimension,
            score: result.score,
            threshold: result.threshold,
            verdict: result.verdict,
            evaluatorType: result.evaluatorType,
            modelName: result.modelName ?? null,
            promptVersion: result.promptVersion ?? null,
            reasoning: result.reasoning,
            evidenceJson: result.evidenceJson ?? null,
          });
        }

        // Compute aggregate
        const { aggregateScore, decision } = computeAggregate(allResults);

        await updateEvalRun(prisma, evalRun.id, {
          status: "completed",
          aggregateScore,
          threshold: AGGREGATE_PROCEED_THRESHOLD,
          verdict: decision,
          finishedAt: new Date(),
        });

        await appendLoopEvent(prisma, {
          projectId,
          type: "evaluation.finished",
          payload: {
            evalRunId: evalRun.id,
            verdict: decision,
            aggregateScore,
            hardFailDimensions: allResults
              .filter((r) => r.verdict === "fail" && isHardFail(r.dimension))
              .map((r) => r.dimension),
          },
        });
      } catch (error) {
        await updateEvalRun(prisma, evalRun.id, {
          status: "failed",
          finishedAt: new Date(),
        });
        throw error;
      }

      return getEvalRunDetail(prisma, evalRun.id);
    },

    async listEvalRuns(executionId: string) {
      return listEvalRuns(prisma, executionId);
    },
  };
}

export type EvaluatorService = ReturnType<typeof createEvaluatorService>;

async function loadReviewerModel(
  prisma: PrismaClient,
  snapshot: {
    modelId: string;
    modelSlug: string;
    providerKey: string;
    providerKind: string;
    concreteModelName: string;
    slotKey: string;
  },
  env: Record<string, string | undefined>,
) {
  const model = await prisma.registeredModel.findUnique({
    where: { id: snapshot.modelId },
    include: { provider: { include: { secretRef: true } } },
  });

  if (!model) {
    throw new EvaluatorError(`Registered model ${snapshot.modelId} not found.`, "MODEL_NOT_FOUND");
  }

  return createAiSdkLanguageModel(
    toRuntimeProviderConfig(
      {
        slotKey: snapshot.slotKey as any,
        providerId: model.provider.id,
        providerKey: model.provider.key,
        providerKind: model.provider.providerKind as any,
        modelId: model.id,
        modelName: model.name,
        modelSlug: model.slug,
        concreteModelName: snapshot.concreteModelName,
        usedFallback: false,
        requiredCapabilities: ["json"],
      },
      {
        baseUrl: model.provider.baseUrl,
        apiKey: model.provider.secretRef ? env[model.provider.secretRef.reference] : undefined,
      },
    ),
  );
}

async function defaultJudgeGenerator(input: {
  model: unknown;
  system: string;
  prompt: string;
}): Promise<{ score: number; reason: string }> {
  const result = await generateObject({
    model: input.model as any,
    schema: judgeOutputSchema,
    schemaName: "eval_result",
    schemaDescription: "Evaluation result with a 0-100 score and reasoning.",
    system: input.system,
    prompt: input.prompt,
    temperature: 0,
    seed: 42,
    maxRetries: 0,
  });

  return { score: result.object.score, reason: result.object.reason };
}

function isHardFail(dimension: string): boolean {
  return ["outcome_correctness", "security_policy_compliance", "verification_quality"].includes(dimension);
}
