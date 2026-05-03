import { spawn, type SpawnOptions } from "node:child_process";
import { delimiter, join } from "node:path";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";

export type DetectedClaudeCli =
  | { found: true; path: string; version: string | null }
  | { found: false; reason: string };

export type DetectClaudeCliOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Override for testing — defaults to spawning `claude --version`. */
  runVersion?: (executable: string) => Promise<{ stdout: string; code: number | null }>;
  /** Override for testing — defaults to checking PATH for the executable. */
  resolveExecutable?: (
    candidates: readonly string[],
    pathEntries: readonly string[],
  ) => Promise<string | null>;
};

const PROBE_TIMEOUT_MS = 4000;

export async function detectClaudeCli(
  opts: DetectClaudeCliOptions = {},
): Promise<DetectedClaudeCli> {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const candidates = candidateNames(platform);
  const pathEntries = (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);

  const resolved = await (opts.resolveExecutable
    ? opts.resolveExecutable(candidates, pathEntries)
    : findOnPath(candidates, pathEntries));

  if (!resolved) {
    return { found: false, reason: "`claude` was not found on PATH." };
  }

  const runner = opts.runVersion ?? defaultRunVersion;
  let stdout = "";
  let code: number | null = null;

  try {
    const result = await runner(resolved);
    stdout = result.stdout;
    code = result.code;
  } catch (error) {
    return {
      found: false,
      reason: `Failed to run ${resolved} --version: ${formatError(error)}`,
    };
  }

  if (code !== 0 && code !== null) {
    return {
      found: false,
      reason: `${resolved} --version exited with code ${code}.`,
    };
  }

  return {
    found: true,
    path: resolved,
    version: extractVersion(stdout),
  };
}

function candidateNames(platform: NodeJS.Platform): readonly string[] {
  if (platform === "win32") {
    return ["claude.exe", "claude.cmd", "claude.bat", "claude"];
  }
  return ["claude"];
}

async function findOnPath(
  candidates: readonly string[],
  pathEntries: readonly string[],
): Promise<string | null> {
  for (const dir of pathEntries) {
    for (const candidate of candidates) {
      const probe = join(dir, candidate);
      try {
        await access(probe, fsConstants.X_OK);
        return probe;
      } catch {
        // Some Windows shells expose .cmd files without the X bit; fall back to F_OK.
        try {
          await access(probe, fsConstants.F_OK);
          return probe;
        } catch {
          // try the next candidate
        }
      }
    }
  }
  return null;
}

async function defaultRunVersion(
  executable: string,
): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const opts: SpawnOptions = {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    };
    const child = spawn(executable, ["--version"], opts);

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (code: number | null, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
        return;
      }
      // Some CLIs print the version to stderr instead of stdout.
      resolve({ stdout: stdout || stderr, code });
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null, new Error(`probe timed out after ${PROBE_TIMEOUT_MS}ms`));
    }, PROBE_TIMEOUT_MS);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => finish(null, error));
    child.on("close", (code) => finish(code));
  });
}

function extractVersion(stdout: string): string | null {
  const match = stdout.match(/\d+\.\d+\.\d+(?:[-+][\w.]+)?/);
  return match ? match[0] : stdout.trim() || null;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
