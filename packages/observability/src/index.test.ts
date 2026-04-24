import {
  createLangSmithExporter,
  createLangSmithTraceLinkService,
  exportLangSmithTraceNonBlocking,
  normalizeCreateLangSmithTraceLinkInput,
  normalizeUpdateLangSmithTraceLinkInput,
  validateLangSmithTraceUrl,
  type LangSmithTraceLink,
  type LangSmithTraceLinkRepository,
} from "./index";

function createMemoryRepository(): LangSmithTraceLinkRepository {
  const links = new Map<string, LangSmithTraceLink>();
  let nextId = 1;

  return {
    async create(input) {
      const now = new Date("2026-04-24T00:00:00.000Z");
      const link = {
        id: `link-${nextId++}`,
        ...input,
        createdAt: now,
        updatedAt: now,
      };

      links.set(link.id, link);
      return link;
    },
    async list(filter) {
      return [...links.values()].filter((link) => {
        return (
          (!filter.projectId || link.projectId === filter.projectId) &&
          (!filter.subjectType || link.subjectType === filter.subjectType) &&
          (!filter.subjectId || link.subjectId === filter.subjectId) &&
          (!filter.syncStatus || link.syncStatus === filter.syncStatus)
        );
      });
    },
    async update(id, input) {
      const existing = links.get(id);

      if (!existing) {
        throw new Error(`Link ${id} was not found.`);
      }

      const updated = {
        ...existing,
        ...input,
        updatedAt: new Date("2026-04-24T00:01:00.000Z"),
      };

      links.set(id, updated);
      return updated;
    },
  };
}

describe("LangSmith trace link validation", () => {
  test("normalizes a create input with a trace URL", () => {
    expect(
      normalizeCreateLangSmithTraceLinkInput({
        projectId: " project-1 ",
        subjectType: " planner_run ",
        subjectId: " run-1 ",
        traceUrl: "https://smith.langchain.com/o/acme/projects/p/r/trace",
      }),
    ).toMatchObject({
      projectId: "project-1",
      subjectType: "planner_run",
      subjectId: "run-1",
      traceUrl: "https://smith.langchain.com/o/acme/projects/p/r/trace",
      syncStatus: "linked",
    });
  });

  test("allows pending export records without a LangSmith reference", () => {
    expect(
      normalizeCreateLangSmithTraceLinkInput({
        projectId: "project-1",
        subjectType: "planner_run",
        subjectId: "run-1",
        syncStatus: "pending",
      }),
    ).toMatchObject({
      projectId: "project-1",
      subjectType: "planner_run",
      subjectId: "run-1",
      syncStatus: "pending",
      traceUrl: null,
      runId: null,
    });
  });

  test("requires at least one LangSmith reference", () => {
    expect(() =>
      normalizeCreateLangSmithTraceLinkInput({
        projectId: "project-1",
        subjectType: "planner_run",
        subjectId: "run-1",
      }),
    ).toThrow("At least one LangSmith reference is required.");
  });

  test("supports configured self-hosted trace URL hosts", () => {
    expect(
      validateLangSmithTraceUrl("https://langsmith.internal.example/runs/1", {
        allowedTraceHostnames: ["langsmith.internal.example"],
      }),
    ).toBe("https://langsmith.internal.example/runs/1");
  });

  test("rejects unexpected trace URL hosts by default", () => {
    expect(() => validateLangSmithTraceUrl("https://example.com/runs/1")).toThrow(
      "is not an allowed LangSmith host",
    );
  });

  test("allows partial updates to clear a reference field", () => {
    expect(normalizeUpdateLangSmithTraceLinkInput({ traceUrl: null })).toEqual({
      traceUrl: null,
    });
  });
});

