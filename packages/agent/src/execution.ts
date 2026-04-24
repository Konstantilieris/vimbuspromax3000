import { spawnSync } from "node:child_process";
import type { PrismaClient } from "@vimbuspromax3000/db/client";
import {
  abandonTaskBranch as abandonTaskBranchRecord,
  appendLoopEvent,
  createAgentStep,
  createModelDecision,
  createTaskExecution,
  createTaskBranch,
  getLatestPatchReview,
  getTaskBranch,
  getTaskBranchDetail,
  getTaskExecutionContext,
  getTaskExecutionDetail,
  setTaskStatus,
  updatePatchReview,
  updateTaskBranch,
  updateTaskExecution,
} from "@vimbuspromax3000/db";
import { createMcpService } from "@vimbuspromax3000/mcp-client";
import { resolveModelSlot } from "@vimbuspromax3000/policy-engine";

export type ExecutionService = {
  getTaskBranch(taskId: string): Promise<Awaited<ReturnType<typeof getTaskBranchDetail>>>;
  prepareTaskBranch(input: { taskId: string }): Promise<Awaited<ReturnType<typeof getTaskBranchDetail>>>;
  abandonTaskBranch(input: { taskId: string }): Promise<Awaited<ReturnType<typeof getTaskBranchDetail>>>;
  startTaskExecution(input: { taskId: string }): Promise<Awaited<ReturnType<typeof getTaskExecutionDetail>>>;
  getExecutionPatchReview(
    executionId: string,
  ): Promise<{
    patchReview: NonNullable<Awaited<ReturnType<typeof getLatestPatchReview>>>;
    execution: NonNullable<Awaited<ReturnType<typeof getTaskExecutionDetail>>>;
  } | null>;
  approveExecutionPatchReview(
    executionId: string,
  ): Promise<{
    patchReview: NonNullable<Awaited<ReturnType<typeof getLatestPatchReview>>>;
    execution: NonNullable<Awaited<ReturnType<typeof getTaskExecutionDetail>>>;
  }>;
  rejectExecutionPatchReview(
    executionId: string,
  ): Promise<{
    patchReview: NonNullable<Awaited<ReturnType<typeof getLatestPatchReview>>>;
    execution: NonNullable<Awaited<ReturnType<typeof getTaskExecutionDetail>>>;
  }>;
};

