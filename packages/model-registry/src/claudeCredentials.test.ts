import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverAnthropicCredentials,
  discoverClaudeCredentialsFile,
  discoverFromEnv,
  resolveClaudeConfigDir,
  resolveClaudeCredentialsPath,
  validateAnthropicKey,
  writeClaudeCredentialsFile,
} from "./claudeCredentials";

const PLACEHOLDER_KEY = "sk-ant-test-redacted-1234567890";
const PLACEHOLDER_KEY_ALT = "sk-ant-test-redacted-2345678901";

describe("validateAnthropicKey", () => {
  test("rejects undefined and empty values", () => {
    expect(validateAnthropicKey(undefined)).toBe(false);
    expect(validateAnthropicKey("")).toBe(false);
    expect(validateAnthropicKey("   ")).toBe(false);
  });

  test("rejects values that are too short to plausibly be a key", () => {
    expect(validateAnthropicKey("sk-ant-x")).toBe(false);
  });

  test("accepts long string values", () => {
    expect(validateAnthropicKey(PLACEHOLDER_KEY)).toBe(true);
  });
});

describe("resolveClaudeConfigDir", () => {
  test("respects an explicit configDir override", () => {
    expect(resolveClaudeConfigDir({ configDir: "C:/tmp/claude" })).toBe("C:/tmp/claude");
  });

  test("respects CLAUDE_CONFIG_DIR env var", () => {
    expect(resolveClaudeConfigDir({ env: { CLAUDE_CONFIG_DIR: "/etc/claude" } })).toBe("/etc/claude");
  });

  test("falls back to homedir/.claude", () => {
    const result = resolveClaudeConfigDir({ env: {}, homedir: "/home/dev" });
    expect(result.replace(/\\/g, "/")).toBe("/home/dev/.claude");
  });

  test("resolveClaudeCredentialsPath joins .credentials.json", () => {
    const result = resolveClaudeCredentialsPath({ configDir: "/etc/claude" });
    expect(result.replace(/\\/g, "/")).toBe("/etc/claude/.credentials.json");
  });
});

describe("discoverFromEnv", () => {
  test("returns found when ANTHROPIC_API_KEY is present", () => {
    expect(discoverFromEnv({ ANTHROPIC_API_KEY: PLACEHOLDER_KEY })).toEqual({
      found: true,
      source: "env",
      apiKey: PLACEHOLDER_KEY,
    });
  });

  test("returns not found when env var is missing", () => {
    const result = discoverFromEnv({});
    expect(result.found).toBe(false);
  });

  test("returns not found when env var is too short", () => {
    const result = discoverFromEnv({ ANTHROPIC_API_KEY: "x" });
    expect(result.found).toBe(false);
  });
});

describe("discoverClaudeCredentialsFile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vimbus-claude-creds-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("returns found when apiKey is present", async () => {
    await writeFile(join(tempDir, ".credentials.json"), JSON.stringify({ apiKey: PLACEHOLDER_KEY }));
    const result = await discoverClaudeCredentialsFile({ configDir: tempDir });
    expect(result).toEqual({ found: true, source: "claude-cli", apiKey: PLACEHOLDER_KEY });
  });

  test("falls back to anthropicApiKey field", async () => {
    await writeFile(
      join(tempDir, ".credentials.json"),
      JSON.stringify({ anthropicApiKey: PLACEHOLDER_KEY }),
    );
    const result = await discoverClaudeCredentialsFile({ configDir: tempDir });
    expect(result).toEqual({ found: true, source: "claude-cli", apiKey: PLACEHOLDER_KEY });
  });

  test("falls back to token field", async () => {
    await writeFile(join(tempDir, ".credentials.json"), JSON.stringify({ token: PLACEHOLDER_KEY }));
    const result = await discoverClaudeCredentialsFile({ configDir: tempDir });
    expect(result).toEqual({ found: true, source: "claude-cli", apiKey: PLACEHOLDER_KEY });
  });

  test("returns not found when no recognized field is present", async () => {
    await writeFile(join(tempDir, ".credentials.json"), JSON.stringify({ unrelated: "value" }));
    const result = await discoverClaudeCredentialsFile({ configDir: tempDir });
    expect(result.found).toBe(false);
  });

  test("returns not found when file is missing", async () => {
    const result = await discoverClaudeCredentialsFile({ configDir: join(tempDir, "missing") });
    expect(result.found).toBe(false);
  });

  test("returns not found without throwing on malformed JSON", async () => {
    await writeFile(join(tempDir, ".credentials.json"), "not-json{");
    const result = await discoverClaudeCredentialsFile({ configDir: tempDir });
    expect(result.found).toBe(false);
  });
});

