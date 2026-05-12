import type { PrismaClient } from "@vimbuspromax3000/db/client";
import { mapJiraIssuesToDrafts, type JiraImportDraft, type JiraIssue, type ValidationDraft } from "./mapping";

export type ImportJiraIssuesInput = {
  projectId: string;
  issues: readonly JiraIssue[];
  epicKey?: string;
  acceptanceCriteriaField?: string | readonly string[];
};

export type ImportJiraIssuesResult = {
  plannerRunId: string;
  epicId: string;
  taskIds: string[];
  validationIds: string[];
  reviewArtifactId: string;
};

type JiraProjectMapping = {
  jira?: {
    imports?: Record<string, JiraEpicImportMapping>;
  };
};

type JiraEpicImportMapping = {
  plannerRunId: string;
  epicId: string;
  reviewArtifactId?: string;
  taskIdsByIssueKey: Record<string, string>;
  validationIdsByIssueKey: Record<string, string>;
  updatedAt: string;
};

type MutableDb = PrismaClient & {
  [key: string]: any;
};

export async function importJiraIssues(
  db: PrismaClient,
  input: ImportJiraIssuesInput,
): Promise<ImportJiraIssuesResult> {
  const draft = mapJiraIssuesToDrafts(input.issues, {
    epicKey: input.epicKey,
    acceptanceCriteriaField: input.acceptanceCriteriaField,
  });

  return db.$transaction(async (tx) => importDraft(tx as MutableDb, input.projectId, draft));
}

async function importDraft(db: MutableDb, projectId: string, draft: JiraImportDraft): Promise<ImportJiraIssuesResult> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, jiraMappingJson: true },
  });

  if (!project) {
    throw new Error(`Project ${projectId} was not found.`);
  }

  const mapping = parseProjectMapping(project.jiraMappingJson);
  const existingImport = mapping.jira?.imports?.[draft.epic.source.issueKey];
  const existingEpic = await db.epic.findUnique({
    where: { jiraIssueKey: draft.epic.source.issueKey },
  });
  const plannerRun = await upsertPlannerRun(db, {
    projectId,
    draft,
    plannerRunId: existingImport?.plannerRunId ?? existingEpic?.plannerRunId ?? null,
  });
  const epic = await upsertEpic(db, projectId, plannerRun.id, draft);
  const taskIdsByIssueKey: Record<string, string> = {};
  const validationIdsByIssueKey: Record<string, string> = { ...(existingImport?.validationIdsByIssueKey ?? {}) };
  const validationIds: string[] = [];

  for (const taskDraft of draft.epic.tasks) {
    const task = await upsertTask(db, epic.id, taskDraft);
    taskIdsByIssueKey[taskDraft.source.issueKey] = task.id;

    for (const validationDraft of taskDraft.validations) {
      const validation = await upsertValidation(db, {
        draft: validationDraft,
        taskId: task.id,
        validationId: validationIdsByIssueKey[validationDraft.source.issueKey],
      });
      validationIdsByIssueKey[validationDraft.source.issueKey] = validation.id;
      validationIds.push(validation.id);
    }
  }

  for (const validationDraft of draft.orphanValidations) {
    const parentKey = validationDraft.taskStableId;
    const taskId = parentKey ? taskIdsByIssueKey[parentKey] : undefined;

    if (!taskId) {
      continue;
    }

    const validation = await upsertValidation(db, {
      draft: validationDraft,
      taskId,
      validationId: validationIdsByIssueKey[validationDraft.source.issueKey],
    });
    validationIdsByIssueKey[validationDraft.source.issueKey] = validation.id;
    validationIds.push(validation.id);
  }

  const reviewArtifact = await upsertReviewArtifact(db, {
    projectId,
    plannerRunId: plannerRun.id,
    reviewArtifactId: existingImport?.reviewArtifactId,
    draft,
    taskIdsByIssueKey,
    validationIdsByIssueKey,
  });
  const updatedMapping: JiraProjectMapping = {
    ...mapping,
    jira: {
      ...(mapping.jira ?? {}),
      imports: {
        ...(mapping.jira?.imports ?? {}),
        [draft.epic.source.issueKey]: {
          plannerRunId: plannerRun.id,
          epicId: epic.id,
          reviewArtifactId: reviewArtifact.id,
          taskIdsByIssueKey,
          validationIdsByIssueKey,
          updatedAt: new Date().toISOString(),
        },
      },
    },
  };

  await db.project.update({
    where: { id: projectId },
    data: { jiraMappingJson: JSON.stringify(updatedMapping) },
  });

  return {
    plannerRunId: plannerRun.id,
    epicId: epic.id,
    taskIds: Object.values(taskIdsByIssueKey),
    validationIds,
    reviewArtifactId: reviewArtifact.id,
  };
}

async function upsertPlannerRun(
  db: MutableDb,
  input: {
    projectId: string;
    draft: JiraImportDraft;
    plannerRunId: string | null;
  },
) {
  if (input.plannerRunId) {
    const existing = await db.plannerRun.findUnique({ where: { id: input.plannerRunId } });

    if (existing) {
      return db.plannerRun.update({
        where: { id: existing.id },
        data: {
          goal: input.draft.epic.goal,
          moduleName: "jira",
          summary: buildPlannerSummary(input.draft),
        },
      });
    }
  }

  return db.plannerRun.create({
    data: {
      projectId: input.projectId,
      status: "generated",
      goal: input.draft.epic.goal,
      moduleName: "jira",
      summary: buildPlannerSummary(input.draft),
    },
  });
}

