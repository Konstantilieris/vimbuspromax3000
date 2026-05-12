import { appendLoopEvent } from "./eventRepository";
import type { DatabaseClient } from "./types";

type PlannerProposalValidationInput = {
  testType?: string;
  kind?: string;
  runner?: string | null;
  title?: string;
  description?: string | null;
  acceptanceCriteria?: unknown;
  acceptanceCriteriaJson?: string | null;
  rationale?: string | null;
  command?: string | null;
  testFilePath?: string | null;
  metadata?: unknown;
  metadataJson?: string | null;
  orderIndex?: number;
  verificationItemIndex?: number;
  legacyVerificationItemIndex?: number;
  status?: string;
};

export type CreatePlannerRunInput = {
  projectId: string;
  goal: string;
  moduleName?: string | null;
  contextPath?: string | null;
};

export type PlannerProposalInput = {
  plannerRunId: string;
  summary?: string | null;
  epics: Array<{
    key: string;
    title: string;
    goal: string;
    orderIndex?: number;
    acceptance?: unknown;
    risks?: unknown;
    tasks: Array<{
      stableId: string;
      title: string;
      description?: string | null;
      type: string;
      complexity: string;
      orderIndex?: number;
      acceptance: unknown;
      targetFiles?: unknown;
      requires?: unknown;
      validations?: PlannerProposalValidationInput[];
      verificationPlan: {
        rationale?: string | null;
        items: Array<{
          kind: string;
          runner?: string | null;
          title: string;
          description: string;
          rationale?: string | null;
          command?: string | null;
          testFilePath?: string | null;
          route?: string | null;
          interaction?: string | null;
          expectedAssetId?: string | null;
          orderIndex?: number;
          config?: unknown;
          validation?: PlannerProposalValidationInput | null;
        }>;
      };
    }>;
  }>;
};

export async function createPlannerRun(db: DatabaseClient, input: CreatePlannerRunInput) {
  const plannerRun = await db.plannerRun.create({
    data: {
      projectId: input.projectId,
      status: "interviewing",
      goal: input.goal,
      moduleName: input.moduleName ?? null,
      contextPath: input.contextPath ?? null,
    },
  });

  await appendLoopEvent(db, {
    projectId: input.projectId,
    type: "planner.started",
    payload: {
      plannerRunId: plannerRun.id,
      goal: plannerRun.goal,
      moduleName: plannerRun.moduleName,
      contextPath: plannerRun.contextPath,
    },
  });

  return plannerRun;
}

