import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveVimbusStatePath, VIMBUS_STATE_FILENAME } from "./configPath";
import { readVimbusState } from "./readState";
import { writeVimbusState } from "./writeState";

describe("resolveVimbusStatePath", () => {
  test("anchors at resolveClaudeConfigDir", () => {
    const result = resolveVimbusStatePath({ configDir: "/etc/claude" });
    expect(result.replace(/\\/g, "/")).toBe(`/etc/claude/${VIMBUS_STATE_FILENAME}`);
  });

  test("honors CLAUDE_CONFIG_DIR via env", () => {
    const result = resolveVimbusStatePath({ env: { CLAUDE_CONFIG_DIR: "/custom" } });
    expect(result.replace(/\\/g, "/")).toBe(`/custom/${VIMBUS_STATE_FILENAME}`);
  });
});

describe("vimbus state read/write", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vimbus-state-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("returns empty object when file does not exist", async () => {
    const state = await readVimbusState({ configDir: tempDir });
    expect(state).toEqual({});
  });

  test("write creates file and read round-trips", async () => {
    const result = await writeVimbusState({
      patch: { selectedProjectId: "proj-1", lastApiUrl: "http://api" },
      opts: { configDir: tempDir },
    });

    expect(result.path).toBe(join(tempDir, VIMBUS_STATE_FILENAME));
    expect(result.state).toEqual({
      selectedProjectId: "proj-1",
      lastApiUrl: "http://api",
    });

    const reread = await readVimbusState({ configDir: tempDir });
    expect(reread).toEqual({
      selectedProjectId: "proj-1",
      lastApiUrl: "http://api",
    });
  });

  test("write merges with existing state and removes undefined keys", async () => {
    await writeVimbusState({
      patch: { selectedProjectId: "proj-1", lastApiUrl: "http://api" },
      opts: { configDir: tempDir },
    });
    await writeVimbusState({
      patch: { selectedProjectId: undefined, lastApiUrl: "http://api2" },
      opts: { configDir: tempDir },
    });

    const state = await readVimbusState({ configDir: tempDir });
    expect(state).toEqual({ lastApiUrl: "http://api2" });
  });

  test("write leaves no temp files behind", async () => {
    await writeVimbusState({
      patch: { selectedProjectId: "proj-1" },
      opts: { configDir: tempDir },
    });
    const entries = await readdir(tempDir);
    expect(entries).toContain(VIMBUS_STATE_FILENAME);
    expect(entries.filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });

  test("read tolerates corrupt JSON", async () => {
    const fs = await import("node:fs/promises");
    await fs.writeFile(join(tempDir, VIMBUS_STATE_FILENAME), "{ not json", "utf8");
    const state = await readVimbusState({ configDir: tempDir });
    expect(state).toEqual({});
  });
});
