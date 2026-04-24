import { createApp } from "./app";
import {
  approveVerificationPlan,
  createApprovalDecision,
  createMcpToolCall,
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
import { createEvaluatorService } from "@vimbuspromax3000/evaluator";
import type { PrismaClient } from "@vimbuspromax3000/db/client";
import type { JudgeGenerator } from "@vimbuspromax3000/evaluator";

const MOCK_LLM_SCORE = 82;
const mockGenerator: JudgeGenerator = async () => ({
  score: MOCK_LLM_SCORE,
  reason: "mock evaluation",
});

describe("Evaluation API", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-eval-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  });

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  function makeApp() {
    return createApp({
      prisma,
      evaluatorService: createEvaluatorService({ prisma, generator: mockGenerator }),
    });
  }

  async function seedProject() {
    const project = await createProject(prisma, {
      name: "Eval Test Project",
      rootPath: tempDir,
      baseBranch: "main",
    });
    const plannerRun = await createPlannerRun(prisma, {
      projectId: project.id,
      goal: "Test evaluation gate",
    });
    await persistPlannerProposal(prisma, {
      plannerRunId: plannerRun.id,
      summary: "Eval test proposal",
      epics: [
        {
          key: "EVAL-EPIC-1",
          title: "Evaluation",
          goal: "Add evaluation gate",
          tasks: [
            {
              stableId: "EVAL-TASK-1",
              title: "Implement evaluator",
              type: "backend",
              complexity: "medium",
              acceptance: [{ label: "evaluation runs" }],
              verificationPlan: {
                items: [
                  {
                    kind: "logic",
                    runner: "custom",
                    title: "eval test check",
                    description: "evaluation executes",
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

  async function seedExecution(taskId: string, branchName = "tg/eval-test-branch") {
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

  async function addTestRun(
    executionId: string,
    exitCode: number,
  ) {
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

  async function addAgentStep(executionId: string, status: "completed" | "failed") {
    return prisma.agentStep.create({
      data: {
        taskExecutionId: executionId,
        role: "executor",
        status,
        startedAt: new Date(),
      },
    });
  }

  describe("POST /executions/:id/evaluations", () => {
    test("returns 404 for non-existent execution", async () => {
      const api = makeApp();
      const res = await api.fetch(
        new Request("http://localhost/executions/nonexistent/evaluations", { method: "POST" }),
      );
      expect(res.status).toBe(404);
    });

    test("runs evaluation and returns all 8 dimension results (7 when no MCP calls)", async () => {
      const { task } = await seedProject();
      const { execution } = await seedExecution(task.id);
      await addTestRun(execution.id, 0);
      await addAgentStep(execution.id, "completed");

      const api = makeApp();
      const res = await api.fetch(
        new Request(`http://localhost/executions/${execution.id}/evaluations`, { method: "POST" }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      const { evalRun } = body;

      expect(evalRun.status).toBe("completed");
      expect(evalRun.verdict).toBeDefined();
      expect(typeof evalRun.aggregateScore).toBe("number");

      // No MCP calls → tool_usage_quality is not_applicable → 7 results
      expect(evalRun.results).toHaveLength(7);

      const dimensions = evalRun.results.map((r: { dimension: string }) => r.dimension);
      expect(dimensions).toContain("outcome_correctness");
      expect(dimensions).toContain("security_policy_compliance");
      expect(dimensions).toContain("execution_quality");
      expect(dimensions).toContain("verification_quality");
      expect(dimensions).toContain("planner_quality");
      expect(dimensions).toContain("task_decomposition");
      expect(dimensions).toContain("regression_risk");
      expect(dimensions).not.toContain("tool_usage_quality");
    });

    test("returns 8 results when MCP calls exist", async () => {
      const { project, task } = await seedProject();
      const { execution } = await seedExecution(task.id);
      await addTestRun(execution.id, 0);
      const tool = await prisma.mcpTool.findFirst({ where: { name: "read_file" } });
      await createMcpToolCall(prisma, {
        projectId: project.id,
        taskExecutionId: execution.id,
        toolId: tool?.id ?? null,
        serverName: "taskgoblin-fs-git",
        toolName: "read_file",
        status: "succeeded",
        mutability: "read",
        argumentsHash: "abc",
        argumentsJson: JSON.stringify({ path: "/tmp/file.ts" }),
      });

      const api = makeApp();
      const res = await api.fetch(
        new Request(`http://localhost/executions/${execution.id}/evaluations`, { method: "POST" }),
      );
      const body = await res.json();
      expect(body.evalRun.results).toHaveLength(8);
      expect(body.evalRun.results.map((r: { dimension: string }) => r.dimension)).toContain("tool_usage_quality");
    });

    test("outcome_correctness hybrid: all tests pass → rule score 100, combined score reflects weights", async () => {
      const { task } = await seedProject();
      const { execution } = await seedExecution(task.id);
      await addTestRun(execution.id, 0);
      await addTestRun(execution.id, 0);

      const api = makeApp();
      const res = await api.fetch(
        new Request(`http://localhost/executions/${execution.id}/evaluations`, { method: "POST" }),
      );
      const body = await res.json();
      const outcome = body.evalRun.results.find(
        (r: { dimension: string }) => r.dimension === "outcome_correctness",
      );
      expect(outcome.evaluatorType).toBe("hybrid");
      // rule: 100, llm: 82 → 0.6*100 + 0.4*82 = 92.8 → 93
      expect(outcome.score).toBe(93);
    });

    test("outcome_correctness: no test runs → rule score 0 → hard fail", async () => {
      const { task } = await seedProject();
      const { execution } = await seedExecution(task.id);
      // No test runs seeded

      const api = makeApp();
      const res = await api.fetch(
        new Request(`http://localhost/executions/${execution.id}/evaluations`, { method: "POST" }),
      );
      const body = await res.json();
      const outcome = body.evalRun.results.find(
        (r: { dimension: string }) => r.dimension === "outcome_correctness",
      );
      // rule: 0, llm: 82 → 0.6*0 + 0.4*82 = 32.8 → 33 → below 85 threshold → hard fail
      expect(outcome.score).toBe(33);
      expect(outcome.verdict).toBe("fail");
      expect(body.evalRun.verdict).toBe("fail");
    });

    test("security_policy_compliance: unapproved mutating call → score 0 → hard fail", async () => {
      const { project, task } = await seedProject();
      const { execution } = await seedExecution(task.id);
      await addTestRun(execution.id, 0);

      // Create mutating call without approvalId
      const tool = await prisma.mcpTool.findFirst({ where: { name: "apply_patch" } });
      await createMcpToolCall(prisma, {
        projectId: project.id,
        taskExecutionId: execution.id,
        toolId: tool?.id ?? null,
        serverName: "taskgoblin-fs-git",
        toolName: "apply_patch",
        status: "succeeded",
        mutability: "write",
        argumentsHash: "zzz",
        argumentsJson: JSON.stringify({ patch: "--- a\n+++ b" }),
      });

      const api = makeApp();
      const res = await api.fetch(
        new Request(`http://localhost/executions/${execution.id}/evaluations`, { method: "POST" }),
      );
      const body = await res.json();
      const sec = body.evalRun.results.find(
        (r: { dimension: string }) => r.dimension === "security_policy_compliance",
      );
      expect(sec.score).toBe(0);
      expect(sec.verdict).toBe("fail");
      expect(body.evalRun.verdict).toBe("fail");
    });

    test("execution_quality: failed agent step deducts from score", async () => {
      const { task } = await seedProject();
      const { execution } = await seedExecution(task.id);
      await addTestRun(execution.id, 0);
      await addAgentStep(execution.id, "failed");

      const api = makeApp();
      const res = await api.fetch(
        new Request(`http://localhost/executions/${execution.id}/evaluations`, { method: "POST" }),
      );
      const body = await res.json();
      const eq = body.evalRun.results.find(
        (r: { dimension: string }) => r.dimension === "execution_quality",
      );
      expect(eq.score).toBeLessThan(100);
      expect(eq.evaluatorType).toBe("rule_based");
    });

    test("LLM judge dimensions have correct evaluatorType and promptVersion", async () => {
      const { task } = await seedProject();
      const { execution } = await seedExecution(task.id);
      await addTestRun(execution.id, 0);

      const api = makeApp();
      const res = await api.fetch(
        new Request(`http://localhost/executions/${execution.id}/evaluations`, { method: "POST" }),
      );
      const body = await res.json();
      const llmDims = ["verification_quality", "planner_quality", "task_decomposition", "regression_risk"];
      for (const dim of llmDims) {
        const result = body.evalRun.results.find((r: { dimension: string }) => r.dimension === dim);
        expect(result).toBeDefined();
        expect(result.evaluatorType).toBe("llm_judge");
        expect(result.score).toBe(MOCK_LLM_SCORE);
        expect(result.promptVersion).toBe("v1");
      }
    });

    test("idempotency: same execution state returns existing completed run", async () => {
      const { task } = await seedProject();
      const { execution } = await seedExecution(task.id);
      await addTestRun(execution.id, 0);

      const api = makeApp();
      const res1 = await api.fetch(
        new Request(`http://localhost/executions/${execution.id}/evaluations`, { method: "POST" }),
      );
      const body1 = await res1.json();
      const evalRunId1 = body1.evalRun.id;

      const res2 = await api.fetch(
        new Request(`http://localhost/executions/${execution.id}/evaluations`, { method: "POST" }),
      );
      const body2 = await res2.json();

      expect(body2.evalRun.id).toBe(evalRunId1);
    });

    test("422 MODEL_SLOT_UNAVAILABLE when reviewer slot not configured", async () => {
      const { task } = await seedProject();
      const { execution } = await seedExecution(task.id);
      await addTestRun(execution.id, 0);

      // Use the default evaluator service (no mock generator, no model configured)
      const api = createApp({ prisma });
      const res = await api.fetch(
        new Request(`http://localhost/executions/${execution.id}/evaluations`, { method: "POST" }),
      );
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.code).toBe("MODEL_SLOT_UNAVAILABLE");
    });
  });

  describe("GET /executions/:id/evaluations", () => {
    test("returns 404 for non-existent execution", async () => {
      const api = makeApp();
      const res = await api.fetch(
        new Request("http://localhost/executions/nonexistent/evaluations"),
      );
      expect(res.status).toBe(404);
    });

    test("returns empty list before evaluation runs", async () => {
      const { task } = await seedProject();
      const { execution } = await seedExecution(task.id);

      const api = makeApp();
      const res = await api.fetch(
        new Request(`http://localhost/executions/${execution.id}/evaluations`),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.evalRuns).toHaveLength(0);
    });

    test("returns persisted eval runs with results after POST", async () => {
      const { task } = await seedProject();
      const { execution } = await seedExecution(task.id);
      await addTestRun(execution.id, 0);

      const api = makeApp();
      await api.fetch(
        new Request(`http://localhost/executions/${execution.id}/evaluations`, { method: "POST" }),
      );

      const res = await api.fetch(
        new Request(`http://localhost/executions/${execution.id}/evaluations`),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.evalRuns).toHaveLength(1);
      expect(body.evalRuns[0].status).toBe("completed");
      expect(body.evalRuns[0].results.length).toBeGreaterThan(0);
    });
  });
});
