/**
 * VIM-44 — Evaluator runEvaluation auto-flips ModelDecision.state on
 * failing verdicts.
 *
 * Contract:
 *   - When runEvaluation persists a verdict of `fail | retry | escalate`,
 *     it also flips the latest ModelDecision.state for the execution from
 *     `selected` → `stopped`, in the same Prisma `$transaction` as the
 *     verdict row update.
 *   - Pass / proceed verdicts leave the cursor at `selected`.
 *   - Idempotent: re-running runEvaluation when the latest decision is
 *     already `stopped` is a no-op (no extra rows, no error).
 */

import {
  approveVerificationPlan,
  createApprovalDecision,
  createPlannerRun,
  createProject,
  listTasks,
  persistPlannerProposal,
} from "@vimbuspromax3000/db";
import {
  createIsolatedPrisma,
  removeTempDir,
} from "@vimbuspromax3000/db/testing";
import { createMcpService } from "@vimbuspromax3000/mcp-client";
import type { PrismaClient } from "@vimbuspromax3000/db/client";
import { createEvaluatorService } from "./service";
import type { JudgeGenerator } from "./types";

// Score that produces a clean `proceed` aggregate verdict. The proceed
// threshold is 80; 95 keeps every dimension well above that.
const PASSING_LLM_SCORE = 95;

// Score that drops below every dimension threshold. With no test runs and
// no agent steps the rule-based dimensions also fail, so the aggregate
// verdict resolves to `fail` (hard-fail on outcome_correctness +
// security_policy_compliance).
const FAILING_LLM_SCORE = 5;

const passingGenerator: JudgeGenerator = async () => ({
  score: PASSING_LLM_SCORE,
  reason: "mock pass",
});

const failingGenerator: JudgeGenerator = async () => ({
  score: FAILING_LLM_SCORE,
  reason: "mock fail",
});

describe("runEvaluation — VIM-44 auto-flip ModelDecision cursor", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-eval-flip-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  });

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test("failing verdict flips latest ModelDecision selected → stopped", async () => {
    const { project, execution } = await seedExecutionWithSelectedDecision(prisma, tempDir);
    const evaluator = createEvaluatorService({ prisma, generator: failingGenerator });

    const evalRun = await evaluator.runEvaluation(execution.id);
    const verdict = evalRun?.verdict;
    expect(verdict === "fail" || verdict === "retry" || verdict === "escalate").toBe(true);

    const decisions = await prisma.modelDecision.findMany({
      where: { taskExecutionId: execution.id },
      orderBy: { attempt: "asc" },
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.state).toBe("stopped");
    expect(decisions[0]?.projectId).toBe(project.id);
  });

  test("passing verdict leaves the cursor at selected", async () => {
    const { execution } = await seedExecutionWithSelectedDecision(prisma, tempDir, {
      withTestRunPass: true,
    });
    const evaluator = createEvaluatorService({ prisma, generator: passingGenerator });

    const evalRun = await evaluator.runEvaluation(execution.id);
    expect(evalRun?.verdict).toBe("proceed");

    const decisions = await prisma.modelDecision.findMany({
      where: { taskExecutionId: execution.id },
      orderBy: { attempt: "asc" },
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.state).toBe("selected");
  });

  test("idempotent: re-running after state already stopped is a no-op", async () => {
    const { execution } = await seedExecutionWithSelectedDecision(prisma, tempDir);
    const evaluator = createEvaluatorService({ prisma, generator: failingGenerator });

    // First run: flips selected → stopped, persists fail verdict.
    await evaluator.runEvaluation(execution.id);

    const decisionsAfterFirst = await prisma.modelDecision.findMany({
      where: { taskExecutionId: execution.id },
    });
    expect(decisionsAfterFirst).toHaveLength(1);
    expect(decisionsAfterFirst[0]?.state).toBe("stopped");

    // Second run: idempotent — same inputs, no extra ModelDecision rows,
    // no error, state stays stopped. The evaluator itself short-circuits
    // via getLatestCompletedEvalRun, but even if a re-run happened the
    // updateMany guard keeps it a no-op.
    await evaluator.runEvaluation(execution.id);

    const decisionsAfterSecond = await prisma.modelDecision.findMany({
      where: { taskExecutionId: execution.id },
    });
    expect(decisionsAfterSecond).toHaveLength(1);
    expect(decisionsAfterSecond[0]?.state).toBe("stopped");
  });
});

async function seedExecutionWithSelectedDecision(
  prisma: PrismaClient,
  tempDir: string,
  options: { withTestRunPass?: boolean } = {},
) {
  const project = await createProject(prisma, {
    name: "Eval Flip Test Project",
    rootPath: tempDir,
    baseBranch: "main",
  });
  const plannerRun = await createPlannerRun(prisma, {
    projectId: project.id,
    goal: "Eval flip test",
  });
  await persistPlannerProposal(prisma, {
    plannerRunId: plannerRun.id,
    summary: "Eval flip test proposal",
    epics: [
      {
        key: "EVAL-FLIP-1",
        title: "Eval flip",
        goal: "auto-flip cursor on fail",
        tasks: [
          {
            stableId: "EVAL-FLIP-TASK-1",
            title: "auto-flip cursor",
            type: "backend",
            complexity: "medium",
            acceptance: [{ label: "evaluator flips cursor" }],
            verificationPlan: {
              items: [
                {
                  kind: "logic",
                  runner: "custom",
                  title: "flip check",
                  description: "verifies the cursor flip",
                  command: "echo ok",
                },
              ],
            },
          },
        ],
      },
    ],
  });
  await createApprovalDecision(prisma, {
    projectId: project.id,
    subjectType: "planner_run",
    subjectId: plannerRun.id,
    stage: "planner_review",
    status: "granted",
  });
  const tasks = await listTasks(prisma, { projectId: project.id });
  const task = tasks[0];
  if (!task) throw new Error("Expected task to exist.");
  await approveVerificationPlan(prisma, { taskId: task.id });

  const mcpService = createMcpService({ prisma });
  await mcpService.ensureProjectMcpSetup(project.id);

  const branch = await prisma.taskBranch.create({
    data: {
      taskId: task.id,
      name: "tg/eval-flip-branch",
      base: "main",
      state: "active",
      currentHead: "abc123",
    },
  });
  const execution = await prisma.taskExecution.create({
    data: {
      taskId: task.id,
      branchId: branch.id,
      status: "implementing",
      retryCount: 0,
      startedAt: new Date(),
    },
  });

  // Seed an attempt-1 ModelDecision in `selected` state — the cursor the
  // evaluator should flip to `stopped` on a failing verdict.
  await prisma.modelDecision.create({
    data: {
      projectId: project.id,
      taskExecutionId: execution.id,
      attempt: 1,
      complexityLabel: task.complexity,
      selectedSlot: "executor_default",
      selectedModel: "openai:gpt-default",
      reason: "initial",
      state: "selected",
    },
  });

  if (options.withTestRunPass) {
    await prisma.testRun.create({
      data: {
        taskExecutionId: execution.id,
        command: "bun run test:vitest",
        status: "passed",
        exitCode: 0,
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    });
    await prisma.agentStep.create({
      data: {
        taskExecutionId: execution.id,
        role: "executor",
        status: "completed",
        startedAt: new Date(),
      },
    });
  }

  return { project, task, execution };
}
