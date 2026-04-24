import type { DatabaseClient } from "./types";

export type UpsertMcpServerInput = {
  projectId: string;
  name: string;
  transport?: string;
  endpoint?: string | null;
  trustLevel?: string;
  status?: string;
  authType?: string;
  credentialRefId?: string | null;
  credentialEnv?: string | null;
  credentialLabel?: string | null;
  credentialStatus?: string;
  configJson?: string | null;
};

export type UpsertMcpToolInput = {
  serverId: string;
  name: string;
  description?: string | null;
  mutability?: string;
  approvalRequired?: boolean;
  inputSchemaJson?: string;
  status?: string;
};

export type UpdateMcpToolCallInput = {
  status?: string;
  approvalId?: string | null;
  resultSummary?: string | null;
  errorSummary?: string | null;
  latencyMs?: number | null;
  finishedAt?: Date | null;
};

export async function upsertMcpServer(db: DatabaseClient, input: UpsertMcpServerInput) {
  const credentialRefId = await resolveMcpCredentialRefId(db, {
    projectId: input.projectId,
    serverName: input.name,
    credentialRefId: input.credentialRefId,
    credentialEnv: input.credentialEnv,
    credentialLabel: input.credentialLabel,
    credentialStatus: input.credentialStatus,
  });

  return db.mcpServer.upsert({
    where: {
      projectId_name: {
        projectId: input.projectId,
        name: input.name,
      },
    },
    update: {
      transport: input.transport ?? "stdio",
      endpoint: input.endpoint ?? null,
      trustLevel: input.trustLevel ?? "trusted",
      status: input.status ?? "active",
      authType: input.authType ?? "none",
      credentialRefId,
      configJson: input.configJson ?? null,
    },
    create: {
      projectId: input.projectId,
      name: input.name,
      transport: input.transport ?? "stdio",
      endpoint: input.endpoint ?? null,
      trustLevel: input.trustLevel ?? "trusted",
      status: input.status ?? "active",
      authType: input.authType ?? "none",
      credentialRefId,
      configJson: input.configJson ?? null,
    },
    include: { tools: true, credentialRef: true },
  });
}

export async function listMcpServers(db: DatabaseClient, projectId: string) {
  return db.mcpServer.findMany({
    where: { projectId },
    include: { tools: { orderBy: [{ name: "asc" }] }, credentialRef: true },
    orderBy: [{ name: "asc" }],
  });
}

export async function listMcpToolsForProject(db: DatabaseClient, projectId: string) {
  return db.mcpTool.findMany({
    where: {
      status: "active",
      server: {
        projectId,
        status: "active",
      },
    },
    include: { server: true },
    orderBy: [{ server: { name: "asc" } }, { name: "asc" }],
  });
}

export async function getMcpToolByServerAndName(
  db: DatabaseClient,
  projectId: string,
  serverName: string,
  toolName: string,
) {
  return db.mcpTool.findFirst({
    where: {
      name: toolName,
      server: { projectId, name: serverName },
    },
    include: { server: true },
  });
}

export async function getMcpServer(db: DatabaseClient, id: string) {
  return db.mcpServer.findUnique({
    where: { id },
    include: { tools: true, credentialRef: true },
  });
}

export async function updateMcpServerStatus(
  db: DatabaseClient,
  id: string,
  input: { status: string; lastError?: string | null; lastVerifiedAt?: Date | null },
) {
  return db.mcpServer.update({
    where: { id },
    data: {
      status: input.status,
      lastError: input.lastError ?? null,
      lastVerifiedAt: input.lastVerifiedAt,
    },
    include: { tools: true, credentialRef: true },
  });
}

export async function setMcpServerCredential(
  db: DatabaseClient,
  id: string,
  input: {
    authType: string;
    credentialRefId?: string | null;
    credentialEnv?: string | null;
    credentialLabel?: string | null;
    credentialStatus?: string;
  },
) {
  const server = input.credentialEnv
    ? await db.mcpServer.findUnique({
        where: { id },
        select: { projectId: true, name: true },
      })
    : null;
  const credentialRefId = await resolveMcpCredentialRefId(db, {
    projectId: server?.projectId,
    serverName: server?.name,
    credentialRefId: input.credentialRefId,
    credentialEnv: input.credentialEnv,
    credentialLabel: input.credentialLabel,
    credentialStatus: input.credentialStatus,
  });

  return db.mcpServer.update({
    where: { id },
    data: {
      authType: input.authType,
      credentialRefId,
    },
    include: { tools: true, credentialRef: true },
  });
}

