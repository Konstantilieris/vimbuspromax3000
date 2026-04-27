/**
 * VIM-29 Sprint 2 — Vercel AI SDK adapter for the execution agent loop.
 *
 * Implements {@link CreateAgentGenerator} on top of the `ai` package's
 * `generateText`. Each {@link AgentGenerator.nextTurn} call:
 *
 *   1. Re-renders the conversation from the loop's `history` (system prompt
 *      + assistant tool calls + tool observations).
 *   2. Calls `generateText` once with the project's MCP tool catalog declared
 *      as schema-only `tool()` entries — no `execute` is provided so the SDK
 *      does NOT auto-execute. The Sprint 1 loop owns execution + persistence
 *      via `mcpService.executeToolCall`, so the adapter just relays the
 *      model's chosen tool call (or a finalize signal) back.
 *   3. Translates the SDK response into an {@link AgentTurnDecision}:
 *        - first `toolCall` -> `{ type: "tool_call", tool, input }`
 *        - none            -> `{ type: "finalize" }`
 *
 * Tool errors are not swallowed: if `generateText` rejects, the loop's
 * existing try/catch surfaces it as `tool_error` via the agent step record.
 *
 * Model resolution is delegated to the same `runtime.ts` helpers used by the
 * planner and evaluator services — keeping the policy slot snapshot the
 * single source of truth for which model handles each turn.
 */

import type { PrismaClient } from "@vimbuspromax3000/db/client";
import {
  generateText,
  jsonSchema,
  tool,
  type GenerateTextResult,
  type LanguageModel,
  type ModelMessage,
  type Tool,
  type ToolSet,
} from "ai";
import type { ResolvedModelSnapshot } from "@vimbuspromax3000/shared";
import type { CreateAgentGenerator } from "../execution";
import type {
  AgentGenerator,
  AgentTurn,
  AgentTurnDecision,
  ToolDef,
} from "../agentLoop";
import { createAiSdkLanguageModel, toRuntimeProviderConfig } from "../runtime";

const DEFAULT_SYSTEM_PROMPT =
  "You are TaskGoblin's execution agent. You complete the assigned task by calling MCP tools from the catalog and observing their results. Each turn, either invoke exactly one tool from the catalog (using the schema as-is) or, when the work is fully verified, respond without any tool call to finalize. Do not invent tools that are not in the catalog. Do not produce free-form prose alongside a tool call.";

export type VercelAiSdkAgentGeneratorOptions = {
  /**
   * Pre-built language model. Tests inject the AI SDK's `MockLanguageModelV3`
   * here. Production code leaves this undefined so the adapter resolves a
   * concrete model via {@link createAiSdkLanguageModel}.
   */
  languageModel?: LanguageModel;
  /** Override the default system prompt (e.g. for evals). */
  systemPrompt?: string;
  /**
   * Per-turn temperature passed to `generateText`. Defaults to `0` for
   * deterministic execution, matching the planner / evaluator services.
   */
  temperature?: number;
};

export type VercelAiSdkAgentGeneratorFactoryOptions = {
  prisma: PrismaClient;
  env?: Record<string, string | undefined>;
} & VercelAiSdkAgentGeneratorOptions;

/**
 * Returns a {@link CreateAgentGenerator} bound to the supplied prisma + env.
 * The returned factory is what `createExecutionService` invokes once per
 * execution to obtain the {@link AgentGenerator} for that loop.
 */
export function createVercelAiSdkAgentGeneratorFactory(
  options: VercelAiSdkAgentGeneratorFactoryOptions,
): CreateAgentGenerator {
  const env = options.env ?? process.env;
  return async (context) => {
    const languageModel =
      options.languageModel ??
      (await resolveLanguageModelForExecution(options.prisma, context.taskExecutionId, env));

    return buildAgentGenerator({
      languageModel,
      taskId: context.taskId,
      modelName: context.modelName,
      systemPrompt: options.systemPrompt,
      temperature: options.temperature,
    });
  };
}

/**
 * Builds a single-shot {@link AgentGenerator} from an already-resolved
 * language model. Exposed for tests + benchmarks that prefer to skip the
 * prisma-backed snapshot lookup.
 */
export function buildAgentGenerator(input: {
  languageModel: LanguageModel;
  taskId: string;
  modelName: string | null;
  systemPrompt?: string;
  temperature?: number;
}): AgentGenerator {
  const systemPrompt = input.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const temperature = input.temperature ?? 0;

  return {
    async nextTurn({ history, toolCatalog }) {
      const messages = renderConversation({
        history,
        taskId: input.taskId,
      });
      const tools = buildToolSet(toolCatalog);

      const result = (await generateText({
        model: input.languageModel,
        system: systemPrompt,
        messages,
        tools,
        temperature,
        maxRetries: 0,
      })) as GenerateTextResult<ToolSet, never>;

      return translateGenerateTextResult(result, toolCatalog);
    },
  };
}

function buildToolSet(toolCatalog: ToolDef[]): ToolSet {
  const tools: Record<string, Tool> = {};

  for (const def of toolCatalog) {
    const sdkName = encodeToolKey(def.serverName, def.toolName);
    tools[sdkName] = tool({
      description: buildToolDescription(def),
      // Schema-only registration; without `execute` the SDK will return the
      // tool call to us instead of auto-running it.
      inputSchema: jsonSchema(def.inputSchema as never),
    });
  }

  return tools as ToolSet;
}

