import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import {
  isAbsolute,
  posix,
  relative,
  resolve,
} from "node:path";
import type { McpMutability } from "@vimbuspromax3000/shared";
import {
  BROWSER_NAVIGATE_TOOL_NAME,
  BROWSER_RUN_AXE_TOOL_NAME,
  BROWSER_SCREENSHOT_TOOL_NAME,
  createBrowserWrapper,
  TASKGOBLIN_BROWSER_SERVER_NAME,
} from "./wrappers/browser";

export type McpWrapperExecutionContext = {
  rootPath: string;
};

export type McpWrapperResult = {
  summary: string;
  data: unknown;
};

type McpWrapperDefinition = {
  serverName: string;
  toolName: string;
  mutability: McpMutability;
  execute(
    args: Record<string, unknown>,
    context: McpWrapperExecutionContext,
  ): McpWrapperResult | Promise<McpWrapperResult>;
};

export class McpPolicyError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "McpPolicyError";
  }
}

export class McpWrapperExecutionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "McpWrapperExecutionError";
  }
}

const MAX_READ_FILE_BYTES = 1_000_000;
const MAX_GREP_FILE_BYTES = 512_000;
const MAX_GREP_MATCHES = 200;
const PROCESS_TIMEOUT_MS = 120_000;
const PROCESS_MAX_BUFFER_BYTES = 2_000_000;
const SKIPPED_GREP_DIRECTORIES = new Set([
  ".artifacts",
  ".git",
  ".taskgoblin",
  "dist",
  "node_modules",
]);
const BROWSER_WRAPPER = createBrowserWrapper();

