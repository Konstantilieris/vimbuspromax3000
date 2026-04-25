import { spawn, type SpawnOptions } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { basename } from "node:path";
import { stdin as defaultStdin, stdout as defaultStdout } from "node:process";
import { PRODUCT_NAME } from "@vimbuspromax3000/shared";
import {
  discoverAnthropicCredentials,
  resolveClaudeCredentialsPath,
  validateAnthropicKey,
  writeClaudeCredentialsFile,
  type CredentialSource,
  type DiscoveredCredential,
} from "@vimbuspromax3000/model-registry";

export const SETUP_COMMANDS = ["/setup", "/setup:run"] as const;

export type SetupCommand = (typeof SETUP_COMMANDS)[number];

export type SetupSpawnResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type SetupSpawnFn = (
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv },
) => Promise<SetupSpawnResult>;

export type SetupReadlineFn = (prompt: string) => Promise<string>;

export type SetupCommandOptions = {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  spawn?: SetupSpawnFn;
  prompt?: SetupReadlineFn;
  cwd?: string;
  isTty?: boolean;
  isSmoke?: boolean;
  homedir?: string;
  configDir?: string;
  writeCredentials?: typeof writeClaudeCredentialsFile;
  discoverCredentials?: typeof discoverAnthropicCredentials;
};

type ParsedOptions = Record<string, string | undefined>;

type ApiProject = {
  id: string;
  name: string;
  rootPath: string;
  baseBranch: string;
};

type ApiSlot = {
  slotKey: string;
  primaryModel?: { slug: string; provider?: { key: string } } | null;
};

type ApiMcpServer = {
  id?: string;
  name: string;
  status: string;
  transport: string;
};

type ApiMcpProbe = {
  name: string;
  ok: boolean;
  message?: string;
  missingEnv?: string[];
};

export function isSetupCommand(value: string): boolean {
  return SETUP_COMMANDS.includes(value as SetupCommand);
}

export async function runSetupCommand(
  args: readonly string[],
  commandOptions: SetupCommandOptions = {},
): Promise<string> {
  const command = (args.find(isSetupCommand) as SetupCommand | undefined) ?? "/setup";
  const parsed = parseOptions(args.filter((arg) => arg !== command));
  const env = commandOptions.env ?? process.env;
  const apiUrl = withoutTrailingSlash(parsed["api-url"] ?? env.VIMBUS_API_URL ?? "http://localhost:3000");
  const request = commandOptions.fetch ?? fetch;
  const cwd = commandOptions.cwd ?? process.cwd();
  const isSmoke =
    commandOptions.isSmoke ?? (args.includes("--smoke") || env.CI === "true");
  const isTty = commandOptions.isTty ?? Boolean(process.stdout.isTTY);
  const ask = commandOptions.prompt ?? createDefaultPrompt();
  const spawnFn = commandOptions.spawn ?? defaultSpawn;
  const writeCreds = commandOptions.writeCredentials ?? writeClaudeCredentialsFile;
  const discoverCreds = commandOptions.discoverCredentials ?? discoverAnthropicCredentials;
  const credOpts = {
    env,
    homedir: commandOptions.homedir,
    configDir: commandOptions.configDir,
  };

  const lines: string[] = [];
  const log = (line: string) => {
    lines.push(line);
  };

  log(`${PRODUCT_NAME} setup wizard`);
  log("Step 1/5: project");

  const project = await resolveProject({
    apiUrl,
    request,
    cwd,
    parsed,
    isSmoke,
    isTty,
    ask,
    log,
  });

  log(`Selected project ${project.name} (${project.id}) at ${project.rootPath}.`);
  log("");
  log("Step 2/5: credentials");

  const credentials = await resolveCredentials({
    parsed,
    env,
    isSmoke,
    isTty,
    ask,
    credOpts,
    discoverCreds,
    writeCreds,
    log,
  });

  // Surface the resolved key in-process so models/MCP setup can use it.
  if (env === process.env) {
    process.env.ANTHROPIC_API_KEY = credentials.apiKey;
  } else {
    env.ANTHROPIC_API_KEY = credentials.apiKey;
  }

  log("");
  log("Step 3/5: models");

  await runModelsStep({ projectId: project.id, parsed, env, spawnFn, log });

  log("");
  log("Step 4/5: mcp");

  await runMcpStep({ projectId: project.id, parsed, env, spawnFn, log });

  log("");
  log("Step 5/5: health");

  const health = await runHealthCheck({
    apiUrl,
    request,
    projectId: project.id,
    credentialSource: credentials.source,
    log,
  });

  if (!health.ok) {
    throw new Error(`Health check failed: ${health.reason}`);
  }

  log("");
  log("Setup complete.");

  return lines.join("\n");
}

