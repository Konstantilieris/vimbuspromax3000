import type { PrismaClient } from "../client";
import { createIsolatedPrisma, removeTempDir } from "../testing";
import {
  approveValidation,
  createProject,
  createTestRun,
  createValidation,
  createValidationReviewArtifact,
  getValidation,
  isValidationStatus,
  isValidationTestType,
  listLoopEvents,
  listValidationsByTask,
  rejectValidation,
  refreshTaskReadiness,
  setValidationExecutionResult,
} from "./index";

describe("validation repository", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-validation-repo-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  });

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test("creates, lists, and reads task validations", async () => {
    const { task, verificationItem } = await seedTask(prisma, tempDir);

    const later = await createValidation(prisma, {
      taskId: task.id,
      verificationItemId: verificationItem.id,
      testType: "playwright",
      title: "Dashboard loads",
      description: "Generated browser check for the task dashboard.",
      acceptanceCriteria: [{ label: "dashboard visible" }],
      rationale: "Covers the primary browser path.",
      command: "bunx playwright test tests/generated/TASK-VAL/dashboard.spec.ts",
      testFilePath: "tests/generated/TASK-VAL/dashboard.spec.ts",
      metadataJson: JSON.stringify({ acceptance: "dashboard visible" }),
      orderIndex: 1,
    });
    const earlier = await createValidation(prisma, {
      taskId: task.id,
      testType: "manual",
      title: "Operator acceptance",
      description: "Human confirms the final behavior.",
      orderIndex: 0,
    });

    const listed = await listValidationsByTask(prisma, task.id);
    const filtered = await listValidationsByTask(prisma, task.id, {
      testType: "playwright",
      status: "proposed",
    });
    const stored = await getValidation(prisma, later.id);

    expect(isValidationTestType("playwright")).toBe(true);
    expect(isValidationStatus(stored?.status ?? "")).toBe(true);
    expect(listed.map((validation) => validation.id)).toEqual([earlier.id, later.id]);
    expect(filtered).toHaveLength(1);
    expect(stored).toMatchObject({
      id: later.id,
      taskId: task.id,
      verificationItemId: verificationItem.id,
      legacyVerificationItemId: verificationItem.id,
      testType: "playwright",
      status: "proposed",
      acceptanceCriteriaJson: JSON.stringify([{ label: "dashboard visible" }]),
      rationale: "Covers the primary browser path.",
      testFilePath: "tests/generated/TASK-VAL/dashboard.spec.ts",
    });
  });

  test("approves, rejects, and records latest execution result", async () => {
    const { project, task, execution } = await seedTask(prisma, tempDir);
    const validation = await createValidation(prisma, {
      taskId: task.id,
      testType: "logic",
      title: "Repository contract",
      command: "bun run test:vitest packages/db/src/repositories/validationRepository.test.ts",
    });
    const rejectedValidation = await createValidation(prisma, {
      taskId: task.id,
      testType: "manual",
      title: "Rejected acceptance wording",
    });
    const testRun = await createTestRun(prisma, {
      taskExecutionId: execution.id,
      command: "bun run test:vitest",
      status: "running",
    });

    const approval = await approveValidation(prisma, {
      validationId: validation.id,
      operator: "ak",
      reason: "Covers the expected contract.",
    });
    const rejection = await rejectValidation(prisma, {
      validationId: rejectedValidation.id,
      operator: "ak",
      reason: "Needs a concrete check.",
    });
    const running = await setValidationExecutionResult(prisma, {
      validationId: validation.id,
      status: "running",
      taskExecutionId: execution.id,
      testRunId: testRun.id,
    });
    const passed = await setValidationExecutionResult(prisma, {
      validationId: validation.id,
      status: "passed",
      taskExecutionId: execution.id,
      testRunId: testRun.id,
      exitCode: 0,
      resultSummary: "Validation passed.",
      resultJson: JSON.stringify({ assertions: 3 }),
      artifactPath: ".artifacts/validation/contract.json",
    });
    const events = await listLoopEvents(prisma, { projectId: project.id });

    expect(approval.validation).toMatchObject({
      id: validation.id,
      status: "approved",
      approvalId: approval.approval.id,
    });
    expect(approval.approval).toMatchObject({
      subjectType: "validation",
      subjectId: validation.id,
      status: "granted",
    });
    expect(rejection.validation).toMatchObject({
      id: rejectedValidation.id,
      status: "rejected",
      approvalId: rejection.approval.id,
    });
    expect(running).toMatchObject({
      status: "running",
      lastTaskExecutionId: execution.id,
      lastTestRunId: testRun.id,
      finishedAt: null,
    });
    expect(passed).toMatchObject({
      status: "passed",
      lastExitCode: 0,
      resultSummary: "Validation passed.",
      artifactPath: ".artifacts/validation/contract.json",
    });
    expect(passed.finishedAt).toBeInstanceOf(Date);
    expect(events.map((event) => event.type)).toEqual(["approval.granted", "approval.rejected"]);
  });

  test("creates validation review artifacts with operator review markdown", async () => {
    const { task } = await seedTask(prisma, tempDir);
    const validation = await createValidation(prisma, {
      taskId: task.id,
      testType: "manual",
      title: "Manual acceptance wording",
      description: "Operator confirms the final behavior matches the task.",
      acceptanceCriteria: [
        { label: "validation rows persisted" },
        "review path is visible",
      ],
    });

    const artifact = await createValidationReviewArtifact(prisma, validation.id);

    expect(artifact).toMatchObject({
      subjectType: "validation",
      subjectId: validation.id,
      stage: "validation_review",
      status: "pending",
      title: "Validation review: Manual acceptance wording",
    });
    expect(artifact.markdown).toContain("Operator confirms the final behavior matches the task.");
    expect(artifact.markdown).toContain("- [ ] validation rows persisted");
    expect(artifact.markdown).toContain("- [ ] review path is visible");
    expect(artifact.markdown).toContain("manual");
    expect(artifact.markdown).toContain(`/review/${artifact.id}`);
    expect(artifact.markdown).toContain(`/review-artifacts/${artifact.id}/approve`);
    expect(artifact.markdown).toContain(`/review-artifacts/${artifact.id}/reject`);
  });

  test("derives task readiness from validations with legacy fallback and downgrade", async () => {
    const { task } = await seedTask(prisma, tempDir);

    await refreshTaskReadiness(prisma, task.id);
    await expect(prisma.task.findUnique({ where: { id: task.id } })).resolves.toMatchObject({
      status: "ready",
    });

    const approvedValidation = await createValidation(prisma, {
      taskId: task.id,
      testType: "logic",
      title: "Approved contract",
      status: "approved",
    });
    const proposedValidation = await createValidation(prisma, {
      taskId: task.id,
      testType: "manual",
      title: "Pending operator contract",
    });

    await refreshTaskReadiness(prisma, task.id);
    await expect(prisma.task.findUnique({ where: { id: task.id } })).resolves.toMatchObject({
      status: "awaiting_verification_approval",
    });

    await prisma.validation.update({
      where: { id: proposedValidation.id },
      data: { status: "approved" },
    });
    await refreshTaskReadiness(prisma, task.id);
    await expect(prisma.task.findUnique({ where: { id: task.id } })).resolves.toMatchObject({
      status: "ready",
    });

    await prisma.validation.update({
      where: { id: approvedValidation.id },
      data: { status: "rejected" },
    });
    await refreshTaskReadiness(prisma, task.id);
    await expect(prisma.task.findUnique({ where: { id: task.id } })).resolves.toMatchObject({
      status: "awaiting_verification_approval",
    });
  });
});

