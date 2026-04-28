import {
  BENCHMARK_COMMANDS,
  getBenchmarkRunViewSnapshot,
  isBenchmarkCommand,
  runBenchmarkCommand,
} from "./benchmark";

const benchmarkRunResponse = {
  run: {
    runId: "bench_run_1",
    verdict: "passed",
    aggregateScore: 0.875,
    dimensionScores: [
      {
        dimension: "task_success",
        score: 0.9,
        passThreshold: 0.75,
        passed: true,
      },
      {
        dimension: "regression_safety",
        score: 1,
        passThreshold: 1,
        passed: true,
      },
    ],
  },
  evalRun: {
    id: "eval_run_1",
  },
};

describe("Benchmark CLI commands", () => {
  test("recognizes the documented benchmark command and renders run snapshots", () => {
    expect(BENCHMARK_COMMANDS).toEqual(["benchmark"]);
    expect(isBenchmarkCommand("benchmark")).toBe(true);
    expect(isBenchmarkCommand("/benchmark")).toBe(false);

    const snapshot = getBenchmarkRunViewSnapshot(benchmarkRunResponse, {
      id: "scenario_1",
      name: "HC regression smoke",
    });

    expect(snapshot).toContain("benchmark run");
    expect(snapshot).toContain("Scenario: HC regression smoke (scenario_1)");
    expect(snapshot).toContain("Run: bench_run_1");
    expect(snapshot).toContain("EvalRun: eval_run_1");
    expect(snapshot).toContain("Verdict: passed");
    expect(snapshot).toContain("Aggregate: 0.88");
    expect(snapshot).toContain("- task_success: 0.90 / 0.75 passed");
    expect(snapshot).toContain("- regression_safety: 1 / 1 passed");
  });

  test("runs an explicit benchmark scenario through mocked fetch", async () => {
    const requests: Array<{ method: string; url: string; body?: unknown; headers?: HeadersInit }> = [];
    const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        method: init?.method ?? "GET",
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        headers: init?.headers,
      });
      return Response.json(benchmarkRunResponse, { status: 201 });
    };

    const output = await runBenchmarkCommand(
      [
        "benchmark",
        "run",
        "--execution",
        "exec_1",
        "--scenario-id",
        "scenario/with slash",
        "--run-id",
        "manual_run_1",
      ],
      {
        env: { VIMBUS_API_URL: "http://api.example.test/" },
        fetch: mockFetch as typeof fetch,
      },
    );

    expect(requests).toEqual([
      {
        method: "POST",
        url: "http://api.example.test/benchmarks/scenarios/scenario%2Fwith%20slash/run",
        body: {
          taskExecutionId: "exec_1",
          runId: "manual_run_1",
        },
        headers: { "content-type": "application/json" },
      },
    ]);
    expect(output).toContain("Run: bench_run_1");
    expect(output).toContain("Verdict: passed");
  });

  test("resolves the active scenario before running when scenario id is omitted", async () => {
    const requests: Array<{ method: string; url: string; body?: unknown }> = [];
    const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({
        method,
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });

      if (url.includes("/benchmarks/scenarios?") && method === "GET") {
        return Response.json([{ id: "scenario_1", name: "HC regression smoke" }]);
      }

      if (url.includes("/benchmarks/scenarios/scenario_1/run") && method === "POST") {
        return Response.json(benchmarkRunResponse, { status: 201 });
      }

      return Response.json({ error: "not found" }, { status: 404 });
    };

    const output = await runBenchmarkCommand(
      ["benchmark", "run", "--execution", "exec_1", "--project-id", "project_1", "--status", "ready"],
      { fetch: mockFetch as typeof fetch },
    );

    expect(requests).toEqual([
      {
        method: "GET",
        url: "http://localhost:3000/benchmarks/scenarios?taskExecutionId=exec_1&status=ready&projectId=project_1",
        body: undefined,
      },
      {
        method: "POST",
        url: "http://localhost:3000/benchmarks/scenarios/scenario_1/run",
        body: {
          taskExecutionId: "exec_1",
        },
      },
    ]);
    expect(output).toContain("Scenario: HC regression smoke (scenario_1)");
    expect(output).toContain("Aggregate: 0.88");
  });

  test("surfaces API errors with status and message", async () => {
    const mockFetch = async () => Response.json({ error: "scenario unavailable" }, { status: 409 });

    await expect(
      runBenchmarkCommand(["benchmark", "run", "--execution", "exec_1", "--scenario-id", "scenario_1"], {
        fetch: mockFetch as typeof fetch,
      }),
    ).rejects.toThrow("API 409: scenario unavailable");
  });
});