export function createExecutionService(options: {
  prisma: PrismaClient;
  env?: Record<string, string | undefined>;
}): ExecutionService {
  const prisma = options.prisma;
  const env = options.env ?? process.env;
  const mcpService = createMcpService({ prisma });

  return {
    async getTaskBranch(taskId) {
      return getTaskBranchDetail(prisma, taskId);
    },

    async prepareTaskBranch(input) {
      const context = await requireReadyTaskContext(prisma, input.taskId);
      const project = context.epic.project;
      const derivedBranchName = deriveBranchName(project.branchNaming, {
        moduleName: context.epic.plannerRun?.moduleName ?? null,
        taskId: context.stableId,
        title: context.title,
      });

      assertGitRepository(project.rootPath);
      assertCleanWorktree(project.rootPath);
      assertLocalBranchExists(project.rootPath, project.baseBranch);
      assertValidBranchName(project.rootPath, derivedBranchName);

      const persistedBranch = await getTaskBranch(prisma, context.id);

      if (persistedBranch && persistedBranch.name !== derivedBranchName) {
        throw new Error(
          `Task ${context.id} already has persisted branch ${persistedBranch.name}, expected ${derivedBranchName}.`,
        );
      }

      const gitBranchExists = hasLocalBranch(project.rootPath, derivedBranchName);

      if (persistedBranch || gitBranchExists) {
        switchToBranch(project.rootPath, derivedBranchName);

        const currentHead = getHeadCommit(project.rootPath);
        ensureNotOnBaseBranch(project.rootPath, project.baseBranch);

        await prisma.$transaction(async (tx) => {
          if (persistedBranch) {
            await updateTaskBranch(tx, persistedBranch.id, {
              state: "created",
              currentHead,
              base: project.baseBranch,
            });
          } else {
            await createTaskBranch(tx, {
              taskId: context.id,
              name: derivedBranchName,
              base: project.baseBranch,
              state: "created",
              currentHead,
            });
          }

          await appendLoopEvent(tx, {
            projectId: project.id,
            type: "branch.switched",
            payload: {
              taskId: context.id,
              branchName: derivedBranchName,
              baseBranch: project.baseBranch,
            },
          });
        });

        return getTaskBranchDetail(prisma, context.id);
      }

      switchToBranch(project.rootPath, project.baseBranch);
      createAndSwitchToBranch(project.rootPath, derivedBranchName, project.baseBranch);

      const currentHead = getHeadCommit(project.rootPath);
      ensureNotOnBaseBranch(project.rootPath, project.baseBranch);

      await prisma.$transaction(async (tx) => {
        await createTaskBranch(tx, {
          taskId: context.id,
          name: derivedBranchName,
          base: project.baseBranch,
          state: "created",
          currentHead,
        });

        await appendLoopEvent(tx, {
          projectId: project.id,
          type: "branch.created",
          payload: {
            taskId: context.id,
            branchName: derivedBranchName,
            baseBranch: project.baseBranch,
          },
        });
        await appendLoopEvent(tx, {
          projectId: project.id,
          type: "branch.switched",
          payload: {
            taskId: context.id,
            branchName: derivedBranchName,
            baseBranch: project.baseBranch,
          },
        });
      });

      return getTaskBranchDetail(prisma, context.id);
    },

    async abandonTaskBranch(input) {
      const branch = await getTaskBranchDetail(prisma, input.taskId);

      if (!branch) {
        return null;
      }

      const project = branch.task.epic.project;
      assertGitRepository(project.rootPath);
      assertLocalBranchExists(project.rootPath, project.baseBranch);
      assertCleanWorktree(project.rootPath);

      if (getCurrentBranch(project.rootPath) === branch.name) {
        switchToBranch(project.rootPath, project.baseBranch);
      }

      await prisma.$transaction(async (tx) => {
        await abandonTaskBranchRecord(tx, input.taskId);
      });

      return getTaskBranchDetail(prisma, input.taskId);
    },

    async startTaskExecution(input) {
      const preparedBranch = await this.prepareTaskBranch({ taskId: input.taskId });

      if (!preparedBranch) {
        throw new Error(`Task ${input.taskId} branch could not be prepared.`);
      }

      const context = await requireReadyTaskContext(prisma, input.taskId);
      await mcpService.ensureProjectMcpSetup(context.epic.projectId);
      const project = context.epic.project;
      const branch = preparedBranch;
      const startedAt = new Date();
      const execution = await createTaskExecution(prisma, {
        taskId: context.id,
        branchId: branch.id,
        status: "queued",
        startedAt,
      });

      const resolution = await resolveModelSlot(
        prisma,
        {
          projectId: project.id,
          slotKey: "executor_default",
          taskExecutionId: execution.id,
        },
        env,
      );

      if (!resolution.ok) {
        await prisma.$transaction(async (tx) => {
          await updateTaskExecution(tx, execution.id, {
            status: "failed",
            finishedAt: new Date(),
          });
          await setTaskStatus(tx, context.id, "failed");
          await appendLoopEvent(tx, {
            projectId: project.id,
            taskExecutionId: execution.id,
            type: "task.failed",
            payload: {
              taskId: context.id,
              code: resolution.code,
              message: resolution.message,
            },
          });
        });

        throw new Error(`Execution model resolution failed: ${resolution.message}`);
      }

      const policyJson = JSON.stringify({
        modelResolution: resolution.value,
      });

      await prisma.$transaction(async (tx) => {
        await updateTaskExecution(tx, execution.id, {
          status: "implementing",
          policyJson,
          startedAt,
        });
        await updateTaskBranch(tx, branch.id, {
          state: "active",
          currentHead: getHeadCommit(project.rootPath),
        });
        await setTaskStatus(tx, context.id, "executing");
        await createModelDecision(tx, {
          projectId: project.id,
          taskExecutionId: execution.id,
          attempt: 1,
          complexityLabel: context.complexity,
          selectedSlot: "executor_default",
          selectedModel: resolution.value.concreteModelName,
          reason: "Execution started for approved task.",
          state: "selected",
        });
        const agentStep = await createAgentStep(tx, {
          taskExecutionId: execution.id,
          role: "executor",
          modelName: resolution.value.concreteModelName,
          status: "started",
          startedAt,
          summary: "Minimal execution backend started.",
        });

        await appendLoopEvent(tx, {
          projectId: project.id,
          taskExecutionId: execution.id,
          type: "task.selected",
          payload: {
            taskId: context.id,
            branchName: branch.name,
          },
        });
        await appendLoopEvent(tx, {
          projectId: project.id,
          taskExecutionId: execution.id,
          type: "model.selected",
          payload: {
            taskId: context.id,
            slotKey: "executor_default",
            selectedModel: resolution.value.concreteModelName,
            attempt: 1,
          },
        });
        await appendLoopEvent(tx, {
          projectId: project.id,
          taskExecutionId: execution.id,
          type: "agent.step.started",
          payload: {
            taskId: context.id,
            agentStepId: agentStep.id,
            role: "executor",
            modelName: resolution.value.concreteModelName,
          },
        });
      });

      const detail = await getTaskExecutionDetail(prisma, execution.id);

      if (!detail) {
        throw new Error(`Task execution ${execution.id} was not found after creation.`);
      }

      return detail;
    },

    async getExecutionPatchReview(executionId) {
      const execution = await getTaskExecutionDetail(prisma, executionId);

      if (!execution) {
        return null;
      }

      const patchReview = await getLatestPatchReview(prisma, executionId);

      if (!patchReview) {
        return null;
      }

      return {
        patchReview,
        execution,
      };
    },

    async approveExecutionPatchReview(executionId) {
      const execution = await getRequiredExecutionWithPatch(prisma, executionId);
      const now = new Date();

      await prisma.$transaction(async (tx) => {
        await updatePatchReview(tx, execution.patchReview.id, {
          status: "approved",
          approvedAt: now,
        });
        await updateTaskBranch(tx, execution.execution.branch.id, {
          state: "approved",
          currentHead: getHeadCommit(execution.execution.task.epic.project.rootPath),
        });
        await updateTaskExecution(tx, execution.execution.id, {
          status: "completed",
          finishedAt: now,
        });
        await setTaskStatus(tx, execution.execution.task.id, "completed");
        await appendLoopEvent(tx, {
          projectId: execution.execution.task.epic.project.id,
          taskExecutionId: execution.execution.id,
          type: "patch.approved",
          payload: {
            taskId: execution.execution.task.id,
            patchReviewId: execution.patchReview.id,
          },
        });
        await appendLoopEvent(tx, {
          projectId: execution.execution.task.epic.project.id,
          taskExecutionId: execution.execution.id,
          type: "task.completed",
          payload: {
            taskId: execution.execution.task.id,
            patchReviewId: execution.patchReview.id,
          },
        });
      });

      const updatedExecution = await getTaskExecutionDetail(prisma, executionId);
      const updatedPatchReview = await getLatestPatchReview(prisma, executionId);

      if (!updatedExecution || !updatedPatchReview) {
        throw new Error(`Patch review ${execution.patchReview.id} was not found after approval.`);
      }

      return {
        patchReview: updatedPatchReview,
        execution: updatedExecution,
      };
    },

    async rejectExecutionPatchReview(executionId) {
      const execution = await getRequiredExecutionWithPatch(prisma, executionId);
      const now = new Date();

      await prisma.$transaction(async (tx) => {
        await updatePatchReview(tx, execution.patchReview.id, {
          status: "rejected",
        });
        await updateTaskExecution(tx, execution.execution.id, {
          status: "failed",
          finishedAt: now,
        });
        await setTaskStatus(tx, execution.execution.task.id, "failed");
        await appendLoopEvent(tx, {
          projectId: execution.execution.task.epic.project.id,
          taskExecutionId: execution.execution.id,
          type: "task.failed",
          payload: {
            taskId: execution.execution.task.id,
            patchReviewId: execution.patchReview.id,
            reason: "Patch review rejected.",
          },
        });
      });

      const updatedExecution = await getTaskExecutionDetail(prisma, executionId);
      const updatedPatchReview = await getLatestPatchReview(prisma, executionId);

      if (!updatedExecution || !updatedPatchReview) {
        throw new Error(`Patch review ${execution.patchReview.id} was not found after rejection.`);
      }

      return {
        patchReview: updatedPatchReview,
        execution: updatedExecution,
      };
    },
  };
}

