/**
 * VIM-29 Sprint 2 — end-to-end smoke for the agent execution loop.
 *
 * Drives a fixture task through `POST /tasks/:id/execute` with the Vercel AI
 * SDK adapter wired against `MockLanguageModelV3`. Asserts that:
 *   - the loop persists at least one `AgentStep` row,
 *   - it persists at least one `mcpToolCall`,
 *   - the loop terminates with stop reason `finalize`,
 *   - the API responds 201 with a sane execution body.
 */

import { createApp } from "./app";
import {
  approveVerificationPlan,
  createApprovalDecision,
  createPlannerRun,
  createProject,
  listLoopEvents,
  listMcpToolCallsForExecution,
  listTasks,
  persistPlannerProposal,
} from "@vimbuspromax3000/db";
import {
  createIsolatedPrisma,
  initializeGitRepository,
  removeTempDir,
} from "@vimbuspromax3000/db/testing";
import { setupModelRegistry } from "@vimbuspromax3000/model-registry";
import { createVercelAiSdkAgentGeneratorFactory } from "@vimbuspromax3000/agent";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3GenerateResult } from "@ai-sdk/provider";
import type { PrismaClient } from "@vimbuspromax3000/db/client";

describe("POST /tasks/:id/execute (agent loop smoke)", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-execute-smoke-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
    initializeGitRepository(tempDir, {
      baseBranch: "main",
      initialFiles: {
        "README.md": "# smoke\n",
        "notes.txt": "smoke contents\n",
      },
    });
  }, 60000);

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test(
    "drives the AI SDK loop end-to-end and persists agent steps + tool calls",
    async () => {
      const env = { VIMBUS_TEST_KEY: "present" };
      const { project, task } = await seedReadyTaskWithMcp(prisma, tempDir);
      await setupModelRegistry(prisma, {
        projectId: project.id,
        providerKey: "openai",
        providerKind: "openai",
        providerStatus: "active",
        secretEnv: "VIMBUS_TEST_KEY",
        modelName: "GPT Smoke",
        modelSlug: "gpt-smoke",
        capabilities: ["tools"],
        slotKeys: ["executor_default"],
      });

      const languageModel = createScriptedLanguageModel([
        // Turn 1: model asks the executor to read a file.
        toolCallResult({
          toolCallId: "call-read-1",
          // Tool key encoding mirrors `vercelAiSdk.ts`: server__tool.
          toolName: "taskgoblin-fs-git__read_file",
          input: { path: "notes.txt" },
        }),
        // Turn 2: model responds with text only -> finalize.
        textResult("All done."),
      ]);

      const agentGeneratorFactory = createVercelAiSdkAgentGeneratorFactory({
        prisma,
        env,
        languageModel,
      });

      const api = createApp({
        prisma,
        env,
        agentGeneratorFactory,
        agentLoopMaxTurns: 5,
      });

      const response = await api.fetch(
        new Request(`http://localhost/tasks/${task.id}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }),
      );

      if (response.status !== 201) {
        // Surface the API error so failures are easy to diagnose.
        const errorBody = await response.text();
        throw new Error(`Expected 201 but got ${response.status}: ${errorBody}`);
      }
      const body = (await response.json()) as Record<string, unknown> & {
        id: string;
        status: string;
        latestAgentStep?: { status: string } | null;
      };
      expect(typeof body.id).toBe("string");
      expect(body.status).toBe("implementing");
      expect(body.latestAgentStep).toBeTruthy();

      // At least one AgentStep row beyond the initial "started" stub: the
      // Sprint 1 service writes one before the loop, then the loop writes one
      // per turn. We expect 2 turns -> >= 3 total steps.
      const steps = await prisma.agentStep.findMany({
        where: { taskExecutionId: body.id },
        orderBy: { createdAt: "asc" },
      });
      expect(steps.length).toBeGreaterThanOrEqual(2);
      const completedSteps = steps.filter((step) => step.status === "completed");
      expect(completedSteps.length).toBeGreaterThanOrEqual(1);

      // At least one mcpToolCall row from the loop's tool_call turn.
      const calls = await listMcpToolCallsForExecution(prisma, body.id);
      expect(calls.length).toBeGreaterThanOrEqual(1);
      const readCall = calls.find((call) => call.toolName === "read_file");
      expect(readCall?.serverName).toBe("taskgoblin-fs-git");
      expect(readCall?.status).toBe("succeeded");

      // Loop emitted a `agent.step.completed` event whose payload reports
      // `stopReason: "finalize"`.
      const events = await listLoopEvents(prisma, {
        projectId: project.id,
        taskExecutionId: body.id,
        limit: 200,
      });
      const finalizeCompletion = events.find((event) => {
        if (event.type !== "agent.step.completed") return false;
        const payload = asRecord(event.payload);
        return payload?.stopReason === "finalize";
      });
      expect(finalizeCompletion).toBeTruthy();
    },
    60000,
  );
});

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function createScriptedLanguageModel(results: LanguageModelV3GenerateResult[]): MockLanguageModelV3 {
  let index = 0;
  return new MockLanguageModelV3({
    provider: "mock-provider",
    modelId: "mock-executor",
    doGenerate: async () => {
      const next = results[index];
      if (!next) {
        throw new Error(`MockLanguageModelV3 exhausted after ${index} call(s).`);
      }
      index += 1;
      return next;
    },
  });
}

function toolCallResult(input: {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}): LanguageModelV3GenerateResult {
  return {
    content: [
      {
        type: "tool-call",
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        input: JSON.stringify(input.input),
      },
    ],
    finishReason: { unified: "tool-calls", raw: undefined },
    usage: { inputTokens: 4, outputTokens: 4, totalTokens: 8 },
    warnings: [],
  } as LanguageModelV3GenerateResult;
}

function textResult(text: string): LanguageModelV3GenerateResult {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: undefined },
    usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
    warnings: [],
  } as LanguageModelV3GenerateResult;
}

async function seedReadyTaskWithMcp(prisma: PrismaClient, rootPath: string) {
  const project = await createProject(prisma, {
    name: "Execute Smoke Project",
    rootPath,
    baseBranch: "main",
  });
  const plannerRun = await createPlannerRun(prisma, {
    projectId: project.id,
    goal: "Smoke test the execution loop",
    moduleName: "api",
  });

  await persistPlannerProposal(prisma, {
    plannerRunId: plannerRun.id,
    summary: "Execution smoke proposal",
    epics: [
      {
        key: "EPIC-EXEC-SMOKE",
        title: "Execution Smoke",
        goal: "Run the agent loop end-to-end",
        tasks: [
          {
            stableId: "TASK-EXEC-SMOKE-1",
            title: "Read notes.txt",
            type: "backend",
            complexity: "small",
            acceptance: [{ label: "loop finalizes" }],
            verificationPlan: {
              items: [
                {
                  kind: "logic",
                  runner: "custom",
                  title: "smoke verification",
                  description: "verifies the agent loop",
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

  // Seed MCP servers/tools so the prerequisite gate in `POST /tasks/:id/execute`
  // doesn't 409. `createMcpService.ensureProjectMcpSetup` is also invoked
  // inside the execution service, but we need it to pass the pre-check here.
  const { createMcpService } = await import("@vimbuspromax3000/mcp-client");
  const mcpService = createMcpService({ prisma });
  await mcpService.ensureProjectMcpSetup(project.id);

  return { project, task };
}