export async function upsertMcpTool(db: DatabaseClient, input: UpsertMcpToolInput) {
  return db.mcpTool.upsert({
    where: {
      serverId_name: {
        serverId: input.serverId,
        name: input.name,
      },
    },
    update: {
      description: input.description ?? null,
      mutability: input.mutability ?? "read",
      approvalRequired: input.approvalRequired ?? false,
      inputSchemaJson: input.inputSchemaJson ?? "{}",
      status: input.status ?? "active",
    },
    create: {
      serverId: input.serverId,
      name: input.name,
      description: input.description ?? null,
      mutability: input.mutability ?? "read",
      approvalRequired: input.approvalRequired ?? false,
      inputSchemaJson: input.inputSchemaJson ?? "{}",
      status: input.status ?? "active",
    },
  });
}

export async function listTaskMcpTools(db: DatabaseClient, taskId: string) {
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: {
      epic: {
        include: {
          project: true,
        },
      },
    },
  });

  if (!task) {
    return null;
  }

  return db.mcpTool.findMany({
    where: {
      status: "active",
      server: {
        projectId: task.epic.projectId,
        status: "active",
      },
    },
    include: { server: true },
    orderBy: [{ server: { name: "asc" } }, { name: "asc" }],
  });
}

export async function createMcpToolCall(
  db: DatabaseClient,
  input: {
    projectId: string;
    taskExecutionId?: string | null;
    toolId?: string | null;
    serverName: string;
    toolName: string;
    status: string;
    mutability: string;
    approvalId?: string | null;
    argumentsHash?: string | null;
    argumentsJson?: string | null;
    resultSummary?: string | null;
    errorSummary?: string | null;
    latencyMs?: number | null;
    finishedAt?: Date | null;
  },
) {
  return db.mcpToolCall.create({
    data: {
      projectId: input.projectId,
      taskExecutionId: input.taskExecutionId ?? null,
      toolId: input.toolId ?? null,
      serverName: input.serverName,
      toolName: input.toolName,
      status: input.status,
      mutability: input.mutability,
      approvalId: input.approvalId ?? null,
      argumentsHash: input.argumentsHash ?? null,
      argumentsJson: input.argumentsJson ?? null,
      resultSummary: input.resultSummary ?? null,
      errorSummary: input.errorSummary ?? null,
      latencyMs: input.latencyMs ?? null,
      finishedAt: input.finishedAt ?? null,
    },
  });
}

export async function updateMcpToolCall(db: DatabaseClient, id: string, input: UpdateMcpToolCallInput) {
  return db.mcpToolCall.update({
    where: { id },
    data: {
      ...(input.status !== undefined && { status: input.status }),
      ...(input.approvalId !== undefined && { approvalId: input.approvalId }),
      ...(input.resultSummary !== undefined && { resultSummary: input.resultSummary }),
      ...(input.errorSummary !== undefined && { errorSummary: input.errorSummary }),
      ...(input.latencyMs !== undefined && { latencyMs: input.latencyMs }),
      ...(input.finishedAt !== undefined && { finishedAt: input.finishedAt }),
    },
  });
}

export async function listMcpToolCallsForExecution(db: DatabaseClient, taskExecutionId: string) {
  return db.mcpToolCall.findMany({
    where: { taskExecutionId },
    include: { tool: true },
    orderBy: [{ createdAt: "asc" }],
  });
}

export async function getMcpToolCall(db: DatabaseClient, id: string) {
  return db.mcpToolCall.findUnique({ where: { id } });
}

export async function getMcpToolCallDetail(db: DatabaseClient, id: string) {
  return db.mcpToolCall.findUnique({
    where: { id },
    include: { tool: true },
  });
}

export async function listMcpToolCalls(
  db: DatabaseClient,
  input: { projectId?: string; taskExecutionId?: string; status?: string; limit?: number },
) {
  return db.mcpToolCall.findMany({
    where: {
      projectId: input.projectId,
      taskExecutionId: input.taskExecutionId,
      status: input.status,
    },
    orderBy: [{ createdAt: "desc" }],
    take: input.limit ?? 100,
  });
}

async function resolveMcpCredentialRefId(
  db: DatabaseClient,
  input: {
    projectId?: string;
    serverName?: string;
    credentialRefId?: string | null;
    credentialEnv?: string | null;
    credentialLabel?: string | null;
    credentialStatus?: string;
  },
): Promise<string | null> {
  if (typeof input.credentialRefId === "string") {
    return input.credentialRefId;
  }

  if (!input.credentialEnv) {
    return null;
  }

  if (!input.projectId) {
    throw new Error("projectId is required to create an MCP credential reference.");
  }

  const label = input.credentialLabel ?? `${input.serverName ?? "MCP server"} env`;
  const credentialRef = await db.projectSecretRef.upsert({
    where: {
      projectId_label: {
        projectId: input.projectId,
        label,
      },
    },
    update: {
      kind: "mcp_server_env",
      storageType: "env",
      reference: input.credentialEnv,
      status: input.credentialStatus ?? "active",
    },
    create: {
      projectId: input.projectId,
      kind: "mcp_server_env",
      label,
      storageType: "env",
      reference: input.credentialEnv,
      status: input.credentialStatus ?? "active",
    },
  });

  return credentialRef.id;
}
