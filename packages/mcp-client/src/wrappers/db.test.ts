import { createProject } from "@vimbuspromax3000/db";
import type { PrismaClient } from "@vimbuspromax3000/db/client";
import { createIsolatedPrisma, removeTempDir } from "@vimbuspromax3000/db/testing";
import {
  createDbWrapper,
  DB_LIST_TABLES_TOOL_NAME,
  DB_QUERY_TOOL_NAME,
  TASKGOBLIN_DB_SERVER_NAME,
  assertSelectOnly,
  DbReadError,
} from "./db";

const HOOK_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 30_000;

describe("taskgoblin-db read wrapper", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-db-wrapper-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  }, HOOK_TIMEOUT_MS);

  test(
    "exposes the registered server and tool names",
    { timeout: TEST_TIMEOUT_MS },
    () => {
      const wrapper = createDbWrapper({ prisma });
      expect(wrapper.serverName).toBe(TASKGOBLIN_DB_SERVER_NAME);
      expect(wrapper.queryToolName).toBe(DB_QUERY_TOOL_NAME);
      expect(wrapper.listTablesToolName).toBe(DB_LIST_TABLES_TOOL_NAME);
    },
  );

  test(
    "SELECT * FROM \"Task\" LIMIT 10 passes through and returns rows",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const project = await createProject(prisma, {
        name: "Read Wrapper Project",
        rootPath: tempDir,
      });
      const wrapper = createDbWrapper({ prisma });

      const result = await wrapper.query({
        sql: 'SELECT id, name FROM "Project" LIMIT 10',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(`expected success, got ${result.code}: ${result.message}`);
      }
      expect(Array.isArray(result.rows)).toBe(true);
      expect(result.rows.length).toBeGreaterThanOrEqual(1);
      expect(result.rows[0]).toMatchObject({ id: project.id, name: project.name });
    },
  );

  test(
    "INSERT is rejected with INVALID_ARGUMENTS",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const wrapper = createDbWrapper({ prisma });
      const result = await wrapper.query({
        sql: "INSERT INTO \"Task\" (id, title) VALUES ('x', 'y')",
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected failure");
      expect(result.code).toBe("INVALID_ARGUMENTS");
    },
  );

  test(
    "UPDATE is rejected with INVALID_ARGUMENTS",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const wrapper = createDbWrapper({ prisma });
      const result = await wrapper.query({
        sql: "UPDATE \"Task\" SET status = 'done'",
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected failure");
      expect(result.code).toBe("INVALID_ARGUMENTS");
    },
  );

  test(
    "DELETE is rejected with INVALID_ARGUMENTS",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const wrapper = createDbWrapper({ prisma });
      const result = await wrapper.query({
        sql: "DELETE FROM \"Task\"",
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected failure");
      expect(result.code).toBe("INVALID_ARGUMENTS");
    },
  );

  test(
    "multi-statement batch (SELECT 1; DROP TABLE \"Task\";) is rejected",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const wrapper = createDbWrapper({ prisma });
      const result = await wrapper.query({
        sql: 'SELECT 1; DROP TABLE "Task";',
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected failure");
      expect(result.code).toBe("INVALID_ARGUMENTS");
    },
  );

  test(
    "leading line comment passes through",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const wrapper = createDbWrapper({ prisma });
      const result = await wrapper.query({
        sql: "-- harmless\nSELECT 1 AS one",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(`expected success, got ${result.code}: ${result.message}`);
      }
      expect(result.rows[0]).toMatchObject({ one: 1 });
    },
  );

  test(
    "read-only CTE passes through",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const wrapper = createDbWrapper({ prisma });
      const result = await wrapper.query({
        sql: "WITH x AS (SELECT 1 AS n) SELECT * FROM x",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(`expected success, got ${result.code}: ${result.message}`);
      }
      expect(result.rows[0]).toMatchObject({ n: 1 });
    },
  );

  test(
    "mutating CTE (WITH ... DELETE ... RETURNING) is rejected",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const wrapper = createDbWrapper({ prisma });
      const result = await wrapper.query({
        sql: 'WITH x AS (DELETE FROM "Task" RETURNING *) SELECT * FROM x',
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected failure");
      expect(result.code).toBe("INVALID_ARGUMENTS");
    },
  );

  test(
    "list_tables returns Prisma model tables",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const wrapper = createDbWrapper({ prisma });
      const result = await wrapper.listTables();

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(`expected success, got ${result.code}: ${result.message}`);
      }

      expect(Array.isArray(result.tables)).toBe(true);
      expect(result.tables).toEqual(expect.arrayContaining(["Project", "Task"]));
      // tables should not include sqlite internal tables.
      expect(result.tables.find((name) => name.startsWith("sqlite_"))).toBeUndefined();
    },
  );

  test(
    "rejects non-string sql input",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const wrapper = createDbWrapper({ prisma });
      const result = await wrapper.query({ sql: 123 as unknown as string });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected failure");
      expect(result.code).toBe("INVALID_ARGUMENTS");
    },
  );

  test(
    "rejects empty sql",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const wrapper = createDbWrapper({ prisma });
      const result = await wrapper.query({ sql: "   \n  -- nothing\n  " });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected failure");
      expect(result.code).toBe("INVALID_ARGUMENTS");
    },
  );
});

