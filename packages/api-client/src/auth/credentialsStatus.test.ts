import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCredentialsStatus } from "./credentialsStatus";

const PLACEHOLDER_KEY = "sk-ant-test-redacted-1234567890";

describe("getCredentialsStatus", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vimbus-creds-status-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("reports env source when ANTHROPIC_API_KEY is set", async () => {
    const result = await getCredentialsStatus({
      env: { ANTHROPIC_API_KEY: PLACEHOLDER_KEY },
      configDir: tempDir,
    });
    expect(result).toEqual({ found: true, source: "env" });
  });

  test("reports claude-cli source when only file is present", async () => {
    await writeFile(
      join(tempDir, ".credentials.json"),
      JSON.stringify({ apiKey: PLACEHOLDER_KEY }),
      "utf8",
    );
    const result = await getCredentialsStatus({ env: {}, configDir: tempDir });
    expect(result).toEqual({ found: true, source: "claude-cli" });
  });

  test("reports not found with reason when nothing is configured", async () => {
    const result = await getCredentialsStatus({ env: {}, configDir: tempDir });
    expect(result.found).toBe(false);
    if (!result.found) {
      expect(result.reason).toMatch(/Could not read|did not contain/);
    }
  });
});