describe("LangSmith trace link service", () => {
  test("creates, lists, updates, and emits a linked event", async () => {
    const repository = createMemoryRepository();
    const events: Array<Record<string, unknown>> = [];
    const service = createLangSmithTraceLinkService({
      repository,
      eventSink: {
        async append(input) {
          events.push(input);
        },
      },
    });

    const created = await service.create({
      projectId: "project-1",
      subjectType: "planner_run",
      subjectId: "planner-1",
      runId: "run-1",
    });
    const updated = await service.update(created.id, {
      syncStatus: "exported",
      traceUrl: "https://smith.langchain.com/o/acme/projects/p/r/trace",
    });
    const listed = await service.list({
      subjectType: "planner_run",
      subjectId: "planner-1",
    });

    expect(updated.syncStatus).toBe("exported");
    expect(listed).toHaveLength(1);
    expect(events).toMatchObject([
      {
        projectId: "project-1",
        type: "langsmith.trace.linked",
      },
    ]);
  });

  test("persists optional export results without blocking the caller", async () => {
    const repository = createMemoryRepository();
    const events: Array<Record<string, unknown>> = [];
    const service = createLangSmithTraceLinkService({
      repository,
      eventSink: {
        async append(input) {
          events.push(input);
        },
      },
      exporter: createLangSmithExporter(
        {
          apiKey: "key",
        },
        {
          async createRun() {
            return {
              traceUrl: "https://smith.langchain.com/runs/1",
              runId: "run-1",
            };
          },
        },
      ),
    });

    const started = await service.exportTrace({
      projectId: "project-1",
      runName: "planner",
      subjectType: "planner_run",
      subjectId: "planner-1",
    });

    expect(started.link?.syncStatus).toBe("pending");
    expect(started.export).toEqual({
      accepted: true,
      skipped: false,
    });

    await flushPromises();

    const [persisted] = await service.list({
      projectId: "project-1",
      subjectType: "planner_run",
      subjectId: "planner-1",
    });

    expect(persisted).toMatchObject({
      syncStatus: "exported",
      traceUrl: "https://smith.langchain.com/runs/1",
      runId: "run-1",
    });
    expect(events).toMatchObject([
      {
        projectId: "project-1",
        type: "langsmith.trace.linked",
      },
    ]);
  });

  test("marks optional export failures without rejecting the local flow", async () => {
    const repository = createMemoryRepository();
    const errors: unknown[] = [];
    const service = createLangSmithTraceLinkService({
      repository,
      onExportError(error) {
        errors.push(error);
      },
      exporter: createLangSmithExporter(
        {
          apiKey: "key",
        },
        {
          async createRun() {
            throw new Error("LangSmith unavailable");
          },
        },
      ),
    });

    const started = await service.exportTrace({
      projectId: "project-1",
      runName: "planner",
      subjectType: "planner_run",
      subjectId: "planner-1",
    });

    expect(started.export.accepted).toBe(true);

    await flushPromises();

    const [persisted] = await service.list({
      projectId: "project-1",
      subjectType: "planner_run",
      subjectId: "planner-1",
    });

    expect(persisted?.syncStatus).toBe("failed");
    expect(errors).toHaveLength(1);
  });
});

describe("LangSmith exporter", () => {
  test("is a no-op when config is absent", async () => {
    const exporter = createLangSmithExporter({});

    await expect(
      exporter.exportTrace({
        runName: "planner",
        subjectType: "planner_run",
        subjectId: "planner-1",
      }),
    ).resolves.toEqual({
      ok: true,
      skipped: true,
      reason: "disabled",
    });
  });

  test("accepts enabled exports without blocking the caller", () => {
    const exporter = createLangSmithExporter(
      {
        apiKey: "key",
      },
      {
        async createRun() {
          return {
            traceUrl: "https://smith.langchain.com/runs/1",
            runId: "run-1",
          };
        },
      },
    );

    expect(
      exportLangSmithTraceNonBlocking(exporter, {
        runName: "planner",
        subjectType: "planner_run",
        subjectId: "planner-1",
      }),
    ).toEqual({
      accepted: true,
      skipped: false,
    });
  });
});

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
