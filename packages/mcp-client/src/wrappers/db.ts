import type { PrismaClient } from "@vimbuspromax3000/db/client";

export const TASKGOBLIN_DB_SERVER_NAME = "taskgoblin-db";
export const DB_QUERY_TOOL_NAME = "read.query";
export const DB_LIST_TABLES_TOOL_NAME = "read.list_tables";

export const DB_QUERY_INPUT_SCHEMA = {
  type: "object",
  properties: {
    sql: {
      type: "string",
      description:
        "Single read-only SELECT statement (or read-only WITH ... SELECT). " +
        "Mutating statements, multi-statement batches, and mutating CTEs are rejected.",
    },
  },
  required: ["sql"],
  additionalProperties: false,
} as const;

export const DB_LIST_TABLES_INPUT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

export type DbReadErrorCode =
  | "INVALID_ARGUMENTS"
  | "QUERY_FAILED";

export class DbReadError extends Error {
  constructor(
    message: string,
    public readonly code: DbReadErrorCode,
  ) {
    super(message);
    this.name = "DbReadError";
  }
}

export type DbQueryInput = {
  sql: string;
};

export type DbQuerySuccess = {
  ok: true;
  rows: Array<Record<string, unknown>>;
};

export type DbQueryFailure = {
  ok: false;
  code: DbReadErrorCode;
  message: string;
};

export type DbQueryResult = DbQuerySuccess | DbQueryFailure;

export type DbListTablesSuccess = {
  ok: true;
  tables: string[];
};

export type DbListTablesFailure = {
  ok: false;
  code: DbReadErrorCode;
  message: string;
};

export type DbListTablesResult = DbListTablesSuccess | DbListTablesFailure;

export type DbWrapper = {
  readonly serverName: typeof TASKGOBLIN_DB_SERVER_NAME;
  readonly queryToolName: typeof DB_QUERY_TOOL_NAME;
  readonly listTablesToolName: typeof DB_LIST_TABLES_TOOL_NAME;
  query(input: DbQueryInput): Promise<DbQueryResult>;
  listTables(): Promise<DbListTablesResult>;
};

