import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserNotInstalledError, captureScreenshot } from "./capture";

afterEach(() => {
  vi.doUnmock("playwright-core");
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("captureScreenshot", () => {
  it("exports BrowserNotInstalledError", () => {
    const error = new BrowserNotInstalledError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("BrowserNotInstalledError");
    expect(error.message).toContain("playwright install chromium");
  });

  it("throws BrowserNotInstalledError for a missing browser executable", async () => {
    const root = join(tmpdir(), `verification-capture-${crypto.randomUUID()}`);
    await mkdir(root, { recursive: true });
    const launchError = Object.assign(new Error("Executable doesn't exist at the configured path."), {
      code: "ENOENT",
    });
    vi.doMock("playwright-core", () => ({
      chromium: {
        launch: vi.fn(async () => {
          throw launchError;
        }),
      },
    }));

    await expect(
      captureScreenshot({
        url: "about:blank",
        outputPath: join(root, "shot.png"),
        browserExecutablePath: join(root, "does-not-exist.exe"),
      }),
    ).rejects.toBeInstanceOf(BrowserNotInstalledError);
  }, 30_000);

  it("rethrows launch failures that are not missing-browser errors", async () => {
    const launchError = new Error("Chromium profile is locked by another process.");
    vi.doMock("playwright-core", () => ({
      chromium: {
        launch: vi.fn(async () => {
          throw launchError;
        }),
      },
    }));

    await expect(
      captureScreenshot({
        url: "about:blank",
        outputPath: join(tmpdir(), `verification-capture-${crypto.randomUUID()}.png`),
      }),
    ).rejects.toBe(launchError);
  });

  it("closes the browser context before closing the browser", async () => {
    const root = join(tmpdir(), `verification-capture-${crypto.randomUUID()}`);
    await mkdir(root, { recursive: true });
    const outputPath = join(root, "shot.png");
    const events: string[] = [];

    vi.doMock("playwright-core", () => ({
      chromium: {
        launch: vi.fn(async () => ({
          newContext: vi.fn(async () => ({
            newPage: vi.fn(async () => ({
              goto: vi.fn(async () => {
                events.push("goto");
              }),
              screenshot: vi.fn(async ({ path }: { path: string }) => {
                events.push("screenshot");
                await writeFile(path, "png");
              }),
            })),
            close: vi.fn(async () => {
              events.push("context.close");
            }),
          })),
          close: vi.fn(async () => {
            events.push("browser.close");
          }),
        })),
      },
    }));

    const result = await captureScreenshot({
      url: "about:blank",
      outputPath,
    });

    expect(result.bytes).toBeGreaterThan(0);
    expect(events).toEqual(["goto", "screenshot", "context.close", "browser.close"]);
  });

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
