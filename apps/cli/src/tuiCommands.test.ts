import { parseTuiCommandLine, runTuiCommandLine } from "./tuiCommands";

describe("interactive TUI command dispatcher", () => {
  test("parses quoted command arguments", () => {
    expect(parseTuiCommandLine('/review:add --title "Demo plan review" --markdown-file "docs\\Plan A.md"')).toEqual([
      "/review:add",
      "--title",
      "Demo plan review",
      "--markdown-file",
      "docs\\Plan A.md",
    ]);
  });

  test("runs slash commands with TUI defaults", async () => {
    const requests: string[] = [];
    const mockFetch = async (input: string | URL | Request) => {
      requests.push(String(input));
      return Response.json([
        {
          id: "review_1",
          projectId: "project_1",
          subjectType: "agent_plan",
          subjectId: "plan_1",
          title: "Agent plan",
          status: "pending",
          stage: "review",
        },
      ]);
    };

    const output = await runTuiCommandLine("/review:list --status pending", {
      apiUrl: "http://localhost:3000",
      projectId: "project_1",
      fetch: mockFetch as typeof fetch,
    });

    expect(requests).toEqual(["http://localhost:3000/review-artifacts?projectId=project_1&status=pending"]);
    expect(output).toContain("Agent plan");
  });

  test("keeps explicit project ids", async () => {
    const requests: string[] = [];
    const mockFetch = async (input: string | URL | Request) => {
      requests.push(String(input));
      return Response.json([]);
    };

    await runTuiCommandLine("/review:list --project-id explicit_project", {
      apiUrl: "http://localhost:3000",
      projectId: "default_project",
      fetch: mockFetch as typeof fetch,
    });

    expect(requests).toEqual(["http://localhost:3000/review-artifacts?projectId=explicit_project"]);
  });

  test("routes validation commands with TUI defaults", async () => {
    const requests: string[] = [];
    const mockFetch = async (input: string | URL | Request) => {
      requests.push(String(input));
      return Response.json([
        {
          id: "validation_1",
          taskId: "task_1",
          testType: "manual",
          status: "proposed",
          title: "Operator checks the output.",
          orderIndex: 0,
        },
      ]);
    };

    const output = await runTuiCommandLine("/validation:list --task-id task_1", {
      apiUrl: "http://localhost:3000",
      projectId: "project_1",
      fetch: mockFetch as typeof fetch,
    });

    expect(requests).toEqual(["http://localhost:3000/tasks/task_1/validations"]);
    expect(output).toContain("Operator checks the output.");
  });

  test("routes Jira import commands with TUI defaults", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return Response.json({
        plannerRunId: "planner_1",
        reviewArtifactId: "review_1",
        summary: { issueCount: 3, taskCount: 1, validationCount: 1 },
      });
    };

    const output = await runTuiCommandLine("/jira:import --epic HC-100", {
      apiUrl: "http://localhost:3000",
      projectId: "project_1",
      fetch: mockFetch as typeof fetch,
    });

    expect(requests).toEqual([
      {
        url: "http://localhost:3000/jira/import",
        body: {
          projectId: "project_1",
          epicKey: "HC-100",
        },
      },
    ]);
    expect(output).toContain("Planner run: planner_1");
  });
});
