import { detectClaudeCli } from "./claudeCliDetect";

describe("detectClaudeCli", () => {
  test("reports not found when no candidate exists on PATH", async () => {
    const result = await detectClaudeCli({
      env: { PATH: "/usr/bin:/usr/local/bin" },
      platform: "linux",
      resolveExecutable: async () => null,
      runVersion: async () => ({ stdout: "", code: 0 }),
    });
    expect(result.found).toBe(false);
    if (!result.found) {
      expect(result.reason).toMatch(/not found/i);
    }
  });

  test("returns the detected path and parsed version on success", async () => {
    const result = await detectClaudeCli({
      env: { PATH: "/usr/local/bin" },
      platform: "linux",
      resolveExecutable: async () => "/usr/local/bin/claude",
      runVersion: async () => ({ stdout: "claude version 1.2.3 (build abc)\n", code: 0 }),
    });
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.path).toBe("/usr/local/bin/claude");
      expect(result.version).toBe("1.2.3");
    }
  });

  test("falls back to raw stdout when no semver match is present", async () => {
    const result = await detectClaudeCli({
      env: { PATH: "/x" },
      platform: "linux",
      resolveExecutable: async () => "/x/claude",
      runVersion: async () => ({ stdout: "Claude CLI (preview)\n", code: 0 }),
    });
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.version).toBe("Claude CLI (preview)");
    }
  });

  test("reports a non-zero exit as failure", async () => {
    const result = await detectClaudeCli({
      env: { PATH: "/x" },
      platform: "linux",
      resolveExecutable: async () => "/x/claude",
      runVersion: async () => ({ stdout: "", code: 2 }),
    });
    expect(result.found).toBe(false);
  });

  test("wraps spawn errors as not-found with a descriptive reason", async () => {
    const result = await detectClaudeCli({
      env: { PATH: "/x" },
      platform: "linux",
      resolveExecutable: async () => "/x/claude",
      runVersion: async () => {
        throw new Error("EACCES");
      },
    });
    expect(result.found).toBe(false);
    if (!result.found) {
      expect(result.reason).toContain("EACCES");
    }
  });

  test("includes Windows .cmd/.bat variants in the candidate list", async () => {
    let capturedCandidates: readonly string[] = [];
    await detectClaudeCli({
      env: { PATH: "C:\\bin" },
      platform: "win32",
      resolveExecutable: async (candidates) => {
        capturedCandidates = candidates;
        return null;
      },
      runVersion: async () => ({ stdout: "", code: 0 }),
    });
    expect(capturedCandidates).toEqual(
      expect.arrayContaining(["claude.exe", "claude.cmd", "claude.bat", "claude"]),
    );
  });
});
