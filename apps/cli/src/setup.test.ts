import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isSetupCommand, runSetupCommand, SETUP_COMMANDS, type SetupSpawnFn } from "./setup";

const PLACEHOLDER_KEY = "sk-ant-test-redacted-1234567890";
const DEFAULT_SETUP_SLOTS = "planner_fast,planner_deep,executor_default,executor_strong,reviewer";

type FetchHandler = (
  url: string,
  init: { method: string; body?: unknown },
) => Promise<Response> | Response;

function makeFetch(handler: FetchHandler): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    return await handler(url, { method, body });
  }) as typeof fetch;
}

function makeSpawn(
  responder: (
    command: string,
    args: readonly string[],
  ) => { exitCode?: number; stdout?: string; stderr?: string },
): SetupSpawnFn {
  return async (command, args) => {
    const result = responder(command, args);
    return {
      exitCode: result.exitCode ?? 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  };
}

describe("Setup CLI dispatch", () => {
  test("isSetupCommand recognizes the documented commands", () => {
    for (const command of SETUP_COMMANDS) {
      expect(isSetupCommand(command)).toBe(true);
    }
    expect(isSetupCommand("/setup")).toBe(true);
    expect(isSetupCommand("/setup:run")).toBe(true);
    expect(isSetupCommand("/something-else")).toBe(false);
  });
});

describe("Setup wizard happy path", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vimbus-setup-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("smoke run with ANTHROPIC_API_KEY in env reaches a green health summary", async () => {
    const spawnCalls: Array<{ command: string; args: readonly string[] }> = [];
    const fetchCalls: Array<{ method: string; url: string }> = [];

    const fetchImpl = makeFetch((url, { method }) => {
      fetchCalls.push({ method, url });

      if (method === "GET" && url.endsWith("/projects")) {
        return Response.json([
          {
            id: "project_1",
            name: "Existing Project",
            rootPath: "C:/repo",
            baseBranch: "main",
          },
        ]);
      }
      if (method === "GET" && url.includes("/model-slots")) {
        return Response.json([
          {
            slotKey: "planner_fast",
            primaryModel: { slug: "claude-opus-4-7", provider: { key: "anthropic" } },
          },
          {
            slotKey: "planner_deep",
            primaryModel: { slug: "claude-opus-4-7", provider: { key: "anthropic" } },
          },
          {
            slotKey: "executor_default",
            primaryModel: { slug: "claude-opus-4-7", provider: { key: "anthropic" } },
          },
          {
            slotKey: "executor_strong",
            primaryModel: { slug: "claude-opus-4-7", provider: { key: "anthropic" } },
          },
          {
            slotKey: "reviewer",
            primaryModel: { slug: "claude-opus-4-7", provider: { key: "anthropic" } },
          },
        ]);
      }
      if (method === "GET" && url.includes("/mcp/servers")) {
        return Response.json([
          { name: "taskgoblin-db", status: "active", transport: "stdio" },
        ]);
      }
      if (method === "POST" && url.endsWith("/mcp/probe")) {
        return Response.json([
          { name: "taskgoblin-db", ok: true, transport: "stdio", message: "ready" },
        ]);
      }
      return new Response("not found", { status: 404 });
    });

    const spawnImpl = makeSpawn((command, args) => {
      spawnCalls.push({ command, args });
      if (args.includes("/models:setup")) {
        return { exitCode: 0, stdout: "Setup project Existing Project; provider anthropic." };
      }
      if (args.includes("/mcp:setup")) {
        return { exitCode: 0, stdout: "Setup MCP for project project_1: created=1 updated=0 unchanged=0." };
      }
      return { exitCode: 0, stdout: "" };
    });

    const output = await runSetupCommand(["/setup", "--smoke"], {
      env: { ANTHROPIC_API_KEY: PLACEHOLDER_KEY },
      fetch: fetchImpl,
      spawn: spawnImpl,
      cwd: "C:/repo",
      isSmoke: true,
      isTty: false,
      configDir: tempDir,
      detectPlaywright: async () => ({ installed: false }),
    });

    expect(output).toContain("Step 1/6: project");
    expect(output).toContain("Step 2/6: credentials");
    expect(output).toContain("Step 3/6: models");
    expect(output).toContain("Step 4/6: mcp");
    expect(output).toContain("Step 5/6: playwright");
    expect(output).toContain("Step 6/6: health");
    expect(output).toContain("Playwright:");
    expect(output).toContain("Found Anthropic API key from env");
    expect(output).toContain("Credential source: env");
    expect(output).toContain("Slots assigned: 5/5");
    expect(output).toContain("Setup complete.");

    expect(spawnCalls.map((call) => call.args.join(" "))).toEqual([
      [
        "run",
        "cli",
        "/models:setup",
        "--project-id",
        "project_1",
        "--provider-key",
        "anthropic",
        "--provider-kind",
        "anthropic",
        "--provider-label",
        "Anthropic",
        "--secret-env",
        "ANTHROPIC_API_KEY",
        "--secret-label",
        "Anthropic API key",
        "--model-name",
        "Claude Opus 4.7",
        "--model-slug",
        "claude-opus-4-7",
        "--capabilities",
        "tools,json,streaming",
        "--status",
        "active",
        "--slots",
        DEFAULT_SETUP_SLOTS,
      ].join(" "),
      ["run", "cli", "/mcp:setup", "--project-id", "project_1"].join(" "),
    ]);
  });

  test("uses credentials from ~/.claude/.credentials.json when env is missing", async () => {
    await writeFile(join(tempDir, ".credentials.json"), JSON.stringify({ apiKey: PLACEHOLDER_KEY }));

    const fetchImpl = makeFetch((url, { method }) => {
      if (method === "GET" && url.endsWith("/projects")) {
        return Response.json([{ id: "project_1", name: "X", rootPath: "/r", baseBranch: "main" }]);
      }
      if (method === "GET" && url.includes("/model-slots")) {
        return Response.json([
          { slotKey: "executor_default", primaryModel: { slug: "claude-opus-4-7" } },
        ]);
      }
      if (method === "GET" && url.includes("/mcp/servers")) {
        return Response.json([]);
      }
      if (method === "POST" && url.endsWith("/mcp/probe")) {
        return Response.json([]);
      }
      return new Response("not found", { status: 404 });
    });

    const spawnImpl = makeSpawn(() => ({ exitCode: 0, stdout: "ok" }));

    const output = await runSetupCommand(["/setup", "--smoke"], {
      env: {},
      fetch: fetchImpl,
      spawn: spawnImpl,
      cwd: "C:/repo",
      isSmoke: true,
      isTty: false,
      configDir: tempDir,
      detectPlaywright: async () => ({ installed: true }),
    });

    expect(output).toContain("Found Anthropic API key from claude-cli");
    expect(output).toContain("Credential source: claude-cli");
    expect(output).toContain("Playwright Chromium already installed.");
  });

  test("passes resolved credentials to subprocesses without mutating process.env", async () => {
    const previousKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const spawnEnvKeys: Array<string | undefined> = [];

    const fetchImpl = makeFetch((url, { method }) => {
      if (method === "GET" && url.endsWith("/projects")) {
        return Response.json([{ id: "project_1", name: "X", rootPath: "/r", baseBranch: "main" }]);
      }
      if (method === "GET" && url.includes("/model-slots")) {
        return Response.json([{ slotKey: "reviewer", primaryModel: { slug: "claude-opus-4-7" } }]);
      }
      if (method === "GET" && url.includes("/mcp/servers")) {
        return Response.json([]);
      }
      if (method === "POST" && url.endsWith("/mcp/probe")) {
        return Response.json([]);
      }
      return new Response("not found", { status: 404 });
    });

    const spawnImpl: SetupSpawnFn = async (_command, _args, options) => {
      spawnEnvKeys.push(options.env.ANTHROPIC_API_KEY);
      return { exitCode: 0, stdout: "ok", stderr: "" };
    };

    try {
      await runSetupCommand(["/setup", "--smoke"], {
        fetch: fetchImpl,
        spawn: spawnImpl,
        discoverCredentials: async () => ({ found: true, source: "interactive", apiKey: PLACEHOLDER_KEY }),
        cwd: "C:/repo",
        isSmoke: true,
        isTty: false,
        configDir: tempDir,
        detectPlaywright: async () => ({ installed: false }),
      });

      expect(spawnEnvKeys).toEqual([PLACEHOLDER_KEY, PLACEHOLDER_KEY]);
      expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    } finally {
      if (previousKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = previousKey;
      }
    }
  });
});

