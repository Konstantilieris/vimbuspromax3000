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

  test("scenario itself is not yet implemented (scaffold-only)", async () => {
    await expect(
      runDogfoodCommand(["dogfood", "--database-url=postgres://x:y@localhost/z"], {
        env: {},
        cwd: mkdtempSync(join(tmpdir(), "vimbus-dogfood-test-")),
        now: () => fixedNow,
      }),
    ).rejects.toThrow(/scaffolded|implementation lands/i);
  });
});
