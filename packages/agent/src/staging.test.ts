import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getPlaywrightStagingPath,
  readPlaywrightStagingFile,
  removePlaywrightStagingFile,
  writePlaywrightStagingFile,
} from "./staging";

describe("Playwright staging files", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "vimbus-playwright-staging-"));
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  test("writes, reads, and removes a validation spec under the API staging tree", () => {
    const input = {
      workspaceRoot,
      taskId: "task_123",
      validationId: "validation_456",
    };
    const code = "import { test } from '@playwright/test';\n\ntest('ok', async () => {});\n";

    const stagingPath = writePlaywrightStagingFile({ ...input, code });

    expect(stagingPath.relativePath).toBe(
      "apps/api/.artifacts/staging/playwright/task_123/validation_456.spec.ts",
    );
    expect(readPlaywrightStagingFile(input)).toBe(code);
    expect(removePlaywrightStagingFile(input)).toBe(true);
    expect(existsSync(stagingPath.absolutePath)).toBe(false);
    expect(removePlaywrightStagingFile(input)).toBe(false);
  });

  test("rejects unsafe path segments", () => {
    expect(() =>
      getPlaywrightStagingPath({
        workspaceRoot,
        taskId: "..",
        validationId: "validation_456",
      }),
    ).toThrow("taskId must be a safe path segment.");
  });
});