describe("assertSelectOnly tokenizer", () => {
  test("accepts plain SELECT", () => {
    expect(() => assertSelectOnly("SELECT 1")).not.toThrow();
  });

  test("accepts SELECT with trailing semicolon-only terminator", () => {
    expect(() => assertSelectOnly("SELECT 1;")).not.toThrow();
    expect(() => assertSelectOnly("SELECT 1;\n  -- trailing\n")).not.toThrow();
  });

  test("accepts SELECT containing the word DELETE inside a string literal", () => {
    expect(() => assertSelectOnly("SELECT 'DELETE FROM x' AS msg")).not.toThrow();
  });

  test("accepts SELECT against a column quoted as a forbidden keyword", () => {
    expect(() => assertSelectOnly('SELECT "delete_count" FROM tbl')).not.toThrow();
  });

  test("accepts a read-only CTE referencing SELECT", () => {
    expect(() =>
      assertSelectOnly("WITH cte AS (SELECT 1 AS n) SELECT * FROM cte"),
    ).not.toThrow();
  });

  test("rejects empty input", () => {
    expect(() => assertSelectOnly("")).toThrow(DbReadError);
    expect(() => assertSelectOnly("   ")).toThrow(DbReadError);
    expect(() => assertSelectOnly("-- only comment\n")).toThrow(DbReadError);
  });

  test("rejects INSERT", () => {
    expect(() => assertSelectOnly("INSERT INTO t (a) VALUES (1)")).toThrow(DbReadError);
  });

  test("rejects UPDATE", () => {
    expect(() => assertSelectOnly("UPDATE t SET a = 1")).toThrow(DbReadError);
  });

  test("rejects DELETE", () => {
    expect(() => assertSelectOnly("DELETE FROM t")).toThrow(DbReadError);
  });

  test("rejects DROP", () => {
    expect(() => assertSelectOnly("DROP TABLE t")).toThrow(DbReadError);
  });

  test("rejects TRUNCATE", () => {
    expect(() => assertSelectOnly("TRUNCATE TABLE t")).toThrow(DbReadError);
  });

  test("rejects ALTER", () => {
    expect(() => assertSelectOnly("ALTER TABLE t ADD COLUMN c INTEGER")).toThrow(DbReadError);
  });

  test("rejects PRAGMA (sqlite mutator surface)", () => {
    expect(() => assertSelectOnly("PRAGMA writable_schema = 1")).toThrow(DbReadError);
  });

  test("rejects ATTACH (sqlite database mounting)", () => {
    expect(() => assertSelectOnly("ATTACH 'foo' AS evil")).toThrow(DbReadError);
  });

  test("rejects multi-statement batch", () => {
    expect(() => assertSelectOnly("SELECT 1; DROP TABLE t;")).toThrow(DbReadError);
    expect(() => assertSelectOnly("SELECT 1;\nSELECT 2")).toThrow(DbReadError);
  });

  test("rejects mutating CTE", () => {
    expect(() =>
      assertSelectOnly("WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x"),
    ).toThrow(DbReadError);
    expect(() =>
      assertSelectOnly("WITH x AS (INSERT INTO t (a) VALUES (1) RETURNING *) SELECT * FROM x"),
    ).toThrow(DbReadError);
    expect(() =>
      assertSelectOnly("WITH x AS (UPDATE t SET a = 1 RETURNING *) SELECT * FROM x"),
    ).toThrow(DbReadError);
  });

  test("rejects /* block comment */ that hides a mutator", () => {
    // Block comments are stripped — verifies stripping does not let a mutator slip through.
    expect(() => assertSelectOnly("/* comment */ DELETE FROM t")).toThrow(DbReadError);
  });

  test("accepts a /* block comment */ followed by SELECT", () => {
    expect(() => assertSelectOnly("/* lead */ SELECT 1")).not.toThrow();
  });
});
