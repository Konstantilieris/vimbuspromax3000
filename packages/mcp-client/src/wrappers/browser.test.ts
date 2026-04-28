import {
  BROWSER_NAVIGATE_TOOL_NAME,
  BROWSER_RUN_AXE_TOOL_NAME,
  BROWSER_SCREENSHOT_TOOL_NAME,
  createBrowserWrapper,
  TASKGOBLIN_BROWSER_SERVER_NAME,
  type BrowserWrapperRuntime,
} from "./browser";
import { STANDARD_MCP_SERVERS } from "../definitions";
import { vi } from "vitest";

describe("taskgoblin-browser wrapper", () => {
  test("registers navigate, screenshot, and run_axe as read-only tools", () => {
    const server = STANDARD_MCP_SERVERS.find((entry) => entry.name === TASKGOBLIN_BROWSER_SERVER_NAME);

    expect(server).toBeDefined();
    expect(server?.tools.map((tool) => tool.name)).toEqual([
      BROWSER_NAVIGATE_TOOL_NAME,
      BROWSER_SCREENSHOT_TOOL_NAME,
      BROWSER_RUN_AXE_TOOL_NAME,
    ]);
    expect(server?.tools.map((tool) => tool.mutability)).toEqual(["read", "read", "read"]);
    expect(server?.tools.map((tool) => tool.approvalRequired)).toEqual([false, false, false]);
  });

  test("delegates browser operations through the injected runtime", async () => {
    const calls: string[] = [];
    const runtime: BrowserWrapperRuntime = {
      async navigate(input) {
        calls.push(`navigate:${input.url}`);
        return {
          url: input.url,
          title: "Fixture",
          status: 200,
        };
      },
      async screenshot(input) {
        calls.push(`screenshot:${input.url}:${input.outputPath}`);
        return {
          path: input.outputPath,
          viewport: input.viewport ?? { width: 1280, height: 720 },
          bytes: 123,
        };
      },
      async runAxe(input) {
        calls.push(`axe:${input.url}`);
        return {
          url: input.url,
          violations: [
            {
              id: "image-alt",
              impact: "critical",
              description: "Images must have alternate text.",
            },
          ],
          violationCount: 1,
        };
      },
    };
    const wrapper = createBrowserWrapper({ runtime });

    await expect(wrapper.navigate({ url: "file:///fixture.html" })).resolves.toMatchObject({
      ok: true,
      title: "Fixture",
      status: 200,
    });
    await expect(
      wrapper.screenshot({
        url: "file:///fixture.html",
        outputPath: "artifacts/actual.png",
        viewport: { width: 320, height: 240 },
      }),
    ).resolves.toMatchObject({
      ok: true,
      path: "artifacts/actual.png",
      viewport: { width: 320, height: 240 },
      bytes: 123,
    });
    await expect(wrapper.runAxe({ url: "file:///fixture.html" })).resolves.toMatchObject({
      ok: true,
      violationCount: 1,
      violations: [{ id: "image-alt" }],
    });
    expect(calls).toEqual([
      "navigate:file:///fixture.html",
      "screenshot:file:///fixture.html:artifacts/actual.png",
      "axe:file:///fixture.html",
    ]);
  });

  test("returns INVALID_ARGUMENTS for malformed inputs before invoking the runtime", async () => {
    const runtime: BrowserWrapperRuntime = {
      navigate: vi.fn(),
      screenshot: vi.fn(),
      runAxe: vi.fn(),
    };
    const wrapper = createBrowserWrapper({ runtime });

    await expect(wrapper.navigate({ url: "" })).resolves.toMatchObject({
      ok: false,
      code: "INVALID_ARGUMENTS",
    });
    await expect(wrapper.screenshot({ url: "file:///fixture.html" })).resolves.toMatchObject({
      ok: false,
      code: "INVALID_ARGUMENTS",
    });
    expect(runtime.navigate).not.toHaveBeenCalled();
    expect(runtime.screenshot).not.toHaveBeenCalled();
  });
});
