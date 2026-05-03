import { readFile } from "node:fs/promises";
import type { ResolveClaudeOptions } from "@vimbuspromax3000/model-registry";
import { resolveVimbusStatePath } from "./configPath";

export type VimbusState = {
  selectedProjectId?: string;
  lastApiUrl?: string;
};

export async function readVimbusState(opts: ResolveClaudeOptions = {}): Promise<VimbusState> {
  const path = resolveVimbusStatePath(opts);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }

  if (!isRecord(parsed)) {
    return {};
  }

  const out: VimbusState = {};
  if (typeof parsed.selectedProjectId === "string") {
    out.selectedProjectId = parsed.selectedProjectId;
  }
  if (typeof parsed.lastApiUrl === "string") {
    out.lastApiUrl = parsed.lastApiUrl;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
