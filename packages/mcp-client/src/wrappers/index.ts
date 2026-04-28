import type { McpMutability } from "@vimbuspromax3000/shared";
import {
  DB_LIST_TABLES_INPUT_SCHEMA,
  DB_LIST_TABLES_TOOL_NAME,
  DB_QUERY_INPUT_SCHEMA,
  DB_QUERY_TOOL_NAME,
  TASKGOBLIN_DB_SERVER_NAME,
} from "./db";
import {
  BROWSER_NAVIGATE_INPUT_SCHEMA,
  BROWSER_NAVIGATE_TOOL_NAME,
  BROWSER_RUN_AXE_INPUT_SCHEMA,
  BROWSER_RUN_AXE_TOOL_NAME,
  BROWSER_SCREENSHOT_INPUT_SCHEMA,
  BROWSER_SCREENSHOT_TOOL_NAME,
  TASKGOBLIN_BROWSER_SERVER_NAME,
} from "./browser";
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

export {
  assertSelectOnly,
  createDbWrapper,
  DB_LIST_TABLES_INPUT_SCHEMA,
  DB_LIST_TABLES_TOOL_NAME,
  DB_QUERY_INPUT_SCHEMA,
  DB_QUERY_TOOL_NAME,
  DbReadError,
  TASKGOBLIN_DB_SERVER_NAME,
} from "./db";

export type {
  DbListTablesFailure,
  DbListTablesResult,
  DbListTablesSuccess,
  DbQueryFailure,
  DbQueryInput,
  DbQueryResult,
  DbQuerySuccess,
  DbReadErrorCode,
  DbWrapper,
} from "./db";

export {
  BROWSER_NAVIGATE_INPUT_SCHEMA,
  BROWSER_NAVIGATE_TOOL_NAME,
  BROWSER_RUN_AXE_INPUT_SCHEMA,
  BROWSER_RUN_AXE_TOOL_NAME,
  BROWSER_SCREENSHOT_INPUT_SCHEMA,
  BROWSER_SCREENSHOT_TOOL_NAME,
  createBrowserWrapper,
  TASKGOBLIN_BROWSER_SERVER_NAME,
} from "./browser";

export type {
  BrowserAxeSuccess,
  BrowserAxeViolation,
  BrowserFailure,
  BrowserNavigateInput,
  BrowserNavigateResult,
  BrowserNavigateSuccess,
  BrowserRunAxeInput,
  BrowserRunAxeResult,
  BrowserScreenshotInput,
  BrowserScreenshotResult,
  BrowserScreenshotSuccess,
  BrowserViewport,
  BrowserWrapper,
  BrowserWrapperErrorCode,
  BrowserWrapperRuntime,
} from "./browser";

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
  {
    name: TASKGOBLIN_DB_SERVER_NAME,
    label: "TaskGoblin read-only database",
    trustLevel: "trusted",
    tools: [
      {
        name: DB_QUERY_TOOL_NAME,
        description:
          "Run a single read-only SELECT (or read-only WITH ... SELECT) against " +
          "the project Prisma database. Mutating statements, multi-statement batches, " +
          "and mutating CTEs are rejected with INVALID_ARGUMENTS.",
        mutability: "read",
        approvalRequired: false,
        inputSchema: DB_QUERY_INPUT_SCHEMA as unknown as Record<string, unknown>,
      },
      {
        name: DB_LIST_TABLES_TOOL_NAME,
        description:
          "List Prisma-managed table names in the project database. Excludes sqlite " +
          "internal tables and Prisma migration metadata.",
        mutability: "read",
        approvalRequired: false,
        inputSchema: DB_LIST_TABLES_INPUT_SCHEMA as unknown as Record<string, unknown>,
      },
    ],
  },
  {
    name: TASKGOBLIN_BROWSER_SERVER_NAME,
    label: "TaskGoblin browser verification",
    trustLevel: "trusted",
    tools: [
      {
        name: BROWSER_NAVIGATE_TOOL_NAME,
        description: "Navigate a Chromium page to a URL and report the loaded document metadata.",
        mutability: "read",
        approvalRequired: false,
        inputSchema: BROWSER_NAVIGATE_INPUT_SCHEMA as unknown as Record<string, unknown>,
      },
      {
        name: BROWSER_SCREENSHOT_TOOL_NAME,
        description: "Capture a Chromium screenshot to an artifact path for visual verification.",
        mutability: "read",
        approvalRequired: false,
        inputSchema: BROWSER_SCREENSHOT_INPUT_SCHEMA as unknown as Record<string, unknown>,
      },
      {
        name: BROWSER_RUN_AXE_TOOL_NAME,
        description: "Run axe-core against a loaded page and return accessibility violations.",
        mutability: "read",
        approvalRequired: false,
        inputSchema: BROWSER_RUN_AXE_INPUT_SCHEMA as unknown as Record<string, unknown>,
      },
    ],
  },
];
