import type { PrismaClient } from "../client";
import type { Prisma } from "../generated/prisma/client";

export type DatabaseClient = PrismaClient | Prisma.TransactionClient;