async function seedTask(prisma: PrismaClient, rootPath: string) {
  const project = await createProject(prisma, {
    name: "Validation Repository Project",
    rootPath,
  });
  const epic = await prisma.epic.create({
    data: {
      projectId: project.id,
      key: `EPIC-VAL-${Math.random().toString(36).slice(2)}`,
      title: "Validation foundation",
      goal: "Persist first-class task validations.",
      status: "planned",
      orderIndex: 0,
    },
  });
  const task = await prisma.task.create({
    data: {
      epicId: epic.id,
      stableId: `TASK-VAL-${Math.random().toString(36).slice(2)}`,
      title: "Persist validations",
      type: "backend",
      complexity: "medium",
      status: "awaiting_verification_approval",
      orderIndex: 0,
      acceptanceJson: JSON.stringify([{ label: "validation rows persisted" }]),
    },
  });
  const plan = await prisma.verificationPlan.create({
    data: {
      taskId: task.id,
      status: "approved",
      approvedAt: new Date(),
    },
  });
  const verificationItem = await prisma.verificationItem.create({
    data: {
      planId: plan.id,
      taskId: task.id,
      kind: "visual",
      runner: "playwright",
      title: "legacy visual item",
      description: "Existing verification contract row.",
      status: "approved",
      orderIndex: 0,
    },
  });
  const branch = await prisma.taskBranch.create({
    data: {
      taskId: task.id,
      name: `tg/validation/${task.stableId.toLowerCase()}`,
      base: "main",
      state: "active",
    },
  });
  const execution = await prisma.taskExecution.create({
    data: {
      taskId: task.id,
      branchId: branch.id,
      status: "verifying",
      startedAt: new Date(),
    },
  });

  return {
    project,
    task,
    verificationItem,
    execution,
  };
}
