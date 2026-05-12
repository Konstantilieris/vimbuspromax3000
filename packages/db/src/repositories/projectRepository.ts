import { parse, resolve, sep } from "node:path";
import type { DatabaseClient } from "./types";

export type CreateProjectInput = {
  name: string;
  rootPath: string;
  baseBranch?: string;
  branchNaming?: string;
};

export async function createProject(db: DatabaseClient, input: CreateProjectInput) {
  const rootPath = normalizeProjectRootPath(input.rootPath);

  return db.project.create({
    data: {
      name: input.name,
      rootPath,
      baseBranch: input.baseBranch ?? "main",
      branchNaming: input.branchNaming ?? "tg/<module>/<task-id>-<slug>",
    },
  });
}

export async function listProjects(db: DatabaseClient) {
  return db.project.findMany({
    orderBy: [{ createdAt: "asc" }],
  });
}

export async function getProjectById(db: DatabaseClient, id: string) {
  return db.project.findUnique({
    where: { id },
  });
}

export async function findProjectByRootPath(db: DatabaseClient, rootPath: string) {
  const normalizedRootPath = normalizeProjectRootPath(rootPath);
  const exact = await db.project.findFirst({
    where: { rootPath: normalizedRootPath },
    orderBy: [{ createdAt: "asc" }],
  });

  if (exact) {
    return exact;
  }

  const projects = await db.project.findMany({
    orderBy: [{ createdAt: "asc" }],
  });

  return projects.find((project) => normalizeProjectRootPath(project.rootPath) === normalizedRootPath) ?? null;
}

export function normalizeProjectRootPath(rootPath: string) {
  let normalized = resolve(rootPath);

  if (/^[A-Z]:/.test(normalized)) {
    normalized = `${normalized[0]!.toLowerCase()}${normalized.slice(1)}`;
  }

  const root = parse(normalized).root;
  while (normalized.length > root.length && normalized.endsWith(sep)) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}