async function requireReadyTaskContext(prisma: PrismaClient, taskId: string) {
  const context = await getTaskExecutionContext(prisma, taskId);

  if (!context) {
    throw new Error(`Task ${taskId} was not found.`);
  }

  if (context.status !== "ready") {
    throw new Error(`Task ${taskId} must be ready before branch preparation or execution.`);
  }

  if (!context.latestVerificationPlan || context.latestVerificationPlan.status !== "approved") {
    throw new Error(`Task ${taskId} must have an approved verification plan before execution.`);
  }

  return context;
}

async function getRequiredExecutionWithPatch(prisma: PrismaClient, executionId: string) {
  const execution = await getTaskExecutionDetail(prisma, executionId);

  if (!execution) {
    throw new Error(`Task execution ${executionId} was not found.`);
  }

  const patchReview = await getLatestPatchReview(prisma, executionId);

  if (!patchReview) {
    throw new Error(`Task execution ${executionId} has no patch review.`);
  }

  return {
    execution,
    patchReview,
  };
}

function deriveBranchName(
  template: string,
  input: {
    moduleName?: string | null;
    taskId: string;
    title: string;
  },
) {
  const values = {
    module: sanitizeBranchValue(input.moduleName ?? "", true),
    "task-id": sanitizeBranchValue(input.taskId, false),
    slug: sanitizeBranchValue(input.title, true),
  } as const;
  const segments = template
    .split("/")
    .map((segment) => replaceBranchTokens(segment, values))
    .filter(Boolean);
  const branchName = segments.join("/");

  if (!branchName) {
    throw new Error(`Branch naming template ${template} resolved to an empty branch name.`);
  }

  return branchName;
}

