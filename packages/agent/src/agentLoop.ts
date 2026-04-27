/**
 * VIM-29 Sprint 1 — Execution agent loop scaffold.
 *
 * This module provides a model-runtime-agnostic agent loop. The actual model
 * runtime (Vercel AI SDK `streamText` / `generateText`) is injected via the
 * {@link AgentGenerator} interface so the loop can be unit-tested deterministically
 * with a scripted fake. Sprint 2 will plug the real Vercel AI SDK behind this
 * interface; see `docs/policy/model-selection.md` for the runtime adapter
 * contract.
 *
 * Stop conditions (each persisted on the final {@link AgentStep} via `summary`):
 *   - `finalize`: generator returned `{ type: "finalize" }`.
 *   - `max_turns`: turn counter exhausted (default 25, override via `maxTurns`).
 *   - `tool_error`: a tool call threw or returned a non-ok ExecuteToolCallResult.
 *
 * Default `maxTurns` of 25 follows the model-selection policy; the policy doc
 * does not yet specify a hard number for executor loops, so the conservative
 * default mirrors common single-task agent budgets.
 */

const DEFAULT_MAX_TURNS = 25;

export type AgentTurn = {
  index: number;
  decision: AgentTurnDecision;
  observation: AgentTurnObservation | null;
};

export type AgentTurnDecision =
  | { type: "tool_call"; tool: string; input: unknown }
  | { type: "finalize" };

export type AgentTurnObservation =
  | {
      kind: "tool_result";
      ok: true;
      callId: string;
      summary: string | null;
    }
  | {
      kind: "tool_result";
      ok: false;
      callId: string | null;
      code: string;
      message: string;
    };

export type ToolDef = {
  serverName: string;
  toolName: string;
  description?: string;
  mutability: "read" | "write" | "execute";
  approvalRequired: boolean;
  inputSchema: Record<string, unknown>;
};

export interface AgentGenerator {
  nextTurn(input: {
    history: AgentTurn[];
    toolCatalog: ToolDef[];
  }): Promise<AgentTurnDecision>;
}

export type AgentLoopRepository = {
  createAgentStep(input: {
    taskExecutionId: string;
    role: string;
    modelName: string | null;
    status: "started" | "completed" | "failed";
    summary?: string | null;
    startedAt: Date;
  }): Promise<{ id: string }>;
  updateAgentStep(
    id: string,
    input: {
      status?: "started" | "completed" | "failed";
      summary?: string | null;
      finishedAt?: Date | null;
    },
  ): Promise<void>;
  appendLoopEvent(input: {
    projectId: string;
    taskExecutionId?: string;
    type: string;
    payload: unknown;
  }): Promise<void>;
};

export type AgentLoopMcpService = {
  createToolCall(input: {
    projectId: string;
    taskExecutionId?: string | null;
    serverName: string;
    toolName: string;
    args: unknown;
  }): Promise<{ id: string }>;
  executeToolCall(callId: string): Promise<
    | { ok: true; status: "succeeded"; callId?: string; summary?: string | null; [key: string]: unknown }
    | { ok: false; status: "blocked" | "failed"; callId?: string; error: { code: string; message: string }; [key: string]: unknown }
  >;
};

export type AgentLoopDeps = {
  taskExecutionId: string;
  projectId: string;
  agentRole: string;
  modelName: string | null;
  toolCatalog: ToolDef[];
  generator: AgentGenerator;
  repository: AgentLoopRepository;
  mcpService: AgentLoopMcpService;
  maxTurns?: number;
};

export type AgentLoopStopReason = "finalize" | "max_turns" | "tool_error";

export type AgentLoopResult = {
  stopReason: AgentLoopStopReason;
  turns: number;
  history: AgentTurn[];
  finalAgentStepId: string | null;
};

/**
 * Drives the plan -> tool-call -> observation loop until the generator
 * finalizes, the turn budget is exhausted, or a tool call errors out.
 */
