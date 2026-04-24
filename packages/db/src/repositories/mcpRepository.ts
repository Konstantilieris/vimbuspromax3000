import type { DatabaseClient } from "./types";

export type UpsertMcpServerInput = {
  projectId: string;
  name: string;
  transport: string;
  trustLevel: string;
  status: string;
  endpoint?: string | null;
  configJson?: string | null;
};

export type UpsertMcpToolInput = {
  serverId: string;
  name: string;
  description?: string | null;
  mutability: string;
  approvalRequired: boolean;
  inputSchemaJson: string;
  status: string;
};

export type CreateMcpToolCallInput = {
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
  return db.mcpServer.upsert({
    where: { projectId_name: { projectId: input.projectId, name: input.name } },
    update: {
      transport: input.transport,
      trustLevel: input.trustLevel,
      status: input.status,
      endpoint: input.endpoint ?? null,
      configJson: input.configJson ?? null,
    },
    create: {
      projectId: input.projectId,
      name: input.name,
      transport: input.transport,
      trustLevel: input.trustLevel,
      status: input.status,
      endpoint: input.endpoint ?? null,
      configJson: input.configJson ?? null,
    },
    include: { tools: true },
  });
}

export async function upsertMcpTool(db: DatabaseClient, input: UpsertMcpToolInput) {
  return db.mcpTool.upsert({
    where: { serverId_name: { serverId: input.serverId, name: input.name } },
    update: {
      description: input.description ?? null,
      mutability: input.mutability,
      approvalRequired: input.approvalRequired,
      inputSchemaJson: input.inputSchemaJson,
      status: input.status,
    },
    create: {
      serverId: input.serverId,
      name: input.name,
      description: input.description ?? null,
      mutability: input.mutability,
      approvalRequired: input.approvalRequired,
      inputSchemaJson: input.inputSchemaJson,
      status: input.status,
    },
  });
}

export async function listMcpServers(db: DatabaseClient, projectId: string) {
  return db.mcpServer.findMany({
    where: { projectId },
    include: { tools: true },
    orderBy: [{ name: "asc" }],
  });
}

export async function listMcpToolsForProject(db: DatabaseClient, projectId: string) {
  return db.mcpTool.findMany({
    where: {
      status: "active",
      server: { projectId, status: "active" },
    },
    include: { server: true },
    orderBy: [{ name: "asc" }],
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

export async function createMcpToolCall(db: DatabaseClient, input: CreateMcpToolCallInput) {
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
