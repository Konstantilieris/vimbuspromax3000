import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DOGFOOD_COMMANDS,
  formatSummary,
  isDogfoodCommand,
  runDogfoodCommand,
  type DogfoodRunSummary,
} from "./dogfood";

const fixedNow = new Date("2026-04-29T12:00:00.000Z");

describe("dogfood CLI command", () => {
  test("recognizes the documented command predicate", () => {
    expect(DOGFOOD_COMMANDS).toEqual(["dogfood"]);
    expect(isDogfoodCommand("dogfood")).toBe(true);
    expect(isDogfoodCommand("/dogfood")).toBe(false);
    expect(isDogfoodCommand("dog-food")).toBe(false);
  });

  test("formats a run summary with all fields and any notes", () => {
    const summary: DogfoodRunSummary = {
      runId: "fixture_run",
      startedAt: "2026-04-29T12:00:00.000Z",
      finishedAt: "2026-04-29T12:00:01.234Z",
      durationMs: 1234,
      verdict: "scaffold",
      artifactBundlePath: "/tmp/fixture",
      apiUrl: "http://localhost:3000",
      notes: ["dry-run: bundle directory created, scenario skipped"],
    };

    const rendered = formatSummary(summary);
    expect(rendered).toContain("M2 dogfood");
    expect(rendered).toContain("Run: fixture_run");
    expect(rendered).toContain("Started: 2026-04-29T12:00:00.000Z");
    expect(rendered).toContain("Finished: 2026-04-29T12:00:01.234Z");
    expect(rendered).toContain("Duration: 1234ms");
    expect(rendered).toContain("Verdict: scaffold");
    expect(rendered).toContain("API: http://localhost:3000");
    expect(rendered).toContain("Artifacts: /tmp/fixture");
    expect(rendered).toContain("dry-run: bundle directory created, scenario skipped");
  });

  test("dry-run creates the artifact bundle and writes a manifest without driving the scenario", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "vimbus-dogfood-test-"));
    try {
      const output = await runDogfoodCommand(
        ["dogfood", "--dry-run", "--run-id=test_run_123"],
        {
          env: { VIMBUS_API_URL: "http://localhost:3000" },
          cwd,
          now: () => fixedNow,
        },
      );

      expect(output).toContain("Run: test_run_123");
      expect(output).toContain("Verdict: scaffold");

      const manifestPath = join(cwd, ".artifacts", "m2", "test_run_123", "manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as DogfoodRunSummary;
      expect(manifest.runId).toBe("test_run_123");
      expect(manifest.verdict).toBe("scaffold");
      expect(manifest.startedAt).toBe(fixedNow.toISOString());
      expect(manifest.notes).toEqual(["dry-run: bundle directory created, scenario skipped"]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("non-dry-run requires DATABASE_URL", async () => {
    await expect(
      runDogfoodCommand(["dogfood"], { env: {}, cwd: tmpdir(), now: () => fixedNow }),
    ).rejects.toThrow(/DATABASE_URL/);
  });

  test("steps 1-5 drive the deterministic happy path against the API", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "vimbus-dogfood-test-"));
    const requests: Array<{ method: string; url: string; body?: unknown }> = [];
    const mockFetch: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({
        method: init?.method ?? "GET",
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });

      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({ ok: true, status: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/projects") && init?.method === "POST") {
        return new Response(
          JSON.stringify({ id: "proj_dogfood_1", name: "M2 Dogfood (test_run_456)" }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/planner/runs") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "planner_run_1" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/planner/runs/planner_run_1/generate") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "planner_run_1", status: "proposed" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/tasks?projectId=proj_dogfood_1")) {
        return new Response(
          JSON.stringify([{ id: "task_1", stableId: "m2-dogfood-task-1" }]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/tasks/task_1/verification/approve") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "task_1", status: "verifying" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/tasks/task_1/execute/headless") && init?.method === "POST") {
        return new Response(
          JSON.stringify({ id: "exec_1", taskId: "task_1", branchId: "branch_1", status: "implementing" }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }

      return new Response(JSON.stringify({ error: "unexpected route" }), { status: 404 });
    }) as typeof fetch;

    try {
      await expect(
        runDogfoodCommand(
          [
            "dogfood",
            "--api-url=http://localhost:3000",
            "--database-url=postgres://x:y@localhost/z",
            "--run-id=test_run_456",
          ],
          {
            env: {},
            cwd,
            now: () => fixedNow,
            fetch: mockFetch,
          },
        ),
      ).rejects.toThrow(/step 6 .* not yet implemented/i);

      expect(requests[0]).toMatchObject({ method: "GET", url: "http://localhost:3000/health" });
      expect(requests[1]).toMatchObject({
        method: "POST",
        url: "http://localhost:3000/projects",
        body: {
          name: "M2 Dogfood (test_run_456)",
          rootPath: "/tmp/vimbus-m2-dogfood/test_run_456",
          baseBranch: "main",
        },
      });
      expect(requests[2]).toMatchObject({
        method: "POST",
        url: "http://localhost:3000/planner/runs",
        body: {
          projectId: "proj_dogfood_1",
          goal: "M2 dogfood deterministic seed",
        },
      });
      expect(requests[3]?.method).toBe("POST");
      expect(requests[3]?.url).toBe("http://localhost:3000/planner/runs/planner_run_1/generate");
      const proposalBody = requests[3]?.body as { plannerRunId: string; epics: unknown[] };
      expect(proposalBody.plannerRunId).toBe("planner_run_1");
      expect(Array.isArray(proposalBody.epics)).toBe(true);
      expect(proposalBody.epics).toHaveLength(1);
      // Verify the deterministic stableId so a planner-payload regression doesn't
      // silently pass.
      const epic = proposalBody.epics[0] as { tasks: Array<{ stableId: string }> };
      expect(epic.tasks[0]?.stableId).toBe("m2-dogfood-task-1");
      expect(requests[4]).toMatchObject({
        method: "GET",
        url: "http://localhost:3000/tasks?projectId=proj_dogfood_1",
      });
      expect(requests[5]).toMatchObject({
        method: "POST",
        url: "http://localhost:3000/tasks/task_1/verification/approve",
        body: {
          operator: "m2-dogfood",
          reason: "M2 dogfood deterministic auto-approval",
          stage: "verification_review",
        },
      });
      expect(requests[6]).toMatchObject({
        method: "POST",
        url: "http://localhost:3000/tasks/task_1/execute/headless",
        body: {},
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("step 3 surfaces a clear error when the planner seed does not produce the expected task", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "vimbus-dogfood-test-"));
    const mockFetch: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.endsWith("/projects") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "proj_x" }), { status: 201 });
      }
      if (url.endsWith("/planner/runs") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "planner_x" }), { status: 201 });
      }
      if (url.endsWith("/planner/runs/planner_x/generate") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "planner_x" }), { status: 200 });
      }
      if (url.includes("/tasks?projectId=proj_x")) {
        // Return a task with the wrong stableId — simulates a drifted payload
        return new Response(JSON.stringify([{ id: "task_wrong", stableId: "some-other-id" }]), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 404 });
    }) as typeof fetch;

    try {
      await expect(
        runDogfoodCommand(
          ["dogfood", "--database-url=postgres://x:y@localhost/z", "--run-id=test_drift"],
          { env: {}, cwd, now: () => fixedNow, fetch: mockFetch },
        ),
      ).rejects.toThrow(/m2-dogfood-task-1/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("step 1 surfaces a clear error when /health does not return ok", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "vimbus-dogfood-test-"));
    const mockFetch: typeof fetch = (async (_input: string | URL | Request, _init?: RequestInit) => {
      return new Response(JSON.stringify({ status: "draining" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      await expect(
        runDogfoodCommand(
          ["dogfood", "--database-url=postgres://x:y@localhost/z", "--run-id=test_unhealthy"],
          { env: {}, cwd, now: () => fixedNow, fetch: mockFetch },
        ),
      ).rejects.toThrow(/health did not return ok/i);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
