import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { ApprovalStatus } from "@vimbuspromax3000/shared";
import { isApprovalSubjectType } from "@vimbuspromax3000/shared";
import { refreshTaskReadiness } from "./approvalRepository";
import { appendLoopEvent } from "./eventRepository";
import type { DatabaseClient } from "./types";

export type CreateReviewArtifactInput = {
  projectId: string;
  subjectType: string;
  subjectId: string;
  title: string;
  markdown: string;
  payload?: unknown;
  payloadJson?: string | null;
  stage?: string | null;
  status?: string | null;
};

export type ListReviewArtifactsInput = {
  projectId?: string;
  subjectType?: string;
  subjectId?: string;
  status?: string;
};

export type ReviewArtifactDecisionInput = {
  artifactId: string;
  status: Extract<ApprovalStatus, "granted" | "rejected">;
  operator?: string | null;
  reason?: string | null;
};

type ReviewArtifactRecord = NonNullable<Awaited<ReturnType<typeof getReviewArtifact>>>;

type PlaywrightSpecPayload = {
  kind: "playwright_spec";
  stagingFilePath: string;
  stagingWorkspaceRoot?: string;
  taskId?: string;
  validationId?: string;
};

type PlaywrightSpecApprovalResult = {
  validationId: string;
  testFilePath: string;
};

export async function createReviewArtifact(db: DatabaseClient, input: CreateReviewArtifactInput) {
  const payloadJson = input.payloadJson ?? serializeJson(input.payload);
  const artifact = await db.reviewArtifact.create({
    data: {
      projectId: input.projectId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      title: input.title,
      markdown: input.markdown,
      payloadJson,
      stage: input.stage ?? "review",
      status: input.status ?? "pending",
    },
  });

  await appendLoopEvent(db, {
    projectId: input.projectId,
    type: "review.requested",
    payload: {
      reviewArtifactId: artifact.id,
      subjectType: artifact.subjectType,
      subjectId: artifact.subjectId,
      stage: artifact.stage,
      status: artifact.status,
    },
  });

  return artifact;
}

export async function listReviewArtifacts(db: DatabaseClient, input: ListReviewArtifactsInput = {}) {
  return db.reviewArtifact.findMany({
    where: {
      projectId: input.projectId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      status: input.status,
    },
    orderBy: [{ createdAt: "desc" }],
  });
}

export async function getReviewArtifact(db: DatabaseClient, id: string) {
  return db.reviewArtifact.findUnique({
    where: { id },
  });
}