export async function getPlannerRunDetail(db: DatabaseClient, id: string) {
  const plannerRun = await db.plannerRun.findUnique({
    where: { id },
    include: {
      project: true,
      epics: {
        orderBy: [{ orderIndex: "asc" }],
        include: {
          tasks: {
            orderBy: [{ orderIndex: "asc" }],
            include: {
              verificationPlans: {
                orderBy: [{ createdAt: "desc" }],
                take: 1,
                include: {
                  items: {
                    orderBy: [{ orderIndex: "asc" }],
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!plannerRun) {
    return null;
  }

  const approvals = await db.approval.findMany({
    where: {
      subjectType: "planner_run",
      subjectId: plannerRun.id,
    },
    orderBy: [{ createdAt: "asc" }],
  });

  return {
    ...plannerRun,
    interview: parseRecordJson(plannerRun.interviewJson),
    proposalSummary: {
      epicCount: plannerRun.epics.length,
      taskCount: plannerRun.epics.reduce((count, epic) => count + epic.tasks.length, 0),
      verificationPlanCount: plannerRun.epics.reduce(
        (count, epic) => count + epic.tasks.reduce((taskCount, task) => taskCount + task.verificationPlans.length, 0),
        0,
      ),
    },
    approvals,
  };
}

export async function updatePlannerInterview(
  db: DatabaseClient,
  input: {
    plannerRunId: string;
    answers: Record<string, unknown>;
  },
) {
  const plannerRun = await db.plannerRun.findUnique({
    where: { id: input.plannerRunId },
  });

  if (!plannerRun) {
    throw new Error(`Planner run ${input.plannerRunId} was not found.`);
  }

  const mergedInterview = {
    ...parseRecordJson(plannerRun.interviewJson),
    ...input.answers,
  };

  const updatedPlannerRun = await db.plannerRun.update({
    where: { id: input.plannerRunId },
    data: {
      interviewJson: JSON.stringify(mergedInterview),
    },
  });

  await appendLoopEvent(db, {
    projectId: plannerRun.projectId,
    type: "planner.answer",
    payload: {
      plannerRunId: plannerRun.id,
      answers: input.answers,
    },
  });

  return {
    ...updatedPlannerRun,
    interview: mergedInterview,
  };
}

export async function persistPlannerProposal(db: DatabaseClient, input: PlannerProposalInput) {
  if (input.epics.length === 0) {
    throw new Error("Planner proposal must include at least one epic.");
  }

  return db.$transaction(async (tx) => {
    const plannerRun = await tx.plannerRun.findUnique({
      where: { id: input.plannerRunId },
    });

    if (!plannerRun) {
      throw new Error(`Planner run ${input.plannerRunId} was not found.`);
    }

    await clearPlannerRunProposal(tx, plannerRun.id);

    for (const [epicIndex, epic] of input.epics.entries()) {
      const createdEpic = await tx.epic.create({
        data: {
          projectId: plannerRun.projectId,
          plannerRunId: plannerRun.id,
          key: epic.key,
          title: epic.title,
          goal: epic.goal,
          status: "planned",
          orderIndex: epic.orderIndex ?? epicIndex,
          acceptanceJson: serializeJson(epic.acceptance),
          risksJson: serializeJson(epic.risks),
        },
      });

      for (const [taskIndex, task] of epic.tasks.entries()) {
        if (task.verificationPlan.items.length === 0) {
          throw new Error(`Task ${task.stableId} must include at least one verification item.`);
        }

        const taskAcceptanceJson = serializeRequiredJson(task.acceptance, `task ${task.stableId} acceptance`);
        const createdTask = await tx.task.create({
          data: {
            epicId: createdEpic.id,
            stableId: task.stableId,
            title: task.title,
            description: task.description ?? null,
            type: task.type,
            complexity: task.complexity,
            status: "planned",
            orderIndex: task.orderIndex ?? taskIndex,
            acceptanceJson: taskAcceptanceJson,
            targetFilesJson: serializeJson(task.targetFiles),
            requiresJson: serializeJson(task.requires),
          },
        });

        const verificationPlan = await tx.verificationPlan.create({
          data: {
            taskId: createdTask.id,
            status: "proposed",
            rationale: task.verificationPlan.rationale ?? null,
          },
        });

        const createdVerificationItems: Array<{
          input: (typeof task.verificationPlan.items)[number];
          row: { id: string };
          itemIndex: number;
        }> = [];

        for (const [itemIndex, item] of task.verificationPlan.items.entries()) {
          const createdVerificationItem = await tx.verificationItem.create({
            data: {
              planId: verificationPlan.id,
              taskId: createdTask.id,
              kind: item.kind,
              runner: item.runner ?? null,
              title: item.title,
              description: item.description,
              rationale: item.rationale ?? null,
              command: item.command ?? null,
              testFilePath: item.testFilePath ?? null,
              route: item.route ?? null,
              interaction: item.interaction ?? null,
              expectedAssetId: item.expectedAssetId ?? null,
              status: "proposed",
              orderIndex: item.orderIndex ?? itemIndex,
              configJson: serializeJson(item.config),
            },
          });

          createdVerificationItems.push({
            input: item,
            row: createdVerificationItem,
            itemIndex,
          });
        }

        const explicitValidationItems = splitExplicitValidationsByLegacyItem(
          task.validations ?? [],
          createdVerificationItems.length,
          task.stableId,
        );

        for (const createdVerificationItem of createdVerificationItems) {
          const explicitValidation = explicitValidationItems.byItemIndex.get(createdVerificationItem.itemIndex);

          await createValidationForVerificationItem(tx, {
            taskId: createdTask.id,
            taskStableId: task.stableId,
            taskAcceptanceJson,
            verificationItemId: createdVerificationItem.row.id,
            item: createdVerificationItem.input,
            itemIndex: createdVerificationItem.itemIndex,
            validation: explicitValidation ?? createdVerificationItem.input.validation ?? undefined,
          });
        }

        for (const { validation, validationIndex } of explicitValidationItems.standalone) {
          const createdVerificationItem = await createVerificationItemForStandaloneValidation(tx, {
            taskId: createdTask.id,
            planId: verificationPlan.id,
            taskStableId: task.stableId,
            validation,
            validationIndex,
            orderIndex: task.verificationPlan.items.length + validationIndex,
          });

          await createValidationForVerificationItem(tx, {
            taskId: createdTask.id,
            taskStableId: task.stableId,
            taskAcceptanceJson,
            verificationItemId: createdVerificationItem.id,
            item: null,
            itemIndex: task.verificationPlan.items.length + validationIndex,
            validation,
          });
        }
      }
    }

    const updatedPlannerRun = await tx.plannerRun.update({
      where: { id: plannerRun.id },
      data: {
        summary: input.summary ?? null,
        status: "generated",
      },
    });

    await appendLoopEvent(tx, {
      projectId: plannerRun.projectId,
      type: "planner.proposed",
      payload: {
        plannerRunId: plannerRun.id,
        summary: input.summary ?? null,
        epicCount: input.epics.length,
        taskCount: input.epics.reduce((count, epic) => count + epic.tasks.length, 0),
      },
    });

    return updatedPlannerRun;
  });
}

export async function setPlannerRunStatus(db: DatabaseClient, plannerRunId: string, status: string) {
  return db.plannerRun.update({
    where: { id: plannerRunId },
    data: { status },
  });
}

async function clearPlannerRunProposal(db: DatabaseClient, plannerRunId: string) {
  const epics = await db.epic.findMany({
    where: { plannerRunId },
    select: { id: true },
  });

  if (epics.length === 0) {
    return;
  }

  const epicIds = epics.map((epic) => epic.id);
  const tasks = await db.task.findMany({
    where: {
      epicId: { in: epicIds },
    },
    select: { id: true },
  });
  const taskIds = tasks.map((task) => task.id);

  if (taskIds.length > 0) {
    await db.validation.deleteMany({
      where: {
        taskId: { in: taskIds },
      },
    });
    await db.verificationItem.deleteMany({
      where: {
        taskId: { in: taskIds },
      },
    });
    await db.verificationPlan.deleteMany({
      where: {
        taskId: { in: taskIds },
      },
    });
    await db.task.deleteMany({
      where: {
        id: { in: taskIds },
      },
    });
  }

  await db.epic.deleteMany({
    where: { plannerRunId },
  });
}

function splitExplicitValidationsByLegacyItem(
  validations: PlannerProposalValidationInput[],
  itemCount: number,
  taskStableId: string,
) {
  const byItemIndex = new Map<number, PlannerProposalValidationInput>();
  const standalone: Array<{ validation: PlannerProposalValidationInput; validationIndex: number }> = [];

  for (const [validationIndex, validation] of validations.entries()) {
    const itemIndex = validation.verificationItemIndex ?? validation.legacyVerificationItemIndex;

    if (itemIndex === undefined || itemIndex === null) {
      standalone.push({ validation, validationIndex });
      continue;
    }

    if (itemIndex < 0 || itemIndex >= itemCount) {
      throw new Error(`Task ${taskStableId} validation ${validationIndex} references missing verification item ${itemIndex}.`);
    }

    if (byItemIndex.has(itemIndex)) {
      throw new Error(`Task ${taskStableId} has multiple validations for verification item ${itemIndex}.`);
    }

    byItemIndex.set(itemIndex, validation);
  }

  return { byItemIndex, standalone };
}

async function createVerificationItemForStandaloneValidation(
  db: DatabaseClient,
  input: {
    taskId: string;
    planId: string;
    taskStableId: string;
    validation: PlannerProposalValidationInput;
    validationIndex: number;
    orderIndex: number;
  },
) {
  const title = resolveStandaloneValidationTitle(input.validation, input.taskStableId, input.validationIndex);

  return db.verificationItem.create({
    data: {
      planId: input.planId,
      taskId: input.taskId,
      kind: input.validation.kind ?? input.validation.testType ?? "manual",
      runner: input.validation.runner ?? null,
      title,
      description: input.validation.description ?? title,
      rationale: input.validation.rationale ?? null,
      command: input.validation.command ?? null,
      testFilePath: input.validation.testFilePath ?? null,
      route: null,
      interaction: null,
      expectedAssetId: null,
      status: "proposed",
      orderIndex: input.validation.orderIndex ?? input.orderIndex,
      configJson: resolveValidationMetadataJson(input.validation, null),
    },
  });
}

async function createValidationForVerificationItem(
  db: DatabaseClient,
  input: {
    taskId: string;
    taskStableId: string;
    taskAcceptanceJson: string;
    verificationItemId: string;
    item: PlannerProposalInput["epics"][number]["tasks"][number]["verificationPlan"]["items"][number] | null;
    itemIndex: number;
    validation?: PlannerProposalValidationInput | null;
  },
) {
  const validation = input.validation ?? undefined;
  const status = validation?.status ?? "proposed";

  return db.validation.create({
    data: {
      taskId: input.taskId,
      verificationItemId: input.verificationItemId,
      testType: resolveValidationTestType(input.item, validation),
      status,
      title: resolveValidationTitle(input.item, validation, input.taskStableId, input.itemIndex),
      description: validation?.description ?? input.item?.description ?? null,
      acceptanceCriteriaJson: resolveValidationAcceptanceCriteriaJson(validation, input.taskAcceptanceJson),
      rationale: validation?.rationale ?? input.item?.rationale ?? null,
      command: validation?.command ?? input.item?.command ?? null,
      testFilePath: validation?.testFilePath ?? input.item?.testFilePath ?? null,
      metadataJson: resolveValidationMetadataJson(validation, input.item?.config),
      orderIndex: validation?.orderIndex ?? input.item?.orderIndex ?? input.itemIndex,
      legacyVerificationItemId: input.verificationItemId,
      approvedAt: status === "approved" ? new Date() : null,
      rejectedAt: status === "rejected" ? new Date() : null,
    },
  });
}

function resolveValidationTestType(
  item: PlannerProposalInput["epics"][number]["tasks"][number]["verificationPlan"]["items"][number] | null,
  validation: PlannerProposalValidationInput | undefined,
) {
  if (validation?.testType) {
    return validation.testType;
  }

  if (validation?.kind) {
    return validation.kind;
  }

  if (!item) {
    return "manual";
  }

  return item.runner === "playwright" ? "playwright" : item.kind;
}

function resolveValidationTitle(
  item: PlannerProposalInput["epics"][number]["tasks"][number]["verificationPlan"]["items"][number] | null,
  validation: PlannerProposalValidationInput | undefined,
  taskStableId: string,
  itemIndex: number,
) {
  const title = validation?.title ?? item?.title;

  if (!title) {
    throw new Error(`Task ${taskStableId} validation ${itemIndex} title is required.`);
  }

  return title;
}

function resolveStandaloneValidationTitle(
  validation: PlannerProposalValidationInput,
  taskStableId: string,
  validationIndex: number,
) {
  if (!validation.title) {
    throw new Error(`Task ${taskStableId} validation ${validationIndex} title is required.`);
  }

  return validation.title;
}

function resolveValidationAcceptanceCriteriaJson(
  validation: PlannerProposalValidationInput | undefined,
  taskAcceptanceJson: string,
) {
  if (validation?.acceptanceCriteriaJson !== undefined && validation.acceptanceCriteriaJson !== null) {
    return validation.acceptanceCriteriaJson;
  }

  return serializeJson(validation?.acceptanceCriteria) ?? taskAcceptanceJson;
}

function resolveValidationMetadataJson(
  validation: PlannerProposalValidationInput | undefined,
  fallbackMetadata: unknown,
) {
  if (validation?.metadataJson !== undefined && validation.metadataJson !== null) {
    return validation.metadataJson;
  }

  return serializeJson(validation?.metadata) ?? serializeJson(fallbackMetadata);
}

function parseRecordJson(value: string | null): Record<string, unknown> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }

  return {};
}

function serializeJson(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return typeof value === "string" ? value : JSON.stringify(value);
}

function serializeRequiredJson(value: unknown, fieldName: string): string {
  const serialized = serializeJson(value);

  if (!serialized) {
    throw new Error(`${fieldName} is required.`);
  }

  return serialized;
}