export async function runAgentLoop(deps: AgentLoopDeps): Promise<AgentLoopResult> {
  const maxTurns = deps.maxTurns ?? DEFAULT_MAX_TURNS;
  if (!Number.isFinite(maxTurns) || maxTurns < 1) {
    throw new Error(`runAgentLoop requires a positive maxTurns (got ${String(maxTurns)}).`);
  }

  const history: AgentTurn[] = [];
  let stopReason: AgentLoopStopReason | null = null;
  let lastStepId: string | null = null;
  let lastStepSummary: string | null = null;
  let lastStepStatus: "started" | "completed" | "failed" = "started";

  for (let turnIndex = 1; turnIndex <= maxTurns; turnIndex += 1) {
    const startedAt = new Date();
    const step = await deps.repository.createAgentStep({
      taskExecutionId: deps.taskExecutionId,
      role: deps.agentRole,
      modelName: deps.modelName,
      status: "started",
      summary: `Agent loop turn ${turnIndex}`,
      startedAt,
    });
    lastStepId = step.id;
    lastStepSummary = `Agent loop turn ${turnIndex}`;
    lastStepStatus = "started";

    await deps.repository.appendLoopEvent({
      projectId: deps.projectId,
      taskExecutionId: deps.taskExecutionId,
      type: "agent.step.started",
      payload: {
        agentStepId: step.id,
        taskExecutionId: deps.taskExecutionId,
        role: deps.agentRole,
        modelName: deps.modelName,
        turn: turnIndex,
      },
    });

    let decision: AgentTurnDecision;
    try {
      decision = await deps.generator.nextTurn({
        history,
        toolCatalog: deps.toolCatalog,
      });
    } catch (error) {
      const message = formatError(error);
      lastStepSummary = `Generator failed at turn ${turnIndex}: ${message}`;
      lastStepStatus = "failed";
      await deps.repository.updateAgentStep(step.id, {
        status: "failed",
        summary: lastStepSummary,
        finishedAt: new Date(),
      });
      await deps.repository.appendLoopEvent({
        projectId: deps.projectId,
        taskExecutionId: deps.taskExecutionId,
        type: "agent.step.completed",
        payload: {
          agentStepId: step.id,
          taskExecutionId: deps.taskExecutionId,
          turn: turnIndex,
          status: "failed",
          stopReason: "tool_error",
          summary: lastStepSummary,
        },
      });
      stopReason = "tool_error";
      history.push({ index: turnIndex, decision: { type: "finalize" }, observation: null });
      break;
    }

    let observation: AgentTurnObservation | null = null;

    if (decision.type === "finalize") {
      lastStepSummary = `Agent loop finalized at turn ${turnIndex}.`;
      lastStepStatus = "completed";
      await deps.repository.updateAgentStep(step.id, {
        status: "completed",
        summary: lastStepSummary,
        finishedAt: new Date(),
      });
      await deps.repository.appendLoopEvent({
        projectId: deps.projectId,
        taskExecutionId: deps.taskExecutionId,
        type: "agent.step.completed",
        payload: {
          agentStepId: step.id,
          taskExecutionId: deps.taskExecutionId,
          turn: turnIndex,
          status: "completed",
          stopReason: "finalize",
          summary: lastStepSummary,
        },
      });
      history.push({ index: turnIndex, decision, observation: null });
      stopReason = "finalize";
      break;
    }

    // tool_call branch.
    const parsedTool = parseToolName(decision.tool);
    let toolError: { code: string; message: string } | null = null;
    let callId: string | null = null;

    try {
      const created = await deps.mcpService.createToolCall({
        projectId: deps.projectId,
        taskExecutionId: deps.taskExecutionId,
        serverName: parsedTool.serverName,
        toolName: parsedTool.toolName,
        args: decision.input,
      });
      callId = created.id;
    } catch (error) {
      toolError = {
        code: "TOOL_CALL_CREATE_FAILED",
        message: formatError(error),
      };
    }

    if (!toolError && callId) {
      try {
        const executed = await deps.mcpService.executeToolCall(callId);
        if (executed.ok) {
          observation = {
            kind: "tool_result",
            ok: true,
            callId,
            summary: executed.summary ?? null,
          };
        } else {
          toolError = {
            code: executed.error.code,
            message: executed.error.message,
          };
        }
      } catch (error) {
        toolError = {
          code: "TOOL_CALL_EXECUTE_FAILED",
          message: formatError(error),
        };
      }
    }

    if (toolError) {
      observation = {
        kind: "tool_result",
        ok: false,
        callId,
        code: toolError.code,
        message: toolError.message,
      };
      lastStepSummary = `Tool ${decision.tool} failed at turn ${turnIndex}: ${toolError.message}`;
      lastStepStatus = "failed";
      await deps.repository.updateAgentStep(step.id, {
        status: "failed",
        summary: lastStepSummary,
        finishedAt: new Date(),
      });
      await deps.repository.appendLoopEvent({
        projectId: deps.projectId,
        taskExecutionId: deps.taskExecutionId,
        type: "agent.step.completed",
        payload: {
          agentStepId: step.id,
          taskExecutionId: deps.taskExecutionId,
          turn: turnIndex,
          status: "failed",
          stopReason: "tool_error",
          tool: decision.tool,
          error: toolError,
          summary: lastStepSummary,
        },
      });
      history.push({ index: turnIndex, decision, observation });
      stopReason = "tool_error";
      break;
    }

    lastStepSummary = `Tool ${decision.tool} succeeded at turn ${turnIndex}.`;
    lastStepStatus = "completed";
    await deps.repository.updateAgentStep(step.id, {
      status: "completed",
      summary: lastStepSummary,
      finishedAt: new Date(),
    });
    await deps.repository.appendLoopEvent({
      projectId: deps.projectId,
      taskExecutionId: deps.taskExecutionId,
      type: "agent.step.completed",
      payload: {
        agentStepId: step.id,
        taskExecutionId: deps.taskExecutionId,
        turn: turnIndex,
        status: "completed",
        tool: decision.tool,
        summary: lastStepSummary,
      },
    });
    history.push({ index: turnIndex, decision, observation });
  }

  if (stopReason === null) {
    // Loop exited via max_turns budget exhaustion. Re-record the final step
    // with the stop reason so the persistence story stays self-describing.
    stopReason = "max_turns";

    if (lastStepId) {
      const summary = `Agent loop hit max_turns budget (${maxTurns}). Last status: ${lastStepStatus}.`;
      lastStepSummary = summary;
      await deps.repository.updateAgentStep(lastStepId, {
        status: lastStepStatus === "started" ? "completed" : lastStepStatus,
        summary,
        finishedAt: new Date(),
      });
      await deps.repository.appendLoopEvent({
        projectId: deps.projectId,
        taskExecutionId: deps.taskExecutionId,
        type: "agent.step.completed",
        payload: {
          agentStepId: lastStepId,
          taskExecutionId: deps.taskExecutionId,
          turn: history.length,
          status: lastStepStatus === "started" ? "completed" : lastStepStatus,
          stopReason: "max_turns",
          summary,
        },
      });
    }
  }

  return {
    stopReason,
    turns: history.length,
    history,
    finalAgentStepId: lastStepId,
  };
}

function parseToolName(qualified: string): { serverName: string; toolName: string } {
  const slash = qualified.indexOf("/");
  if (slash <= 0 || slash === qualified.length - 1) {
    throw new Error(
      `Tool identifier ${qualified} must be in the form <serverName>/<toolName>.`,
    );
  }
  return {
    serverName: qualified.slice(0, slash),
    toolName: qualified.slice(slash + 1),
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
