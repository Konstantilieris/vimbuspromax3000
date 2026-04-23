import { DASHBOARD_COLUMNS, getDashboardSnapshot } from "./dashboard";
import { MODEL_COMMANDS, getModelsViewSnapshot, runModelsCommand } from "./models";
import { PLANNER_COMMANDS, runPlannerCommand } from "./planner";

describe("CLI dashboard placeholder", () => {
  test("contains the documented bootstrap columns", () => {
    const snapshot = getDashboardSnapshot();

    for (const column of DASHBOARD_COLUMNS) {
      expect(snapshot).toContain(column);
    }

    for (const command of MODEL_COMMANDS) {
      expect(snapshot).toContain(command);
    }

    for (const command of PLANNER_COMMANDS) {
      expect(snapshot).toContain(command);
    }
  });

  test("renders default model slots in the models view", () => {
    const snapshot = getModelsViewSnapshot();

    expect(snapshot).toContain("planner_fast");
    expect(snapshot).toContain("executor_default");
    expect(snapshot).toContain("unassigned");
  });

  test("loads models view data from the API", async () => {
    const requests: string[] = [];
    const mockFetch = async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);

      if (url.includes("/model-providers")) {
        return Response.json([
          {
            id: "provider_1",
            key: "openai",
            label: "OpenAI",
            providerKind: "openai",
            status: "active",
          },
        ]);
      }

      if (url.includes("/model-slots")) {
        return Response.json([
          {
            slotKey: "executor_default",
            primaryModel: { id: "model_1", name: "GPT", slug: "gpt-5.4", provider: { key: "openai" } },
            fallbackModel: null,
          },
        ]);
      }

      return Response.json([
        {
          id: "model_1",
          name: "GPT",
          slug: "gpt-5.4",
          provider: { key: "openai" },
        },
      ]);
    };

    const snapshot = await runModelsCommand(["/models", "--project-id", "project_1"], {
      fetch: mockFetch as typeof fetch,
    });

    expect(requests).toHaveLength(3);
    expect(snapshot).toContain("openai (openai, active)");
    expect(snapshot).toContain("executor_default: openai:gpt-5.4");
  });

  test("posts model setup requests to the API", async () => {
    let capturedBody: unknown;
    const mockFetch = async (_input: string | URL | Request, init?: RequestInit) => {
      capturedBody = init?.body ? JSON.parse(String(init.body)) : undefined;

      return Response.json(
        {
          project: { id: "project_1", name: "Test Project" },
          provider: { id: "provider_1", key: "openai", status: "active" },
          model: { id: "model_1", slug: "gpt-5.4" },
          slots: [{ slotKey: "executor_default" }],
        },
        { status: 201 },
      );
    };

    const output = await runModelsCommand(
      [
        "/models:setup",
        "--project-name",
        "Test Project",
        "--provider-key",
        "openai",
        "--provider-kind",
        "openai",
        "--status",
        "active",
        "--secret-env",
        "OPENAI_API_KEY",
        "--model-name",
        "GPT",
        "--model-slug",
        "gpt-5.4",
        "--capabilities",
        "tools,json",
      ],
      { fetch: mockFetch as typeof fetch },
    );

    expect(output).toContain("Setup project Test Project");
    expect(capturedBody).toMatchObject({
      providerKey: "openai",
      providerStatus: "active",
      modelSlug: "gpt-5.4",
      capabilities: ["tools", "json"],
    });
  });

  test("runs the planner smoke flow through API-backed commands", async () => {
    const requests: Array<{ method: string; url: string; body?: unknown }> = [];
    const state = {
      project: {
        id: "project_1",
        name: "Planner Project",
        rootPath: "c:/repo",
        baseBranch: "main",
      },
      plannerRun: {
        id: "planner_1",
        projectId: "project_1",
        status: "interviewing",
        goal: "Implement planner slice",
        summary: null as string | null,
        interview: {} as Record<string, unknown>,
        proposalSummary: {
          epicCount: 0,
          taskCount: 0,
          verificationPlanCount: 0,
        },
        epics: [] as Array<{
          key: string;
          title: string;
          tasks: Array<{
            id: string;
            stableId: string;
            title: string;
            status: string;
            epic?: { key: string; title: string };
          }>;
        }>,
      },
      tasks: [] as Array<{
        id: string;
        stableId: string;
        title: string;
        status: string;
        epic?: { key: string; title: string };
      }>,
      approvals: [] as Array<{
        id: string;
        subjectType: string;
        subjectId: string;
        stage: string;
        status: string;
      }>,
    };

    const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ method, url, body });

      if (url.endsWith("/projects") && method === "POST") {
        return Response.json(state.project, { status: 201 });
      }

      if (url.endsWith("/planner/runs") && method === "POST") {
        return Response.json(state.plannerRun, { status: 201 });
      }

      if (url.endsWith(`/planner/runs/${state.plannerRun.id}/answers`) && method === "POST") {
        state.plannerRun.interview = (body as { answers: Record<string, unknown> }).answers;
        return Response.json(state.plannerRun);
      }

      if (url.endsWith(`/planner/runs/${state.plannerRun.id}/generate`) && method === "POST") {
        state.plannerRun.status = "generated";
        state.plannerRun.summary = "Planner slice proposal";
        state.plannerRun.proposalSummary = {
          epicCount: 1,
          taskCount: 1,
          verificationPlanCount: 1,
        };
        state.plannerRun.epics = [
          {
            key: "PLAN-ABC123-EPIC-1",
            title: "Planner Vertical Slice",
            tasks: [
              {
                id: "task_1",
                stableId: "PLAN-ABC123-TASK-1",
                title: "Persist planner proposal",
                status: "planned",
              },
            ],
          },
        ];
        state.tasks = [
          {
            id: "task_1",
            stableId: "PLAN-ABC123-TASK-1",
            title: "Persist planner proposal",
            status: "planned",
            epic: {
              key: "PLAN-ABC123-EPIC-1",
              title: "Planner Vertical Slice",
            },
          },
        ];

        return Response.json(state.plannerRun);
      }

      if (url.endsWith("/approvals") && method === "POST") {
        state.approvals.push({
          id: "approval_1",
          subjectType: "planner_run",
          subjectId: state.plannerRun.id,
          stage: "planner_review",
          status: "granted",
        });
        state.plannerRun.status = "approved";
        state.tasks = state.tasks.map((task) => ({
          ...task,
          status: "awaiting_verification_approval",
        }));
        state.plannerRun.epics = state.plannerRun.epics.map((epic) => ({
          ...epic,
          tasks: epic.tasks.map((task) => ({
            ...task,
            status: "awaiting_verification_approval",
          })),
        }));

        return Response.json(state.approvals[0], { status: 201 });
      }

      if (url.includes("/tasks?")) {
        return Response.json(state.tasks);
      }

      if (url.includes("/approvals?")) {
        return Response.json(state.approvals);
      }

      return Response.json(state.plannerRun);
    };

    const projectOutput = await runPlannerCommand(
      ["/projects:create", "--name", "Planner Project", "--root-path", "c:/repo"],
      { fetch: mockFetch as typeof fetch },
    );
    const plannerOutput = await runPlannerCommand(
      ["/plan", "--project-id", "project_1", "--goal", "Implement planner slice"],
      { fetch: mockFetch as typeof fetch },
    );
    const answerOutput = await runPlannerCommand(
      [
        "/plan:answer",
        "--planner-run-id",
        "planner_1",
        "--answers-json",
        JSON.stringify({ scope: { in: ["planner"] }, verification: { required: ["logic"] } }),
      ],
      { fetch: mockFetch as typeof fetch },
    );
    const generateOutput = await runPlannerCommand(
      ["/plan:generate", "--planner-run-id", "planner_1"],
      { fetch: mockFetch as typeof fetch },
    );
    const approvalOutput = await runPlannerCommand(
      ["/approve:plan", "--project-id", "project_1", "--planner-run-id", "planner_1"],
      { fetch: mockFetch as typeof fetch },
    );
    const taskOutput = await runPlannerCommand(["/tasks", "--project-id", "project_1"], {
      fetch: mockFetch as typeof fetch,
    });
    const approvalsOutput = await runPlannerCommand(
      ["/approvals", "--project-id", "project_1", "--subject-type", "planner_run", "--subject-id", "planner_1"],
      { fetch: mockFetch as typeof fetch },
    );

    expect(projectOutput).toContain("Created project Planner Project");
    expect(plannerOutput).toContain("Started planner run planner_1");
    expect(answerOutput).toContain("Interview Keys: scope, verification");
    expect(generateOutput).toContain("Status: generated");
    expect(generateOutput).toContain("Persist planner proposal");
    expect(approvalOutput).toContain("Recorded granted planner approval");
    expect(taskOutput).toContain("awaiting_verification_approval");
    expect(approvalsOutput).toContain("planner_run/planner_1");
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "POST http://localhost:3000/projects",
      "POST http://localhost:3000/planner/runs",
      "POST http://localhost:3000/planner/runs/planner_1/answers",
      "POST http://localhost:3000/planner/runs/planner_1/generate",
      "POST http://localhost:3000/approvals",
      "GET http://localhost:3000/tasks?projectId=project_1",
      "GET http://localhost:3000/approvals?projectId=project_1&subjectType=planner_run&subjectId=planner_1",
    ]);
  });
});
