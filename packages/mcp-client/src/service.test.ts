import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  approveVerificationPlan,
  createApprovalDecision,
  createPlannerRun,
  createProject,
  listTasks,
  persistPlannerProposal,
} from "@vimbuspromax3000/db";
import type { PrismaClient } from "@vimbuspromax3000/db/client";
import {
  createIsolatedPrisma,
  initializeGitRepository,
  removeTempDir,
  runCommand,
} from "@vimbuspromax3000/db/testing";
import { createMcpService, McpValidationError, STANDARD_MCP_SERVERS } from "./index";

const SUITE_HOOK_TIMEOUT_MS = 60_000;
const SUITE_TEST_TIMEOUT_MS = 60_000;

describe("MCP client execution wrappers", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-mcp-client-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  }, SUITE_HOOK_TIMEOUT_MS);

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  }, SUITE_HOOK_TIMEOUT_MS);

  test("catalog exposes only the minimal fs/git and shell wrapper tools", () => {
    expect(
      STANDARD_MCP_SERVERS.map((server) => ({
        name: server.name,
        tools: server.tools.map((tool) => tool.name),
      })),
    ).toEqual([
      {
        name: "taskgoblin-fs-git",
        tools: ["read_file", "grep", "git_status", "git_diff", "apply_patch"],
      },
      {
        name: "taskgoblin-patch",
        tools: ["apply_patch"],
      },
      {
        name: "taskgoblin-shell",
        tools: ["run_command"],
      },
    ]);
  });

  test("rejects invalid arguments before logging a tool call", { timeout: SUITE_TEST_TIMEOUT_MS }, async () => {
    const { project, execution, service } = await seedExecutableProject();

    await expect(
      service.createToolCall({
        projectId: project.id,
        taskExecutionId: execution.id,
        serverName: "taskgoblin-fs-git",
        toolName: "read_file",
        args: { path: 123 },
      }),
    ).rejects.toBeInstanceOf(McpValidationError);

    await expect(prisma.mcpToolCall.count()).resolves.toBe(0);
  });

  test("executes allowed read_file calls and logs completion metadata", { timeout: SUITE_TEST_TIMEOUT_MS }, async () => {
    const { project, execution, service } = await seedExecutableProject();
    const call = await service.createToolCall({
      projectId: project.id,
      taskExecutionId: execution.id,
      serverName: "taskgoblin-fs-git",
      toolName: "read_file",
      args: { path: "src/demo.txt" },
    });

    const result = await service.executeToolCall(call.id);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.summary).toContain("Read src/demo.txt");
      expect(result.result.data).toMatchObject({
        path: "src/demo.txt",
        content: "old\n",
      });
      expect(result.call.status).toBe("succeeded");
      expect(result.call.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.call.resultSummary).toContain("Read src/demo.txt");
      expect(result.call.errorSummary).toBeNull();
      expect(result.call.finishedAt).toBeInstanceOf(Date);
    }

    await expectLoopEvents(project.id, ["mcp.tool.requested", "mcp.tool.completed"]);
  });

  test("blocks read calls that escape the project root and logs the block", { timeout: SUITE_TEST_TIMEOUT_MS }, async () => {
    const { project, execution, service } = await seedExecutableProject();
    const call = await service.createToolCall({
      projectId: project.id,
      taskExecutionId: execution.id,
      serverName: "taskgoblin-fs-git",
      toolName: "read_file",
      args: { path: "../outside.txt" },
    });

    const result = await service.executeToolCall(call.id);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe("blocked");
      expect(result.error.code).toBe("PATH_OUTSIDE_WORKSPACE");
      expect(result.call.status).toBe("blocked");
      expect(result.call.errorSummary).toContain("project root");
      expect(result.call.latencyMs).toBeGreaterThanOrEqual(0);
    }

    await expectLoopEvents(project.id, ["mcp.tool.requested", "mcp.tool.blocked"]);
  });

  test("blocks unapproved mutating calls by default", { timeout: SUITE_TEST_TIMEOUT_MS }, async () => {
    const { project, execution, service } = await seedExecutableProject();
    const call = await service.createToolCall({
      projectId: project.id,
      taskExecutionId: execution.id,
      serverName: "taskgoblin-fs-git",
      toolName: "apply_patch",
      args: { patch: demoPatch("old", "blocked") },
    });

    const result = await service.executeToolCall(call.id);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe("blocked");
      expect(result.error.code).toBe("APPROVAL_REQUIRED");
      expect(result.call.status).toBe("blocked");
    }
    expect(readFileSync(`${tempDir}/src/demo.txt`, "utf8")).toBe("old\n");
  });

  test("executes approved apply_patch calls and links the approval", { timeout: SUITE_TEST_TIMEOUT_MS }, async () => {
    const { project, execution, service } = await seedExecutableProject();
    const call = await service.createToolCall({
      projectId: project.id,
      taskExecutionId: execution.id,
      serverName: "taskgoblin-fs-git",
      toolName: "apply_patch",
      args: { patch: demoPatch("old", "new") },
    });
    const approved = await service.approveToolCall(call.id, {
      projectId: project.id,
      operator: "nikos",
      reason: "safe patch",
    });

    const result = await service.executeToolCall(approved.id);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.call.status).toBe("succeeded");
      expect(result.call.approvalId).toBeTruthy();
      expect(result.call.resultSummary).toBe("Patch applied to the working tree.");
    }
    expect(readFileSync(`${tempDir}/src/demo.txt`, "utf8").replace(/\r\n/g, "\n")).toBe("new\n");
  });

  test("blocks approved shell commands that match unsafe patterns", { timeout: SUITE_TEST_TIMEOUT_MS }, async () => {
    const { project, execution, service } = await seedExecutableProject();
    const call = await service.createToolCall({
      projectId: project.id,
      taskExecutionId: execution.id,
      serverName: "taskgoblin-shell",
      toolName: "run_command",
      args: { command: "git reset --hard" },
    });
    const approved = await service.approveToolCall(call.id, {
      projectId: project.id,
      operator: "nikos",
    });

    const result = await service.executeToolCall(approved.id);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe("blocked");
      expect(result.error.code).toBe("UNSAFE_COMMAND");
      expect(result.call.errorSummary).toContain("Unsafe shell command blocked");
    }
  });

  test("marks approved wrapper execution failures as failed and logs the error", { timeout: SUITE_TEST_TIMEOUT_MS }, async () => {
    const { project, execution, service } = await seedExecutableProject();
    const call = await service.createToolCall({
      projectId: project.id,
      taskExecutionId: execution.id,
      serverName: "taskgoblin-shell",
      toolName: "run_command",
      args: { command: "git not-a-real-command" },
    });
    const approved = await service.approveToolCall(call.id, {
      projectId: project.id,
      operator: "nikos",
    });

    const result = await service.executeToolCall(approved.id);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe("failed");
      expect(result.call.status).toBe("failed");
      expect(result.call.errorSummary).toContain("git not-a-real-command");
      expect(result.call.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.call.finishedAt).toBeInstanceOf(Date);
    }
  });

  async function seedExecutableProject() {
    initializeGitRepository(tempDir, {
      initialFiles: {
        "src/demo.txt": "old\n",
        "README.md": "hello taskgoblin\n",
      },
    });
    runCommand("git", ["switch", "-c", "tg/mcp-test"], tempDir);

    const project = await createProject(prisma, {
      name: "MCP Client Project",
      rootPath: tempDir,
      baseBranch: "main",
    });
    const plannerRun = await createPlannerRun(prisma, {
      projectId: project.id,
      goal: "Test MCP wrapper execution",
    });
    await persistPlannerProposal(prisma, {
      plannerRunId: plannerRun.id,
      summary: "MCP wrapper proposal",
      epics: [
        {
          key: "MCP-CLIENT-EPIC",
          title: "MCP wrappers",
          goal: "Execute minimal wrappers",
          tasks: [
            {
              stableId: `MCP-CLIENT-${randomUUID()}`,
              title: "Exercise MCP wrappers",
              type: "backend",
              complexity: "medium",
              acceptance: [{ label: "wrapper executed" }],
              verificationPlan: {
                items: [
                  {
                    kind: "logic",
                    runner: "custom",
                    title: "wrapper test",
                    description: "runs wrapper paths",
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
    const [task] = await listTasks(prisma, { projectId: project.id });
    if (!task) throw new Error("Expected task.");
    await approveVerificationPlan(prisma, { taskId: task.id });
    await prisma.task.update({
      where: { id: task.id },
      data: { status: "executing" },
    });

    const head = runCommand("git", ["rev-parse", "HEAD"], tempDir).stdout.trim();
    const branch = await prisma.taskBranch.create({
      data: {
        taskId: task.id,
        name: "tg/mcp-test",
        base: "main",
        state: "active",
        currentHead: head,
      },
    });
    const execution = await prisma.taskExecution.create({
      data: {
        taskId: task.id,
        branchId: branch.id,
        status: "implementing",
        startedAt: new Date(),
      },
    });

    const service = createMcpService({ prisma });
    await service.ensureProjectMcpSetup(project.id);

    return { project, task, branch, execution, service };
  }

  async function expectLoopEvents(projectId: string, expectedTypes: string[]) {
    const events = await prisma.loopEvent.findMany({
      where: { projectId },
      orderBy: [{ createdAt: "asc" }],
    });

    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(expectedTypes));
  }
});

function demoPatch(from: string, to: string) {
  return [
    "diff --git a/src/demo.txt b/src/demo.txt",
    "--- a/src/demo.txt",
    "+++ b/src/demo.txt",
    "@@ -1 +1 @@",
    `-${from}`,
    `+${to}`,
    "",
  ].join("\n");
}
