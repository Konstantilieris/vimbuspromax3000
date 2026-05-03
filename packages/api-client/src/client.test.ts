import { createApiClient } from "./client";

type CapturedCall = { url: string; init?: RequestInit };

function makeRecordingFetch(responses: Response[]): {
  fetch: typeof fetch;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const queue = [...responses];
  const fetchMock: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) {
      throw new Error("no more queued responses");
    }
    return next;
  };
  return { fetch: fetchMock, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createApiClient", () => {
  test("health calls GET /health", async () => {
    const { fetch: fetchMock, calls } = makeRecordingFetch([
      jsonResponse(200, { status: "ok" }),
    ]);
    const client = createApiClient({ baseUrl: "http://api", fetch: fetchMock });
    const result = await client.health();
    expect(result).toEqual({ status: "ok" });
    expect(calls[0]?.url).toBe("http://api/health");
    expect(calls[0]?.init?.method ?? "GET").toBe("GET");
  });

  test("listProjects calls GET /projects", async () => {
    const { fetch: fetchMock, calls } = makeRecordingFetch([
      jsonResponse(200, [{ id: "p1", name: "Demo", rootPath: "/x", baseBranch: "main" }]),
    ]);
    const client = createApiClient({ baseUrl: "http://api", fetch: fetchMock });
    const projects = await client.listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]?.name).toBe("Demo");
    expect(calls[0]?.url).toBe("http://api/projects");
  });

  test("createProject POSTs body to /projects", async () => {
    const { fetch: fetchMock, calls } = makeRecordingFetch([
      jsonResponse(200, { id: "p1", name: "Demo", rootPath: "/x", baseBranch: "main" }),
    ]);
    const client = createApiClient({ baseUrl: "http://api", fetch: fetchMock });
    await client.createProject({ name: "Demo", rootPath: "/x" });

    expect(calls[0]?.url).toBe("http://api/projects");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ name: "Demo", rootPath: "/x" }));
  });

  test("listSlots includes projectId query param", async () => {
    const { fetch: fetchMock, calls } = makeRecordingFetch([
      jsonResponse(200, []),
    ]);
    const client = createApiClient({ baseUrl: "http://api", fetch: fetchMock });
    await client.listSlots("proj-1");
    expect(calls[0]?.url).toBe("http://api/model-slots?projectId=proj-1");
  });

  test("listTasks omits empty filter values from the query string", async () => {
    const { fetch: fetchMock, calls } = makeRecordingFetch([
      jsonResponse(200, []),
    ]);
    const client = createApiClient({ baseUrl: "http://api", fetch: fetchMock });
    await client.listTasks("proj-1");
    expect(calls[0]?.url).toBe("http://api/tasks?projectId=proj-1");
  });

  test("listTasks forwards filter values when provided", async () => {
    const { fetch: fetchMock, calls } = makeRecordingFetch([
      jsonResponse(200, []),
    ]);
    const client = createApiClient({ baseUrl: "http://api", fetch: fetchMock });
    await client.listTasks("proj-1", { status: "ready", plannerRunId: "run-9" });
    expect(calls[0]?.url).toBe(
      "http://api/tasks?projectId=proj-1&plannerRunId=run-9&status=ready",
    );
  });

  test("createPlannerRun POSTs to /planner/runs", async () => {
    const { fetch: fetchMock, calls } = makeRecordingFetch([
      jsonResponse(201, { id: "run-1", projectId: "p1", status: "interviewing", goal: "ship it" }),
    ]);
    const client = createApiClient({ baseUrl: "http://api", fetch: fetchMock });
    const run = await client.createPlannerRun({
      projectId: "p1",
      goal: "ship it",
      moduleName: "auth",
    });
    expect(run.id).toBe("run-1");
    expect(calls[0]?.url).toBe("http://api/planner/runs");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({ projectId: "p1", goal: "ship it", moduleName: "auth" }),
    );
  });

  test("getPlannerRun GETs the run by id", async () => {
    const { fetch: fetchMock, calls } = makeRecordingFetch([
      jsonResponse(200, { id: "run 1", projectId: "p1", status: "ready", goal: "x" }),
    ]);
    const client = createApiClient({ baseUrl: "http://api", fetch: fetchMock });
    await client.getPlannerRun("run 1");
    expect(calls[0]?.url).toBe("http://api/planner/runs/run%201");
  });

  test("answerPlannerRun wraps answers in { answers }", async () => {
    const { fetch: fetchMock, calls } = makeRecordingFetch([
      jsonResponse(200, { id: "r", projectId: "p", status: "ready_to_generate", goal: "x" }),
    ]);
    const client = createApiClient({ baseUrl: "http://api", fetch: fetchMock });
    await client.answerPlannerRun({ plannerRunId: "r", answers: { foo: "bar" } });
    expect(calls[0]?.url).toBe("http://api/planner/runs/r/answers");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ answers: { foo: "bar" } }));
  });

  test("generatePlannerRun omits seed when not provided", async () => {
    const { fetch: fetchMock, calls } = makeRecordingFetch([
      jsonResponse(200, { id: "r", projectId: "p", status: "ready", goal: "x" }),
    ]);
    const client = createApiClient({ baseUrl: "http://api", fetch: fetchMock });
    await client.generatePlannerRun({ plannerRunId: "r" });
    expect(calls[0]?.url).toBe("http://api/planner/runs/r/generate");
    expect(calls[0]?.init?.body).toBe("{}");
  });

  test("generatePlannerRun forwards seed when provided", async () => {
    const { fetch: fetchMock, calls } = makeRecordingFetch([
      jsonResponse(200, { id: "r", projectId: "p", status: "ready", goal: "x" }),
    ]);
    const client = createApiClient({ baseUrl: "http://api", fetch: fetchMock });
    await client.generatePlannerRun({ plannerRunId: "r", seed: 42 });
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ seed: 42 }));
  });

  test("listApprovals omits empty filter values", async () => {
    const { fetch: fetchMock, calls } = makeRecordingFetch([
      jsonResponse(200, []),
    ]);
    const client = createApiClient({ baseUrl: "http://api", fetch: fetchMock });
    await client.listApprovals({ projectId: "p1" });
    expect(calls[0]?.url).toBe("http://api/approvals?projectId=p1");
  });

  test("createApproval POSTs full body to /approvals", async () => {
    const { fetch: fetchMock, calls } = makeRecordingFetch([
      jsonResponse(201, {
        id: "a1",
        subjectType: "planner_run",
        subjectId: "run-1",
        stage: "planner_review",
        status: "granted",
      }),
    ]);
    const client = createApiClient({ baseUrl: "http://api", fetch: fetchMock });
    await client.createApproval({
      projectId: "p1",
      subjectType: "planner_run",
      subjectId: "run-1",
      stage: "planner_review",
      status: "granted",
      operator: "alice",
    });
    expect(calls[0]?.url).toBe("http://api/approvals");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        projectId: "p1",
        subjectType: "planner_run",
        subjectId: "run-1",
        stage: "planner_review",
        status: "granted",
        operator: "alice",
      }),
    );
  });

  test("startExecution POSTs to /tasks/:id/execute", async () => {
    const { fetch: fetchMock, calls } = makeRecordingFetch([
      jsonResponse(201, {
        id: "e1",
        taskId: "t1",
        status: "queued",
        createdAt: "2026-01-01",
      }),
    ]);
    const client = createApiClient({ baseUrl: "http://api", fetch: fetchMock });
    await client.startExecution("t1");
    expect(calls[0]?.url).toBe("http://api/tasks/t1/execute");
    expect(calls[0]?.init?.method).toBe("POST");
  });

  test("createBranch posts baseBranch only when provided", async () => {
    const { fetch: fetchMock, calls } = makeRecordingFetch([
      jsonResponse(201, {
        id: "b1",
        taskId: "t1",
        branchName: "feat/t1",
        state: "open",
        baseBranch: "main",
      }),
      jsonResponse(201, {
        id: "b2",
        taskId: "t2",
        branchName: "feat/t2",
        state: "open",
        baseBranch: "develop",
      }),
    ]);
    const client = createApiClient({ baseUrl: "http://api", fetch: fetchMock });

    await client.createBranch({ taskId: "t1" });
    expect(calls[0]?.init?.body).toBe("{}");

    await client.createBranch({ taskId: "t2", baseBranch: "develop" });
    expect(calls[1]?.init?.body).toBe(JSON.stringify({ baseBranch: "develop" }));
  });

  test("startTestRuns POSTs and listTestRuns GETs the same URL", async () => {
    const { fetch: fetchMock, calls } = makeRecordingFetch([
      jsonResponse(201, []),
      jsonResponse(200, []),
    ]);
    const client = createApiClient({ baseUrl: "http://api", fetch: fetchMock });

    await client.startTestRuns("e1");
    expect(calls[0]?.url).toBe("http://api/executions/e1/test-runs");
    expect(calls[0]?.init?.method).toBe("POST");

    await client.listTestRuns("e1");
    expect(calls[1]?.url).toBe("http://api/executions/e1/test-runs");
    expect(calls[1]?.init?.method ?? "GET").toBe("GET");
  });

  test("listEvaluations unwraps { evalRuns }", async () => {
    const { fetch: fetchMock } = makeRecordingFetch([
      jsonResponse(200, { evalRuns: [{ id: "ev1", status: "completed" }] }),
    ]);
    const client = createApiClient({ baseUrl: "http://api", fetch: fetchMock });
    const runs = await client.listEvaluations("e1");
    expect(runs).toHaveLength(1);
    expect(runs[0]?.id).toBe("ev1");
  });

  test("runEvaluation unwraps { evalRun }", async () => {
    const { fetch: fetchMock, calls } = makeRecordingFetch([
      jsonResponse(201, { evalRun: { id: "ev1", status: "completed" } }),
    ]);
    const client = createApiClient({ baseUrl: "http://api", fetch: fetchMock });
    const run = await client.runEvaluation("e1");
    expect(run.id).toBe("ev1");
    expect(calls[0]?.init?.method).toBe("POST");
  });

  test("getTaskVerification GETs /tasks/:id/verification", async () => {
    const { fetch: fetchMock, calls } = makeRecordingFetch([
      jsonResponse(200, {
        taskId: "t1",
        plan: null,
        summary: null,
      }),
    ]);
    const client = createApiClient({ baseUrl: "http://api", fetch: fetchMock });
    const review = await client.getTaskVerification("t1");
    expect(review.taskId).toBe("t1");
    expect(calls[0]?.url).toBe("http://api/tasks/t1/verification");
  });

  test("testSlot URL-encodes the slot key and posts capabilities", async () => {
    const { fetch: fetchMock, calls } = makeRecordingFetch([
      jsonResponse(200, {
        ok: true,
        value: { concreteModelName: "claude", usedFallback: false },
      }),
    ]);
    const client = createApiClient({ baseUrl: "http://api", fetch: fetchMock });
    const result = await client.testSlot({
      projectId: "proj-1",
      slot: "planner_deep",
      requiredCapabilities: ["json"],
    });

    expect(result.ok).toBe(true);
    expect(calls[0]?.url).toBe("http://api/model-slots/planner_deep/test");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({ projectId: "proj-1", requiredCapabilities: ["json"] }),
    );
  });
});
