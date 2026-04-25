import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type CredentialSource = "env" | "claude-cli" | "interactive";

export type DiscoveredCredential =
  | { found: true; source: CredentialSource; apiKey: string }
  | { found: false; reason: string };

export type ResolveClaudeOptions = {
  homedir?: string;
  configDir?: string;
  env?: NodeJS.ProcessEnv;
};

export type DiscoverOptions = ResolveClaudeOptions;

export type WriteClaudeCredentialsResult = {
  path: string;
  overwroteExisting: boolean;
};

const CANDIDATE_KEY_FIELDS = [
  "apiKey",
  "anthropicApiKey",
  "key",
  "token",
] as const;

export function validateAnthropicKey(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 20;
}

export function resolveClaudeConfigDir(opts: ResolveClaudeOptions = {}): string {
  const env = opts.env ?? process.env;

  if (opts.configDir) {
    return opts.configDir;
  }

  if (env.CLAUDE_CONFIG_DIR) {
    return env.CLAUDE_CONFIG_DIR;
  }

  return join(opts.homedir ?? homedir(), ".claude");
}

export function resolveClaudeCredentialsPath(opts: ResolveClaudeOptions = {}): string {
  return join(resolveClaudeConfigDir(opts), ".credentials.json");
}

export function discoverFromEnv(env: NodeJS.ProcessEnv = process.env): DiscoveredCredential {
  const key = env.ANTHROPIC_API_KEY;

  if (validateAnthropicKey(key)) {
    return { found: true, source: "env", apiKey: key.trim() };
  }

  return { found: false, reason: "ANTHROPIC_API_KEY not set or too short" };
}

export async function discoverClaudeCredentialsFile(opts: DiscoverOptions = {}): Promise<DiscoveredCredential> {
  const path = resolveClaudeCredentialsPath(opts);
  let raw: string;

  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    return { found: false, reason: `Could not read ${path}: ${formatError(error)}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { found: false, reason: `${path} is not valid JSON: ${formatError(error)}` };
  }

  if (!isObjectRecord(parsed)) {
    return { found: false, reason: `${path} did not contain a JSON object` };
  }

  for (const field of CANDIDATE_KEY_FIELDS) {
    const candidate = parsed[field];

    if (validateAnthropicKey(candidate)) {
      return { found: true, source: "claude-cli", apiKey: candidate.trim() };
    }
  }

  return {
    found: false,
    reason: `${path} did not contain a recognized API key field (${CANDIDATE_KEY_FIELDS.join(", ")})`,
  };
}

export async function discoverAnthropicCredentials(opts: DiscoverOptions = {}): Promise<DiscoveredCredential> {
  const fromEnv = discoverFromEnv(opts.env);
  if (fromEnv.found) {
    return fromEnv;
  }

  return discoverClaudeCredentialsFile(opts);
}

export async function writeClaudeCredentialsFile(input: {
  apiKey: string;
  opts?: ResolveClaudeOptions;
}): Promise<WriteClaudeCredentialsResult> {
  if (!validateAnthropicKey(input.apiKey)) {
    throw new Error("Refusing to write empty or implausibly short Anthropic API key.");
  }

  const path = resolveClaudeCredentialsPath(input.opts);

  await mkdir(dirname(path), { recursive: true });

  let existing: Record<string, unknown> = {};
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    if (isObjectRecord(parsed)) {
      existing = parsed;
    }
  } catch {
    // missing or unreadable file is fine; we'll create or replace it
  }

  const priorKey = existing.apiKey;
  const overwroteExisting =
    typeof priorKey === "string" && priorKey.length > 0 && priorKey !== input.apiKey;

  const next = { ...existing, apiKey: input.apiKey };
  const serialized = `${JSON.stringify(next, null, 2)}\n`;

  await writeFile(path, serialized, "utf8");

  // chmod 600 is meaningless on Windows; ignore failure so we don't block onboarding
  try {
    await chmod(path, 0o600);
  } catch {
    // ignore
  }

  return { path, overwroteExisting };
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
