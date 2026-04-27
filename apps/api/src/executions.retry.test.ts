/**
 * VIM-30 — `POST /executions/:id/retry` runtime contract.
 *
 * Drives a fixture execution through three failed verifications and asserts:
 *   - The first retry stays on `executor_default` and bumps `attempt` to 2.
 *   - The second retry escalates to `executor_strong` (`attempt` = 3) and
 *     emits `model.escalated`.
 *   - The third retry exhausts the budget, transitions the task + execution
 *     to `failed`, and emits `task.failed`.
 *   - The endpoint is idempotent: invoking it twice for the same attempt
 *     window returns the same `ModelDecision` row.
 *
 * Idempotency contract: the endpoint inspects the latest `ModelDecision`
 * for the execution. While that decision is still `state = "selected"`,
 * the route is a no-op (returns the same row). The caller (eval gate) is
 * expected to flip the state to `"stopped"` once verification fails so the
 * next POST can advance the attempt window. This mirrors the state machine
 * already encoded in `MODEL_DECISION_STATES` in @vimbuspromax3000/shared.
 */

import { createApp } from "./app";
import {
  approveVerificationPlan,
  createApprovalDecision,
  createPlannerRun,
  createProject,
  listLoopEvents,
  listTasks,
  persistPlannerProposal,
} from "@vimbuspromax3000/db";
import {
  createIsolatedPrisma,
  removeTempDir,
} from "@vimbuspromax3000/db/testing";
import { createMcpService } from "@vimbuspromax3000/mcp-client";
import { createEvaluatorService, type JudgeGenerator } from "@vimbuspromax3000/evaluator";
import { setupModelRegistry } from "@vimbuspromax3000/model-registry";
import type { PrismaClient } from "@vimbuspromax3000/db/client";

