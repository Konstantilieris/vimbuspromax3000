import type { McpMutability } from "@vimbuspromax3000/shared";
import {
  APPLY_PATCH_INPUT_SCHEMA,
  APPLY_PATCH_TOOL_NAME,
  TASKGOBLIN_PATCH_SERVER_NAME,
} from "./patch";

export {
  ApplyPatchError,
  APPLY_PATCH_INPUT_SCHEMA,
  APPLY_PATCH_TOOL_NAME,
  createPatchWrapper,
  parsePatchSummary,
  TASKGOBLIN_PATCH_SERVER_NAME,
} from "./patch";

export type {
  ApplyPatchErrorCode,
  ApplyPatchFailure,
  ApplyPatchInput,
  ApplyPatchResult,
  ApplyPatchSuccess,
  PatchWrapper,
} from "./patch";

export type WrapperToolDefinition = {
  name: string;
  description: string;
  mutability: McpMutability;
  approvalRequired: boolean;
  inputSchema: Record<string, unknown>;
};

export type WrapperServerDefinition = {
  name: string;
  label: string;
  trustLevel: "trusted";
  tools: WrapperToolDefinition[];
};

/**
 * Registry of MCP wrapper servers implemented in this package via direct
 * function adapters (rather than spawned MCP transports). Used by callers
 * that need to merge wrapper servers with the externally probed catalog.
 */
export const WRAPPER_SERVER_REGISTRY: WrapperServerDefinition[] = [
  {
    name: TASKGOBLIN_PATCH_SERVER_NAME,
    label: "TaskGoblin patch application",
    trustLevel: "trusted",
    tools: [
      {
        name: APPLY_PATCH_TOOL_NAME,
        description:
          "Apply a unified diff to the active task execution worktree. The wrapper looks " +
          "up the execution's project rootPath and asserts the worktree is on the task " +
          "branch (and not the base branch) before invoking git apply --3way.",
        mutability: "write",
        approvalRequired: true,
        inputSchema: APPLY_PATCH_INPUT_SCHEMA as unknown as Record<string, unknown>,
      },
    ],
  },
];
