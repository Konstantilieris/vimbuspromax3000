import type { McpMutability } from "@vimbuspromax3000/shared";
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