function replaceBranchTokens(
  segment: string,
  values: {
    module: string;
    "task-id": string;
    slug: string;
  },
) {
  const normalized = segment
    .replaceAll("<module>", values.module)
    .replaceAll("<task-id>", values["task-id"])
    .replaceAll("<slug>", values.slug);

  if (/<[^>]+>/.test(normalized)) {
    throw new Error(`Unsupported branch naming token in segment: ${segment}`);
  }

  return normalized.replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "").trim();
}

function sanitizeBranchValue(value: string, lowercase: boolean) {
  const normalized = (lowercase ? value.toLowerCase() : value)
    .trim()
    .replace(/[^a-zA-Z0-9._/-]+/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/-{2,}/g, "-")
    .replace(/^[-/]+|[-/]+$/g, "");

  return normalized;
}

function assertGitRepository(rootPath: string) {
  const result = runGit(rootPath, ["rev-parse", "--is-inside-work-tree"], true);

  if (result.status !== 0 || result.stdout.trim() !== "true") {
    throw new Error(`Project root ${rootPath} is not a git repository.`);
  }
}

function assertCleanWorktree(rootPath: string) {
  const result = runGit(rootPath, ["status", "--porcelain"]);

  if (result.stdout.trim().length > 0) {
    throw new Error("Branch preparation requires a clean git worktree.");
  }
}

function assertLocalBranchExists(rootPath: string, branchName: string) {
  if (!hasLocalBranch(rootPath, branchName)) {
    throw new Error(`Base branch ${branchName} was not found in the local repository.`);
  }
}

function assertValidBranchName(rootPath: string, branchName: string) {
  const result = runGit(rootPath, ["check-ref-format", "--branch", branchName], true);

  if (result.status !== 0) {
    throw new Error(`Derived branch name ${branchName} is not a valid git branch name.`);
  }
}

function hasLocalBranch(rootPath: string, branchName: string) {
  return runGit(rootPath, ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], true).status === 0;
}

function switchToBranch(rootPath: string, branchName: string) {
  runGit(rootPath, ["switch", branchName]);
}

function createAndSwitchToBranch(rootPath: string, branchName: string, baseBranch: string) {
  runGit(rootPath, ["switch", "-c", branchName, baseBranch]);
}

function ensureNotOnBaseBranch(rootPath: string, baseBranch: string) {
  const currentBranch = getCurrentBranch(rootPath);

  if (currentBranch === baseBranch) {
    throw new Error(`Execution cannot run directly on the base branch ${baseBranch}.`);
  }
}

function getCurrentBranch(rootPath: string) {
  return runGit(rootPath, ["branch", "--show-current"]).stdout.trim();
}

function getHeadCommit(rootPath: string) {
  return runGit(rootPath, ["rev-parse", "HEAD"]).stdout.trim();
}

function runGit(rootPath: string, args: string[], allowFailure = false) {
  const result = spawnSync("git", args, {
    cwd: rootPath,
    encoding: "utf8",
  });

  if (!allowFailure && result.status !== 0) {
    const stderr = result.stderr?.trim() ?? "";
    const stdout = result.stdout?.trim() ?? "";
    throw new Error(
      `git ${args.join(" ")} failed.\n${[stdout, stderr].filter(Boolean).join("\n")}`.trim(),
    );
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
