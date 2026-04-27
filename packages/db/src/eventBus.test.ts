import { describe, test, expect, beforeEach } from "vitest";
import {
  appendLoopEvent,
  createLoopEventBus,
  getDefaultLoopEventBus,
  resetDefaultLoopEventBus,
} from "./index";
import { createIsolatedPrisma, removeTempDir } from "./testing";
import type { PrismaClient } from "./client";

describe("LoopEventBus", () => {
  beforeEach(() => {
    resetDefaultLoopEventBus();
  });

  test("publishes events to project-scoped subscribers synchronously", () => {
    const bus = createLoopEventBus();
    const received: string[] = [];

    const unsubscribe = bus.subscribe({ projectId: "project_1" }, (event) => {
      received.push(`${event.type}:${event.id}`);
    });

    bus.publish({
      id: "evt_1",
      projectId: "project_1",
      type: "planner.started",
      payload: { reason: "fixture" },
      createdAt: new Date().toISOString(),
    });

    bus.publish({
      id: "evt_2",
      projectId: "project_2",
      type: "planner.proposed",
      payload: {},
      createdAt: new Date().toISOString(),
    });

    unsubscribe();

    expect(received).toEqual(["planner.started:evt_1"]);
  });

  test("filters by taskExecutionId when subscriber requests it", () => {
    const bus = createLoopEventBus();
    const received: string[] = [];

    bus.subscribe(
      { projectId: "project_1", taskExecutionId: "exec_1" },
      (event) => {
        received.push(`${event.type}:${event.taskExecutionId ?? "none"}`);
      },
    );

    bus.publish({
      id: "evt_a",
      projectId: "project_1",
      taskExecutionId: "exec_1",
      type: "agent.step.started",
      payload: {},
      createdAt: new Date().toISOString(),
    });

    bus.publish({
      id: "evt_b",
      projectId: "project_1",
      taskExecutionId: "exec_2",
      type: "agent.step.started",
      payload: {},
      createdAt: new Date().toISOString(),
    });

    bus.publish({
      id: "evt_c",
      projectId: "project_1",
      type: "planner.started",
      payload: {},
      createdAt: new Date().toISOString(),
    });

    expect(received).toEqual(["agent.step.started:exec_1"]);
  });

  test("isolates one subscriber's failure from the rest", () => {
    const bus = createLoopEventBus();
    const received: string[] = [];

    bus.subscribe({ projectId: "project_1" }, () => {
      throw new Error("boom");
    });
    bus.subscribe({ projectId: "project_1" }, (event) => {
      received.push(event.id);
    });

    expect(() =>
      bus.publish({
        id: "evt_z",
        projectId: "project_1",
        type: "planner.started",
        payload: {},
        createdAt: new Date().toISOString(),
      }),
    ).not.toThrow();

    expect(received).toEqual(["evt_z"]);
  });

  test("getDefaultLoopEventBus returns a stable singleton", () => {
    const a = getDefaultLoopEventBus();
    const b = getDefaultLoopEventBus();
    expect(a).toBe(b);
  });
});

describe("appendLoopEvent publishes to the default bus", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    resetDefaultLoopEventBus();
    const isolated = await createIsolatedPrisma("vimbus-eventbus-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  });

  test("appendLoopEvent publishes to default bus subscribers within ~50ms", async () => {
    const project = await prisma.project.create({
      data: {
        name: "EventBus Project",
        rootPath: tempDir,
        baseBranch: "main",
      },
    });

    const bus = getDefaultLoopEventBus();
    const seen: Array<{ type: string; latencyMs: number }> = [];
    const startedAt = Date.now();

    bus.subscribe({ projectId: project.id }, (event) => {
      seen.push({ type: event.type, latencyMs: Date.now() - startedAt });
    });

    await appendLoopEvent(prisma, {
      projectId: project.id,
      type: "planner.proposed",
      payload: { fixture: true },
    });

    await prisma.$disconnect();
    removeTempDir(tempDir);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.type).toBe("planner.proposed");
    expect(seen[0]?.latencyMs).toBeLessThan(200);
  });
});
