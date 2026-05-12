import {
  REVIEW_COMMANDS,
  getReviewListSnapshot,
  getReviewShowSnapshot,
  isReviewCommand,
  runReviewCommand,
} from "./review";

describe("markdown review CLI commands", () => {
  test("renders sparse review snapshots", () => {
    const output = getReviewListSnapshot(
      [
        {
          id: "review_1",
          projectId: "project_1",
          subjectType: "planner_run",
          subjectId: "planner_1",
          title: "Plan review",
          status: "pending",
          stage: "planner_review",
        },
      ],
      "http://localhost:3000",
    );

    expect(output).toContain("markdown reviews");
    expect(output).toContain("pending review_1 Plan review (planner_run/planner_1)");
    expect(output).toContain("http://localhost:3000/review/review_1");
  });

  test("lists review artifacts with filters", async () => {
    const requests: string[] = [];
    const mockFetch = async (input: string | URL | Request) => {
      requests.push(String(input));
      return Response.json([
        {
          id: "review_1",
          projectId: "project_1",
          subjectType: "planner_run",
          subjectId: "planner_1",
          title: "Plan review",
          status: "pending",
          stage: "planner_review",
        },
      ]);
    };

    const output = await runReviewCommand(
      [
        "/review:list",
        "--project-id",
        "project_1",
        "--subject-type",
        "planner_run",
        "--subject-id",
        "planner_1",
        "--status",
        "pending",
      ],
      { fetch: mockFetch as typeof fetch },
    );

    expect(requests).toEqual([
      "http://localhost:3000/review-artifacts?projectId=project_1&subjectType=planner_run&subjectId=planner_1&status=pending",
    ]);
    expect(output).toContain("Plan review");
    expect(output).toContain("http://localhost:3000/review/review_1");
  });

  test("adds markdown reviews from the terminal", async () => {
    const requests: Array<{ method: string; url: string; body?: unknown }> = [];
    const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        method: init?.method ?? "GET",
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return Response.json(
        {
          id: "review_1",
          projectId: "project_1",
          subjectType: "agent_plan",
          subjectId: "plan_1",
          title: "Agent plan",
          status: "pending",
          stage: "agent_review",
        },
        { status: 201 },
      );
    };

    const output = await runReviewCommand(
      [
        "/review:add",
        "--project-id",
        "project_1",
        "--subject-type",
        "agent_plan",
        "--subject-id",
        "plan_1",
        "--title",
        "Agent plan",
        "--markdown",
        "# Agent Plan",
        "--stage",
        "agent_review",
      ],
      { fetch: mockFetch as typeof fetch },
    );

    expect(requests).toEqual([
      {
        method: "POST",
        url: "http://localhost:3000/review-artifacts",
        body: {
          projectId: "project_1",
          subjectType: "agent_plan",
          subjectId: "plan_1",
          title: "Agent plan",
          markdown: "# Agent Plan",
          stage: "agent_review",
        },
      },
    ]);
    expect(output).toBe("Created markdown review review_1: http://localhost:3000/review/review_1");
  });

  test("prints the browser review URL", () => {
    const output = getReviewShowSnapshot("http://localhost:3000/", "review_1");

    expect(output).toContain("Artifact: review_1");
    expect(output).toContain("Open: http://localhost:3000/review/review_1");
  });

  test("exports command predicates", () => {
    for (const command of REVIEW_COMMANDS) {
      expect(isReviewCommand(command)).toBe(true);
    }
    expect(isReviewCommand("/plan")).toBe(false);
  });
});
