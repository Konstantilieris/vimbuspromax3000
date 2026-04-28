import type { McpMutability } from "@vimbuspromax3000/shared";
import {
  DB_LIST_TABLES_INPUT_SCHEMA,
  DB_LIST_TABLES_TOOL_NAME,
  DB_QUERY_INPUT_SCHEMA,
  DB_QUERY_TOOL_NAME,
  TASKGOBLIN_DB_SERVER_NAME,
} from "./wrappers/db";
import {
  BROWSER_NAVIGATE_INPUT_SCHEMA,
  BROWSER_NAVIGATE_TOOL_NAME,
  BROWSER_RUN_AXE_INPUT_SCHEMA,
  BROWSER_RUN_AXE_TOOL_NAME,
  BROWSER_SCREENSHOT_INPUT_SCHEMA,
  BROWSER_SCREENSHOT_TOOL_NAME,
  TASKGOBLIN_BROWSER_SERVER_NAME,
} from "./wrappers/browser";
import { APPLY_PATCH_INPUT_SCHEMA, TASKGOBLIN_PATCH_SERVER_NAME } from "./wrappers/patch";

type ToolDefinition = {
  name: string;
  description: string;
  mutability: McpMutability;
  approvalRequired: boolean;
  inputSchemaJson: string;
};

type ServerDefinition = {
  name: string;
  transport: "stdio";
  trustLevel: "trusted";
  tools: ToolDefinition[];
};

export const STANDARD_MCP_SERVERS: ServerDefinition[] = [
  {
    name: "taskgoblin-fs-git",
    transport: "stdio",
    trustLevel: "trusted",
    tools: [
      {
        name: "read_file",
        description: "Read the contents of a file at the given path.",
        mutability: "read",
        approvalRequired: false,
        inputSchemaJson: JSON.stringify({
          type: "object",
          properties: {
            path: { type: "string", description: "Absolute or project-relative file path." },
          },
          required: ["path"],
        }),
      },
      {
        name: "grep",
        description: "Search for a regular-expression pattern in files under a directory.",
        mutability: "read",
        approvalRequired: false,
        inputSchemaJson: JSON.stringify({
          type: "object",
          properties: {
            pattern: { type: "string", description: "Regular expression pattern to search for." },
            path: { type: "string", description: "Directory or file to search in." },
          },
          required: ["pattern"],
        }),
      },
      {
        name: "git_status",
        description: "Return the git status of the working tree.",
        mutability: "read",
        approvalRequired: false,
        inputSchemaJson: JSON.stringify({
          type: "object",
          properties: {},
        }),
      },
      {
        name: "git_diff",
        description: "Return the git diff for the current branch.",
        mutability: "read",
        approvalRequired: false,
        inputSchemaJson: JSON.stringify({
          type: "object",
          properties: {
            staged: { type: "boolean", description: "If true, show staged changes only." },
          },
        }),
      },
      {
        name: "apply_patch",
        description: "Apply a unified diff patch to the working tree. Requires operator approval.",
        mutability: "write",
        approvalRequired: true,
        inputSchemaJson: JSON.stringify({
          type: "object",
          properties: {
            patch: { type: "string", description: "Unified diff patch content." },
          },
          required: ["patch"],
        }),
      },
    ],
  },
  {
    name: TASKGOBLIN_PATCH_SERVER_NAME,
    transport: "stdio",
    trustLevel: "trusted",
    tools: [
      {
        name: "apply_patch",
        description:
          "Apply a unified diff to the active task execution worktree. Looks up the " +
          "execution rootPath, asserts the worktree is on the task branch (and not the " +
          "base branch), and runs git apply --3way. Requires operator approval.",
        mutability: "write",
        approvalRequired: true,
        inputSchemaJson: JSON.stringify(APPLY_PATCH_INPUT_SCHEMA),
      },
    ],
  },
  {
    name: TASKGOBLIN_DB_SERVER_NAME,
    transport: "stdio",
    trustLevel: "trusted",
    tools: [
      {
        name: DB_QUERY_TOOL_NAME,
        description:
          "Run a single read-only SELECT (or read-only WITH ... SELECT) " +
          "against the project Prisma database. Mutating statements, " +
          "multi-statement batches, and mutating CTEs are rejected with " +
          "INVALID_ARGUMENTS.",
        mutability: "read",
        approvalRequired: false,
        inputSchemaJson: JSON.stringify(DB_QUERY_INPUT_SCHEMA),
      },
      {
        name: DB_LIST_TABLES_TOOL_NAME,
        description:
          "List the live Prisma-managed table names in the project " +
          "database. Excludes sqlite internal tables and Prisma migration " +
          "metadata.",
        mutability: "read",
        approvalRequired: false,
        inputSchemaJson: JSON.stringify(DB_LIST_TABLES_INPUT_SCHEMA),
      },
    ],
  },
  {
    name: TASKGOBLIN_BROWSER_SERVER_NAME,
    transport: "stdio",
    trustLevel: "trusted",
    tools: [
      {
        name: BROWSER_NAVIGATE_TOOL_NAME,
        description: "Navigate a Chromium page to a URL and report the loaded document metadata.",
        mutability: "read",
        approvalRequired: false,
        inputSchemaJson: JSON.stringify(BROWSER_NAVIGATE_INPUT_SCHEMA),
      },
      {
        name: BROWSER_SCREENSHOT_TOOL_NAME,
        description: "Capture a Chromium screenshot to an artifact path for visual verification.",
        mutability: "read",
        approvalRequired: false,
        inputSchemaJson: JSON.stringify(BROWSER_SCREENSHOT_INPUT_SCHEMA),
      },
      {
        name: BROWSER_RUN_AXE_TOOL_NAME,
        description: "Run axe-core against a loaded page and return accessibility violations.",
        mutability: "read",
        approvalRequired: false,
        inputSchemaJson: JSON.stringify(BROWSER_RUN_AXE_INPUT_SCHEMA),
      },
    ],
  },
  {
    name: "taskgoblin-shell",
    transport: "stdio",
    trustLevel: "trusted",
    tools: [
      {
        name: "run_command",
        description: "Execute an approved shell command. Requires operator approval.",
        mutability: "write",
        approvalRequired: true,
        inputSchemaJson: JSON.stringify({
          type: "object",
          properties: {
            command: { type: "string", description: "Shell command to execute." },
            cwd: { type: "string", description: "Working directory for the command." },
          },
          required: ["command"],
        }),
      },
    ],
  },
];
