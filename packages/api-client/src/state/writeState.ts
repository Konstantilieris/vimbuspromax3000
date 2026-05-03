import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ResolveClaudeOptions } from "@vimbuspromax3000/model-registry";
import { resolveVimbusStatePath } from "./configPath";
import type { VimbusState } from "./readState";

export type WriteVimbusStateInput = {
  patch: Partial<VimbusState>;
  opts?: ResolveClaudeOptions;
};

export type WriteVimbusStateResult = {
  path: string;
  state: VimbusState;
};

export async function writeVimbusState(
  input: WriteVimbusStateInput,
): Promise<WriteVimbusStateResult> {
  const path = resolveVimbusStatePath(input.opts);

  await mkdir(dirname(path), { recursive: true });

  let existing: Record<string, unknown> = {};
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    if (isRecord(parsed)) {
      existing = parsed;
    }
  } catch {
    // missing or unreadable: treat as empty
  }

  const next: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(input.patch)) {
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }

  const serialized = `${JSON.stringify(next, null, 2)}\n`;
  const tmpPath = `${path}.${randomUUID()}.tmp`;

  try {
    await writeFile(tmpPath, serialized, { encoding: "utf8", mode: 0o600 });
    await rename(tmpPath, path);
  } catch (error) {
    try {
      await unlink(tmpPath);
    } catch {
      // ignore
    }
    throw error;
  }

  try {
    await chmod(path, 0o600);
  } catch {
    // chmod is meaningless on Windows
  }

  return {
    path,
    state: extractState(next),
  };
}

function extractState(record: Record<string, unknown>): VimbusState {
  const out: VimbusState = {};
  if (typeof record.selectedProjectId === "string") {
    out.selectedProjectId = record.selectedProjectId;
  }
  if (typeof record.lastApiUrl === "string") {
    out.lastApiUrl = record.lastApiUrl;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
