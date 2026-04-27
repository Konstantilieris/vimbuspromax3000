import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "./app";
import { createIsolatedPrisma, removeTempDir } from "@vimbuspromax3000/db/testing";
import { appendLoopEvent } from "@vimbuspromax3000/db";
import type { PrismaClient } from "@vimbuspromax3000/db/client";

describe("GET /events?stream=sse", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-sse-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  });

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test("opens an event-stream and pushes a newly inserted loopEvent within ~200ms", async () => {
    const api = createApp({ prisma });

    const project = await prisma.project.create({
      data: {
        name: "SSE Project",
        rootPath: tempDir,
        baseBranch: "main",
      },
    });

    // Pre-existing event so we can assert the SSE includes the backlog as well.
    await appendLoopEvent(prisma, {
      projectId: project.id,
      type: "planner.started",
      payload: { reason: "fixture-backlog" },
    });

    const controller = new AbortController();
    const response = await api.fetch(
      new Request(`http://localhost/events?projectId=${project.id}&stream=sse`, {
        signal: controller.signal,
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type") ?? "").toContain("text/event-stream");

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) return;

    const decoder = new TextDecoder();
    const collected: string[] = [];
    const deadline = Date.now() + 5000;

    // Insert a new event ~150ms after subscription so we exercise the live push path.
    setTimeout(() => {
      void appendLoopEvent(prisma, {
        projectId: project.id,
        type: "planner.proposed",
        payload: { fixture: "live-push" },
      });
    }, 150);

    let liveSeen = false;
    while (Date.now() < deadline) {
      const result = await Promise.race([
        reader.read(),
        new Promise<{ done: boolean; value?: undefined }>((resolve) =>
          setTimeout(() => resolve({ done: false }), 500),
        ),
      ]);

      if ("value" in result && result.value) {
        collected.push(decoder.decode(result.value));
      }
      const buffer = collected.join("");
      if (buffer.includes("planner.proposed")) {
        liveSeen = true;
        break;
      }
    }

    controller.abort();
    try {
      await reader.cancel();
    } catch {
      // ignore cancel errors after abort
    }

    expect(liveSeen).toBe(true);
    const buffer = collected.join("");
    expect(buffer).toMatch(/event: planner\.proposed/);
    expect(buffer).toContain("\"fixture\":\"live-push\"");
  }, 10000);

  test("emits a heartbeat comment frame so idle clients stay open", async () => {
    const api = createApp({
      prisma,
      // 50ms heartbeat for fast assertion in tests; production default is 15s.
      eventsSseConfig: { heartbeatMs: 50, pollIntervalMs: 100 },
    });
    const project = await prisma.project.create({
      data: {
        name: "Heartbeat Project",
        rootPath: tempDir,
        baseBranch: "main",
      },
    });

    const controller = new AbortController();
    const response = await api.fetch(
      new Request(`http://localhost/events?projectId=${project.id}&stream=sse`, {
        signal: controller.signal,
      }),
    );

    expect(response.status).toBe(200);

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = "";
    const deadline = Date.now() + 2000;

    while (Date.now() < deadline) {
      const result = await Promise.race([
        reader.read(),
        new Promise<{ done: boolean; value?: undefined }>((resolve) =>
          setTimeout(() => resolve({ done: false }), 200),
        ),
      ]);

      if ("value" in result && result.value) {
        buffer += decoder.decode(result.value);
      }
      if (buffer.includes(": heartbeat")) {
        break;
      }
    }

    controller.abort();
    try {
      await reader.cancel();
    } catch {
      // ignore cancel errors after abort
    }

    expect(buffer).toContain(": heartbeat");
  }, 5000);
});

describe("GET /events/history", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-history-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  });

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test("returns the JSON list (replacement for the deprecated /events JSON path)", async () => {
    const api = createApp({ prisma });
    const project = await prisma.project.create({
      data: {
        name: "History Project",
        rootPath: tempDir,
        baseBranch: "main",
      },
    });

    await appendLoopEvent(prisma, {
      projectId: project.id,
      type: "planner.started",
      payload: { reason: "history" },
    });

    const response = await api.fetch(
      new Request(`http://localhost/events/history?projectId=${project.id}`),
    );
    expect(response.status).toBe(200);
    const events = await response.json();
    expect(events.map((event: { type: string }) => event.type)).toContain("planner.started");
  });
});
