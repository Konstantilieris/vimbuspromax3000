import type { PrismaClient } from "@vimbuspromax3000/db/client";
import {
  appendLoopEvent,
  createMcpToolCall,
  getMcpToolByServerAndName,
  getMcpToolCallDetail,
  listMcpServers,
  listMcpToolsForProject,
  updateMcpToolCall,
  upsertMcpServer,
  upsertMcpTool,
} from "@vimbuspromax3000/db";
import { STANDARD_MCP_SERVERS } from "./definitions";
import { hashArgs, normalizeArgs } from "./args";
import { McpValidationError, validateToolArguments } from "./validation";

export { McpValidationError };

export class McpError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "McpError";
  }
}

export type CreateToolCallInput = {
  projectId: string;
  taskExecutionId?: string | null;
  serverName: string;
  toolName: string;
  args: unknown;
};

export type ApproveToolCallInput = {
  operator: string;
  reason?: string | null;
  projectId: string;
};

export function createMcpService(options: { prisma: PrismaClient }) {
  const { prisma } = options;

  return {
    async ensureProjectMcpSetup(projectId: string): Promise<void> {
      for (const serverDef of STANDARD_MCP_SERVERS) {
        const server = await upsertMcpServer(prisma, {
          projectId,
          name: serverDef.name,
          transport: serverDef.transport,
          trustLevel: serverDef.trustLevel,
          status: "active",
        });

        for (const toolDef of serverDef.tools) {
          await upsertMcpTool(prisma, {
            serverId: server.id,
            name: toolDef.name,
            description: toolDef.description,
            mutability: toolDef.mutability,
            approvalRequired: toolDef.approvalRequired,
            inputSchemaJson: toolDef.inputSchemaJson,
            status: "active",
          });
        }
      }
    },

    async listProjectServers(projectId: string) {
      return listMcpServers(prisma, projectId);
    },

    async listProjectTools(projectId: string) {
      return listMcpToolsForProject(prisma, projectId);
    },

    async createToolCall(input: CreateToolCallInput) {
      const tool = await getMcpToolByServerAndName(
        prisma,
        input.projectId,
        input.serverName,
        input.toolName,
      );

      if (!tool) {
        throw new McpError(
          `Tool ${input.serverName}/${input.toolName} was not found for project ${input.projectId}.`,
          "TOOL_NOT_FOUND",
        );
      }

      const validated = validateToolArguments(tool.inputSchemaJson, input.args);
      const normalized = normalizeArgs(validated);
      const argumentsHash = hashArgs(normalized);

      return createMcpToolCall(prisma, {
        projectId: input.projectId,
        taskExecutionId: input.taskExecutionId ?? null,
        toolId: tool.id,
        serverName: input.serverName,
        toolName: input.toolName,
        status: "requested",
        mutability: tool.mutability,
        argumentsHash,
        argumentsJson: normalized,
      });
    },

    async assertToolCallExecutable(callId: string): Promise<void> {
      const call = await getMcpToolCallDetail(prisma, callId);

      if (!call) {
        throw new McpError(`Tool call ${callId} was not found.`, "CALL_NOT_FOUND");
      }

      const approvalRequired = call.tool?.approvalRequired ?? false;

      if (approvalRequired && call.status !== "approved") {
        throw new McpError(
          `Tool call ${callId} requires operator approval before it can be executed.`,
          "APPROVAL_REQUIRED",
        );
      }

      if (["running", "succeeded", "failed"].includes(call.status)) {
        throw new McpError(
          `Tool call ${callId} is already in a terminal or active state: ${call.status}.`,
          "CALL_NOT_EXECUTABLE",
        );
      }
    },

    async approveToolCall(callId: string, input: ApproveToolCallInput) {
      const call = await getMcpToolCallDetail(prisma, callId);

      if (!call) {
        throw new McpError(`Tool call ${callId} was not found.`, "CALL_NOT_FOUND");
      }

      const approvalRequired = call.tool?.approvalRequired ?? false;

      if (!approvalRequired) {
        throw new McpError(
          `Tool call ${callId} does not require approval.`,
          "APPROVAL_NOT_REQUIRED",
        );
      }

      if (call.status !== "requested") {
        throw new McpError(
          `Tool call ${callId} is not in requested state (current: ${call.status}).`,
          "CALL_NOT_PENDING",
        );
      }

      return prisma.$transaction(async (tx) => {
        const approval = await tx.approval.create({
          data: {
            projectId: input.projectId,
            subjectType: "mutating_tool_call",
            subjectId: callId,
            stage: "operator_review",
            status: "granted",
            operator: input.operator,
            reason: input.reason ?? null,
          },
        });

        await appendLoopEvent(tx, {
          projectId: input.projectId,
          type: "approval.granted",
          payload: {
            approvalId: approval.id,
            subjectType: "mutating_tool_call",
            subjectId: callId,
          },
        });

        return updateMcpToolCall(tx, callId, {
          status: "approved",
          approvalId: approval.id,
        });
      });
    },
  };
}

export type McpService = ReturnType<typeof createMcpService>;
