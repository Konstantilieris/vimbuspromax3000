import { afterEach, describe, expect, test, vi } from "vitest";
import {
  getDefaultLoopEventBus,
  POSTGRES_LOOP_CHANNEL,
  resetDefaultLoopEventBus,
  type PostgresNotifyClient,
} from "@vimbuspromax3000/db";
import type { LoopEvent } from "@vimbuspromax3000/shared";
import { buildApiLoopEventBus, installDefaultLoopEventBus } from "./loopEventBus";

class FakePgClient implements PostgresNotifyClient {
  static instances: FakePgClient[] = [];

  readonly config: { connectionString: string };
  readonly queries: Array<{ sql: string; values?: unknown[] }> = [];
  connected = false;
  ended = false;
  private readonly handlers = new Map<string, Set<(...args: unknown[]) => void>>();

  constructor(config: { connectionString: string }) {
    this.config = config;
    FakePgClient.instances.push(this);
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }> {
    const entry: { sql: string; values?: unknown[] } = { sql };
    if (values !== undefined) entry.values = values;
    this.queries.push(entry);
    return { rows: [] };
  }

  on(
    event: "notification",
    handler: (msg: { channel: string; payload: string; processId: number }) => void,
  ): unknown;
  on(event: "error", handler: (err: Error) => void): unknown;
  on(event: "end", handler: () => void): unknown;
  on(
    event: "notification" | "error" | "end",
    handler:
      | ((msg: { channel: string; payload: string; processId: number }) => void)
      | ((err: Error) => void)
      | (() => void),
  ): unknown {
    const existing = this.handlers.get(event) ?? new Set<(...args: unknown[]) => void>();
    existing.add(handler as (...args: unknown[]) => void);
    this.handlers.set(event, existing);
    return this;
  }

  removeAllListeners(event?: string): unknown {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
    return this;
  }

  async end(): Promise<void> {
    this.connected = false;
    this.ended = true;
  }
}

function makeLoopEvent(overrides: Partial<LoopEvent> = {}): LoopEvent {
  return {
    id: "event-1",
    projectId: "project-1",
    type: "planner.started",
    payload: {},
    createdAt: "2026-04-28T00:00:00.000Z",
    ...overrides,
  };
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(condition()).toBe(true);
}

describe("API loop event bus startup wiring", () => {
  afterEach(() => {
    resetDefaultLoopEventBus();
    FakePgClient.instances = [];
    vi.restoreAllMocks();
  });

  test("uses the in-process bus when VIMBUS_LOOP_BUS is unset without loading pg", async () => {
    const importPg = vi.fn(async () => {
      throw new Error("pg should not load");
    });
    const bus = await buildApiLoopEventBus({ env: {}, importPg });
    const received: LoopEvent[] = [];
    const event = makeLoopEvent();

    bus.subscribe({ projectId: event.projectId }, (loopEvent) => received.push(loopEvent));
    bus.publish(event);

    expect(received).toEqual([event]);
    expect(importPg).not.toHaveBeenCalled();
    expect("close" in bus).toBe(false);
  });

  test("uses the in-process bus for any non-postgres VIMBUS_LOOP_BUS value", async () => {
    const importPg = vi.fn(async () => {
      throw new Error("pg should not load");
    });
    const bus = await buildApiLoopEventBus({
      env: {
        VIMBUS_LOOP_BUS: "pg",
        DATABASE_URL: "postgres://user:pass@localhost:5432/vimbus",
      },
      importPg,
    });
    const received: LoopEvent[] = [];
    const event = makeLoopEvent({ id: "event-2" });

    bus.subscribe({ projectId: event.projectId }, (loopEvent) => received.push(loopEvent));
    bus.publish(event);

    expect(received).toEqual([event]);
    expect(importPg).not.toHaveBeenCalled();
    expect("close" in bus).toBe(false);
  });

  test("wires pg Client from DATABASE_URL when VIMBUS_LOOP_BUS is postgres", async () => {
    const databaseUrl = "postgres://user:pass@localhost:5432/vimbus";
    const importPg = vi.fn(async () => ({ Client: FakePgClient }));
    const bus = await buildApiLoopEventBus({
      env: { VIMBUS_LOOP_BUS: "postgres", DATABASE_URL: databaseUrl },
      importPg,
    });

    try {
      expect(importPg).toHaveBeenCalledTimes(1);
      expect(FakePgClient.instances).toHaveLength(1);
      expect(FakePgClient.instances[0]?.config).toEqual({ connectionString: databaseUrl });
      expect(FakePgClient.instances[0]?.connected).toBe(true);
      expect(FakePgClient.instances[0]?.queries).toEqual([{ sql: `LISTEN ${POSTGRES_LOOP_CHANNEL}` }]);

      const event = makeLoopEvent({ id: "event-3" });
      bus.publish(event);

      await waitForCondition(() => FakePgClient.instances.length === 2);
      await waitForCondition(() => (FakePgClient.instances[1]?.queries.length ?? 0) === 1);
      expect(FakePgClient.instances[1]?.config).toEqual({ connectionString: databaseUrl });
      expect(FakePgClient.instances[1]?.queries).toEqual([
        {
          sql: "SELECT pg_notify($1, $2)",
          values: [POSTGRES_LOOP_CHANNEL, JSON.stringify(event)],
        },
      ]);
      expect(FakePgClient.instances[1]?.ended).toBe(true);
    } finally {
      await (bus as { close?: () => Promise<void> }).close?.();
    }
  });

  test("rejects postgres mode without DATABASE_URL before loading pg", async () => {
    const importPg = vi.fn(async () => ({ Client: FakePgClient }));

    await expect(
      buildApiLoopEventBus({
        env: { VIMBUS_LOOP_BUS: "postgres" },
        importPg,
      }),
    ).rejects.toThrow("VIMBUS_LOOP_BUS=postgres requires DATABASE_URL");

    expect(importPg).not.toHaveBeenCalled();
  });

  test("installs the selected bus as the process default", async () => {
    const bus = await installDefaultLoopEventBus({ env: {} });

    expect(getDefaultLoopEventBus()).toBe(bus);
  });
});
