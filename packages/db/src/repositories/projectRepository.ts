import type { DatabaseClient } from "./types";

export type CreateProjectInput = {
  name: string;
  rootPath: string;
  baseBranch?: string;
  branchNaming?: string;
};

export async function createProject(db: DatabaseClient, input: CreateProjectInput) {
  return db.project.create({
    data: {
      name: input.name,
      rootPath: input.rootPath,
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
  return db.project.findFirst({
    where: { rootPath },
    orderBy: [{ createdAt: "asc" }],
  });
}