const WRAPPERS: McpWrapperDefinition[] = [
  {
    serverName: "taskgoblin-fs-git",
    toolName: "read_file",
    mutability: "read",
    execute(args, context) {
      const filePath = resolveWorkspacePath(context.rootPath, requireStringArg(args, "path"), "path");
      assertExistingPathInsideWorkspace(context.rootPath, filePath, "path");
      const stat = statSync(filePath);

      if (!stat.isFile()) {
        throw new McpWrapperExecutionError("read_file path must point to a file.", "PATH_NOT_FILE");
      }

      if (stat.size > MAX_READ_FILE_BYTES) {
        throw new McpWrapperExecutionError(
          `read_file path is too large (${stat.size} bytes).`,
          "FILE_TOO_LARGE",
        );
      }

      const content = readFileSync(filePath, "utf8");
      const relativePath = normalizeRelativePath(context.rootPath, filePath);

      return {
        summary: `Read ${relativePath} (${Buffer.byteLength(content, "utf8")} bytes).`,
        data: {
          path: relativePath,
          content,
        },
      };
    },
  },
  {
    serverName: "taskgoblin-fs-git",
    toolName: "grep",
    mutability: "read",
    execute(args, context) {
      const pattern = requireStringArg(args, "pattern");
      const searchPath = resolveWorkspacePath(
        context.rootPath,
        optionalStringArg(args, "path") ?? ".",
        "path",
      );
      assertExistingPathInsideWorkspace(context.rootPath, searchPath, "path");

      let regex: RegExp;
      try {
        regex = new RegExp(pattern);
      } catch (error) {
        throw new McpPolicyError(
          `grep pattern is not a valid regular expression: ${getErrorMessage(error)}`,
          "INVALID_GREP_PATTERN",
        );
      }

      const matches: Array<{ path: string; line: number; preview: string }> = [];
      const files = collectSearchFiles(context.rootPath, searchPath);

      for (const filePath of files) {
        if (matches.length >= MAX_GREP_MATCHES) {
          break;
        }

        const stat = statSync(filePath);
        if (stat.size > MAX_GREP_FILE_BYTES) {
          continue;
        }

        const content = readFileSync(filePath);
        if (content.includes(0)) {
          continue;
        }

        const lines = content.toString("utf8").split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          if (!regex.test(lines[index] ?? "")) {
            continue;
          }

          matches.push({
            path: normalizeRelativePath(context.rootPath, filePath),
            line: index + 1,
            preview: truncate((lines[index] ?? "").trim(), 240),
          });

          regex.lastIndex = 0;

          if (matches.length >= MAX_GREP_MATCHES) {
            break;
          }
        }
      }

      const uniqueFiles = new Set(matches.map((match) => match.path)).size;

      return {
        summary: `grep found ${matches.length} match${matches.length === 1 ? "" : "es"} in ${uniqueFiles} file${uniqueFiles === 1 ? "" : "s"}.`,
        data: {
          pattern,
          matches,
          truncated: matches.length >= MAX_GREP_MATCHES,
        },
      };
    },
  },
  {
    serverName: "taskgoblin-fs-git",
    toolName: "git_status",
    mutability: "read",
    execute(_args, context) {
      assertGitRepository(context.rootPath);
      const result = runProcess("git", ["status", "--short"], context.rootPath);
      const output = result.stdout.trim();
      const entries = output.length === 0 ? 0 : output.split(/\r?\n/).length;

      return {
        summary: entries === 0 ? "Git status is clean." : `Git status returned ${entries} entr${entries === 1 ? "y" : "ies"}.`,
        data: {
          stdout: result.stdout,
          stderr: result.stderr,
        },
      };
    },
  },
  {
    serverName: "taskgoblin-fs-git",
    toolName: "git_diff",
    mutability: "read",
    execute(args, context) {
      assertGitRepository(context.rootPath);
      const staged = optionalBooleanArg(args, "staged") ?? false;
      const result = runProcess("git", staged ? ["diff", "--cached"] : ["diff"], context.rootPath);
      const diffBytes = Buffer.byteLength(result.stdout, "utf8");

      return {
        summary: diffBytes === 0 ? "Git diff is empty." : `Git diff returned ${diffBytes} bytes.`,
        data: {
          staged,
          stdout: result.stdout,
          stderr: result.stderr,
        },
      };
    },
  },
  {
    serverName: "taskgoblin-fs-git",
    toolName: "apply_patch",
    mutability: "write",
    execute(args, context) {
      const patch = requireStringArg(args, "patch");

      if (patch.trim().length === 0) {
        throw new McpPolicyError("apply_patch requires a non-empty patch.", "EMPTY_PATCH");
      }

      assertPatchPathsInsideWorkspace(context.rootPath, patch);
      assertGitRepository(context.rootPath);

      runProcess("git", ["apply", "--check", "--whitespace=nowarn"], context.rootPath, patch);
      runProcess("git", ["apply", "--whitespace=nowarn"], context.rootPath, patch);

      return {
        summary: "Patch applied to the working tree.",
        data: {
          applied: true,
        },
      };
    },
  },
  {
    serverName: "taskgoblin-shell",
    toolName: "run_command",
    mutability: "write",
    execute(args, context) {
      const command = requireStringArg(args, "command").trim();
      const cwd = resolveWorkspacePath(
        context.rootPath,
        optionalStringArg(args, "cwd") ?? ".",
        "cwd",
      );

      if (command.length === 0) {
        throw new McpPolicyError("run_command requires a non-empty command.", "EMPTY_COMMAND");
      }

      assertExistingPathInsideWorkspace(context.rootPath, cwd, "cwd");

      if (!statSync(cwd).isDirectory()) {
        throw new McpPolicyError("run_command cwd must point to a directory.", "CWD_NOT_DIRECTORY");
      }

      assertSafeShellCommand(command);

      const shell = process.platform === "win32" ? "powershell" : "sh";
      const shellArgs =
        process.platform === "win32"
          ? ["-NoProfile", "-Command", command]
          : ["-lc", command];
      const result = runProcess(shell, shellArgs, cwd);
      const exitCode = result.status;

      return {
        summary: `Command exited ${exitCode} (${Buffer.byteLength(result.stdout, "utf8")} stdout bytes, ${Buffer.byteLength(result.stderr, "utf8")} stderr bytes).`,
        data: {
          exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          cwd: normalizeRelativePath(context.rootPath, cwd),
        },
      };
    },
  },
  {
    serverName: TASKGOBLIN_BROWSER_SERVER_NAME,
    toolName: BROWSER_NAVIGATE_TOOL_NAME,
    mutability: "read",
    async execute(args) {
      const result = await BROWSER_WRAPPER.navigate(args);

      if (!result.ok) {
        throw new McpWrapperExecutionError(result.message, result.code);
      }

      return {
        summary: `Navigated to ${result.url}${result.status === null ? "" : ` (${result.status})`}.`,
        data: result,
      };
    },
  },
  {
    serverName: TASKGOBLIN_BROWSER_SERVER_NAME,
    toolName: BROWSER_SCREENSHOT_TOOL_NAME,
    mutability: "read",
    async execute(args) {
      const result = await BROWSER_WRAPPER.screenshot(args);

      if (!result.ok) {
        throw new McpWrapperExecutionError(result.message, result.code);
      }

      return {
        summary: `Captured screenshot ${result.path} (${result.bytes} bytes).`,
        data: result,
      };
    },
  },
  {
    serverName: TASKGOBLIN_BROWSER_SERVER_NAME,
    toolName: BROWSER_RUN_AXE_TOOL_NAME,
    mutability: "read",
    async execute(args) {
      const result = await BROWSER_WRAPPER.runAxe(args);

      if (!result.ok) {
        throw new McpWrapperExecutionError(result.message, result.code);
      }

      return {
        summary: `Axe reported ${result.violationCount} violation${result.violationCount === 1 ? "" : "s"}.`,
        data: result,
      };
    },
  },
];

