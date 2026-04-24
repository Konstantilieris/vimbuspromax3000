import type { PrismaClient } from "../client";
import { createIsolatedPrisma, removeTempDir } from "../testing";
import {
  createLangSmithTraceLink,
  createProject,
  listLangSmithTraceLinks,
  listLoopEvents,
  updateLangSmithTraceLink,
  updateLangSmithTraceLinkStatus,
} from "./index";

describe("langSmithRepository", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-langsmith-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  });

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test("persists manual links and emits a linked event", async () => {
    const project = await createProject(prisma, {
      name: "LangSmith Project",
      rootPath: tempDir,
    });

    const link = await createLangSmithTraceLink(prisma, {
      projectId: project.id,
      subjectType: "planner_run",
      subjectId: "planner-1",
      traceUrl: "https://smith.langchain.com/runs/1",
    });
    const links = await listLangSmithTraceLinks(prisma, {
      projectId: project.id,
      subjectType: "planner_run",
      subjectId: "planner-1",
    });
    const events = await listLoopEvents(prisma, {
      projectId: project.id,
    });

    expect(link.syncStatus).toBe("linked");
    expect(links).toHaveLength(1);
    expect(events).toMatchObject([
      {
        type: "langsmith.trace.linked",
        payload: {
          langSmithTraceLinkId: link.id,
          subjectType: "planner_run",
          subjectId: "planner-1",
          traceUrl: "https://smith.langchain.com/runs/1",
          syncStatus: "linked",
        },
      },
    ]);
  });

  test("updates references and supports status-only updates", async () => {
    const project = await createProject(prisma, {
      name: "LangSmith Export Project",
      rootPath: tempDir,
    });

    const pending = await createLangSmithTraceLink(prisma, {
      projectId: project.id,
      subjectType: "task_execution",
      subjectId: "execution-1",
      syncStatus: "pending",
    });
    const exported = await updateLangSmithTraceLink(prisma, pending.id, {
      traceUrl: "https://smith.langchain.com/runs/2",
      runId: "run-2",
      syncStatus: "exported",
    });
    const failed = await updateLangSmithTraceLinkStatus(prisma, exported.id, "failed");
    const failedLinks = await listLangSmithTraceLinks(prisma, {
      projectId: project.id,
      syncStatus: "failed",
    });
    const events = await listLoopEvents(prisma, {
      projectId: project.id,
    });

    expect(exported).toMatchObject({
      traceUrl: "https://smith.langchain.com/runs/2",
      runId: "run-2",
      syncStatus: "exported",
    });
    expect(failed.syncStatus).toBe("failed");
    expect(failedLinks.map((link) => link.id)).toEqual([pending.id]);
    expect(events.map((event) => event.type)).toEqual(["langsmith.trace.linked"]);
  });
});