type ResolveProjectInput = {
  apiUrl: string;
  request: typeof fetch;
  cwd: string;
  parsed: ParsedOptions;
  isSmoke: boolean;
  isTty: boolean;
  ask: SetupReadlineFn;
  log: (line: string) => void;
};

async function resolveProject(input: ResolveProjectInput): Promise<ApiProject> {
  const existing = await requestJson<ApiProject[]>(input.request, `${input.apiUrl}/projects`);

  if (input.parsed["project-id"]) {
    const found = existing.find((project) => project.id === input.parsed["project-id"]);
    if (!found) {
      throw new Error(`No project found with id ${input.parsed["project-id"]}.`);
    }
    return found;
  }

  if (existing.length > 0 && !input.isSmoke && input.isTty && !input.parsed["project-name"]) {
    input.log("Existing projects:");
    existing.forEach((project, index) => {
      input.log(`  [${index + 1}] ${project.name} (${project.id})`);
    });
    input.log(`  [${existing.length + 1}] Create a new project`);

    const choice = await input.ask(`Select a project [1-${existing.length + 1}]: `);
    const parsedChoice = Number.parseInt(choice.trim(), 10);

    if (
      Number.isFinite(parsedChoice) &&
      parsedChoice >= 1 &&
      parsedChoice <= existing.length
    ) {
      const project = existing[parsedChoice - 1];
      if (project) {
        return project;
      }
    }

    // fall through to create-new flow below
  } else if (existing.length > 0 && (input.isSmoke || !input.isTty) && !input.parsed["project-name"]) {
    // smoke/non-TTY with existing projects: pick the first deterministically
    const first = existing[0];
    if (first) {
      input.log(`Auto-selected first existing project (smoke/non-TTY).`);
      return first;
    }
  }

  const defaultName = basename(input.cwd) || "vimbus-project";
  let name = input.parsed["project-name"];

  if (!name && !input.isSmoke && input.isTty) {
    const answer = await input.ask(`Project name [${defaultName}]: `);
    name = answer.trim() || defaultName;
  }

  name = name?.trim() || defaultName;

  if (!name) {
    throw new Error("Project name is required.");
  }

  const created = await requestJson<ApiProject>(input.request, `${input.apiUrl}/projects`, {
    method: "POST",
    body: {
      name,
      rootPath: input.parsed["root-path"] ?? input.cwd,
      baseBranch: input.parsed["base-branch"],
    },
  });

  input.log(`Created project ${created.name} (${created.id}).`);
  return created;
}

type ResolveCredentialsInput = {
  parsed: ParsedOptions;
  env: NodeJS.ProcessEnv;
  isSmoke: boolean;
  isTty: boolean;
  ask: SetupReadlineFn;
  credOpts: { env: NodeJS.ProcessEnv; homedir?: string; configDir?: string };
  discoverCreds: typeof discoverAnthropicCredentials;
  writeCreds: typeof writeClaudeCredentialsFile;
  log: (line: string) => void;
};

type ResolvedCredentials = {
  apiKey: string;
  source: CredentialSource;
};

