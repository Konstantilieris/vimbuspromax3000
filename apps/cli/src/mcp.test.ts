import { MCP_COMMANDS, getMcpViewSnapshot, isMcpCommand, runMcpCommand } from "./mcp";

describe("MCP CLI commands", () => {
  test("renders MCP command help", () => {
    const snapshot = getMcpViewSnapshot();

    for (const command of MCP_COMMANDS) {
      expect(isMcpCommand(command)).toBe(true);
      expect(snapshot).toContain(command);
    }
  });

  test("lists MCP servers through mocked fetch", async () => {
    const requests: string[] = [];
    const mockFetch = async (input: string | URL | Request) => {
      requests.push(String(input));
      return Response.json([
        {
          id: "server_1",
          name: "taskgoblin-db",
          transport: "stdio",
          status: "active",
          trustLevel: "trusted",
          endpoint: null,
        },
      ]);
    };

    const output = await runMcpCommand(["/mcp:servers", "--project-id", "project_1"], {
      fetch: mockFetch as typeof fetch,
    });

    expect(requests).toEqual(["http://localhost:3000/mcp/servers?projectId=project_1"]);
    expect(output).toContain("taskgoblin-db");
    expect(output).toContain("active");
  });

  test("posts idempotent MCP setup requests", async () => {
    let capturedBody: unknown;
    const mockFetch = async (_input: string | URL | Request, init?: RequestInit) => {
      capturedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return Response.json({
        projectId: "project_1",
        created: [{ id: "server_1", name: "taskgoblin-db", transport: "stdio", status: "pending" }],
        updated: [],
        unchanged: ["taskgoblin-shell"],
      });
    };

    const output = await runMcpCommand(
      ["/mcp:setup", "--project-id", "project_1", "--servers", "taskgoblin-db,taskgoblin-shell", "--activate"],
      { fetch: mockFetch as typeof fetch },
    );

    expect(capturedBody).toEqual({
      projectId: "project_1",
      servers: ["taskgoblin-db", "taskgoblin-shell"],
      activate: true,
    });
    expect(output).toBe("Setup MCP for project project_1: created=1 updated=0 unchanged=1.");
  });

  test("adds MCP servers without sending secret values", async () => {
    const requests: Array<{ url: string; body?: unknown }> = [];
    const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return Response.json({
        id: "server_1",
        name: "remote-docs",
        transport: "http",
        status: "pending",
        authType: "env_passthrough",
      });
    };

    const output = await runMcpCommand(
      [
        "/mcp:add-server",
        "--project-id",
        "project_1",
        "--name",
        "remote-docs",
        "--transport",
        "http",
        "--endpoint",
        "https://mcp.example.test",
        "--secret-env",
        "REMOTE_DOCS_TOKEN",
        "--secret-label",
        "Remote docs MCP token",
      ],
      { fetch: mockFetch as typeof fetch },
    );

    expect(requests).toEqual([
      {
        url: "http://localhost:3000/mcp/servers",
        body: {
          projectId: "project_1",
          name: "remote-docs",
          label: "remote-docs",
          transport: "http",
          endpoint: "https://mcp.example.test",
          trustLevel: "restricted",
          status: "pending",
          authType: "env_passthrough",
          credentialEnv: "REMOTE_DOCS_TOKEN",
          credentialLabel: "Remote docs MCP token",
          config: {
            env: ["REMOTE_DOCS_TOKEN"],
          },
          tools: [],
        },
      },
    ]);
    expect(JSON.stringify(requests[0]?.body)).not.toContain("secret=");
    expect(output).toContain("Added MCP server remote-docs");
  });

  test("sets MCP secret references through mocked fetch", async () => {
    const requests: Array<{ url: string; body?: unknown }> = [];
    const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return Response.json({
        id: "server_1",
        name: "remote-docs",
        transport: "http",
        status: "active",
        authType: "env_passthrough",
      });
    };

    const output = await runMcpCommand(
      [
        "/mcp:set-secret",
        "--server-id",
        "server_1",
        "--secret-env",
        "REMOTE_DOCS_TOKEN",
        "--secret-label",
        "Remote docs MCP token",
      ],
      { fetch: mockFetch as typeof fetch },
    );

    expect(requests).toEqual([
      {
        url: "http://localhost:3000/mcp/servers/server_1/credential",
        body: {
          authType: "env_passthrough",
          credentialEnv: "REMOTE_DOCS_TOKEN",
          credentialLabel: "Remote docs MCP token",
        },
      },
    ]);
    expect(output).toBe("Updated MCP credentials for remote-docs (env_passthrough).");
  });

  test("probes MCP servers through mocked fetch", async () => {
    const mockFetch = async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.body ? JSON.parse(String(init.body)) : undefined).toEqual({
        projectId: "project_1",
        servers: ["taskgoblin-db"],
      });
      return Response.json([
        {
          name: "taskgoblin-db",
          ok: false,
          transport: "stdio",
          message: "Missing environment: DATABASE_URL",
          missingEnv: ["DATABASE_URL"],
        },
      ]);
    };

    const output = await runMcpCommand(["/mcp:probe", "--project-id", "project_1", "--server", "taskgoblin-db"], {
      fetch: mockFetch as typeof fetch,
    });

    expect(output).toContain("failed taskgoblin-db");
    expect(output).toContain("missing-env=DATABASE_URL");
  });
});
