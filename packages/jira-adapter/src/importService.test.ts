import { readFileSync } from "node:fs";
import type { PrismaClient } from "@vimbuspromax3000/db/client";
import { createProject } from "@vimbuspromax3000/db/repositories";
import { createIsolatedPrisma, removeTempDir } from "@vimbuspromax3000/db/testing";
import { importJiraIssues } from "./importService";
import type { JiraIssue } from "./mapping";

describe("Jira import service", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-jira-import-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  });

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test("imports fixture issues into planner rows and a review artifact", async () => {
    const project = await createProject(prisma, {
      name: "Jira Import",
      rootPath: tempDir,
    });

    const result = await importJiraIssues(prisma, {
      projectId: project.id,
      issues: loadFixtureIssues(),
      acceptanceCriteriaField: "customfield_12345",
    });

    const plannerRun = await prisma.plannerRun.findUnique({
      where: { id: result.plannerRunId },
      include: {
        epics: {
          include: {
            tasks: {
              include: {
                validations: true,
              },
              orderBy: [{ orderIndex: "asc" }],
            },
          },
        },
      },
    });
    const reviewArtifacts = await prisma.reviewArtifact.findMany({
      where: {
        projectId: project.id,
        stage: "jira_import",
      },
    });

    expect(plannerRun).toMatchObject({
      status: "generated",
      moduleName: "jira",
      goal: "Import Jira issue trees into draft planning records.",
    });
    expect(plannerRun?.epics[0]).toMatchObject({
      key: "HC-100",
      jiraIssueKey: "HC-100",
      title: "E6 Jira adapter foundation",
    });
    expect(plannerRun?.epics[0]?.tasks.map((task) => task.jiraIssueKey)).toEqual(["HC-101", "HC-102"]);
    expect(plannerRun?.epics[0]?.tasks.flatMap((task) => task.validations).map((validation) => validation.title)).toEqual([
      "Unit test mapping output",
      "Manual review import shape",
    ]);
    expect(reviewArtifacts).toHaveLength(1);
    expect(reviewArtifacts[0]).toMatchObject({
      id: result.reviewArtifactId,
      subjectType: "planner_run",
      subjectId: result.plannerRunId,
      title: "Jira import summary: HC-100",
    });
  });

  test("re-importing the same Jira issue keys updates rows without duplicates", async () => {
    const project = await createProject(prisma, {
      name: "Jira Idempotency",
      rootPath: tempDir,
    });
    const issues = loadFixtureIssues();

    const first = await importJiraIssues(prisma, {
      projectId: project.id,
      issues,
      acceptanceCriteriaField: "customfield_12345",
    });
    await prisma.plannerRun.update({
      where: { id: first.plannerRunId },
      data: { status: "approved" },
    });
    await prisma.epic.update({
      where: { id: first.epicId },
      data: { status: "approved" },
    });
    await prisma.reviewArtifact.update({
      where: { id: first.reviewArtifactId },
      data: { status: "approved" },
    });
    const updatedIssues = issues.map((issue) =>
      issue.key === "HC-101"
        ? {
            ...issue,
            fields: {
              ...issue.fields,
              summary: "Map Jira Story issues after refinement",
            },
          }
        : issue,
    );
    const second = await importJiraIssues(prisma, {
      projectId: project.id,
      issues: updatedIssues,
      acceptanceCriteriaField: "customfield_12345",
    });

    expect(second).toMatchObject(first);
    await expect(prisma.plannerRun.count()).resolves.toBe(1);
    await expect(prisma.epic.count()).resolves.toBe(1);
    await expect(prisma.task.count()).resolves.toBe(2);
    await expect(prisma.validation.count()).resolves.toBe(2);
    await expect(prisma.reviewArtifact.count()).resolves.toBe(1);

    const updatedTask = await prisma.task.findUnique({
      where: { jiraIssueKey: "HC-101" },
    });
    const preservedPlannerRun = await prisma.plannerRun.findUnique({
      where: { id: first.plannerRunId },
    });
    const preservedEpic = await prisma.epic.findUnique({
      where: { id: first.epicId },
    });
    const preservedReviewArtifact = await prisma.reviewArtifact.findUnique({
      where: { id: first.reviewArtifactId },
    });
    const updatedProject = await prisma.project.findUnique({
      where: { id: project.id },
      select: { jiraMappingJson: true },
    });
    const mapping = JSON.parse(updatedProject?.jiraMappingJson ?? "{}");

    expect(updatedTask?.title).toBe("Map Jira Story issues after refinement");
    expect(preservedPlannerRun?.status).toBe("approved");
    expect(preservedEpic?.status).toBe("approved");
    expect(preservedReviewArtifact?.status).toBe("approved");
    expect(mapping.jira.imports["HC-100"]).toMatchObject({
      plannerRunId: first.plannerRunId,
      epicId: first.epicId,
      reviewArtifactId: first.reviewArtifactId,
    });
    expect(Object.keys(mapping.jira.imports["HC-100"].validationIdsByIssueKey)).toEqual(["HC-103", "HC-104"]);
  });
});

function loadFixtureIssues(): JiraIssue[] {
  const fixtureUrl = new URL("../fixtures/epic-with-children.json", import.meta.url);
  const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8")) as { issues: JiraIssue[] };

  return fixture.issues;
}