describe("Setup wizard error paths", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vimbus-setup-err-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("smoke without env or file produces actionable provider_secret_missing error", async () => {
    const fetchImpl = makeFetch((url, { method }) => {
      if (method === "GET" && url.endsWith("/projects")) {
        return Response.json([{ id: "project_1", name: "X", rootPath: "/r", baseBranch: "main" }]);
      }
      return new Response("not found", { status: 404 });
    });

    await expect(
      runSetupCommand(["/setup", "--smoke"], {
        env: {},
        fetch: fetchImpl,
        spawn: makeSpawn(() => ({ exitCode: 0 })),
        cwd: "C:/repo",
        isSmoke: true,
        isTty: false,
        configDir: tempDir,
      }),
    ).rejects.toThrow(/ANTHROPIC_API_KEY|credentials\.json/);
  });

  test("models step failure aborts before MCP step", async () => {
    const spawnCalls: string[] = [];
    const fetchImpl = makeFetch((url, { method }) => {
      if (method === "GET" && url.endsWith("/projects")) {
        return Response.json([{ id: "project_1", name: "X", rootPath: "/r", baseBranch: "main" }]);
      }
      return new Response("not found", { status: 404 });
    });
    const spawnImpl: SetupSpawnFn = async (_command, args) => {
      spawnCalls.push(args.join(" "));
      if (args.includes("/models:setup")) {
        return { exitCode: 2, stdout: "", stderr: "boom: model setup blew up" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    await expect(
      runSetupCommand(["/setup", "--smoke"], {
        env: { ANTHROPIC_API_KEY: PLACEHOLDER_KEY },
        fetch: fetchImpl,
        spawn: spawnImpl,
        cwd: "C:/repo",
        isSmoke: true,
        isTty: false,
        configDir: tempDir,
      }),
    ).rejects.toThrow(/Models setup failed/);

    expect(spawnCalls.some((entry) => entry.includes("/models:setup"))).toBe(true);
    expect(spawnCalls.some((entry) => entry.includes("/mcp:setup"))).toBe(false);
  });

  test("mcp probe failure surfaces as a non-zero summary", async () => {
    const fetchImpl = makeFetch((url, { method }) => {
      if (method === "GET" && url.endsWith("/projects")) {
        return Response.json([{ id: "project_1", name: "X", rootPath: "/r", baseBranch: "main" }]);
      }
      if (method === "GET" && url.includes("/model-slots")) {
        return Response.json([{ slotKey: "executor_default", primaryModel: { slug: "x" } }]);
      }
      if (method === "GET" && url.includes("/mcp/servers")) {
        return Response.json([]);
      }
      if (method === "POST" && url.endsWith("/mcp/probe")) {
        return Response.json([
          { name: "taskgoblin-db", ok: false, message: "missing env", missingEnv: ["DATABASE_URL"] },
        ]);
      }
      return new Response("not found", { status: 404 });
    });

    await expect(
      runSetupCommand(["/setup", "--smoke"], {
        env: { ANTHROPIC_API_KEY: PLACEHOLDER_KEY },
        fetch: fetchImpl,
        spawn: makeSpawn(() => ({ exitCode: 0, stdout: "ok" })),
        cwd: "C:/repo",
        isSmoke: true,
        isTty: false,
        configDir: tempDir,
      }),
    ).rejects.toThrow(/Health check failed.*taskgoblin-db/);
  });

  test("unreachable health endpoints fail setup", async () => {
    const fetchImpl = makeFetch((url, { method }) => {
      if (method === "GET" && url.endsWith("/projects")) {
        return Response.json([{ id: "project_1", name: "X", rootPath: "/r", baseBranch: "main" }]);
      }
      if (method === "GET" && url.includes("/model-slots")) {
        return new Response("unavailable", { status: 503 });
      }
      return new Response("not found", { status: 404 });
    });

    await expect(
      runSetupCommand(["/setup", "--smoke"], {
        env: { ANTHROPIC_API_KEY: PLACEHOLDER_KEY },
        fetch: fetchImpl,
        spawn: makeSpawn(() => ({ exitCode: 0, stdout: "ok" })),
        cwd: "C:/repo",
        isSmoke: true,
        isTty: false,
        configDir: tempDir,
      }),
    ).rejects.toThrow(/Health check failed.*model slots endpoint/);
  });
});

describe("Interactive credentials write to claude config", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vimbus-setup-tty-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("TTY flow writes pasted key into ~/.claude/.credentials.json", async () => {
    const fetchImpl = makeFetch((url, { method }) => {
      if (method === "GET" && url.endsWith("/projects")) {
        return Response.json([{ id: "project_1", name: "X", rootPath: "/r", baseBranch: "main" }]);
      }
      if (method === "GET" && url.includes("/model-slots")) {
        return Response.json([{ slotKey: "executor_default", primaryModel: { slug: "x" } }]);
      }
      if (method === "GET" && url.includes("/mcp/servers")) {
        return Response.json([]);
      }
      if (method === "POST" && url.endsWith("/mcp/probe")) {
        return Response.json([]);
      }
      return new Response("not found", { status: 404 });
    });

    const prompts: string[] = [];
    const ask = async (prompt: string) => {
      prompts.push(prompt);
      if (prompt.includes("Select a project")) return "1";
      if (prompt.includes("Anthropic API key")) return PLACEHOLDER_KEY;
      return "";
    };

    const output = await runSetupCommand(["/setup"], {
      env: {},
      fetch: fetchImpl,
      spawn: makeSpawn(() => ({ exitCode: 0, stdout: "ok" })),
      prompt: ask,
      cwd: "C:/repo",
      isSmoke: false,
      isTty: true,
      configDir: tempDir,
      detectPlaywright: async () => ({ installed: true }),
    });

    expect(output).toContain("Wrote API key to");
    const raw = await readFile(join(tempDir, ".credentials.json"), "utf8");
    expect(JSON.parse(raw)).toEqual({ apiKey: PLACEHOLDER_KEY });
    expect(prompts.some((p) => p.includes("Select a project"))).toBe(true);
  });
});

describe("Setup wizard playwright step", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vimbus-setup-pw-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function buildBaseFetch(): typeof fetch {
    return makeFetch((url, { method }) => {
      if (method === "GET" && url.endsWith("/projects")) {
        return Response.json([{ id: "project_1", name: "X", rootPath: "/r", baseBranch: "main" }]);
      }
      if (method === "GET" && url.includes("/model-slots")) {
        return Response.json([{ slotKey: "reviewer", primaryModel: { slug: "claude-opus-4-7" } }]);
      }
      if (method === "GET" && url.includes("/mcp/servers")) {
        return Response.json([]);
      }
      if (method === "POST" && url.endsWith("/mcp/probe")) {
        return Response.json([]);
      }
      return new Response("not found", { status: 404 });
    });
  }

  test("smoke skips playwright install when chromium is missing", async () => {
    const spawnCalls: Array<{ command: string; args: readonly string[] }> = [];
    const spawnImpl: SetupSpawnFn = async (command, args) => {
      spawnCalls.push({ command, args });
      return { exitCode: 0, stdout: "ok", stderr: "" };
    };

    const output = await runSetupCommand(["/setup", "--smoke"], {
      env: { ANTHROPIC_API_KEY: PLACEHOLDER_KEY },
      fetch: buildBaseFetch(),
      spawn: spawnImpl,
      cwd: "C:/repo",
      isSmoke: true,
      isTty: false,
      configDir: tempDir,
      detectPlaywright: async () => ({ installed: false }),
    });

    expect(output).toContain("Skipped (non-interactive)");
    expect(output).toContain("Playwright: skipped (non-interactive)");
    expect(spawnCalls.find((call) => call.command === "npx")).toBeUndefined();
  });

  test("install failure logs warning and does not abort the wizard", async () => {
    const spawnImpl: SetupSpawnFn = async (command, args) => {
      if (command === "npx" && args[0] === "playwright") {
        return { exitCode: 1, stdout: "", stderr: "network error" };
      }
      return { exitCode: 0, stdout: "ok", stderr: "" };
    };

    const output = await runSetupCommand(["/setup", "--install-playwright=true"], {
      env: { ANTHROPIC_API_KEY: PLACEHOLDER_KEY },
      fetch: buildBaseFetch(),
      spawn: spawnImpl,
      cwd: "C:/repo",
      isSmoke: false,
      isTty: false,
      configDir: tempDir,
      detectPlaywright: async () => ({ installed: false, reason: "missing" }),
    });

    expect(output).toContain("Warning: Playwright install failed (exit 1)");
    expect(output).toContain("Playwright: failed (network error)");
    expect(output).toContain("Setup complete.");
  });

  test("--no-playwright explicitly skips playwright step", async () => {
    const spawnCalls: Array<{ command: string; args: readonly string[] }> = [];
    const spawnImpl: SetupSpawnFn = async (command, args) => {
      spawnCalls.push({ command, args });
      return { exitCode: 0, stdout: "ok", stderr: "" };
    };

    const output = await runSetupCommand(["/setup", "--smoke", "--no-playwright"], {
      env: { ANTHROPIC_API_KEY: PLACEHOLDER_KEY },
      fetch: buildBaseFetch(),
      spawn: spawnImpl,
      cwd: "C:/repo",
      isSmoke: true,
      isTty: false,
      configDir: tempDir,
      // detectPlaywright should not even be called when --no-playwright is set, but provide it defensively.
      detectPlaywright: async () => {
        throw new Error("should not be called");
      },
    });

    expect(output).toContain("Skipped (--no-playwright)");
    expect(spawnCalls.find((call) => call.command === "npx")).toBeUndefined();
  });
});
