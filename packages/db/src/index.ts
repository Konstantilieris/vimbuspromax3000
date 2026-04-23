export const DEFAULT_DATABASE_URL = "file:./prisma/vimbuspromax3000.dev.db";

export function getDatabaseUrl(env: Record<string, string | undefined> = process.env): string {
  return env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

export * from "./client";
export * from "./repositories/index";