export function createDbWrapper(options: { prisma: PrismaClient }): DbWrapper {
  const { prisma } = options;

  return {
    serverName: TASKGOBLIN_DB_SERVER_NAME,
    queryToolName: DB_QUERY_TOOL_NAME,
    listTablesToolName: DB_LIST_TABLES_TOOL_NAME,

    async query(input) {
      try {
        const sql = parseSqlInput(input);
        assertSelectOnly(sql);

        const rows = (await prisma.$queryRawUnsafe(sql)) as Array<Record<string, unknown>>;
        const safeRows = Array.isArray(rows) ? rows.map(normalizeRow) : [];

        return { ok: true, rows: safeRows };
      } catch (error) {
        if (error instanceof DbReadError) {
          return { ok: false, code: error.code, message: error.message };
        }
        return {
          ok: false,
          code: "QUERY_FAILED",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async listTables() {
      try {
        const rows = (await prisma.$queryRawUnsafe(LIST_TABLES_SQL)) as Array<{ name: string }>;
        const tables = (Array.isArray(rows) ? rows : [])
          .map((row) => (typeof row?.name === "string" ? row.name : null))
          .filter((name): name is string => Boolean(name));
        return { ok: true, tables };
      } catch (error) {
        return {
          ok: false,
          code: "QUERY_FAILED",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

const LIST_TABLES_SQL =
  "SELECT name FROM sqlite_master " +
  "WHERE type = 'table' " +
  "AND name NOT LIKE 'sqlite_%' " +
  "AND name NOT LIKE '_prisma_%' " +
  "ORDER BY name";

function parseSqlInput(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new DbReadError(
      "read.query arguments must be an object with a string `sql` field.",
      "INVALID_ARGUMENTS",
    );
  }

  const record = input as Record<string, unknown>;
  const sql = record.sql;

  if (typeof sql !== "string") {
    throw new DbReadError("read.query `sql` must be a string.", "INVALID_ARGUMENTS");
  }

  return sql;
}

function normalizeRow(row: unknown): Record<string, unknown> {
  if (!row || typeof row !== "object") {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    out[key] = typeof value === "bigint" ? value.toString() : value;
  }
  return out;
}

/**
 * Assert that `sql` is a single read-only statement.
 *
 * Threat model:
 * - We have no SQL parser dep in the workspace, so this is a strict tokenizer:
 *   1. Strip line comments (`-- ...` to end of line).
 *   2. Strip block comments (`/* ... *\/`, non-nested — standard SQL).
 *   3. Strip string literals (`'...'`, with `''` escape).
 *   4. Strip quoted identifiers (`"..."`, `[...]`, `` `...` ``).
 * - With those stripped, scan the remaining tokens (uppercased) for any of a
 *   denylist of mutating keywords: INSERT, UPDATE, DELETE, DROP, TRUNCATE,
 *   ALTER, CREATE, REPLACE, MERGE, GRANT, REVOKE, ATTACH, DETACH, PRAGMA,
 *   VACUUM, REINDEX, ANALYZE, EXEC, EXECUTE, CALL.
 * - The first non-stripped, non-whitespace token must be SELECT or WITH.
 * - A `;` is allowed only at the trailing position (optionally followed by
 *   whitespace). A `;` followed by another non-trivial token is a multi-
 *   statement batch and is rejected.
 *
 * Threat-model gaps we accept:
 * - We do not parse a real AST. Functions or operators that mutate state are
 *   theoretically possible — but SQLite has no stored procedures, no user
 *   triggers from a SELECT context, and the `read.query` path runs against a
 *   regular Prisma client whose connection is not granted DDL/DML rights at
 *   the data layer in production. The keyword denylist + multi-statement
 *   guard is a defence-in-depth on top of those facts.
 * - Nested block comments are not standard SQL and are not handled.
 * - Backslash-escapes inside single-quoted strings are not standard SQL; we
 *   honour the SQL standard `''` escape only. A SQLite client driver would
 *   reject malformed strings before we executed them anyway.
 */
export function assertSelectOnly(sql: string): void {
  if (typeof sql !== "string") {
    throw new DbReadError("sql must be a string.", "INVALID_ARGUMENTS");
  }

  const stripped = stripCommentsStringsAndIdentifiers(sql);
  const trimmed = stripped.trim();

  if (trimmed.length === 0) {
    throw new DbReadError("sql is empty after stripping comments.", "INVALID_ARGUMENTS");
  }

  // Multi-statement check: a `;` followed by additional non-whitespace is a batch.
  const firstSemicolon = trimmed.indexOf(";");
  if (firstSemicolon !== -1) {
    const tail = trimmed.slice(firstSemicolon + 1).trim();
    if (tail.length > 0) {
      throw new DbReadError(
        "sql must be a single statement (no `;`-separated batches).",
        "INVALID_ARGUMENTS",
      );
    }
  }

  // Tokenize: split on non-word characters, keep word tokens.
  const tokens = trimmed
    .split(/[^A-Za-z0-9_]+/)
    .map((token) => token.toUpperCase())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    throw new DbReadError("sql contains no tokens.", "INVALID_ARGUMENTS");
  }

  const first = tokens[0];
  if (first !== "SELECT" && first !== "WITH") {
    throw new DbReadError(
      `sql must begin with SELECT or WITH; got ${first}.`,
      "INVALID_ARGUMENTS",
    );
  }

  for (const token of tokens) {
    if (FORBIDDEN_KEYWORDS.has(token)) {
      throw new DbReadError(
        `sql contains forbidden keyword \`${token}\` (read-only wrapper accepts SELECT/WITH only).`,
        "INVALID_ARGUMENTS",
      );
    }
  }
}

const FORBIDDEN_KEYWORDS = new Set<string>([
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "TRUNCATE",
  "ALTER",
  "CREATE",
  "REPLACE",
  "MERGE",
  "GRANT",
  "REVOKE",
  "ATTACH",
  "DETACH",
  "PRAGMA",
  "VACUUM",
  "REINDEX",
  "ANALYZE",
  "EXEC",
  "EXECUTE",
  "CALL",
  // RETURNING is allowed only in SELECT context but is otherwise tied to
  // INSERT/UPDATE/DELETE. We do NOT add it here — a read-only `SELECT ...
  // RETURNING` is meaningless and the engine will error, which is fine.
]);

/**
 * Replace string literals, quoted identifiers, and comments with whitespace
 * (preserving length for diagnostics is unnecessary; we just keep token
 * boundaries clean by inserting a single space).
 */
function stripCommentsStringsAndIdentifiers(sql: string): string {
  const out: string[] = [];
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i];
    if (ch === undefined) {
      break;
    }
    const next = i + 1 < n ? sql[i + 1] : "";

    // Line comment: -- to end of line.
    if (ch === "-" && next === "-") {
      i += 2;
      while (i < n && sql[i] !== "\n") {
        i += 1;
      }
      out.push(" ");
      continue;
    }

    // Block comment: /* ... */ (non-nested, standard SQL).
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) {
        i += 1;
      }
      if (i < n) {
        i += 2; // consume */
      }
      out.push(" ");
      continue;
    }

    // Single-quoted string literal with '' escape.
    if (ch === "'") {
      i += 1;
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2; // escaped quote, stay in string
            continue;
          }
          i += 1; // end of string
          break;
        }
        i += 1;
      }
      out.push(" ");
      continue;
    }

    // Double-quoted identifier with "" escape.
    if (ch === '"') {
      i += 1;
      while (i < n) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      out.push(" ");
      continue;
    }

    // Backtick-quoted identifier (MySQL flavour, harmless to support here).
    if (ch === "`") {
      i += 1;
      while (i < n && sql[i] !== "`") {
        i += 1;
      }
      if (i < n) {
        i += 1;
      }
      out.push(" ");
      continue;
    }

    // Bracket-quoted identifier (SQL Server flavour, harmless to support here).
    if (ch === "[") {
      i += 1;
      while (i < n && sql[i] !== "]") {
        i += 1;
      }
      if (i < n) {
        i += 1;
      }
      out.push(" ");
      continue;
    }

    out.push(ch);
    i += 1;
  }

  return out.join("");
}
