import type { BranchState } from "@vimbuspromax3000/shared";
import type { DatabaseClient } from "./types";

export type CreateTaskBranchInput = {
  taskId: string;
  name: string;
  base: string;
  state: BranchState;
  currentHead?: string | null;
  lastVerifiedAt?: Date | null;
};

export type UpdateTaskBranchInput = {
  name?: string;
  base?: string;
  state?: BranchState;
  currentHead?: string | null;
  lastVerifiedAt?: Date | null;
};

export async function createTaskBranch(db: DatabaseClient, input: CreateTaskBranchInput) {
  return db.taskBranch.create({
    data: {
      taskId: input.taskId,
      name: input.name,
      base: input.base,
      state: input.state,
      currentHead: input.currentHead ?? null,
      lastVerifiedAt: input.lastVerifiedAt ?? null,
    },
  });
}

export async function getTaskBranch(db: DatabaseClient, taskId: string) {
  return db.taskBranch.findUnique({
    where: { taskId },
  });
}

export async function getTaskBranchById(db: DatabaseClient, id: string) {
  return db.taskBranch.findUnique({
    where: { id },
  });
}

export async function getTaskBranchDetail(db: DatabaseClient, taskId: string) {
  const branch = await db.taskBranch.findUnique({
    where: { taskId },
    include: {
      task: {
        include: {
          epic: {
            include: {
              plannerRun: true,
              project: true,
            },
          },
        },
      },
      executions: {
        orderBy: [{ createdAt: "desc" }],
        take: 1,
      },
    },
  });

  if (!branch) {
    return null;
  }

  return {
    ...branch,
    latestExecution: branch.executions[0] ?? null,
  };
}

export async function updateTaskBranch(db: DatabaseClient, branchId: string, input: UpdateTaskBranchInput) {
  return db.taskBranch.update({
    where: { id: branchId },
    data: {
      name: input.name,
      base: input.base,
      state: input.state,
      currentHead: input.currentHead,
      lastVerifiedAt: input.lastVerifiedAt,
    },
  });
}

export async function abandonTaskBranch(db: DatabaseClient, taskId: string) {
  return db.taskBranch.update({
    where: { taskId },
    data: {
      state: "abandoned",
    },
  });
}
