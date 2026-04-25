import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BrowserNotInstalledError, captureScreenshot } from "./capture";

describe("captureScreenshot", () => {
  it("exports BrowserNotInstalledError", () => {
    const error = new BrowserNotInstalledError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("BrowserNotInstalledError");
    expect(error.message).toContain("playwright install chromium");
  });

  it("throws BrowserNotInstalledError for a bogus executable path", async () => {
    const root = join(tmpdir(), `verification-capture-${crypto.randomUUID()}`);
    await mkdir(root, { recursive: true });

    await expect(
      captureScreenshot({
        url: "about:blank",
        outputPath: join(root, "shot.png"),
        browserExecutablePath: join(root, "does-not-exist.exe"),
      }),
    ).rejects.toBeInstanceOf(BrowserNotInstalledError);
  }, 30_000);

  // Live capture is gated on RUN_PLAYWRIGHT_TESTS so CI doesn't need browser installs.
  it.skipIf(!process.env.RUN_PLAYWRIGHT_TESTS)("captures a real page to disk", async () => {
    const root = join(tmpdir(), `verification-capture-${crypto.randomUUID()}`);
    await mkdir(root, { recursive: true });
    const outputPath = join(root, "shot.png");

    const result = await captureScreenshot({
      url: "about:blank",
      outputPath,
      viewport: { width: 320, height: 240 },
    });

    expect(result.path).toBe(outputPath);
    expect(result.viewport).toEqual({ width: 320, height: 240 });
    expect(result.bytes).toBeGreaterThan(0);
  });
});
