import { createHash } from "node:crypto";

export function normalizeArgs(args: unknown): string {
  return JSON.stringify(deepSortKeys(args));
}

export function hashArgs(normalized: string): string {
  return createHash("sha256").update(normalized).digest("hex");
}

function deepSortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepSortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, deepSortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}