export async function decideReviewArtifact(db: DatabaseClient, input: ReviewArtifactDecisionInput) {
  const artifact = await getReviewArtifact(db, input.artifactId);

  if (!artifact) {
    throw new Error(`Review artifact ${input.artifactId} was not found.`);
  }

  const sideEffectResult = await applyReviewArtifactFilesystemSideEffect(db, artifact, input.status);
  const targetSubjectType = getTargetSubjectType(artifact);
  const targetSubjectId = targetSubjectType === "review_artifact" ? artifact.id : artifact.subjectId;
  const targetStage = artifact.stage || "review";

  return db.$transaction(async (tx) => {
    const approval = await tx.approval.create({
      data: {
        projectId: artifact.projectId,
        subjectType: targetSubjectType,
        subjectId: targetSubjectId,
        stage: targetStage,
        status: input.status,
        operator: input.operator ?? null,
        reason: input.reason ?? null,
      },
    });

    if (targetSubjectType === "planner_run") {
      await tx.plannerRun.update({
        where: { id: artifact.subjectId },
        data: { status: input.status === "granted" ? "approved" : "rejected" },
      });

      if (input.status === "granted") {
        await tx.task.updateMany({
          where: {
            status: "planned",
            epic: {
              plannerRunId: artifact.subjectId,
            },
          },
          data: {
            status: "awaiting_verification_approval",
          },
        });
      }
    }

    if (targetSubjectType === "verification_plan") {
      const plan = await tx.verificationPlan.findUnique({
        where: { id: artifact.subjectId },
      });

      if (!plan) {
        throw new Error(`Verification plan ${artifact.subjectId} was not found.`);
      }

      await tx.verificationPlan.update({
        where: { id: plan.id },
        data: {
          status: input.status === "granted" ? "approved" : "rejected",
          approvedAt: input.status === "granted" ? new Date() : null,
        },
      });

      if (input.status === "granted") {
        await tx.verificationItem.updateMany({
          where: {
            planId: plan.id,
            status: "proposed",
          },
          data: {
            status: "approved",
          },
        });

        await tx.task.update({
          where: { id: plan.taskId },
          data: { status: "ready" },
        });
      }
    }

    if (targetSubjectType === "validation") {
      const validation = await tx.validation.update({
        where: { id: artifact.subjectId },
        data: {
          status: input.status === "granted" ? "approved" : "rejected",
          approvalId: approval.id,
          approvedAt: input.status === "granted" ? new Date() : null,
          rejectedAt: input.status === "rejected" ? new Date() : null,
          ...(sideEffectResult ? { testFilePath: sideEffectResult.testFilePath } : {}),
        },
        select: { taskId: true },
      });

      await refreshTaskReadiness(tx, validation.taskId);
    }

    const updatedArtifact = await tx.reviewArtifact.update({
      where: { id: artifact.id },
      data: {
        status: input.status === "granted" ? "approved" : "rejected",
        approvalId: approval.id,
      },
    });

    await appendLoopEvent(tx, {
      projectId: artifact.projectId,
      type: input.status === "granted" ? "approval.granted" : "approval.rejected",
      payload: {
        approvalId: approval.id,
        reviewArtifactId: artifact.id,
        subjectType: targetSubjectType,
        subjectId: targetSubjectId,
        stage: targetStage,
        status: input.status,
      },
    });

    return {
      artifact: updatedArtifact,
      approval,
    };
  });
}

async function applyReviewArtifactFilesystemSideEffect(
  db: DatabaseClient,
  artifact: ReviewArtifactRecord,
  status: ReviewArtifactDecisionInput["status"],
): Promise<PlaywrightSpecApprovalResult | null> {
  const payload = parsePlaywrightSpecPayload(artifact.payloadJson);
  if (!payload || artifact.subjectType !== "validation") {
    return null;
  }

  if (payload.validationId && payload.validationId !== artifact.subjectId) {
    throw new Error(
      `Playwright spec payload validationId ${payload.validationId} does not match review artifact subject ${artifact.subjectId}.`,
    );
  }

  const [project, validation] = await Promise.all([
    db.project.findUnique({
      where: { id: artifact.projectId },
      select: { rootPath: true },
    }),
    db.validation.findUnique({
      where: { id: artifact.subjectId },
      select: {
        id: true,
        taskId: true,
        task: {
          select: {
            epic: {
              select: {
                projectId: true,
              },
            },
          },
        },
      },
    }),
  ]);

  if (!project) {
    throw new Error(`Project ${artifact.projectId} was not found.`);
  }
  if (!validation) {
    throw new Error(`Validation ${artifact.subjectId} was not found.`);
  }
  if (validation.task.epic.projectId !== artifact.projectId) {
    throw new Error(
      `Validation ${validation.id} does not belong to project ${artifact.projectId}.`,
    );
  }

  const sourcePath = resolveStagingFilePath(
    project.rootPath,
    payload.stagingFilePath,
    payload.stagingWorkspaceRoot,
  );

  if (status === "rejected") {
    rmSync(sourcePath, { force: true });
    return null;
  }

  if (!existsSync(sourcePath)) {
    throw new Error(`Playwright staging file ${payload.stagingFilePath} was not found.`);
  }

  const taskPathSegment = sanitizePathSegment(validation.taskId, "taskId");
  const validationPathSegment = sanitizePathSegment(validation.id, "validationId");
  const testFilePath = join(
    "tests",
    "generated",
    taskPathSegment,
    `${validationPathSegment}.spec.ts`,
  ).replace(/\\/g, "/");
  const destinationPath = resolveInsideProject(project.rootPath, testFilePath, "testFilePath");

  mkdirSync(dirname(destinationPath), { recursive: true });
  if (resolve(sourcePath) !== resolve(destinationPath)) {
    rmSync(destinationPath, { force: true });
    renameSync(sourcePath, destinationPath);
  }

  return {
    validationId: validation.id,
    testFilePath,
  };
}

