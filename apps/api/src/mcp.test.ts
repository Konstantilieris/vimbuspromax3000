import { createApp } from "./app";
import {
  createApprovalDecision,
  createMcpToolCall,
  createPlannerRun,
  createProject,
  approveVerificationPlan,
  listTasks,
  persistPlannerProposal,
} from "@vimbuspromax3000/db";
import {
  createIsolatedPrisma,
  removeTempDir,
  writeProjectFile,
} from "@vimbuspromax3000/db/testing";
import { createMcpService } from "@vimbuspromax3000/mcp-client";
import type { PrismaClient } from "@vimbuspromax3000/db/client";

describe("MCP API", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-mcp-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  });

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  async function seedProject() {
    const project = await createProject(prisma, {
      name: "MCP Test Project",
      rootPath: tempDir,
      baseBranch: "main",
    });
    const plannerRun = await createPlannerRun(prisma, {
      projectId: project.id,
      goal: "Test MCP integration",
    });
    await persistPlannerProposal(prisma, {
      plannerRunId: plannerRun.id,
      summary: "MCP test proposal",
      epics: [
        {
          key: "MCP-EPIC-1",
          title: "MCP Integration",
          goal: "Test MCP tool catalog",
          tasks: [
            {
              stableId: "MCP-TASK-1",
              title: "Implement MCP layer",
              type: "backend",
              complexity: "medium",
              acceptance: [{ label: "tools discovered" }],
              verificationPlan: {
                items: [
                  {
                    kind: "logic",
                    runner: "custom",
                    title: "mcp tool check",
                    description: "tools accessible",
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

  async function seedExecution(projectId: string, taskId: string) {
    const branch = await prisma.taskBranch.create({
      data: {
        taskId,
        name: "tg/mcp-test-branch",
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

  describe("GET /mcp/servers", () => {
    test("returns 400 when projectId query param is missing", async () => {
      const api = createApp({ prisma });
      const res = await api.fetch(new Request("http://localhost/mcp/servers"));
      expect(res.status).toBe(400);
    });

    test("returns empty list before setup", async () => {
      const project = await createProject(prisma, { name: "Empty", rootPath: tempDir });
      const api = createApp({ prisma });
      const res = await api.fetch(new Request(`http://localhost/mcp/servers?projectId=${project.id}`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.servers).toHaveLength(0);
    });

    test("returns 3 seeded servers with correct toolCounts", async () => {
      const { project } = await seedProject();
      const api = createApp({ prisma });
      const res = await api.fetch(new Request(`http://localhost/mcp/servers?projectId=${project.id}`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.servers).toHaveLength(3);
      const fsGit = body.servers.find((s: { name: string }) => s.name === "taskgoblin-fs-git");
      expect(fsGit.toolCount).toBe(5);
      expect(fsGit.transport).toBe("stdio");
      expect(fsGit.trustLevel).toBe("trusted");
      const patch = body.servers.find((s: { name: string }) => s.name === "taskgoblin-patch");
      expect(patch.toolCount).toBe(1);
      expect(patch.transport).toBe("stdio");
      expect(patch.trustLevel).toBe("trusted");
      const shell = body.servers.find((s: { name: string }) => s.name === "taskgoblin-shell");
      expect(shell.toolCount).toBe(1);
    });

    test("ensureProjectMcpSetup is idempotent", async () => {
      const { project } = await seedProject();
      const mcpService = createMcpService({ prisma });
      await mcpService.ensureProjectMcpSetup(project.id);
      const api = createApp({ prisma });
      const res = await api.fetch(new Request(`http://localhost/mcp/servers?projectId=${project.id}`));
      const body = await res.json();
      expect(body.servers).toHaveLength(3);
    });
  });

  describe("GET /tasks/:id/mcp/tools", () => {
    test("returns 404 for non-existent task", async () => {
      const api = createApp({ prisma });
      const res = await api.fetch(new Request("http://localhost/tasks/nonexistent/mcp/tools"));
      expect(res.status).toBe(404);
    });

    test("returns 7 tools with correct fields after setup", async () => {
      const { task } = await seedProject();
      const api = createApp({ prisma });
      const res = await api.fetch(new Request(`http://localhost/tasks/${task.id}/mcp/tools`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tools).toHaveLength(7);

      const readTools = body.tools.filter((t: { mutability: string }) => t.mutability === "read");
      const writeTools = body.tools.filter((t: { mutability: string }) => t.mutability === "write");
      expect(readTools).toHaveLength(4);
      expect(writeTools).toHaveLength(3);

      const applyPatch = body.tools.find(
        (t: { name: string; serverName: string }) =>
          t.name === "apply_patch" && t.serverName === "taskgoblin-fs-git",
      );
      expect(applyPatch.approvalRequired).toBe(true);
      expect(applyPatch.serverName).toBe("taskgoblin-fs-git");
      expect(applyPatch.inputSchema).toBeDefined();
      expect(applyPatch.inputSchema.required).toContain("patch");

      const patchServerApply = body.tools.find(
        (t: { name: string; serverName: string }) =>
          t.name === "apply_patch" && t.serverName === "taskgoblin-patch",
      );
      expect(patchServerApply).toBeDefined();
      expect(patchServerApply.approvalRequired).toBe(true);
      expect(patchServerApply.mutability).toBe("write");

      const readFile = body.tools.find((t: { name: string }) => t.name === "read_file");
      expect(readFile.approvalRequired).toBe(false);
      expect(readFile.mutability).toBe("read");
      expect(readFile.inputSchema.required).toContain("path");
    });
  });

  describe("GET /executions/:id/mcp/calls", () => {
    test("returns 404 for non-existent execution", async () => {
      const api = createApp({ prisma });
      const res = await api.fetch(new Request("http://localhost/executions/nonexistent/mcp/calls"));
      expect(res.status).toBe(404);
    });

    test("returns empty list when no calls exist", async () => {
      const { project, task } = await seedProject();
      const { execution } = await seedExecution(project.id, task.id);
      const api = createApp({ prisma });
      const res = await api.fetch(new Request(`http://localhost/executions/${execution.id}/mcp/calls`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.calls).toHaveLength(0);
    });

    test("returns persisted tool calls with DTO fields", async () => {
      const { project, task } = await seedProject();
      const { execution } = await seedExecution(project.id, task.id);
      await createMcpToolCall(prisma, {
        projectId: project.id,
        taskExecutionId: execution.id,
        serverName: "taskgoblin-fs-git",
        toolName: "read_file",
        status: "requested",
        mutability: "read",
        argumentsHash: "abc123",
        argumentsJson: JSON.stringify({ path: "/tmp/file.ts" }),
      });
      const api = createApp({ prisma });
      const res = await api.fetch(new Request(`http://localhost/executions/${execution.id}/mcp/calls`));
      const body = await res.json();
      expect(body.calls).toHaveLength(1);
      expect(body.calls[0].toolName).toBe("read_file");
      expect(body.calls[0].mutability).toBe("read");
      expect(body.calls[0].argumentsHash).toBe("abc123");
      expect(body.calls[0].status).toBe("requested");
    });
  });

  describe("POST /executions/:id/mcp/calls", () => {
    test("creates and executes a read-only tool call through the API", async () => {
      const { project, task } = await seedProject();
      const { execution } = await seedExecution(project.id, task.id);
      writeProjectFile(tempDir, "notes.txt", "hello api\n");

      const api = createApp({ prisma });
      const createdRef = await postJson(api, `/executions/${execution.id}/mcp/calls`, {
        serverName: "taskgoblin-fs-git",
        toolName: "read_file",
        args: { path: "notes.txt" },
      });
      expect(createdRef.status).toBe(201);
      const created = await createdRef.json();
      expect(created.call.status).toBe("requested");
      expect(created.call.requiresApproval).toBe(false);

      const executedRef = await postJson(api, `/executions/${execution.id}/mcp/calls/${created.call.id}/execute`, {});
      expect(executedRef.status).toBe(200);
      const executed = await executedRef.json();
      expect(executed.call.status).toBe("succeeded");
      expect(executed.result.data.content).toBe("hello api\n");
      expect(executed.call.resultSummary).toContain("Read notes.txt");
    });

    test("blocks unapproved mutating execution attempts through the API", async () => {
      const { project, task } = await seedProject();
      const { execution } = await seedExecution(project.id, task.id);
      const api = createApp({ prisma });
      const createdRef = await postJson(api, `/executions/${execution.id}/mcp/calls`, {
        serverName: "taskgoblin-fs-git",
        toolName: "apply_patch",
        args: { patch: "--- a/notes.txt\n+++ b/notes.txt\n" },
      });
      const created = await createdRef.json();

      const executedRef = await postJson(api, `/executions/${execution.id}/mcp/calls/${created.call.id}/execute`, {});

      expect(executedRef.status).toBe(422);
      const executed = await executedRef.json();
      expect(executed.error.code).toBe("APPROVAL_REQUIRED");
      expect(executed.call.status).toBe("blocked");

      const stored = await prisma.mcpToolCall.findUnique({ where: { id: created.call.id } });
      expect(stored?.status).toBe("blocked");
      expect(stored?.errorSummary).toContain("requires operator approval");
      expect(stored?.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("POST /executions/:id/mcp/calls/:callId/approve", () => {
    test("returns 404 for non-existent execution", async () => {
      const api = createApp({ prisma });
      const res = await postJson(api, "/executions/nonexistent/mcp/calls/abc/approve", { operator: "nikos" });
      expect(res.status).toBe(404);
    });

    test("returns 404 for non-existent tool call", async () => {
      const { project, task } = await seedProject();
      const { execution } = await seedExecution(project.id, task.id);
      const api = createApp({ prisma });
      const res = await postJson(api, `/executions/${execution.id}/mcp/calls/nonexistent/approve`, { operator: "nikos" });
      expect(res.status).toBe(404);
    });

    test("returns 422 CALL_NOT_IN_EXECUTION when call belongs to another execution", async () => {
      const { project, task } = await seedProject();
      const { execution } = await seedExecution(project.id, task.id);

      // Create a call linked to a different (non-existent) execution id
      const tool = await prisma.mcpTool.findFirst({
        where: { name: "apply_patch", server: { name: "taskgoblin-fs-git" } },
      });
      const call = await createMcpToolCall(prisma, {
        projectId: project.id,
        taskExecutionId: "other-execution-id",
        toolId: tool?.id ?? null,
        serverName: "taskgoblin-fs-git",
        toolName: "apply_patch",
        status: "requested",
        mutability: "write",
        argumentsHash: "zzz",
        argumentsJson: JSON.stringify({ patch: "--- a\n+++ b\n" }),
      });

      const api = createApp({ prisma });
      const res = await postJson(api, `/executions/${execution.id}/mcp/calls/${call.id}/approve`, { operator: "nikos" });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.code).toBe("CALL_NOT_IN_EXECUTION");
    });

    test("returns 422 APPROVAL_NOT_REQUIRED for read-only tool call", async () => {
      const { project, task } = await seedProject();
      const { execution } = await seedExecution(project.id, task.id);
      const readTool = await prisma.mcpTool.findFirst({ where: { name: "read_file" } });
      const call = await createMcpToolCall(prisma, {
        projectId: project.id,
        taskExecutionId: execution.id,
        toolId: readTool?.id ?? null,
        serverName: "taskgoblin-fs-git",
        toolName: "read_file",
        status: "requested",
        mutability: "read",
        argumentsHash: "r1",
        argumentsJson: JSON.stringify({ path: "/tmp/file.ts" }),
      });
      const api = createApp({ prisma });
      const res = await postJson(api, `/executions/${execution.id}/mcp/calls/${call.id}/approve`, { operator: "nikos" });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.code).toBe("APPROVAL_NOT_REQUIRED");
    });

    test("returns 422 CALL_NOT_PENDING for already-approved call", async () => {
      const { project, task } = await seedProject();
      const { execution } = await seedExecution(project.id, task.id);
      const tool = await prisma.mcpTool.findFirst({ where: { name: "run_command" } });
      const call = await createMcpToolCall(prisma, {
        projectId: project.id,
        taskExecutionId: execution.id,
        toolId: tool?.id ?? null,
        serverName: "taskgoblin-shell",
        toolName: "run_command",
        status: "approved",
        mutability: "write",
        argumentsHash: "a1",
        argumentsJson: JSON.stringify({ command: "echo ok" }),
      });
      const api = createApp({ prisma });
      const res = await postJson(api, `/executions/${execution.id}/mcp/calls/${call.id}/approve`, { operator: "nikos" });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.code).toBe("CALL_NOT_PENDING");
    });

    test("approves a mutating call, sets status to approved, links Approval record", async () => {
      const { project, task } = await seedProject();
      const { execution } = await seedExecution(project.id, task.id);
      const tool = await prisma.mcpTool.findFirst({ where: { name: "run_command" } });
      const call = await createMcpToolCall(prisma, {
        projectId: project.id,
        taskExecutionId: execution.id,
        toolId: tool?.id ?? null,
        serverName: "taskgoblin-shell",
        toolName: "run_command",
        status: "requested",
        mutability: "write",
        argumentsHash: "b1",
        argumentsJson: JSON.stringify({ command: "echo ok" }),
      });

      const api = createApp({ prisma });
      const res = await postJson(api, `/executions/${execution.id}/mcp/calls/${call.id}/approve`, {
        operator: "nikos",
        reason: "verified safe",
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.call.status).toBe("approved");
      expect(body.call.approvalId).toBeTruthy();

      const approval = await prisma.approval.findUnique({ where: { id: body.call.approvalId } });
      expect(approval?.subjectType).toBe("mutating_tool_call");
      expect(approval?.subjectId).toBe(call.id);
      expect(approval?.operator).toBe("nikos");
      expect(approval?.reason).toBe("verified safe");
      expect(approval?.status).toBe("granted");
    });
  });
});

async function postJson(api: ReturnType<typeof createApp>, path: string, body: unknown) {
  return api.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
