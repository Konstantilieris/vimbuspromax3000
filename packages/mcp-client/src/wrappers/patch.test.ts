import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  approveVerificationPlan,
  createApprovalDecision,
  createPlannerRun,
  createProject,
  listTasks,
  persistPlannerProposal,
} from "@vimbuspromax3000/db";
import type { PrismaClient } from "@vimbuspromax3000/db/client";
import {
  createIsolatedPrisma,
  initializeGitRepository,
  removeTempDir,
  runCommand,
} from "@vimbuspromax3000/db/testing";
import {
  ApplyPatchError,
  APPLY_PATCH_TOOL_NAME,
  createPatchWrapper,
  parsePatchSummary,
  TASKGOBLIN_PATCH_SERVER_NAME,
} from "./patch";

const SEED_TIMEOUT_MS = 60_000;
const HOOK_TIMEOUT_MS = 60_000;

describe("taskgoblin-patch apply_patch wrapper", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-patch-wrapper-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  }, HOOK_TIMEOUT_MS);

  test("exposes the registered server and tool names", { timeout: SEED_TIMEOUT_MS }, () => {
    const wrapper = createPatchWrapper({ prisma });
    expect(wrapper.serverName).toBe(TASKGOBLIN_PATCH_SERVER_NAME);
    expect(wrapper.toolName).toBe(APPLY_PATCH_TOOL_NAME);
  });

  test("applies a multi-hunk diff and reports hunk count and files", { timeout: SEED_TIMEOUT_MS }, async () => {
    const { execution } = await seedExecutionOnTaskBranch();
    const wrapper = createPatchWrapper({ prisma });
    const patch = multiHunkPatch();

    const result = await wrapper.applyPatch({
      patch,
      taskExecutionId: execution.id,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`expected success, got ${result.code}: ${result.message}`);
    }

    expect(result.summary.hunkCount).toBe(3);
    expect(result.summary.files).toEqual(["src/alpha.txt", "src/beta.txt"]);

    expect(readFileSync(`${tempDir}/src/alpha.txt`, "utf8").replace(/\r\n/g, "\n")).toBe(
      "alpha-1\nalpha-CHANGED\nalpha-3\nalpha-4\nalpha-5\nalpha-SIX\nalpha-7\n",
    );
    expect(readFileSync(`${tempDir}/src/beta.txt`, "utf8").replace(/\r\n/g, "\n")).toBe(
      "beta-1\nbeta-2\nbeta-3-NEW\n",
    );
  });

  test("rejects when the worktree is on the configured base branch", { timeout: SEED_TIMEOUT_MS }, async () => {
    const { execution } = await seedExecutionOnTaskBranch();
    runCommand("git", ["switch", "main"], tempDir);

    const wrapper = createPatchWrapper({ prisma });
    const result = await wrapper.applyPatch({
      patch: simplePatch("alpha-2", "alpha-CHANGED"),
      taskExecutionId: execution.id,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe("BASE_BRANCH_MUTATION_BLOCKED");
    expect(result.message).toContain("base branch");
  });

  test("rejects when the patch does not apply to the worktree", { timeout: SEED_TIMEOUT_MS }, async () => {
    const { execution } = await seedExecutionOnTaskBranch();
    const wrapper = createPatchWrapper({ prisma });
    const corruptedPatch = [
      "diff --git a/src/alpha.txt b/src/alpha.txt",
      "--- a/src/alpha.txt",
      "+++ b/src/alpha.txt",
      "@@ -1 +1 @@",
      "-not-the-actual-content",
      "+something-else",
      "",
    ].join("\n");

    const result = await wrapper.applyPatch({
      patch: corruptedPatch,
      taskExecutionId: execution.id,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe("PATCH_APPLY_FAILED");
  });

  test("rejects when taskExecutionId does not resolve to an execution", { timeout: SEED_TIMEOUT_MS }, async () => {
    const wrapper = createPatchWrapper({ prisma });
    const result = await wrapper.applyPatch({
      patch: simplePatch("a", "b"),
      taskExecutionId: "execution-does-not-exist",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe("EXECUTION_NOT_FOUND");
  });

  test("rejects when taskExecutionId is missing", { timeout: SEED_TIMEOUT_MS }, async () => {
    const wrapper = createPatchWrapper({ prisma });
    const result = await wrapper.applyPatch({
      patch: simplePatch("a", "b"),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe("EXECUTION_REQUIRED");
  });

  test("rejects empty patches before touching git", { timeout: SEED_TIMEOUT_MS }, async () => {
    const { execution } = await seedExecutionOnTaskBranch();
    const wrapper = createPatchWrapper({ prisma });
    const result = await wrapper.applyPatch({
      patch: "   \n\n",
      taskExecutionId: execution.id,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe("EMPTY_PATCH");
  });

  async function seedExecutionOnTaskBranch() {
    initializeGitRepository(tempDir, {
      initialFiles: {
        "src/alpha.txt":
          "alpha-1\nalpha-2\nalpha-3\nalpha-4\nalpha-5\nalpha-6\nalpha-7\n",
        "src/beta.txt": "beta-1\nbeta-2\nbeta-3\n",
        "README.md": "patch wrapper fixture\n",
      },
    });
    runCommand("git", ["switch", "-c", "tg/patch-wrapper-test"], tempDir);

    const project = await createProject(prisma, {
      name: "Patch Wrapper Project",
      rootPath: tempDir,
      baseBranch: "main",
    });
    const plannerRun = await createPlannerRun(prisma, {
      projectId: project.id,
      goal: "Test taskgoblin-patch wrapper",
    });
    await persistPlannerProposal(prisma, {
      plannerRunId: plannerRun.id,
      summary: "Patch wrapper proposal",
      epics: [
        {
          key: "PATCH-WRAPPER-EPIC",
          title: "Patch wrapper",
          goal: "Apply patches via wrapper",
          tasks: [
            {
              stableId: `PATCH-WRAPPER-${randomUUID()}`,
              title: "Exercise patch wrapper",
              type: "backend",
              complexity: "medium",
              acceptance: [{ label: "patch applied" }],
              verificationPlan: {
                items: [
                  {
                    kind: "logic",
                    runner: "custom",
                    title: "wrapper test",
                    description: "runs wrapper paths",
                    command: "echo ok",
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    await createApprovalDecision(prisma, {
      projectId: project.id,
      subjectType: "planner_run",
      subjectId: plannerRun.id,
      stage: "planner_review",
      status: "granted",
    });
    const [task] = await listTasks(prisma, { projectId: project.id });
    if (!task) throw new Error("Expected task.");
    await approveVerificationPlan(prisma, { taskId: task.id });
    await prisma.task.update({
      where: { id: task.id },
      data: { status: "executing" },
    });

    const head = runCommand("git", ["rev-parse", "HEAD"], tempDir).stdout.trim();
    const branch = await prisma.taskBranch.create({
      data: {
        taskId: task.id,
        name: "tg/patch-wrapper-test",
        base: "main",
        state: "active",
        currentHead: head,
      },
    });
    const execution = await prisma.taskExecution.create({
      data: {
        taskId: task.id,
        branchId: branch.id,
        status: "implementing",
        startedAt: new Date(),
      },
    });

    return { project, task, branch, execution };
  }
});

describe("parsePatchSummary", () => {
  test("counts hunks and collects unique post-image files", () => {
    const summary = parsePatchSummary(multiHunkPatch());
    expect(summary.hunkCount).toBe(3);
    expect(summary.files).toEqual(["src/alpha.txt", "src/beta.txt"]);
  });

  test("throws ApplyPatchError when the patch has no diff headers", () => {
    expect(() => parsePatchSummary("not a patch")).toThrowError(ApplyPatchError);
  });
});

function simplePatch(from: string, to: string) {
  return [
    "diff --git a/src/alpha.txt b/src/alpha.txt",
    "--- a/src/alpha.txt",
    "+++ b/src/alpha.txt",
    "@@ -1,3 +1,3 @@",
    " alpha-1",
    `-${from}`,
    `+${to}`,
    " alpha-3",
    "",
  ].join("\n");
}

function multiHunkPatch() {
  return [
    "diff --git a/src/alpha.txt b/src/alpha.txt",
    "--- a/src/alpha.txt",
    "+++ b/src/alpha.txt",
    "@@ -1,3 +1,3 @@",
    " alpha-1",
    "-alpha-2",
    "+alpha-CHANGED",
    " alpha-3",
    "@@ -5,3 +5,3 @@",
    " alpha-5",
    "-alpha-6",
    "+alpha-SIX",
    " alpha-7",
    "diff --git a/src/beta.txt b/src/beta.txt",
    "--- a/src/beta.txt",
    "+++ b/src/beta.txt",
    "@@ -1,3 +1,3 @@",
    " beta-1",
    " beta-2",
    "-beta-3",
    "+beta-3-NEW",
    "",
  ].join("\n");
}