async function upsertEpic(db: MutableDb, projectId: string, plannerRunId: string, draft: JiraImportDraft) {
  const existing =
    (await db.epic.findUnique({
      where: { jiraIssueKey: draft.epic.source.issueKey },
    })) ??
    (await db.epic.findFirst({
      where: {
        projectId,
        key: draft.epic.key,
      },
    }));
  const data = {
    projectId,
    plannerRunId,
    key: draft.epic.key,
    jiraIssueKey: draft.epic.source.issueKey,
    title: draft.epic.title,
    goal: draft.epic.goal,
    orderIndex: draft.epic.orderIndex,
    acceptanceJson: JSON.stringify(draft.epic.acceptance),
    risksJson: serializeJson(draft.epic.risks),
  };

  if (existing) {
    return db.epic.update({
      where: { id: existing.id },
      data,
    });
  }

  return db.epic.create({
    data: {
      ...data,
      status: "planned",
    },
  });
}

async function upsertTask(db: MutableDb, epicId: string, draft: JiraImportDraft["epic"]["tasks"][number]) {
  const existing =
    (await db.task.findUnique({
      where: { jiraIssueKey: draft.source.issueKey },
    })) ??
    (await db.task.findUnique({
      where: { stableId: draft.stableId },
    }));
  const data = {
    epicId,
    stableId: draft.stableId,
    jiraIssueKey: draft.source.issueKey,
    title: draft.title,
    description: draft.description,
    type: draft.type,
    complexity: draft.complexity,
    orderIndex: draft.orderIndex,
    acceptanceJson: JSON.stringify(draft.acceptance),
    targetFilesJson: serializeJson(draft.targetFiles),
    requiresJson: serializeJson(draft.requires),
  };

  if (existing) {
    return db.task.update({
      where: { id: existing.id },
      data,
    });
  }

  return db.task.create({
    data: {
      ...data,
      status: "planned",
    },
  });
}

async function upsertValidation(
  db: MutableDb,
  input: {
    draft: ValidationDraft;
    taskId: string;
    validationId: string | undefined;
  },
) {
  const data = {
    taskId: input.taskId,
    testType: input.draft.testType,
    title: input.draft.title,
    description: input.draft.description,
    acceptanceCriteriaJson: JSON.stringify(input.draft.acceptanceCriteria),
    rationale: input.draft.rationale,
    command: input.draft.command,
    testFilePath: input.draft.testFilePath,
    metadataJson: JSON.stringify({
      ...input.draft.metadata,
      source: input.draft.source,
    }),
    orderIndex: input.draft.orderIndex,
  };

  if (input.validationId) {
    const existing = await db.validation.findUnique({ where: { id: input.validationId } });

    if (existing) {
      return db.validation.update({
        where: { id: existing.id },
        data,
      });
    }
  }

  return db.validation.create({
    data: {
      ...data,
      status: "proposed",
    },
  });
}

async function upsertReviewArtifact(
  db: MutableDb,
  input: {
    projectId: string;
    plannerRunId: string;
    reviewArtifactId: string | undefined;
    draft: JiraImportDraft;
    taskIdsByIssueKey: Record<string, string>;
    validationIdsByIssueKey: Record<string, string>;
  },
) {
  const markdown = buildReviewMarkdown(input.draft);
  const payloadJson = JSON.stringify({
    provider: "jira",
    epicIssueKey: input.draft.epic.source.issueKey,
    taskIdsByIssueKey: input.taskIdsByIssueKey,
    validationIdsByIssueKey: input.validationIdsByIssueKey,
    ignoredIssueKeys: input.draft.ignoredIssues.map((issue) => issue.issueKey),
  });
  const data = {
    projectId: input.projectId,
    subjectType: "planner_run",
    subjectId: input.plannerRunId,
    title: `Jira import summary: ${input.draft.epic.source.issueKey}`,
    markdown,
    payloadJson,
    stage: "jira_import",
  };

  if (input.reviewArtifactId) {
    const existing = await db.reviewArtifact.findUnique({ where: { id: input.reviewArtifactId } });

    if (existing) {
      return db.reviewArtifact.update({
        where: { id: existing.id },
        data,
      });
    }
  }

  const existingForRun = await db.reviewArtifact.findFirst({
    where: {
      projectId: input.projectId,
      subjectType: "planner_run",
      subjectId: input.plannerRunId,
      stage: "jira_import",
    },
  });

  if (existingForRun) {
    return db.reviewArtifact.update({
      where: { id: existingForRun.id },
      data,
    });
  }

  return db.reviewArtifact.create({
    data: {
      ...data,
      status: "pending",
    },
  });
}

function buildPlannerSummary(draft: JiraImportDraft): string {
  const validationCount = draft.epic.tasks.reduce((count, task) => count + task.validations.length, 0);
  return `Imported Jira epic ${draft.epic.source.issueKey} with ${draft.epic.tasks.length} tasks and ${validationCount} validations.`;
}

function buildReviewMarkdown(draft: JiraImportDraft): string {
  const lines = [
    `# Jira import ${draft.epic.source.issueKey}`,
    "",
    `Imported **${draft.epic.title}** from Jira.`,
    "",
    `- Tasks: ${draft.epic.tasks.length}`,
    `- Validations: ${draft.epic.tasks.reduce((count, task) => count + task.validations.length, 0)}`,
    `- Ignored issues: ${draft.ignoredIssues.length}`,
    "",
    "## Tasks",
  ];

  for (const task of draft.epic.tasks) {
    lines.push(`- ${task.source.issueKey}: ${task.title} (${task.validations.length} validations)`);
  }

  return lines.join("\n");
}

function parseProjectMapping(value: string | null): JiraProjectMapping {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as JiraProjectMapping;
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
