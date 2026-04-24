import { spawnSync } from "node:child_process";
import type { PrismaClient } from "@vimbuspromax3000/db/client";
import {
  appendLoopEvent,
  createMcpToolCall,
  getMcpToolByServerAndName,
  getMcpToolCallDetail,
  getTaskExecutionDetail,
  listMcpServers,
  listMcpToolsForProject,
  updateMcpToolCall,
  upsertMcpServer,
  upsertMcpTool,
} from "@vimbuspromax3000/db";
import { STANDARD_MCP_SERVERS } from "./definitions";
import { hashArgs, normalizeArgs } from "./args";
import { McpValidationError, validateToolArguments } from "./validation";
import {
  executeMcpWrapper,
  isMcpPolicyError,
  McpPolicyError,
  McpWrapperExecutionError,
  type McpWrapperResult,
} from "./wrappers";

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

export type ExecuteToolCallResult =
  | {
      ok: true;
      status: "succeeded";
      call: Awaited<ReturnType<typeof updateMcpToolCall>>;
      result: McpWrapperResult;
    }
  | {
      ok: false;
      status: "blocked" | "failed";
      call: Awaited<ReturnType<typeof updateMcpToolCall>>;
      error: {
        code: string;
        message: string;
      };
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

      return prisma.$transaction(async (tx) => {
        const call = await createMcpToolCall(tx, {
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

        await appendLoopEvent(tx, {
          projectId: input.projectId,
          taskExecutionId: input.taskExecutionId ?? undefined,
          type: "mcp.tool.requested",
          payload: {
            callId: call.id,
            serverName: input.serverName,
            toolName: input.toolName,
            mutability: tool.mutability,
            approvalRequired: tool.approvalRequired,
            argumentsHash,
          },
        });

        return call;
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

      if (["blocked", "running", "succeeded", "failed"].includes(call.status)) {
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

      if (call.projectId !== input.projectId) {
        throw new McpError(
          `Tool call ${callId} does not belong to project ${input.projectId}.`,
          "CALL_PROJECT_MISMATCH",
        );
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

    async executeToolCall(callId: string): Promise<ExecuteToolCallResult> {
      const startedAt = Date.now();
      const call = await getMcpToolCallDetail(prisma, callId);

      if (!call) {
        throw new McpError(`Tool call ${callId} was not found.`, "CALL_NOT_FOUND");
      }

      try {
        assertCallCanStart(call);

        if (!call.tool || call.tool.status !== "active") {
          throw new McpPolicyError(
            `Tool ${call.serverName}/${call.toolName} is not active for this project.`,
            "TOOL_NOT_ACTIVE",
          );
        }

        if (call.tool.mutability !== call.mutability) {
          throw new McpPolicyError(
            `Tool call ${call.id} mutability does not match the tool catalog.`,
            "MUTABILITY_MISMATCH",
          );
        }

        const args = parsePersistedArguments(call.argumentsJson);
        const validatedArgs = validatePersistedArguments(call.tool.inputSchemaJson, args);
        const context = await loadToolExecutionContext(prisma, call.projectId, call.taskExecutionId);

        if (call.mutability !== "read") {
          await assertMutatingToolCallAllowed(prisma, call, context.rootPath);
        }

        await updateMcpToolCall(prisma, call.id, {
          status: "running",
        });

        const result = executeMcpWrapper({
          serverName: call.serverName,
          toolName: call.toolName,
          mutability: call.mutability,
          args: validatedArgs,
          context,
        });
        const finishedAt = new Date();
        const resultSummary = normalizeSummary(result.summary);

        const updated = await prisma.$transaction(async (tx) => {
          const persisted = await updateMcpToolCall(tx, call.id, {
            status: "succeeded",
            resultSummary,
            errorSummary: null,
            latencyMs: Date.now() - startedAt,
            finishedAt,
          });

          await appendLoopEvent(tx, {
            projectId: call.projectId,
            taskExecutionId: call.taskExecutionId ?? undefined,
            type: "mcp.tool.completed",
            payload: {
              callId: call.id,
              serverName: call.serverName,
              toolName: call.toolName,
              status: "succeeded",
              latencyMs: persisted.latencyMs,
              resultSummary,
            },
          });

          return persisted;
        });

        return {
          ok: true,
          status: "succeeded",
          call: updated,
          result,
        };
      } catch (error) {
        if (isMcpPolicyError(error)) {
          return persistBlockedToolCall(prisma, call, startedAt, error.code, error.message);
        }

        return persistFailedToolCall(
          prisma,
          call,
          startedAt,
          getExecutionErrorCode(error),
          getErrorMessage(error),
        );
      }
    },
  };
}

export type McpService = ReturnType<typeof createMcpService>;

type McpToolCallDetail = NonNullable<Awaited<ReturnType<typeof getMcpToolCallDetail>>>;

function assertCallCanStart(call: McpToolCallDetail) {
  if (["blocked", "running", "succeeded", "failed"].includes(call.status)) {
    throw new McpPolicyError(
      `Tool call ${call.id} is already in a terminal or active state: ${call.status}.`,
      "CALL_NOT_EXECUTABLE",
    );
  }
}

function parsePersistedArguments(argumentsJson: string | null): Record<string, unknown> {
  if (!argumentsJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(argumentsJson) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new McpPolicyError("Persisted tool arguments must be an object.", "INVALID_ARGUMENTS");
    }

    return parsed as Record<string, unknown>;
  } catch (error) {
    if (isMcpPolicyError(error)) {
      throw error;
    }

    throw new McpPolicyError("Persisted tool arguments are malformed JSON.", "INVALID_ARGUMENTS");
  }
}

function validatePersistedArguments(inputSchemaJson: string, args: Record<string, unknown>) {
  try {
    return validateToolArguments(inputSchemaJson, args);
  } catch (error) {
    if (error instanceof McpValidationError) {
      throw new McpPolicyError(error.message, "INVALID_ARGUMENTS");
    }

    throw error;
  }
}

async function loadToolExecutionContext(
  prisma: PrismaClient,
  projectId: string,
  taskExecutionId: string | null,
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    throw new McpPolicyError(`Project ${projectId} was not found.`, "PROJECT_NOT_FOUND");
  }

  if (taskExecutionId) {
    const execution = await getTaskExecutionDetail(prisma, taskExecutionId);

    if (!execution) {
      throw new McpPolicyError(`Execution ${taskExecutionId} was not found.`, "EXECUTION_NOT_FOUND");
    }

    if (execution.task.epic.project.id !== projectId) {
      throw new McpPolicyError(
        `Execution ${taskExecutionId} does not belong to project ${projectId}.`,
        "EXECUTION_PROJECT_MISMATCH",
      );
    }
  }

  return {
    rootPath: project.rootPath,
  };
}

async function assertMutatingToolCallAllowed(
  prisma: PrismaClient,
  call: McpToolCallDetail,
  rootPath: string,
) {
  const approvalRequired = call.tool?.approvalRequired ?? true;

  if (approvalRequired && call.status !== "approved") {
    throw new McpPolicyError(
      `Tool call ${call.id} requires operator approval before execution.`,
      "APPROVAL_REQUIRED",
    );
  }

  if (approvalRequired && !call.approvalId) {
    throw new McpPolicyError(
      `Tool call ${call.id} is approved but has no linked approval record.`,
      "APPROVAL_LINK_REQUIRED",
    );
  }

  if (call.approvalId) {
    const approval = await prisma.approval.findUnique({
      where: { id: call.approvalId },
    });

    if (
      !approval ||
      approval.subjectType !== "mutating_tool_call" ||
      approval.subjectId !== call.id ||
      approval.status !== "granted"
    ) {
      throw new McpPolicyError(
        `Tool call ${call.id} has an invalid approval link.`,
        "APPROVAL_LINK_INVALID",
      );
    }
  }

  if (!call.taskExecutionId) {
    throw new McpPolicyError(
      `Mutating tool call ${call.id} must be linked to a task execution.`,
      "EXECUTION_REQUIRED",
    );
  }

  const execution = await getTaskExecutionDetail(prisma, call.taskExecutionId);

  if (!execution) {
    throw new McpPolicyError(`Execution ${call.taskExecutionId} was not found.`, "EXECUTION_NOT_FOUND");
  }

  if (!execution.latestVerificationPlan || execution.latestVerificationPlan.status !== "approved") {
    throw new McpPolicyError(
      `Execution ${execution.id} does not have an approved verification plan.`,
      "VERIFICATION_APPROVAL_REQUIRED",
    );
  }

  if (execution.status !== "implementing") {
    throw new McpPolicyError(
      `Execution ${execution.id} is not in implementing state.`,
      "EXECUTION_NOT_MUTABLE",
    );
  }

  if (execution.task.status !== "executing") {
    throw new McpPolicyError(
      `Task ${execution.task.id} is not in executing state.`,
      "TASK_NOT_MUTABLE",
    );
  }

  if (execution.branch.state !== "active") {
    throw new McpPolicyError(
      `Task branch ${execution.branch.name} is not active.`,
      "BRANCH_NOT_ACTIVE",
    );
  }

  assertGitCurrentBranch(rootPath, execution.branch.name, execution.task.epic.project.baseBranch);
}

function assertGitCurrentBranch(rootPath: string, expectedBranch: string, baseBranch: string) {
  const inside = runGit(rootPath, ["rev-parse", "--is-inside-work-tree"]);

  if (inside.stdout.trim() !== "true") {
    throw new McpPolicyError(`Project root ${rootPath} is not a git repository.`, "NOT_GIT_REPOSITORY");
  }

  const currentBranch = runGit(rootPath, ["branch", "--show-current"]).stdout.trim();

  if (currentBranch !== expectedBranch) {
    throw new McpPolicyError(
      `Mutating tool calls must run on ${expectedBranch}, but the current branch is ${currentBranch}.`,
      "BRANCH_MISMATCH",
    );
  }

  if (currentBranch === baseBranch) {
    throw new McpPolicyError(
      `Mutating tool calls cannot run directly on the base branch ${baseBranch}.`,
      "BASE_BRANCH_MUTATION_BLOCKED",
    );
  }
}

function runGit(rootPath: string, args: string[]) {
  const result = spawnSync("git", args, {
    cwd: rootPath,
    encoding: "utf8",
    timeout: 30_000,
  });

  if (result.error || result.status !== 0) {
    throw new McpPolicyError(
      `git ${args.join(" ")} failed: ${normalizeSummary(result.stderr || result.stdout || result.error?.message || "")}`,
      "GIT_POLICY_CHECK_FAILED",
    );
  }

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

async function persistBlockedToolCall(
  prisma: PrismaClient,
  call: McpToolCallDetail,
  startedAt: number,
  code: string,
  message: string,
): Promise<ExecuteToolCallResult> {
  const errorSummary = normalizeSummary(message);
  const finishedAt = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const persisted = await updateMcpToolCall(tx, call.id, {
      status: "blocked",
      errorSummary,
      latencyMs: Date.now() - startedAt,
      finishedAt,
    });

    await appendLoopEvent(tx, {
      projectId: call.projectId,
      taskExecutionId: call.taskExecutionId ?? undefined,
      type: "mcp.tool.blocked",
      payload: {
        callId: call.id,
        serverName: call.serverName,
        toolName: call.toolName,
        code,
        errorSummary,
      },
    });

    return persisted;
  });

  return {
    ok: false,
    status: "blocked",
    call: updated,
    error: {
      code,
      message: errorSummary,
    },
  };
}

async function persistFailedToolCall(
  prisma: PrismaClient,
  call: McpToolCallDetail,
  startedAt: number,
  code: string,
  message: string,
): Promise<ExecuteToolCallResult> {
  const errorSummary = normalizeSummary(message);
  const finishedAt = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const persisted = await updateMcpToolCall(tx, call.id, {
      status: "failed",
      errorSummary,
      latencyMs: Date.now() - startedAt,
      finishedAt,
    });

    await appendLoopEvent(tx, {
      projectId: call.projectId,
      taskExecutionId: call.taskExecutionId ?? undefined,
      type: "mcp.tool.completed",
      payload: {
        callId: call.id,
        serverName: call.serverName,
        toolName: call.toolName,
        status: "failed",
        code,
        latencyMs: persisted.latencyMs,
        errorSummary,
      },
    });

    return persisted;
  });

  return {
    ok: false,
    status: "failed",
    call: updated,
    error: {
      code,
      message: errorSummary,
    },
  };
}

function normalizeSummary(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= 500 ? normalized : `${normalized.slice(0, 499)}...`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getExecutionErrorCode(error: unknown) {
  if (error instanceof McpValidationError) {
    return "INVALID_ARGUMENTS";
  }

  if (error instanceof McpWrapperExecutionError) {
    return error.code;
  }

  return "TOOL_EXECUTION_FAILED";
}