async function resolveCredentials(input: ResolveCredentialsInput): Promise<ResolvedCredentials> {
  const discovered: DiscoveredCredential = await input.discoverCreds(input.credOpts);

  if (discovered.found) {
    input.log(`Found Anthropic API key from ${discovered.source}.`);
    return { apiKey: discovered.apiKey, source: discovered.source };
  }

  const path = resolveClaudeCredentialsPath(input.credOpts);

  if (input.isSmoke || !input.isTty) {
    throw new Error(
      `provider_secret_missing: no Anthropic API key. Set ANTHROPIC_API_KEY in your environment or place a key in ${path}.`,
    );
  }

  input.log(`No Anthropic API key found. Reason: ${discovered.reason}`);
  const provided = (await input.ask("Paste your Anthropic API key (sk-ant-...): ")).trim();

  if (!validateAnthropicKey(provided)) {
    throw new Error("provider_secret_missing: pasted value did not look like an Anthropic API key.");
  }

  const writeResult = await input.writeCreds({ apiKey: provided, opts: input.credOpts });
  input.log(`Wrote API key to ${writeResult.path}.`);
  if (writeResult.overwroteExisting) {
    input.log("Warning: overwrote a previously stored apiKey in this file.");
  }

  return { apiKey: provided, source: "interactive" };
}

type SubStepInput = {
  projectId: string;
  parsed: ParsedOptions;
  env: NodeJS.ProcessEnv;
  spawnFn: SetupSpawnFn;
  log: (line: string) => void;
};

async function runModelsStep(input: SubStepInput): Promise<void> {
  const args = buildModelsArgs(input.projectId, input.parsed);
  const result = await input.spawnFn("bun", args, { env: input.env });

  if (result.stdout.trim()) {
    input.log(indent(result.stdout.trim()));
  }
  if (result.exitCode !== 0) {
    if (result.stderr.trim()) {
      input.log(indent(result.stderr.trim()));
    }
    throw new Error(`Models setup failed with exit code ${result.exitCode}.`);
  }
}

async function runMcpStep(input: SubStepInput): Promise<void> {
  const args = buildMcpArgs(input.projectId, input.parsed);
  const result = await input.spawnFn("bun", args, { env: input.env });

  if (result.stdout.trim()) {
    input.log(indent(result.stdout.trim()));
  }
  if (result.exitCode !== 0) {
    if (result.stderr.trim()) {
      input.log(indent(result.stderr.trim()));
    }
    throw new Error(`MCP setup failed with exit code ${result.exitCode}.`);
  }
}

type HealthCheckInput = {
  apiUrl: string;
  request: typeof fetch;
  projectId: string;
  credentialSource: CredentialSource;
  log: (line: string) => void;
};

async function runHealthCheck(input: HealthCheckInput): Promise<{ ok: boolean; reason?: string }> {
  const slots = await safeRequest<ApiSlot[]>(input.request, `${input.apiUrl}/model-slots?projectId=${encodeURIComponent(input.projectId)}`);
  const assigned = (slots ?? []).filter((slot) => slot.primaryModel).length;
  const total = slots?.length ?? 0;

  const probe = await safeRequest<ApiMcpProbe[]>(input.request, `${input.apiUrl}/mcp/probe`, {
    method: "POST",
    body: { projectId: input.projectId },
  });
  const probes = probe ?? [];
  const failures = probes.filter((entry) => !entry.ok);

  const servers = await safeRequest<ApiMcpServer[]>(input.request, `${input.apiUrl}/mcp/servers?projectId=${encodeURIComponent(input.projectId)}`);
  const serverCount = Array.isArray(servers) ? servers.length : (servers as { servers?: ApiMcpServer[] } | null)?.servers?.length ?? 0;

  input.log(`Project: ${input.projectId}`);
  input.log(`Credential source: ${input.credentialSource}`);
  input.log(`Slots assigned: ${assigned}/${total}`);
  input.log(`MCP servers: ${serverCount}`);

  if (probes.length === 0) {
    input.log("MCP probes: none reported");
  } else {
    for (const entry of probes) {
      const status = entry.ok ? "ok" : "error";
      const detail = entry.missingEnv && entry.missingEnv.length > 0 ? ` missing-env=${entry.missingEnv.join(",")}` : "";
      input.log(`  - ${status} ${entry.name}: ${entry.message ?? "no message"}${detail}`);
    }
  }

  if (failures.length > 0) {
    return {
      ok: false,
      reason: `MCP probe failed for: ${failures.map((entry) => entry.name).join(", ")}`,
    };
  }

  return { ok: true };
}

