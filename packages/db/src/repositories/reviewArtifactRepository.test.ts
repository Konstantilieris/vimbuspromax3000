import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PrismaClient } from "../client";
import { createIsolatedPrisma, removeTempDir } from "../testing";
import {
  createProject,
  createReviewArtifact,
  createValidation,
  decideReviewArtifact,
} from "./index";

describe("review artifact repository", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-review-artifact-repo-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  });

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test("approves and rejects staged Playwright specs for validation artifacts", async () => {
    const { project, task } = await seedTask(prisma, tempDir);
    const approvedValidation = await createValidation(prisma, {
      taskId: task.id,
      testType: "playwright",
      title: "Generated browser check",
    });
    const rejectedValidation = await createValidation(prisma, {
      taskId: task.id,
      testType: "playwright",
      title: "Rejected browser check",
    });
    const approvedCode = "import { test } from '@playwright/test';\n\ntest('approved', async () => {});\n";
    const rejectedCode = "import { test } from '@playwright/test';\n\ntest('rejected', async () => {});\n";
    const approvedStagingPath = writeStagingSpec(
      tempDir,
      approvedValidation.taskId,
      approvedValidation.id,
      approvedCode,
    );
    const rejectedStagingPath = writeStagingSpec(
      tempDir,
      rejectedValidation.taskId,
      rejectedValidation.id,
      rejectedCode,
    );
    const approvedArtifact = await createReviewArtifact(prisma, {
      projectId: project.id,
      subjectType: "validation",
      subjectId: approvedValidation.id,
      title: "Review approved spec",
      markdown: "Generated spec.",
      payload: {
        kind: "playwright_spec",
        taskId: task.id,
        validationId: approvedValidation.id,
        stagingFilePath: approvedStagingPath.relativePath,
      },
      stage: "validation_review",
    });
    const rejectedArtifact = await createReviewArtifact(prisma, {
      projectId: project.id,
      subjectType: "validation",
      subjectId: rejectedValidation.id,
      title: "Review rejected spec",
      markdown: "Generated spec.",
      payload: {
        kind: "playwright_spec",
        taskId: task.id,
        validationId: rejectedValidation.id,
        stagingFilePath: rejectedStagingPath.relativePath,
      },
      stage: "validation_review",
    });

    const approval = await decideReviewArtifact(prisma, {
      artifactId: approvedArtifact.id,
      status: "granted",
      operator: "ak",
    });
    await decideReviewArtifact(prisma, {
      artifactId: rejectedArtifact.id,
      status: "rejected",
      operator: "ak",
    });

    const approvedGeneratedPath = `tests/generated/${approvedValidation.taskId}/${approvedValidation.id}.spec.ts`;
    const approvedValidationAfter = await prisma.validation.findUnique({
      where: { id: approvedValidation.id },
    });
    const rejectedValidationAfter = await prisma.validation.findUnique({
      where: { id: rejectedValidation.id },
    });

    expect(approvedArtifact.payloadJson).toContain('"kind":"playwright_spec"');
    expect(approval.approval).toMatchObject({
      subjectType: "validation",
      subjectId: approvedValidation.id,
      status: "granted",
    });
    expect(existsSync(approvedStagingPath.absolutePath)).toBe(false);
    expect(readFileSync(join(tempDir, approvedGeneratedPath), "utf8")).toBe(approvedCode);
    expect(approvedValidationAfter?.testFilePath).toBe(approvedGeneratedPath);
    expect(existsSync(rejectedStagingPath.absolutePath)).toBe(false);
    expect(rejectedValidationAfter?.testFilePath).toBeNull();
  });

  test("validation review artifact decisions update validation approvals and task readiness", async () => {
    const { project, task } = await seedTask(prisma, tempDir);
    const firstValidation = await createValidation(prisma, {
      taskId: task.id,
      testType: "logic",
      title: "Logic contract",
    });
    const secondValidation = await createValidation(prisma, {
      taskId: task.id,
      testType: "manual",
      title: "Manual contract",
    });
    const firstArtifact = await createReviewArtifact(prisma, {
      projectId: project.id,
      subjectType: "validation",
      subjectId: firstValidation.id,
      title: "Review logic validation",
      markdown: "Approve logic validation.",
      stage: "validation_review",
    });
    const secondArtifact = await createReviewArtifact(prisma, {
      projectId: project.id,
      subjectType: "validation",
      subjectId: secondValidation.id,
      title: "Review manual validation",
      markdown: "Approve manual validation.",
      stage: "validation_review",
    });

    const firstDecision = await decideReviewArtifact(prisma, {
      artifactId: firstArtifact.id,
      status: "granted",
      operator: "ak",
    });
    const taskAfterPartialApproval = await prisma.task.findUnique({ where: { id: task.id } });

    expect(firstDecision.approval).toMatchObject({
      subjectType: "validation",
      subjectId: firstValidation.id,
      status: "granted",
    });
    await expect(prisma.validation.findUnique({ where: { id: firstValidation.id } })).resolves.toMatchObject({
      status: "approved",
      approvalId: firstDecision.approval.id,
    });
    expect(taskAfterPartialApproval?.status).toBe("awaiting_verification_approval");

    await decideReviewArtifact(prisma, {
      artifactId: secondArtifact.id,
      status: "granted",
      operator: "ak",
    });
    const taskAfterAllApproved = await prisma.task.findUnique({ where: { id: task.id } });
    expect(taskAfterAllApproved?.status).toBe("ready");

    const rejection = await decideReviewArtifact(prisma, {
      artifactId: secondArtifact.id,
      status: "rejected",
      operator: "ak",
      reason: "Needs a stronger assertion.",
    });
    const taskAfterRejection = await prisma.task.findUnique({ where: { id: task.id } });

    expect(rejection.artifact.status).toBe("rejected");
    expect(rejection.approval).toMatchObject({
      subjectType: "validation",
      subjectId: secondValidation.id,
      status: "rejected",
      reason: "Needs a stronger assertion.",
    });
    await expect(prisma.validation.findUnique({ where: { id: secondValidation.id } })).resolves.toMatchObject({
      status: "rejected",
      approvalId: rejection.approval.id,
      approvedAt: null,
    });
    expect(taskAfterRejection?.status).toBe("awaiting_verification_approval");
  });
});

async function seedTask(prisma: PrismaClient, rootPath: string) {
  const project = await createProject(prisma, {
    name: "Review Artifact Project",
    rootPath,
  });
  const epic = await prisma.epic.create({
    data: {
      projectId: project.id,
      key: `EPIC-RA-${Math.random().toString(36).slice(2)}`,
      title: "Review artifacts",
      goal: "Review staged generated artifacts.",
      status: "planned",
      orderIndex: 0,
    },
  });
  const task = await prisma.task.create({
    data: {
      epicId: epic.id,
      stableId: `TASK-RA-${Math.random().toString(36).slice(2)}`,
      title: "Review generated specs",
      type: "backend",
      complexity: "medium",
      status: "awaiting_verification_approval",
      orderIndex: 0,
      acceptanceJson: "[]",
    },
  });

  return { project, task };
}

function writeStagingSpec(rootPath: string, taskId: string, validationId: string, code: string) {
  const relativePath = `apps/api/.artifacts/staging/playwright/${taskId}/${validationId}.spec.ts`;
  const absolutePath = join(rootPath, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, code, "utf8");
  return { absolutePath, relativePath };
}