export function getMcpWrapperDefinition(serverName: string, toolName: string) {
  return WRAPPERS.find((wrapper) => wrapper.serverName === serverName && wrapper.toolName === toolName) ?? null;
}

export function executeMcpWrapper(input: {
  serverName: string;
  toolName: string;
  mutability: string;
  args: Record<string, unknown>;
  context: McpWrapperExecutionContext;
}): McpWrapperResult | Promise<McpWrapperResult> {
  const wrapper = getMcpWrapperDefinition(input.serverName, input.toolName);

  if (!wrapper) {
    throw new McpPolicyError(
      `Tool ${input.serverName}/${input.toolName} is not exposed by the minimal MCP wrappers.`,
      "WRAPPER_NOT_ALLOWLISTED",
    );
  }

  if (wrapper.mutability !== input.mutability) {
    throw new McpPolicyError(
      `Tool ${input.serverName}/${input.toolName} mutability mismatch.`,
      "MUTABILITY_MISMATCH",
    );
  }

  return wrapper.execute(input.args, input.context);
}

export function isMcpPolicyError(error: unknown): error is McpPolicyError {
  return error instanceof McpPolicyError;
}

function collectSearchFiles(rootPath: string, searchPath: string): string[] {
  const stat = statSync(searchPath);

  if (stat.isFile()) {
    return [searchPath];
  }

  if (!stat.isDirectory()) {
    return [];
  }

  const files: string[] = [];
  walkDirectory(rootPath, searchPath, files);
  return files;
}

function walkDirectory(rootPath: string, directory: string, files: string[]) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);

    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      if (!SKIPPED_GREP_DIRECTORIES.has(entry.name)) {
        assertExistingPathInsideWorkspace(rootPath, entryPath, "path");
        walkDirectory(rootPath, entryPath, files);
      }
      continue;
    }

    if (entry.isFile()) {
      assertExistingPathInsideWorkspace(rootPath, entryPath, "path");
      files.push(entryPath);
    }
  }
}

function assertGitRepository(rootPath: string) {
  const result = runProcess("git", ["rev-parse", "--is-inside-work-tree"], rootPath);

  if (result.stdout.trim() !== "true") {
    throw new McpWrapperExecutionError("Project root is not a git repository.", "NOT_GIT_REPOSITORY");
  }
}

function assertPatchPathsInsideWorkspace(rootPath: string, patch: string) {
  const paths = new Set<string>();

  for (const rawLine of patch.split(/\r?\n/)) {
    const line = rawLine.trimEnd();

    if (line.startsWith("diff --git ")) {
      const parts = line.split(/\s+/);
      if (parts[2]) paths.add(parts[2]);
      if (parts[3]) paths.add(parts[3]);
      continue;
    }

    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      const token = line.slice(4).trim().split(/\s+/)[0];
      if (token) paths.add(token);
    }
  }

  if (paths.size === 0) {
    throw new McpPolicyError("apply_patch could not identify patch file paths.", "PATCH_PATHS_MISSING");
  }

  for (const patchPath of paths) {
    const normalized = normalizePatchPath(patchPath);
    if (!normalized) {
      continue;
    }

    const absolutePath = resolve(rootPath, normalized);
    assertPathInsideWorkspace(rootPath, absolutePath, "patch");
  }
}

function normalizePatchPath(value: string): string | null {
  if (value === "/dev/null") {
    return null;
  }

  const unquoted = value.replace(/^"|"$/g, "").replace(/\\/g, "/");
  const withoutPrefix = unquoted.startsWith("a/") || unquoted.startsWith("b/")
    ? unquoted.slice(2)
    : unquoted;

  if (withoutPrefix.length === 0) {
    throw new McpPolicyError("Patch path cannot be empty.", "INVALID_PATCH_PATH");
  }

  if (withoutPrefix.startsWith("/") || /^[a-zA-Z]:/.test(withoutPrefix)) {
    throw new McpPolicyError(`Patch path ${value} must be project-relative.`, "PATCH_PATH_OUTSIDE_WORKSPACE");
  }

  const normalized = posix.normalize(withoutPrefix);

  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new McpPolicyError(`Patch path ${value} must stay inside the project root.`, "PATCH_PATH_OUTSIDE_WORKSPACE");
  }

  return normalized;
}

