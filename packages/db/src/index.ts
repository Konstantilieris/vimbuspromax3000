import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultDatabasePath = resolve(packageRoot, "prisma", "vimbuspromax3000.dev.db").replace(/\\/g, "/");

export const DEFAULT_DATABASE_URL = `file:${defaultDatabasePath}`;

export function getDatabaseUrl(env: Record<string, string | undefined> = process.env): string {
  return env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

export * from "./client";
export * from "./repositories/index";