describe("POST /executions/:id/retry (VIM-30)", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-retry-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  });

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test("returns 404 for an unknown execution", async () => {
    const api = createApp({ prisma });
    const res = await api.fetch(
      new Request("http://localhost/executions/does-not-exist/retry", { method: "POST" }),
    );
    expect(res.status).toBe(404);
  });

  test(
    "drives the failed-verification escalation lifecycle and emits task.failed on the third miss",
    async () => {
      const env = { VIMBUS_TEST_KEY: "present" };
      const { project, task } = await seedReadyTaskWithMcp(prisma, tempDir);

      // Both the default and strong executor slots must resolve so the retry
      // route can drive escalation without a slot lookup failure.
      await setupModelRegistry(prisma, {
        projectId: project.id,
        providerKey: "openai",
        providerKind: "openai",
        providerStatus: "active",
        secretEnv: "VIMBUS_TEST_KEY",
        modelName: "GPT Default",
        modelSlug: "gpt-default",
        capabilities: ["tools"],
        slotKeys: ["executor_default"],
      });
      await setupModelRegistry(prisma, {
        projectId: project.id,
        providerKey: "openai-strong",
        providerKind: "openai",
        providerStatus: "active",
        secretEnv: "VIMBUS_TEST_KEY",
        modelName: "GPT Strong",
        modelSlug: "gpt-strong",
        capabilities: ["tools"],
        slotKeys: ["executor_strong"],
      });

      const api = createApp({ prisma, env });

      // Seed a branch + execution + an initial attempt-1 ModelDecision so the
      // retry endpoint sees prior history. This mirrors what the execution
      // service writes after the first model resolution succeeds.
      const branch = await prisma.taskBranch.create({
        data: {
          taskId: task.id,
          name: "tg/retry-test-branch",
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

      // Simulate a failed verification: flip the latest decision's state to
      // `stopped` so the next retry advances the attempt window.
      await markLatestDecisionStopped(prisma, execution.id);

      // --- First retry (verification fail #1 -> attempt 2 same slot) ---
      const retry1 = await api.fetch(
        new Request(`http://localhost/executions/${execution.id}/retry`, { method: "POST" }),
      );
      expect(retry1.status).toBe(200);
      const body1 = (await retry1.json()) as {
        decision: {
          id: string;
          attempt: number;
          selectedSlot: string;
          reason: string;
          selectedModel: string | null;
          state: string;
        };
        execution: { status: string; retryCount: number };
      };
      expect(body1.decision.attempt).toBe(2);
      expect(body1.decision.selectedSlot).toBe("executor_default");
      expect(body1.decision.reason).toBe("retry_same_slot");
      expect(body1.decision.selectedModel).toBe("openai:gpt-default");
      expect(body1.decision.state).toBe("selected");
      expect(body1.execution.status).toBe("implementing");
      expect(body1.execution.retryCount).toBe(1);

      // --- Idempotency: latest decision still in `selected` state ---
      // A duplicate POST while the prior attempt is still in flight returns
      // the existing decision without advancing the attempt counter or
      // creating a new ModelDecision row.
      const retry1Dup = await api.fetch(
        new Request(`http://localhost/executions/${execution.id}/retry`, { method: "POST" }),
      );
      expect(retry1Dup.status).toBe(200);
      const body1Dup = (await retry1Dup.json()) as { decision: { id: string; attempt: number } };
      expect(body1Dup.decision.id).toBe(body1.decision.id);
      expect(body1Dup.decision.attempt).toBe(2);

      const decisionsAfterDup = await prisma.modelDecision.findMany({
        where: { taskExecutionId: execution.id },
      });
      expect(decisionsAfterDup).toHaveLength(2);

      const executionAfterDup = await prisma.taskExecution.findUnique({
        where: { id: execution.id },
      });
      expect(executionAfterDup?.retryCount).toBe(1);

      // Second failure -> mark the attempt-2 decision as stopped and POST again.
      await markLatestDecisionStopped(prisma, execution.id);

      // --- Second retry (verification fail #2 -> escalate to strong) ---
      const retry2 = await api.fetch(
        new Request(`http://localhost/executions/${execution.id}/retry`, { method: "POST" }),
      );
      expect(retry2.status).toBe(200);
      const body2 = (await retry2.json()) as {
        decision: {
          attempt: number;
          selectedSlot: string;
          reason: string;
          selectedModel: string | null;
          state: string;
        };
        execution: { status: string; retryCount: number };
      };
      expect(body2.decision.attempt).toBe(3);
      expect(body2.decision.selectedSlot).toBe("executor_strong");
      expect(body2.decision.reason).toBe("escalate_to_strong");
      expect(body2.decision.selectedModel).toBe("openai-strong:gpt-strong");
      expect(body2.decision.state).toBe("escalated");
      expect(body2.execution.status).toBe("implementing");
      expect(body2.execution.retryCount).toBe(2);

      const events2 = await listLoopEvents(prisma, {
        projectId: project.id,
        taskExecutionId: execution.id,
        limit: 200,
      });
      const escalated = events2.find((event) => event.type === "model.escalated");
      expect(escalated).toBeTruthy();

      // Third failure -> mark the attempt-3 decision as stopped and POST again.
      await markLatestDecisionStopped(prisma, execution.id);

      // --- Third retry (verification fail #3 -> task.failed) ---
      const retry3 = await api.fetch(
        new Request(`http://localhost/executions/${execution.id}/retry`, { method: "POST" }),
      );
      expect(retry3.status).toBe(200);
      const body3 = (await retry3.json()) as {
        decision: { attempt: number; selectedSlot: string; reason: string; state: string };
        execution: { status: string };
        terminated: boolean;
      };
      expect(body3.terminated).toBe(true);
      expect(body3.decision.attempt).toBe(4);
      expect(body3.decision.reason).toBe("max_attempts_exceeded");
      expect(body3.decision.state).toBe("stopped");
      expect(body3.execution.status).toBe("failed");

      const events3 = await listLoopEvents(prisma, {
        projectId: project.id,
        taskExecutionId: execution.id,
        limit: 200,
      });
      const failedEvent = events3.find((event) => event.type === "task.failed");
      expect(failedEvent).toBeTruthy();

      const refreshedTask = await prisma.task.findUnique({ where: { id: task.id } });
      expect(refreshedTask?.status).toBe("failed");

      // Final ModelDecision invariants.
      const allDecisions = await prisma.modelDecision.findMany({
        where: { taskExecutionId: execution.id },
        orderBy: { attempt: "asc" },
      });
      expect(allDecisions.map((d) => d.attempt)).toEqual([1, 2, 3, 4]);
      expect(allDecisions.map((d) => d.selectedSlot)).toEqual([
        "executor_default",
        "executor_default",
        "executor_strong",
        "executor_strong",
      ]);
      expect(allDecisions[3]?.state).toBe("stopped");
    },
    60000,
  );

  test("422 when the executor slot is not configured", async () => {
    const env = { VIMBUS_TEST_KEY: "present" };
    const { project, task } = await seedReadyTaskWithMcp(prisma, tempDir);

    const branch = await prisma.taskBranch.create({
      data: {
        taskId: task.id,
        name: "tg/retry-no-slot",
        base: "main",
        state: "active",
        currentHead: "abc",
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

    // Seed an initial decision so the retry path advances to attempt 2 and
    // tries to resolve the executor_default slot (which is unassigned).
    await prisma.modelDecision.create({
      data: {
        projectId: project.id,
        taskExecutionId: execution.id,
        attempt: 1,
        complexityLabel: task.complexity,
        selectedSlot: "executor_default",
        selectedModel: null,
        reason: "initial",
        state: "stopped",
      },
    });

    const api = createApp({ prisma, env });

    const res = await api.fetch(
      new Request(`http://localhost/executions/${execution.id}/retry`, { method: "POST" }),
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("MODEL_SLOT_UNAVAILABLE");
  });
});

/**
 * VIM-44 — `runEvaluation` auto-flips the latest `ModelDecision` cursor
 * from `selected` → `stopped` whenever the persisted verdict is
 * `fail | retry | escalate`. The follow-up `POST /executions/:id/retry`
 * call should then advance the attempt window WITHOUT any manual
 * operator nudge — proving the M1 retry loop is fully automated.
 */
describe("runEvaluation → POST /executions/:id/retry (VIM-44 auto-flip)", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-retry-flip-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  });

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test(
    "verdict.fail flips cursor automatically; subsequent retry creates a second ModelDecision row without manual intervention",
    async () => {
      const env = { VIMBUS_TEST_KEY: "present" };
      const { project, task } = await seedReadyTaskWithMcp(prisma, tempDir);

      // Both executor slots resolve so the retry can advance.
      await setupModelRegistry(prisma, {
        projectId: project.id,
        providerKey: "openai",
        providerKind: "openai",
        providerStatus: "active",
        secretEnv: "VIMBUS_TEST_KEY",
        modelName: "GPT Default",
        modelSlug: "gpt-default",
        capabilities: ["tools"],
        slotKeys: ["executor_default"],
      });
      await setupModelRegistry(prisma, {
        projectId: project.id,
        providerKey: "openai-strong",
        providerKind: "openai",
        providerStatus: "active",
        secretEnv: "VIMBUS_TEST_KEY",
        modelName: "GPT Strong",
        modelSlug: "gpt-strong",
        capabilities: ["tools"],
        slotKeys: ["executor_strong"],
      });

      // Seed branch + execution + an initial attempt-1 ModelDecision in
      // `selected` state — exactly what `startTaskExecution` produces.
      const branch = await prisma.taskBranch.create({
        data: {
          taskId: task.id,
          name: "tg/retry-flip-branch",
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

      // Mock judge returns a low score so the eval verdict resolves to
      // `fail` (rule-based outcome_correctness hard-fails first since no
      // test runs are seeded). The point is to drive the persistence
      // path that includes the auto-flip.
      const failingGenerator: JudgeGenerator = async () => ({
        score: 5,
        reason: "mock fail for retry-flip contract",
      });
      const evaluatorService = createEvaluatorService({
        prisma,
        env,
        generator: failingGenerator,
      });

      const evalRun = await evaluatorService.runEvaluation(execution.id);
      expect(evalRun?.verdict).toBe("fail");

      // VIM-44: the evaluator already flipped the cursor — operator is NOT
      // expected to call markLatestDecisionStopped manually.
      const latestAfterEval = await prisma.modelDecision.findFirst({
        where: { taskExecutionId: execution.id },
        orderBy: { attempt: "desc" },
      });
      expect(latestAfterEval?.state).toBe("stopped");

      const api = createApp({ prisma, env });

      // POST /executions/:id/retry should succeed with no operator nudge —
      // it sees a `stopped` cursor and advances to attempt 2.
      const retry = await api.fetch(
        new Request(`http://localhost/executions/${execution.id}/retry`, { method: "POST" }),
      );
      expect(retry.status).toBe(200);
      const body = (await retry.json()) as {
        decision: { attempt: number; selectedSlot: string; state: string };
      };
      expect(body.decision.attempt).toBe(2);
      expect(body.decision.selectedSlot).toBe("executor_default");
      expect(body.decision.state).toBe("selected");

      // Two ModelDecision rows now exist: the original (now stopped) and
      // the new attempt-2 selection.
      const decisions = await prisma.modelDecision.findMany({
        where: { taskExecutionId: execution.id },
        orderBy: { attempt: "asc" },
      });
      expect(decisions).toHaveLength(2);
      expect(decisions[0]?.state).toBe("stopped");
      expect(decisions[1]?.state).toBe("selected");
    },
    60000,
  );
});

async function markLatestDecisionStopped(prisma: PrismaClient, executionId: string) {
  const latest = await prisma.modelDecision.findFirst({
    where: { taskExecutionId: executionId },
    orderBy: { attempt: "desc" },
  });
  if (!latest) throw new Error("Expected a decision to exist before marking stopped.");
  await prisma.modelDecision.update({
    where: { id: latest.id },
    data: { state: "stopped" },
  });
}

async function seedReadyTaskWithMcp(prisma: PrismaClient, rootPath: string) {
  const project = await createProject(prisma, {
    name: "Retry Test Project",
    rootPath,
    baseBranch: "main",
  });
  const plannerRun = await createPlannerRun(prisma, {
    projectId: project.id,
    goal: "Test retry policy",
  });

  await persistPlannerProposal(prisma, {
    plannerRunId: plannerRun.id,
    summary: "Retry test proposal",
    epics: [
      {
        key: "EPIC-RETRY-1",
        title: "Retry policy",
        goal: "Drive retry escalation",
        tasks: [
          {
            stableId: "TASK-RETRY-1",
            title: "retry happy path",
            type: "backend",
            complexity: "medium",
            acceptance: [{ label: "retry escalates" }],
            verificationPlan: {
              items: [
                {
                  kind: "logic",
                  runner: "custom",
                  title: "retry verification",
                  description: "verifies the retry path",
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

  return { project, task };
}
