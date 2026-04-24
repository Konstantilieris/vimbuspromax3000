import type { PrismaClient } from "../client";
import { createIsolatedPrisma, removeTempDir } from "../testing";
import { createProject, listMcpServers, setMcpServerCredential, upsertMcpServer } from "./index";

describe("mcp repository", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-mcp-repo-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  });

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test("upserts MCP servers with env-backed credential references", async () => {
    const project = await createProject(prisma, {
      name: "MCP Repo",
      rootPath: tempDir,
    });

    const first = await upsertMcpServer(prisma, {
      projectId: project.id,
      name: "taskgoblin-db",
      authType: "env_passthrough",
      credentialEnv: "DATABASE_URL",
      credentialLabel: "TaskGoblin database MCP env",
    });
    const second = await upsertMcpServer(prisma, {
      projectId: project.id,
      name: "taskgoblin-db",
      authType: "env_passthrough",
      credentialEnv: "DATABASE_URL",
      credentialLabel: "TaskGoblin database MCP env",
    });

    expect(second.id).toBe(first.id);
    expect(second.credentialRef?.reference).toBe("DATABASE_URL");
    expect(second.credentialRef?.kind).toBe("mcp_server_env");
    expect(second.credentialRef?.storageType).toBe("env");

    const secretRefs = await prisma.projectSecretRef.findMany({
      where: { projectId: project.id, kind: "mcp_server_env" },
    });
    expect(secretRefs).toHaveLength(1);
  });

  test("setMcpServerCredential can create and swap env references by input", async () => {
    const project = await createProject(prisma, {
      name: "MCP Secret Repo",
      rootPath: tempDir,
    });
    const server = await upsertMcpServer(prisma, {
      projectId: project.id,
      name: "remote-docs",
      transport: "http",
      endpoint: "https://mcp.example.test",
      authType: "none",
    });

    const updated = await setMcpServerCredential(prisma, server.id, {
      authType: "env_passthrough",
      credentialEnv: "REMOTE_DOCS_TOKEN",
      credentialLabel: "Remote docs MCP token",
    });
    const listed = await listMcpServers(prisma, project.id);

    expect(updated.credentialRef?.reference).toBe("REMOTE_DOCS_TOKEN");
    expect(updated.credentialRef?.label).toBe("Remote docs MCP token");
    expect(listed[0]?.credentialRef?.reference).toBe("REMOTE_DOCS_TOKEN");
  });
});
