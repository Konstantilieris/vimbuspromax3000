import { describe, expect, test, vi } from "vitest";
import {
  runAgentLoop,
  type AgentGenerator,
  type AgentLoopDeps,
  type AgentTurnDecision,
  type ToolDef,
} from "./agentLoop";

const TOOL_CATALOG: ToolDef[] = [
  {
    serverName: "taskgoblin-fs-git",
    toolName: "read_file",
    description: "Read a file.",
    mutability: "read",
    approvalRequired: false,
    inputSchema: { type: "object", properties: { path: { type: "string" } } },
  },
];

type StubAgentStep = {
  id: string;
  status: string;
  summary: string | null;
  finishedAt: Date | null;
  createdAt: number;
};

type StubToolCall = {
  id: string;
  serverName: string;
  toolName: string;
  args: unknown;
};

type StubLoopEvent = {
  type: string;
  payload: unknown;
};

function createStubDeps(generator: AgentGenerator): {
  deps: AgentLoopDeps;
  agentSteps: StubAgentStep[];
  toolCalls: StubToolCall[];
  events: StubLoopEvent[];
  executeMock: ReturnType<typeof vi.fn>;
} {
  const agentSteps: StubAgentStep[] = [];
  const toolCalls: StubToolCall[] = [];
  const events: StubLoopEvent[] = [];
  const executeMock = vi.fn(async (callId: string) => ({
    ok: true as const,
    status: "succeeded" as const,
    callId,
    summary: "stub-success",
  }));

  let stepCounter = 0;
  let toolCallCounter = 0;

  const deps: AgentLoopDeps = {
    taskExecutionId: "exec-1",
    projectId: "proj-1",
    agentRole: "executor",
    modelName: "openai:gpt-test",
    toolCatalog: TOOL_CATALOG,
    generator,
    repository: {
      async createAgentStep(input) {
        stepCounter += 1;
        const step: StubAgentStep = {
          id: `step-${stepCounter}`,
          status: input.status,
          summary: input.summary ?? null,
          finishedAt: null,
          createdAt: stepCounter,
        };
        agentSteps.push(step);
        return { id: step.id };
      },
      async updateAgentStep(id, input) {
        const step = agentSteps.find((entry) => entry.id === id);
        if (!step) {
          throw new Error(`Step ${id} not found`);
        }
        if (input.status !== undefined) step.status = input.status;
        if (input.summary !== undefined) step.summary = input.summary;
        if (input.finishedAt !== undefined) step.finishedAt = input.finishedAt;
      },
      async appendLoopEvent(input) {
        events.push({ type: input.type, payload: input.payload });
      },
    },
    mcpService: {
      async createToolCall(input) {
        toolCallCounter += 1;
        const call: StubToolCall = {
          id: `call-${toolCallCounter}`,
          serverName: input.serverName,
          toolName: input.toolName,
          args: input.args,
        };
        toolCalls.push(call);
        // Mirror real `createMcpService.createToolCall` which appends a
        // `mcp.tool.requested` loop event inside the create transaction.
        events.push({
          type: "mcp.tool.requested",
          payload: {
            callId: call.id,
            serverName: input.serverName,
            toolName: input.toolName,
          },
        });
        return { id: call.id };
      },
      executeToolCall: executeMock,
    },
  };

  return { deps, agentSteps, toolCalls, events, executeMock };
}

function scriptedGenerator(decisions: AgentTurnDecision[]): AgentGenerator {
  let index = 0;
  return {
    async nextTurn() {
      const decision = decisions[index];
      if (!decision) {
        throw new Error(`No scripted decision for turn ${index + 1}`);
      }
      index += 1;
      return decision;
    },
  };
}

describe("runAgentLoop", () => {
  test("runs tool_call then finalize, persisting one step per turn", async () => {
    const generator = scriptedGenerator([
      {
        type: "tool_call",
        tool: "taskgoblin-fs-git/read_file",
        input: { path: "README.md" },
      },
      { type: "finalize" },
    ]);
    const { deps, agentSteps, toolCalls, events, executeMock } = createStubDeps(generator);

    const result = await runAgentLoop(deps);

    expect(result.stopReason).toBe("finalize");
    expect(result.turns).toBe(2);
    expect(agentSteps).toHaveLength(2);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.serverName).toBe("taskgoblin-fs-git");
    expect(toolCalls[0]?.toolName).toBe("read_file");
    expect(executeMock).toHaveBeenCalledTimes(1);

    const eventTypes = events.map((event) => event.type);
    expect(eventTypes).toContain("agent.step.started");
    expect(eventTypes).toContain("agent.step.completed");
    expect(eventTypes).toContain("mcp.tool.requested");

    // Both steps should be marked completed at the end.
    expect(agentSteps.every((step) => step.status === "completed")).toBe(true);
  });

  test("stops with max_turns when generator never returns finalize", async () => {
    const generator: AgentGenerator = {
      async nextTurn() {
        return {
          type: "tool_call",
          tool: "taskgoblin-fs-git/read_file",
          input: { path: "README.md" },
        };
      },
    };
    const { deps, agentSteps, toolCalls } = createStubDeps(generator);

    const result = await runAgentLoop({ ...deps, maxTurns: 3 });

    expect(result.stopReason).toBe("max_turns");
    expect(result.turns).toBe(3);
    expect(agentSteps).toHaveLength(3);
    expect(toolCalls).toHaveLength(3);
    // Final step should reflect the stop reason in its summary.
    const finalStep = agentSteps[agentSteps.length - 1];
    expect(finalStep?.summary).toContain("max_turns");
  });

  test("stops with tool_error when a tool call throws", async () => {
    const generator = scriptedGenerator([
      {
        type: "tool_call",
        tool: "taskgoblin-fs-git/read_file",
        input: { path: "missing.md" },
      },
    ]);
    const { deps, agentSteps, executeMock } = createStubDeps(generator);
    executeMock.mockRejectedValueOnce(new Error("boom"));

    const result = await runAgentLoop(deps);

    expect(result.stopReason).toBe("tool_error");
    expect(result.turns).toBe(1);
    expect(agentSteps).toHaveLength(1);
    const finalStep = agentSteps[0];
    expect(finalStep?.status).toBe("failed");
    expect(finalStep?.summary).toContain("boom");
  });
});
