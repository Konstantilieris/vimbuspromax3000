import {
  buildMcpServerSetupPlan,
  checkMcpServerPrerequisites,
  discoverMcpServerTools,
  getStandardMcpServerDefinitions,
  probeMcpServerDefinition,
  testMcpServerDefinition,
  type McpServerDefinition,
} from "./index";

describe("mcp client onboarding helpers", () => {
  test("builds idempotent setup payloads including env-backed credential references", () => {
    const definitions = getStandardMcpServerDefinitions();
    const firstPlan = buildMcpServerSetupPlan({
      projectId: "project_1",
      definitions,
      existingServers: [],
    });

    expect(firstPlan.create).toHaveLength(4);
    const dbPayload = firstPlan.create.find((server) => server.name === "taskgoblin-db");
    expect(dbPayload).toMatchObject({
      projectId: "project_1",
      name: "taskgoblin-db",
      authType: "env_passthrough",
      credentialEnv: "DATABASE_URL",
      credentialLabel: "TaskGoblin database MCP env",
      config: {
        command: "bun",
        args: ["--filter", "@vimbuspromax3000/mcp-server-db", "start"],
        env: ["DATABASE_URL"],
      },
    });

    const secondPlan = buildMcpServerSetupPlan({
      projectId: "project_1",
      definitions,
      existingServers: firstPlan.create.map((payload) => ({
        id: `server_${payload.name}`,
        projectId: payload.projectId,
        name: payload.name,
        transport: payload.transport,
        endpoint: payload.endpoint,
        trustLevel: payload.trustLevel,
        status: payload.status,
        authType: payload.authType,
        credentialRefId: payload.credentialEnv ? `secret_${payload.name}` : null,
        credentialRef: payload.credentialEnv
          ? {
              id: `secret_${payload.name}`,
              kind: "mcp_server_env",
              label: payload.credentialLabel ?? payload.credentialEnv,
              storageType: "env",
              reference: payload.credentialEnv,
              status: "active",
            }
          : null,
        configJson: JSON.stringify(payload.config),
        tools: payload.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          mutability: tool.mutability,
          approvalRequired: tool.approvalRequired,
          inputSchemaJson: JSON.stringify(tool.inputSchema),
          status: tool.status,
        })),
      })),
    });

    expect(secondPlan.create).toHaveLength(0);
    expect(secondPlan.update).toHaveLength(0);
    expect(secondPlan.unchanged).toEqual(definitions.map((definition) => definition.name));
  });

  test("checks prerequisites and probes stdio servers through injected spawn", async () => {
    const definition = getStandardMcpServerDefinitions().find((server) => server.name === "taskgoblin-db");
    expect(definition).toBeDefined();

    expect(checkMcpServerPrerequisites(definition!, {})).toEqual({
      name: "taskgoblin-db",
      ok: false,
      missingEnv: ["DATABASE_URL"],
    });

    const result = await probeMcpServerDefinition(definition!, {
      env: { DATABASE_URL: "file:test.db" },
      spawn: async (invocation) => ({
        code: invocation.command === "bun" && invocation.args.includes("--version") ? 0 : 1,
        stdout: "1.3.13",
      }),
    });

    expect(result).toMatchObject({
      name: "taskgoblin-db",
      ok: true,
      code: 0,
      missingEnv: [],
    });
  });

  test("probes HTTP servers through injected fetch and exposes discovery/test stubs", async () => {
    const definition: McpServerDefinition = {
      name: "remote-docs",
      label: "Remote docs",
      transport: "http",
      endpoint: "https://mcp.example.test/health",
      trustLevel: "restricted",
      authType: "none",
      status: "pending",
      tools: [
        {
          name: "search_docs",
          description: "Search docs.",
          mutability: "read",
          approvalRequired: false,
          inputSchema: { type: "object" },
        },
      ],
    };
    const requests: string[] = [];
    const mockFetch = async (input: string | URL | Request) => {
      requests.push(String(input));
      return Response.json({ ok: true });
    };

    const probe = await testMcpServerDefinition(definition, {
      fetch: mockFetch as typeof fetch,
    });

    expect(requests).toEqual(["https://mcp.example.test/health"]);
    expect(probe.ok).toBe(true);
    expect(discoverMcpServerTools([definition])).toEqual([
      {
        name: "remote-docs",
        label: "Remote docs",
        transport: "http",
        tools: [
          {
            serverName: "remote-docs",
            name: "search_docs",
            description: "Search docs.",
            mutability: "read",
            approvalRequired: false,
            inputSchema: { type: "object" },
            status: "active",
          },
        ],
      },
    ]);
  });
});
