import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";
import { PrismaClient as PostgresPrismaClient } from "./generated/prisma-postgres/client";
import { getDatabaseUrl } from "./index";

export type DatabaseProvider = "sqlite" | "postgresql";

export function createPrismaClient(databaseUrl = getDatabaseUrl()): PrismaClient {
  if (getDatabaseProvider(databaseUrl) === "postgresql") {
    const adapter = new PrismaPg({ connectionString: databaseUrl });
    return new PostgresPrismaClient({ adapter }) as unknown as PrismaClient;
  }

  const adapter = new PrismaLibSql({
    url: databaseUrl,
  });

  return new PrismaClient({ adapter });
}

export function getDatabaseProvider(databaseUrl = getDatabaseUrl()): DatabaseProvider {
  const scheme = getDatabaseUrlScheme(databaseUrl);

  return scheme === "postgres" || scheme === "postgresql" ? "postgresql" : "sqlite";
}

export { PrismaClient };

function getDatabaseUrlScheme(databaseUrl: string): string | undefined {
  return databaseUrl.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
}
