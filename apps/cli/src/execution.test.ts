import {
  EXECUTION_COMMANDS,
  getBranchViewSnapshot,
  getEventsViewSnapshot,
  getExecutionViewSnapshot,
  getMcpCallsViewSnapshot,
  getPatchViewSnapshot,
  getTestRunsViewSnapshot,
  runExecutionCommand,
} from "./execution";

describe("CLI execution console", () => {
  test("getExecutionViewSnapshot renders execution state", () => {
    const snapshot = getExecutionViewSnapshot({
      id: "exec_1",
      taskId: "task_1",
      status: "running",
      branchName: "tg/core/task_1-impl",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(snapshot).toContain("Execution: exec_1");
    expect(snapshot).toContain("Task: task_1");
    expect(snapshot).toContain("Status: running");
    expect(snapshot).toContain("Branch: tg/core/task_1-impl");
  });

  test("getExecutionViewSnapshot handles missing branch", () => {
    const snapshot = getExecutionViewSnapshot({
      id: "exec_2",
      taskId: "task_2",
      status: "pending",
      branchName: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(snapshot).toContain("Branch: none");
  });

  test("getBranchViewSnapshot renders branch state", () => {
    const snapshot = getBranchViewSnapshot({
      id: "branch_1",
      taskId: "task_1",
      branchName: "tg/core/task_1-impl",
      state: "active",
      baseBranch: "main",
    });

    expect(snapshot).toContain("Branch: tg/core/task_1-impl");
    expect(snapshot).toContain("State: active");
    expect(snapshot).toContain("Base: main");
    expect(snapshot).toContain("Task: task_1");
  });

  test("getTestRunsViewSnapshot renders test runs with output", () => {
    const snapshot = getTestRunsViewSnapshot([
      {
        id: "run_1",
        executionId: "exec_1",
        status: "passed",
        orderIndex: 0,
        command: "bunx vitest run",
        exitCode: 0,
        stdout: "All tests passed",
        stderr: null,
      },
      {
        id: "run_2",
        executionId: "exec_1",
        status: "failed",
        orderIndex: 1,
        command: "bunx playwright test",
        exitCode: 1,
        stdout: null,
        stderr: "1 test failed",
      },
    ]);

    expect(snapshot).toContain("[0] passed exit=0 bunx vitest run");
    expect(snapshot).toContain("stdout: All tests passed");
    expect(snapshot).toContain("[1] failed exit=1 bunx playwright test");
    expect(snapshot).toContain("stderr: 1 test failed");
  });

  test("getTestRunsViewSnapshot renders empty state", () => {
    expect(getTestRunsViewSnapshot([])).toContain("No test runs.");
  });

  test("getPatchViewSnapshot renders patch metadata", () => {
    const snapshot = getPatchViewSnapshot({
      executionId: "exec_1",
      status: "ready",
      approvalStatus: "pending",
      filesChanged: 3,
      linesAdded: 42,
      linesRemoved: 7,
      diffSummary: "Added execution CLI commands",
    });

    expect(snapshot).toContain("Execution: exec_1");
    expect(snapshot).toContain("Status: ready");
    expect(snapshot).toContain("Approval: pending");
    expect(snapshot).toContain("Files changed: 3");
    expect(snapshot).toContain("Lines: +42 -7");
    expect(snapshot).toContain("Summary: Added execution CLI commands");
  });

  test("getEventsViewSnapshot renders events with context", () => {
    const snapshot = getEventsViewSnapshot([
      {
        id: "event_1",
        projectId: "project_1",
        taskId: "task_1",
        executionId: "exec_1",
        kind: "execution_started",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "event_2",
        projectId: "project_1",
        taskId: null,
        executionId: null,
        kind: "project_created",
        createdAt: "2026-01-01T00:01:00.000Z",
      },
    ]);

    expect(snapshot).toContain("execution_started task=task_1 exec=exec_1");
    expect(snapshot).toContain("project_created");
    expect(snapshot).not.toContain("task=null");
  });

  test("getEventsViewSnapshot renders empty state", () => {
    expect(getEventsViewSnapshot([])).toContain("No events.");
  });

  test("getMcpCallsViewSnapshot renders calls with approval flag", () => {
    const snapshot = getMcpCallsViewSnapshot([
      {
        id: "call_1",
        executionId: "exec_1",
        toolName: "fs.writeFile",
        status: "pending_approval",
        requiresApproval: true,
      },
      {
        id: "call_2",
        executionId: "exec_1",
        toolName: "fs.readFile",
        status: "completed",
        requiresApproval: false,
      },
    ]);

    expect(snapshot).toContain("call_1 fs.writeFile status=pending_approval [requires-approval]");
    expect(snapshot).toContain("call_2 fs.readFile status=completed");
    expect(snapshot).not.toContain("call_2 fs.readFile status=completed [requires-approval]");
  });

  test("getMcpCallsViewSnapshot renders empty state", () => {
    expect(getMcpCallsViewSnapshot([])).toContain("No MCP calls.");
  });

  test("EXECUTION_COMMANDS are exported and non-empty", () => {
    expect(EXECUTION_COMMANDS.length).toBeGreaterThan(0);
    expect(EXECUTION_COMMANDS).toContain("/execution:start");
    expect(EXECUTION_COMMANDS).toContain("/patch:approve");
    expect(EXECUTION_COMMANDS).toContain("/events");
  });

  test("runs the execution smoke flow through API-backed commands", async () => {
    const requests: Array<{ method: string; url: string; body?: unknown }> = [];

    const state = {
      execution: {
        id: "exec_1",
        taskId: "task_1",
        status: "running",
        branchName: "tg/core/task_1-impl",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      branch: {
        id: "branch_1",
        taskId: "task_1",
        branchName: "tg/core/task_1-impl",
        state: "active",
        baseBranch: "main",
      },
      testRuns: [
        {
          id: "run_1",
          executionId: "exec_1",
          status: "passed",
          orderIndex: 0,
          command: "bunx vitest run",
          exitCode: 0,
          stdout: "Tests passed",
          stderr: null,
        },
      ],
      patch: {
        executionId: "exec_1",
        status: "ready",
        approvalStatus: "pending",
        filesChanged: 2,
        linesAdded: 20,
        linesRemoved: 5,
        diffSummary: "Execution slice",
      },
      events: [
        {
          id: "event_1",
          projectId: "project_1",
          taskId: "task_1",
          executionId: "exec_1",
          kind: "execution_started",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      patchApproval: {
        id: "approval_1",
        subjectType: "patch",
        subjectId: "exec_1",
        stage: "patch_review",
        status: "granted",
      },
      verificationApproval: {
        id: "approval_2",
        subjectType: "verification_plan",
        subjectId: "task_1",
        stage: "verification_review",
        status: "granted",
      },
    };

    const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ method, url, body });

      if (url.includes("/task_1/verification/approve") && method === "POST") {
        return Response.json(state.verificationApproval, { status: 201 });
      }

      if (url.includes("/task_1/branch") && method === "POST") {
        return Response.json(state.branch, { status: 201 });
      }

      if (url.includes("/task_1/branch") && method === "GET") {
        return Response.json(state.branch);
      }

      if (url.includes("/task_1/branch/abandon") && method === "POST") {
        return Response.json({}, { status: 200 });
      }

      if (url.includes("/task_1/execute") && method === "POST") {
        return Response.json(state.execution, { status: 201 });
      }

      if (url.includes("/exec_1/test-runs") && method === "POST") {
        return Response.json(state.testRuns, { status: 201 });
      }

      if (url.includes("/exec_1/test-runs") && method === "GET") {
        return Response.json(state.testRuns);
      }

      if (url.includes("/exec_1/patch/approve") && method === "POST") {
        state.patch.approvalStatus = "granted";
        return Response.json(state.patchApproval, { status: 201 });
      }

      if (url.includes("/exec_1/patch/reject") && method === "POST") {
        state.patch.approvalStatus = "rejected";
        return Response.json({ ...state.patchApproval, status: "rejected" }, { status: 201 });
      }

      if (url.includes("/exec_1/patch") && method === "GET") {
        return Response.json(state.patch);
      }

      if (url.includes("/events?") && method === "GET") {
        return Response.json(state.events);
      }

      if (url.includes("/exec_1/mcp/calls/call_1/approve") && method === "POST") {
        return Response.json({ id: "call_1", status: "approved" }, { status: 201 });
      }

      if (url.includes("/exec_1/mcp/calls") && method === "GET") {
        return Response.json([]);
      }

      return Response.json({}, { status: 404 });
    };

    const verifyOutput = await runExecutionCommand(
      ["/approve:verification", "--task-id", "task_1", "--operator", "nikos"],
      { fetch: mockFetch as typeof fetch },
    );
    const branchCreateOutput = await runExecutionCommand(
      ["/branch:create", "--task-id", "task_1"],
      { fetch: mockFetch as typeof fetch },
    );
    const branchShowOutput = await runExecutionCommand(
      ["/branch:show", "--task-id", "task_1"],
      { fetch: mockFetch as typeof fetch },
    );
    const executionOutput = await runExecutionCommand(
      ["/execution:start", "--task-id", "task_1"],
      { fetch: mockFetch as typeof fetch },
    );
    const testRunsStartOutput = await runExecutionCommand(
      ["/test-runs:start", "--execution-id", "exec_1"],
      { fetch: mockFetch as typeof fetch },
    );
    const testRunsListOutput = await runExecutionCommand(
      ["/test-runs", "--execution-id", "exec_1"],
      { fetch: mockFetch as typeof fetch },
    );
    const patchOutput = await runExecutionCommand(
      ["/patch:show", "--execution-id", "exec_1"],
      { fetch: mockFetch as typeof fetch },
    );
    const eventsOutput = await runExecutionCommand(
      ["/events", "--project-id", "project_1", "--task-id", "task_1"],
      { fetch: mockFetch as typeof fetch },
    );
    const patchApproveOutput = await runExecutionCommand(
      ["/patch:approve", "--execution-id", "exec_1", "--operator", "nikos"],
      { fetch: mockFetch as typeof fetch },
    );
    const mcpCallsOutput = await runExecutionCommand(
      ["/mcp-calls", "--execution-id", "exec_1"],
      { fetch: mockFetch as typeof fetch },
    );
    const mcpApproveOutput = await runExecutionCommand(
      ["/mcp-calls:approve", "--execution-id", "exec_1", "--call-id", "call_1"],
      { fetch: mockFetch as typeof fetch },
    );

    expect(verifyOutput).toContain("Recorded granted verification approval for task task_1");
    expect(branchCreateOutput).toContain("Branch: tg/core/task_1-impl");
    expect(branchCreateOutput).toContain("State: active");
    expect(branchShowOutput).toContain("Base: main");
    expect(executionOutput).toContain("Execution: exec_1");
    expect(executionOutput).toContain("Status: running");
    expect(testRunsStartOutput).toContain("[0] passed exit=0 bunx vitest run");
    expect(testRunsStartOutput).toContain("stdout: Tests passed");
    expect(testRunsListOutput).toContain("[0] passed");
    expect(patchOutput).toContain("Files changed: 2");
    expect(patchOutput).toContain("Lines: +20 -5");
    expect(eventsOutput).toContain("execution_started task=task_1 exec=exec_1");
    expect(patchApproveOutput).toContain("Recorded granted patch approval for execution exec_1");
    expect(mcpCallsOutput).toContain("No MCP calls.");
    expect(mcpApproveOutput).toContain("Approved MCP call call_1 (status: approved)");

    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST http://localhost:3000/tasks/task_1/verification/approve",
      "POST http://localhost:3000/tasks/task_1/branch",
      "GET http://localhost:3000/tasks/task_1/branch",
      "POST http://localhost:3000/tasks/task_1/execute",
      "POST http://localhost:3000/executions/exec_1/test-runs",
      "GET http://localhost:3000/executions/exec_1/test-runs",
      "GET http://localhost:3000/executions/exec_1/patch",
      "GET http://localhost:3000/events?projectId=project_1&taskId=task_1",
      "POST http://localhost:3000/executions/exec_1/patch/approve",
      "GET http://localhost:3000/executions/exec_1/mcp/calls",
      "POST http://localhost:3000/executions/exec_1/mcp/calls/call_1/approve",
    ]);
  });
});
