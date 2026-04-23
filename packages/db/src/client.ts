import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "./generated/prisma/client";
import { getDatabaseUrl } from "./index";

export function createPrismaClient(databaseUrl = getDatabaseUrl()): PrismaClient {
  const adapter = new PrismaLibSql({
    url: databaseUrl,
  });

  return new PrismaClient({ adapter });
}

export { PrismaClient };