function assertSafeShellCommand(command: string) {
  const dangerousPatterns: Array<[RegExp, string]> = [
    [/[;&|`]|>\>?|<|\$\(/, "shell chaining, pipes, substitution, or redirection are not allowed"],
    [/\brm\s+-[^\r\n]*r/i, "recursive rm is not allowed"],
    [/\bRemove-Item\b[\s\S]*-(Recurse|Force)\b/i, "recursive or forced Remove-Item is not allowed"],
    [/\bgit\s+reset\s+--hard\b/i, "git reset --hard is not allowed"],
    [/\bgit\s+clean\b[\s\S]*-[^\s]*f/i, "git clean -f is not allowed"],
    [/\bgit\s+checkout\s+--\b/i, "git checkout -- is not allowed"],
    [/\b(shutdown|reboot|halt|mkfs|format)\b/i, "system-destructive commands are not allowed"],
    [/\b(Invoke-Expression|iex|EncodedCommand)\b/i, "dynamic PowerShell execution is not allowed"],
    [/\b(curl|wget)\b[\s\S]*\|\s*(sh|bash|powershell|pwsh|iex)\b/i, "download-and-execute commands are not allowed"],
  ];

  for (const [pattern, reason] of dangerousPatterns) {
    if (pattern.test(command)) {
      throw new McpPolicyError(`Unsafe shell command blocked: ${reason}.`, "UNSAFE_COMMAND");
    }
  }
}

function resolveWorkspacePath(rootPath: string, requestedPath: string, fieldName: string): string {
  if (requestedPath.includes("\0")) {
    throw new McpPolicyError(`${fieldName} contains a null byte.`, "INVALID_PATH");
  }

  const absoluteRoot = resolve(rootPath);
  const absolutePath = isAbsolute(requestedPath)
    ? resolve(requestedPath)
    : resolve(absoluteRoot, requestedPath);

  assertPathInsideWorkspace(absoluteRoot, absolutePath, fieldName);

  return absolutePath;
}

function assertExistingPathInsideWorkspace(rootPath: string, absolutePath: string, fieldName: string) {
  if (!existsSync(absolutePath)) {
    throw new McpWrapperExecutionError(`${fieldName} does not exist.`, "PATH_NOT_FOUND");
  }

  const lstat = lstatSync(absolutePath);

  if (lstat.isSymbolicLink()) {
    const realRoot = realpathSync(rootPath);
    const realPath = realpathSync(absolutePath);
    assertPathInsideWorkspace(realRoot, realPath, fieldName);
  }
}

function assertPathInsideWorkspace(rootPath: string, absolutePath: string, fieldName: string) {
  const relativePath = relative(rootPath, absolutePath);

  if (relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
    return;
  }

  throw new McpPolicyError(
    `${fieldName} must stay inside the project root.`,
    "PATH_OUTSIDE_WORKSPACE",
  );
}

function normalizeRelativePath(rootPath: string, absolutePath: string) {
  const relativePath = relative(resolve(rootPath), resolve(absolutePath)).replace(/\\/g, "/");
  return relativePath.length === 0 ? "." : relativePath;
}

function requireStringArg(args: Record<string, unknown>, fieldName: string): string {
  const value = args[fieldName];

  if (typeof value !== "string") {
    throw new McpPolicyError(`${fieldName} must be a string.`, "INVALID_ARGUMENTS");
  }

  return value;
}

function optionalStringArg(args: Record<string, unknown>, fieldName: string): string | undefined {
  const value = args[fieldName];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new McpPolicyError(`${fieldName} must be a string.`, "INVALID_ARGUMENTS");
  }

  return value;
}

function optionalBooleanArg(args: Record<string, unknown>, fieldName: string): boolean | undefined {
  const value = args[fieldName];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new McpPolicyError(`${fieldName} must be a boolean.`, "INVALID_ARGUMENTS");
  }

  return value;
}

function runProcess(command: string, args: string[], cwd: string, input?: string) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    input,
    maxBuffer: PROCESS_MAX_BUFFER_BYTES,
    timeout: PROCESS_TIMEOUT_MS,
  });

  if (result.error) {
    throw new McpWrapperExecutionError(
      `${command} ${args.join(" ")} failed to start: ${result.error.message}`,
      "PROCESS_START_FAILED",
    );
  }

  const status = result.status ?? 1;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  if (status !== 0) {
    throw new McpWrapperExecutionError(
      `${command} ${args.join(" ")} exited ${status}: ${truncate((stderr || stdout).trim(), 500)}`,
      "PROCESS_FAILED",
    );
  }

  return {
    status,
    stdout,
    stderr,
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function truncate(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}...`;
}