function buildModelsArgs(projectId: string, parsed: ParsedOptions): string[] {
  const args = ["run", "cli", "/models:setup", "--project-id", projectId];

  // Reasonable defaults for an Anthropic-driven setup; callers may override on /setup invocation.
  args.push("--provider-key", parsed["provider-key"] ?? "anthropic");
  args.push("--provider-kind", parsed["provider-kind"] ?? "anthropic");
  args.push("--provider-label", parsed["provider-label"] ?? "Anthropic");
  args.push("--secret-env", parsed["secret-env"] ?? "ANTHROPIC_API_KEY");
  args.push("--secret-label", parsed["secret-label"] ?? "Anthropic API key");
  args.push("--model-name", parsed["model-name"] ?? "Claude Opus 4.7");
  args.push("--model-slug", parsed["model-slug"] ?? "claude-opus-4-7");
  args.push("--capabilities", parsed.capabilities ?? "tools,json,streaming");
  args.push("--status", parsed["model-status"] ?? "active");
  args.push("--slots", parsed.slots ?? "executor_default");

  if (parsed["api-url"]) {
    args.push("--api-url", parsed["api-url"]);
  }

  return args;
}

function buildMcpArgs(projectId: string, parsed: ParsedOptions): string[] {
  const args = ["run", "cli", "/mcp:setup", "--project-id", projectId];

  if (parsed["mcp-servers"]) {
    args.push("--servers", parsed["mcp-servers"]);
  }
  if (parsed["mcp-activate"]) {
    args.push("--activate");
  }
  if (parsed["api-url"]) {
    args.push("--api-url", parsed["api-url"]);
  }

  return args;
}

function indent(value: string, prefix = "  "): string {
  return value
    .split(/\r?\n/)
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function createDefaultPrompt(): SetupReadlineFn {
  return async (prompt: string) => {
    const rl = createInterface({ input: defaultStdin, output: defaultStdout });
    try {
      return await rl.question(prompt);
    } finally {
      rl.close();
    }
  };
}

const defaultSpawn: SetupSpawnFn = async (command, args, options) => {
  return new Promise<SetupSpawnResult>((resolve, reject) => {
    const spawnOptions: SpawnOptions = {
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    };
    const child = spawn(command, [...args], spawnOptions);
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 0, stdout, stderr });
    });
  });
};

async function safeRequest<T>(
  request: typeof fetch,
  url: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T | null> {
  try {
    return await requestJson<T>(request, url, options);
  } catch {
    return null;
  }
}

async function requestJson<T>(
  request: typeof fetch,
  url: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await request(url, {
    method: options.method ?? "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : undefined;

  if (!response.ok) {
    const message = isObject(payload) && typeof payload.error === "string" ? payload.error : response.statusText;
    throw new Error(`API ${response.status}: ${message}`);
  }

  return payload as T;
}

function parseOptions(args: readonly string[]): ParsedOptions {
  const parsed: ParsedOptions = {};

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (!token?.startsWith("--")) {
      continue;
    }

    const inlineValueIndex = token.indexOf("=");
    if (inlineValueIndex >= 0) {
      parsed[token.slice(2, inlineValueIndex)] = token.slice(inlineValueIndex + 1);
      continue;
    }

    const next = args[index + 1];
    parsed[token.slice(2)] = next && !next.startsWith("--") ? next : "true";

    if (next && !next.startsWith("--")) {
      index += 1;
    }
  }

  return parsed;
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function isObject(value: unknown): value is { error?: unknown } {
  return typeof value === "object" && value !== null;
}
