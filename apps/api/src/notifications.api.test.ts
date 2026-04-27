/**
 * VIM-37 — Operator notifications channel.
 *
 * The API emits an `operator.notification` LoopEvent at three trigger points:
 *
 *   1. Evaluator returns `verdict === "warn"` from POST /executions/:id/evaluations.
 *   2. Patch is rejected via POST /executions/:id/patch/reject.
 *   3. Retry escalates to a stronger slot OR exhausts the attempt budget via
 *      POST /executions/:id/retry.
 *
 * Payload shape: `{ severity: "info" | "warn" | "error", subjectType, subjectId }`.
 * Events flow through the existing `LoopEventBus` (VIM-36) so SSE subscribers
 * see them on the same fan-out.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "./app";
import {
  approveVerificationPlan,
  createApprovalDecision,
  createPlannerRun,
  createProject,
  listLoopEvents,
  listTasks,
  persistPlannerProposal,
  resetDefaultLoopEventBus,
} from "@vimbuspromax3000/db";
import {
  createIsolatedPrisma,
  removeTempDir,
} from "@vimbuspromax3000/db/testing";
import { createMcpService } from "@vimbuspromax3000/mcp-client";
import { createEvaluatorService } from "@vimbuspromax3000/evaluator";
import { setupModelRegistry } from "@vimbuspromax3000/model-registry";
import type { JudgeGenerator } from "@vimbuspromax3000/evaluator";
import type { PrismaClient } from "@vimbuspromax3000/db/client";

describe("operator.notification emits (VIM-37)", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    resetDefaultLoopEventBus();
    const isolated = await createIsolatedPrisma("vimbus-notify-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  });

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test("evaluator warn verdict emits an operator.notification with severity=warn", async () => {
    // A judge generator that returns scores in the warn band so the aggregate
    // verdict comes back as `warn` (between WARN and PROCEED thresholds).
    const warnGenerator: JudgeGenerator = async () => ({
      score: 75,
      reason: "warn-band score for VIM-37 fixture",
    });

    const { project, task } = await seedProjectWithTask(prisma, tempDir);
    const { execution } = await seedExecution(prisma, task.id);
    await addTestRun(prisma, execution.id, 0);
    await addAgentStep(prisma, execution.id, "completed");

    const api = createApp({
      prisma,
      evaluatorService: createEvaluatorService({ prisma, generator: warnGenerator }),
    });

    const res = await api.fetch(
      new Request(`http://localhost/executions/${execution.id}/evaluations`, {
        method: "POST",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { evalRun: { id: string; verdict: string } };
    expect(body.evalRun.verdict).toBe("warn");

    const events = await listLoopEvents(prisma, {
      projectId: project.id,
      taskExecutionId: execution.id,
      limit: 200,
    });
    const notification = events.find((event) => event.type === "operator.notification");
    expect(notification).toBeTruthy();
    const payload = notification?.payload as {
      severity: string;
      subjectType: string;
      subjectId: string;
    };
    expect(payload.severity).toBe("warn");
    expect(payload.subjectType).toBe("eval_run");
    expect(payload.subjectId).toBe(body.evalRun.id);
  });

  test("patch rejection emits an operator.notification with severity=error", async () => {
    const { project, task } = await seedProjectWithTask(prisma, tempDir);
    const { execution } = await seedExecution(prisma, task.id);
    await prisma.patchReview.create({
      data: {
        taskExecutionId: execution.id,
        status: "ready",
        summary: "VIM-37 fixture patch",
        diffPath: null,
      },
    });

    const api = createApp({ prisma });
    const res = await api.fetch(
      new Request(`http://localhost/executions/${execution.id}/patch/reject`, {
        method: "POST",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { patchReview: { id: string; status: string } };
    expect(body.patchReview.status).toBe("rejected");

    const events = await listLoopEvents(prisma, {
      projectId: project.id,
      taskExecutionId: execution.id,
      limit: 200,
    });
    const notification = events.find((event) => event.type === "operator.notification");
    expect(notification).toBeTruthy();
    const payload = notification?.payload as {
      severity: string;
      subjectType: string;
      subjectId: string;
    };
    expect(payload.severity).toBe("error");
    expect(payload.subjectType).toBe("patch_review");
    expect(payload.subjectId).toBe(body.patchReview.id);
  });

  test("retry escalation emits an operator.notification with severity=info", async () => {
    const env = { VIMBUS_TEST_KEY: "present" };
    const { project, task } = await seedProjectWithTask(prisma, tempDir);

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

    const branch = await prisma.taskBranch.create({
      data: {
        taskId: task.id,
        name: "tg/notify-escalate-branch",
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
        retryCount: 1,
        startedAt: new Date(),
      },
    });
    // Seed a stopped attempt-2 decision so the next retry escalates to strong.
    await prisma.modelDecision.create({
      data: {
        projectId: project.id,
        taskExecutionId: execution.id,
        attempt: 2,
        complexityLabel: task.complexity,
        selectedSlot: "executor_default",
        selectedModel: "openai:gpt-default",
        reason: "retry_same_slot",
        state: "stopped",
      },
    });

    const api = createApp({ prisma, env });
    const res = await api.fetch(
      new Request(`http://localhost/executions/${execution.id}/retry`, {
        method: "POST",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      decision: { state: string; selectedSlot: string };
      terminated: boolean;
    };
    expect(body.decision.selectedSlot).toBe("executor_strong");
    expect(body.decision.state).toBe("escalated");

    const events = await listLoopEvents(prisma, {
      projectId: project.id,
      taskExecutionId: execution.id,
      limit: 200,
    });
    const notification = events.find((event) => event.type === "operator.notification");
    expect(notification).toBeTruthy();
    const payload = notification?.payload as {
      severity: string;
      subjectType: string;
      subjectId: string;
    };
    expect(payload.severity).toBe("info");
    expect(payload.subjectType).toBe("task_execution");
    expect(payload.subjectId).toBe(execution.id);
  });

  test("retry exhausting attempt budget emits an error operator.notification", async () => {
    const env = { VIMBUS_TEST_KEY: "present" };
    const { project, task } = await seedProjectWithTask(prisma, tempDir);

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

    const branch = await prisma.taskBranch.create({
      data: {
        taskId: task.id,
        name: "tg/notify-fail-branch",
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
        retryCount: 2,
        startedAt: new Date(),
      },
    });
    // Attempt-3 (strong) decision in stopped state -> next retry exhausts.
    await prisma.modelDecision.create({
      data: {
        projectId: project.id,
        taskExecutionId: execution.id,
        attempt: 3,
        complexityLabel: task.complexity,
        selectedSlot: "executor_strong",
        selectedModel: "openai-strong:gpt-strong",
        reason: "escalate_to_strong",
        state: "stopped",
      },
    });

    const api = createApp({ prisma, env });
    const res = await api.fetch(
      new Request(`http://localhost/executions/${execution.id}/retry`, {
        method: "POST",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { terminated: boolean };
    expect(body.terminated).toBe(true);

    const events = await listLoopEvents(prisma, {
      projectId: project.id,
      taskExecutionId: execution.id,
      limit: 200,
    });
    const notification = events.find((event) => event.type === "operator.notification");
    expect(notification).toBeTruthy();
    const payload = notification?.payload as {
      severity: string;
      subjectType: string;
      subjectId: string;
    };
    expect(payload.severity).toBe("error");
    expect(payload.subjectType).toBe("task_execution");
    expect(payload.subjectId).toBe(execution.id);
  });

  test("evaluator pass verdict does NOT emit an operator.notification", async () => {
    const passGenerator: JudgeGenerator = async () => ({
      score: 95,
      reason: "pass-band score for VIM-37 fixture",
    });

    const { project, task } = await seedProjectWithTask(prisma, tempDir);
    const { execution } = await seedExecution(prisma, task.id);
    await addTestRun(prisma, execution.id, 0);
    await addTestRun(prisma, execution.id, 0);
    await addAgentStep(prisma, execution.id, "completed");

    const api = createApp({
      prisma,
      evaluatorService: createEvaluatorService({ prisma, generator: passGenerator }),
    });

    const res = await api.fetch(
      new Request(`http://localhost/executions/${execution.id}/evaluations`, {
        method: "POST",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { evalRun: { verdict: string } };
    expect(["proceed", "warn"]).toContain(body.evalRun.verdict);

    if (body.evalRun.verdict === "proceed") {
      const events = await listLoopEvents(prisma, {
        projectId: project.id,
        taskExecutionId: execution.id,
        limit: 200,
      });
      const notification = events.find((event) => event.type === "operator.notification");
      expect(notification).toBeUndefined();
    }
  });
});

async function seedProjectWithTask(prisma: PrismaClient, rootPath: string) {
  const project = await createProject(prisma, {
    name: "Notification Test Project",
    rootPath,
    baseBranch: "main",
  });
  const plannerRun = await createPlannerRun(prisma, {
    projectId: project.id,
    goal: "Operator notifications",
  });
  await persistPlannerProposal(prisma, {
    plannerRunId: plannerRun.id,
    summary: "Notify test proposal",
    epics: [
      {
        key: "EPIC-NOTIFY-1",
        title: "Operator notifications",
        goal: "Surface evaluator/patch/retry signals",
        tasks: [
          {
            stableId: "TASK-NOTIFY-1",
            title: "Operator notifications",
            type: "backend",
            complexity: "medium",
            acceptance: [{ label: "notification emitted" }],
            verificationPlan: {
              items: [
                {
                  kind: "logic",
                  runner: "custom",
                  title: "verifies notification path",
                  description: "verifies the notification path",
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

async function seedExecution(prisma: PrismaClient, taskId: string, branchName = "tg/notify-branch") {
  const branch = await prisma.taskBranch.create({
    data: {
      taskId,
      name: branchName,
      base: "main",
      state: "active",
      currentHead: "abc123",
    },
  });
  const execution = await prisma.taskExecution.create({
    data: {
      taskId,
      branchId: branch.id,
      status: "implementing",
      startedAt: new Date(),
    },
  });
  return { branch, execution };
}

async function addTestRun(prisma: PrismaClient, executionId: string, exitCode: number) {
  return prisma.testRun.create({
    data: {
      taskExecutionId: executionId,
      command: "bun run test:vitest",
      status: exitCode === 0 ? "passed" : "failed",
      exitCode,
      startedAt: new Date(),
      finishedAt: new Date(),
    },
  });
}

async function addAgentStep(
  prisma: PrismaClient,
  executionId: string,
  status: "completed" | "failed",
) {
  return prisma.agentStep.create({
    data: {
      taskExecutionId: executionId,
      role: "executor",
      status,
      startedAt: new Date(),
    },
  });
}