function getTargetSubjectType(artifact: ReviewArtifactRecord): string {
  if (artifact.subjectType === "validation") {
    return "validation";
  }

  return isApprovalSubjectType(artifact.subjectType) ? artifact.subjectType : "review_artifact";
}

function parsePlaywrightSpecPayload(payloadJson: string | null): PlaywrightSpecPayload | null {
  if (!payloadJson) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || parsed.kind !== "playwright_spec") {
    return null;
  }
  if (typeof parsed.stagingFilePath !== "string" || parsed.stagingFilePath.length === 0) {
    throw new Error("Playwright spec payload requires stagingFilePath.");
  }
  const taskId = parsed.taskId;
  const validationId = parsed.validationId;
  const stagingWorkspaceRoot = parsed.stagingWorkspaceRoot;

  if (taskId !== undefined && typeof taskId !== "string") {
    throw new Error("Playwright spec payload taskId must be a string when provided.");
  }
  if (validationId !== undefined && typeof validationId !== "string") {
    throw new Error("Playwright spec payload validationId must be a string when provided.");
  }
  if (stagingWorkspaceRoot !== undefined && typeof stagingWorkspaceRoot !== "string") {
    throw new Error("Playwright spec payload stagingWorkspaceRoot must be a string when provided.");
  }

  return {
    kind: "playwright_spec",
    stagingFilePath: parsed.stagingFilePath,
    stagingWorkspaceRoot,
    taskId,
    validationId,
  };
}

function resolveInsideProject(rootPath: string, value: string, fieldName: string): string {
  const projectRoot = resolve(rootPath);
  const absolutePath = isAbsolute(value) ? resolve(value) : resolve(projectRoot, value);
  const relativePath = relative(projectRoot, absolutePath);

  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`${fieldName} must resolve inside the project root.`);
  }

  return absolutePath;
}

function resolveStagingFilePath(
  projectRootPath: string,
  value: string,
  stagingWorkspaceRoot?: string,
): string {
  const normalizedValue = value.replace(/\\/g, "/");
  const projectRoot = resolve(projectRootPath);
  const artifactRoot = resolve(process.cwd(), "apps", "api", ".artifacts", "staging", "playwright");

  if (isAbsolute(value)) {
    const absolutePath = resolve(value);
    if (isInside(projectRoot, absolutePath) || isInside(artifactRoot, absolutePath)) {
      return absolutePath;
    }

    throw new Error("stagingFilePath must resolve inside the project root or Playwright staging artifacts.");
  }

  if (
    normalizedValue.startsWith("apps/api/.artifacts/staging/playwright/") ||
    normalizedValue.startsWith(".artifacts/staging/playwright/")
  ) {
    if (stagingWorkspaceRoot) {
      const basePath = normalizedValue.startsWith("apps/api/")
        ? resolve(stagingWorkspaceRoot)
        : resolve(stagingWorkspaceRoot, "apps", "api");
      return resolveInsideBase(basePath, value, "stagingFilePath");
    }

    const projectCandidate = resolveInsideBase(projectRoot, value, "stagingFilePath");
    if (existsSync(projectCandidate)) {
      return projectCandidate;
    }

    const basePath = normalizedValue.startsWith("apps/api/")
      ? resolve(process.cwd())
      : resolve(process.cwd(), "apps", "api");
    return resolveInsideBase(basePath, value, "stagingFilePath");
  }

  return resolveInsideProject(projectRootPath, value, "stagingFilePath");
}

function resolveInsideBase(basePath: string, value: string, fieldName: string): string {
  const baseRoot = resolve(basePath);
  const absolutePath = resolve(baseRoot, value);
  const relativePath = relative(baseRoot, absolutePath);

  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`${fieldName} must resolve inside ${baseRoot}.`);
  }

  return absolutePath;
}

function isInside(rootPath: string, value: string): boolean {
  const relativePath = relative(rootPath, value);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function sanitizePathSegment(value: string, fieldName: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error(`${fieldName} must be a safe path segment.`);
  }

  return value;
}

function serializeJson(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return typeof value === "string" ? value : JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
