import { JIRA_COMMANDS, isJiraCommand, runJiraCommand } from "./jira";

describe("jira CLI commands", () => {
  test("imports an epic through the API", async () => {
    const requests: Array<{ method: string; url: string; body?: unknown }> = [];
    const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        method: init?.method ?? "GET",
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });

      return Response.json({
        plannerRunId: "planner_1",
        epicId: "epic_1",
        taskIds: ["task_1", "task_2"],
        validationIds: ["validation_1"],
        reviewArtifactId: "artifact_1",
        summary: {
          issueCount: 3,
          taskCount: 2,
          validationCount: 1,
        },
      });
    };

    const output = await runJiraCommand(
      ["/jira:import", "--project-id", "project_1", "--epic", "HC-76"],
      { fetch: mockFetch as typeof fetch },
    );

    expect(requests).toEqual([
      {
        method: "POST",
        url: "http://localhost:3000/jira/import",
        body: {
          projectId: "project_1",
          epicKey: "HC-76",
        },
      },
    ]);
    expect(output).toContain("planner run planner_1");
    expect(output).toContain("Review artifact: artifact_1");
  });

  test("imports by JQL with an acceptance criteria field", async () => {
    const requests: unknown[] = [];
    const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return Response.json({
        plannerRunId: "planner_1",
        epicId: "epic_1",
        taskIds: [],
        validationIds: [],
        reviewArtifactId: "artifact_1",
      });
    };

    await runJiraCommand(
      [
        "/jira:import",
        "--project-id=project_1",
        "--jql",
        "project = HC",
        "--acceptance-criteria-field",
        "customfield_10049",
      ],
      { fetch: mockFetch as typeof fetch },
    );

    expect(requests).toEqual([
      {
        projectId: "project_1",
        jql: "project = HC",
        acceptanceCriteriaField: "customfield_10049",
      },
    ]);
  });

  test("requires a project and import selector", async () => {
    await expect(runJiraCommand(["/jira:import", "--epic", "HC-76"])).rejects.toThrow(
      "Missing required option --project-id.",
    );
    await expect(runJiraCommand(["/jira:import", "--project-id", "project_1"])).rejects.toThrow(
      "Missing required option --epic or --jql.",
    );
  });

  test("exports command predicates", () => {
    for (const command of JIRA_COMMANDS) {
      expect(isJiraCommand(command)).toBe(true);
    }
    expect(isJiraCommand("/validation:list")).toBe(false);
  });
});