function buildToolDescription(def: ToolDef): string {
  const parts = [def.description?.trim()].filter(Boolean) as string[];
  parts.push(`MCP tool ${def.serverName}/${def.toolName} (${def.mutability}).`);
  if (def.approvalRequired) {
    parts.push("Requires operator approval before execution.");
  }
  return parts.join(" ");
}

/**
 * The Vercel AI SDK uses tool names as object keys, which means slashes are
 * not allowed. We encode `serverName/toolName` -> `serverName__toolName` for
 * the SDK and reverse the encoding when translating the response back.
 */
function encodeToolKey(serverName: string, toolName: string): string {
  return `${serverName}__${toolName}`;
}

function decodeToolKey(
  sdkName: string,
  toolCatalog: ToolDef[],
): { serverName: string; toolName: string } {
  // Prefer a catalog match so we tolerate provider quirks (e.g. mixed casing).
  const match = toolCatalog.find(
    (def) => encodeToolKey(def.serverName, def.toolName) === sdkName,
  );
  if (match) {
    return { serverName: match.serverName, toolName: match.toolName };
  }

  const separator = sdkName.indexOf("__");
  if (separator <= 0 || separator === sdkName.length - 2) {
    throw new Error(
      `AI SDK returned tool name ${sdkName} that does not match any catalog entry.`,
    );
  }
  return {
    serverName: sdkName.slice(0, separator),
    toolName: sdkName.slice(separator + 2),
  };
}

function renderConversation(input: {
  history: AgentTurn[];
  taskId: string;
}): ModelMessage[] {
  const messages: ModelMessage[] = [
    {
      role: "user",
      content:
        `Task ${input.taskId} — proceed with the next execution step. ` +
        "Review the catalog and choose the most appropriate next tool call. " +
        "When all required work is verified, finalize without calling a tool.",
    },
  ];

  for (const turn of input.history) {
    if (turn.decision.type === "finalize") {
      messages.push({
        role: "assistant",
        content: [{ type: "text", text: `Turn ${turn.index}: finalized.` }],
      });
      continue;
    }

    const sdkName = (() => {
      const slash = turn.decision.tool.indexOf("/");
      if (slash <= 0) return turn.decision.tool;
      return encodeToolKey(
        turn.decision.tool.slice(0, slash),
        turn.decision.tool.slice(slash + 1),
      );
    })();
    const toolCallId = `turn-${turn.index}`;

    messages.push({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId,
          toolName: sdkName,
          input: turn.decision.input,
        },
      ],
    });

    if (turn.observation) {
      messages.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId,
            toolName: sdkName,
            // JSONValue accepts arbitrary record shapes at runtime; the cast
            // narrows the helper return to the SDK's stricter compile-time
            // type without needing a deep clone or schema check.
            output: observationToToolOutput(turn.observation) as never,
          },
        ],
      });
    }
  }

  return messages;
}

function observationToToolOutput(observation: NonNullable<AgentTurn["observation"]>) {
  if (observation.ok) {
    return {
      type: "json" as const,
      value: {
        status: "succeeded",
        callId: observation.callId,
        summary: observation.summary,
      } as Record<string, unknown>,
    };
  }
  return {
    type: "json" as const,
    value: {
      status: "failed",
      callId: observation.callId,
      code: observation.code,
      message: observation.message,
    } as Record<string, unknown>,
  };
}

function translateGenerateTextResult(
  result: GenerateTextResult<ToolSet, never>,
  toolCatalog: ToolDef[],
): AgentTurnDecision {
  const toolCalls = result.toolCalls;
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    const first = toolCalls[0];
    if (!first) {
      throw new Error("AI SDK returned an empty toolCalls array entry.");
    }
    const decoded = decodeToolKey(first.toolName, toolCatalog);
    return {
      type: "tool_call",
      tool: `${decoded.serverName}/${decoded.toolName}`,
      input: first.input,
    };
  }
  return { type: "finalize" };
}

async function resolveLanguageModelForExecution(
  prisma: PrismaClient,
  taskExecutionId: string,
  env: Record<string, string | undefined>,
): Promise<LanguageModel> {
  const execution = await prisma.taskExecution.findUnique({
    where: { id: taskExecutionId },
    select: { policyJson: true },
  });

  if (!execution) {
    throw new Error(`Task execution ${taskExecutionId} was not found.`);
  }

  const snapshot = parsePolicySnapshot(execution.policyJson);
  if (!snapshot) {
    throw new Error(
      `Task execution ${taskExecutionId} is missing a model resolution snapshot in policyJson.`,
    );
  }

  const model = await prisma.registeredModel.findUnique({
    where: { id: snapshot.modelId },
    include: {
      provider: {
        include: { secretRef: true },
      },
    },
  });

  if (!model) {
    throw new Error(`Registered model ${snapshot.modelId} was not found.`);
  }

  const apiKey = model.provider.secretRef
    ? env[model.provider.secretRef.reference]
    : undefined;

  return createAiSdkLanguageModel(
    toRuntimeProviderConfig(snapshot, {
      baseUrl: model.provider.baseUrl,
      apiKey,
    }),
  ) as LanguageModel;
}

function parsePolicySnapshot(policyJson: string | null): ResolvedModelSnapshot | null {
  if (!policyJson) return null;
  try {
    const parsed = JSON.parse(policyJson) as { modelResolution?: ResolvedModelSnapshot };
    if (parsed.modelResolution && parsed.modelResolution.modelId) {
      return parsed.modelResolution;
    }
  } catch {
    return null;
  }
  return null;
}