describe("discoverAnthropicCredentials", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vimbus-claude-creds-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("prefers env over file", async () => {
    await writeFile(
      join(tempDir, ".credentials.json"),
      JSON.stringify({ apiKey: PLACEHOLDER_KEY_ALT }),
    );
    const result = await discoverAnthropicCredentials({
      configDir: tempDir,
      env: { ANTHROPIC_API_KEY: PLACEHOLDER_KEY },
    });
    expect(result).toEqual({ found: true, source: "env", apiKey: PLACEHOLDER_KEY });
  });

  test("falls back to file when env missing", async () => {
    await writeFile(
      join(tempDir, ".credentials.json"),
      JSON.stringify({ apiKey: PLACEHOLDER_KEY_ALT }),
    );
    const result = await discoverAnthropicCredentials({ configDir: tempDir, env: {} });
    expect(result).toEqual({ found: true, source: "claude-cli", apiKey: PLACEHOLDER_KEY_ALT });
  });
});

describe("writeClaudeCredentialsFile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vimbus-claude-creds-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("creates file when none exists", async () => {
    const result = await writeClaudeCredentialsFile({
      apiKey: PLACEHOLDER_KEY,
      opts: { configDir: tempDir },
    });
    expect(result.overwroteExisting).toBe(false);
    expect(result.replacedExistingApiKey).toBe(false);

    const raw = await readFile(result.path, "utf8");
    expect(JSON.parse(raw)).toEqual({ apiKey: PLACEHOLDER_KEY });
  });

  test("does not leave an atomic-write temp file after success", async () => {
    await writeClaudeCredentialsFile({
      apiKey: PLACEHOLDER_KEY,
      opts: { configDir: tempDir },
    });

    const entries = await readdir(tempDir);
    expect(entries.filter((entry) => entry.startsWith(".credentials.json.") || entry.endsWith(".tmp"))).toEqual([]);
  });

  test("creates parent directory when it is missing", async () => {
    const nested = join(tempDir, "nested", ".claude");
    const result = await writeClaudeCredentialsFile({
      apiKey: PLACEHOLDER_KEY,
      opts: { configDir: nested },
    });
    expect(result.overwroteExisting).toBe(false);
    expect(result.replacedExistingApiKey).toBe(false);

    const raw = await readFile(result.path, "utf8");
    expect(JSON.parse(raw)).toEqual({ apiKey: PLACEHOLDER_KEY });
  });

  test("merges into existing JSON without clobbering other fields", async () => {
    await writeFile(
      join(tempDir, ".credentials.json"),
      JSON.stringify({ refreshToken: "rt-existing", lastLoginAt: "2025-01-01T00:00:00Z" }),
    );

    const result = await writeClaudeCredentialsFile({
      apiKey: PLACEHOLDER_KEY,
      opts: { configDir: tempDir },
    });

    expect(result.overwroteExisting).toBe(false);
    expect(result.replacedExistingApiKey).toBe(false);
    const raw = await readFile(result.path, "utf8");
    expect(JSON.parse(raw)).toEqual({
      refreshToken: "rt-existing",
      lastLoginAt: "2025-01-01T00:00:00Z",
      apiKey: PLACEHOLDER_KEY,
    });
  });

  test("reports overwroteExisting when prior apiKey differed", async () => {
    await writeFile(
      join(tempDir, ".credentials.json"),
      JSON.stringify({ apiKey: PLACEHOLDER_KEY_ALT, label: "before" }),
    );

    const result = await writeClaudeCredentialsFile({
      apiKey: PLACEHOLDER_KEY,
      opts: { configDir: tempDir },
    });

    expect(result.overwroteExisting).toBe(true);
    expect(result.replacedExistingApiKey).toBe(true);
    const raw = await readFile(result.path, "utf8");
    expect(JSON.parse(raw)).toEqual({ apiKey: PLACEHOLDER_KEY, label: "before" });
  });

  test("does not report overwriteExisting when prior apiKey was identical", async () => {
    await writeFile(
      join(tempDir, ".credentials.json"),
      JSON.stringify({ apiKey: PLACEHOLDER_KEY }),
    );
    const result = await writeClaudeCredentialsFile({
      apiKey: PLACEHOLDER_KEY,
      opts: { configDir: tempDir },
    });
    expect(result.overwroteExisting).toBe(false);
    expect(result.replacedExistingApiKey).toBe(false);
  });

  test("rejects refusing to write a too-short key", async () => {
    await expect(
      writeClaudeCredentialsFile({ apiKey: "short", opts: { configDir: tempDir } }),
    ).rejects.toThrow(/short/i);
  });
});
