import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createPrismaClient, getDatabaseProvider, type PrismaClient } from "./client";

const databaseUrl = process.env.DATABASE_URL;
const isPostgres = !!databaseUrl && /^postgres(?:ql)?:\/\//i.test(databaseUrl);

describe.skipIf(!isPostgres)("Postgres Prisma client compatibility", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createPrismaClient(databaseUrl!);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("postgres URLs select the postgres adapter and preserve *Json fields as JSON text", async () => {
    expect(getDatabaseProvider(databaseUrl!)).toBe("postgresql");

    const project = await prisma.project.create({
      data: {
        name: "Postgres smoke",
        rootPath: "/tmp/taskgoblin-postgres-smoke",
      },
    });

    const event = await prisma.loopEvent.create({
      data: {
        projectId: project.id,
        type: "planner.started",
        payloadJson: JSON.stringify({ nested: { ok: true } }),
      },
    });

    const epic = await prisma.epic.create({
      data: {
        projectId: project.id,
        key: "PG-SMOKE",
        title: "Postgres JSON compatibility",
        goal: "Verify JSON text compatibility",
        status: "planned",
        orderIndex: 0,
        acceptanceJson: JSON.stringify([{ label: "json parsed by Postgres adapter" }]),
        risksJson: JSON.stringify({ risk: "low" }),
      },
    });

    expect(JSON.parse(event.payloadJson)).toEqual({ nested: { ok: true } });
    expect(JSON.parse(epic.acceptanceJson ?? "null")).toEqual([
      { label: "json parsed by Postgres adapter" },
    ]);
    expect(JSON.parse(epic.risksJson ?? "null")).toEqual({ risk: "low" });
  });
});
