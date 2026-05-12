import { PLAYWRIGHT_COMMANDS, isPlaywrightCommand, runPlaywrightCommand } from "./playwright";

describe("playwright CLI commands", () => {
  test("generates a Playwright spec review artifact", async () => {
    const requests: Array<{ method: string; url: string; body?: unknown }> = [];
    const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        method: init?.method ?? "GET",
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });

      return Response.json({
        artifactId: "artifact_1",
        reviewUrl: "/review/artifact_1",
        stagingFilePath: "apps/api/.artifacts/staging/playwright/task_1/validation_1.spec.ts",
      });
    };

    const output = await runPlaywrightCommand(
      ["/playwright:generate", "validation_1", "--route", "/checkout"],
      { fetch: mockFetch as typeof fetch },
    );

    expect(requests).toEqual([
      {
        method: "POST",
        url: "http://localhost:3000/validations/validation_1/generate-spec",
        body: { route: "/checkout" },
      },
    ]);
    expect(output).toContain("Artifact: artifact_1");
    expect(output).toContain("Review: /review/artifact_1");
  });

  test("generates a Playwright spec with --validation-id", async () => {
    const requests: Array<{ method: string; url: string; body?: unknown }> = [];
    const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        method: init?.method ?? "GET",
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });

      return Response.json({
        artifactId: "artifact_2",
        reviewUrl: "/review/artifact_2",
        stagingFilePath: "apps/api/.artifacts/staging/playwright/task_2/validation_2.spec.ts",
      });
    };

    const output = await runPlaywrightCommand(
      ["/playwright:generate", "--validation-id", "validation_2"],
      { fetch: mockFetch as typeof fetch },
    );

    expect(requests).toEqual([
      {
        method: "POST",
        url: "http://localhost:3000/validations/validation_2/generate-spec",
        body: { route: null },
      },
    ]);
    expect(output).toContain("Artifact: artifact_2");
    expect(output).toContain(
      "Staged: apps/api/.artifacts/staging/playwright/task_2/validation_2.spec.ts",
    );
  });

  test("requires a validation id", async () => {
    await expect(runPlaywrightCommand(["/playwright:generate"])).rejects.toThrow(
      "Missing required option --validation-id or positional <validation-id>.",
    );
  });

  test("exports command predicates", () => {
    for (const command of PLAYWRIGHT_COMMANDS) {
      expect(isPlaywrightCommand(command)).toBe(true);
    }
    expect(isPlaywrightCommand("/validation:list")).toBe(false);
  });
});
