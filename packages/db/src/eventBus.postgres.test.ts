/**
 * VIM-45 — Postgres LISTEN/NOTIFY adapter tests.
 *
 * Caveat (mirrored in adapter source): Postgres `pg_notify` has an 8KB
 * payload limit per notification. We serialize each `LoopEvent` as compact
 * JSON; if a payload would exceed the limit (rare — most relevant for
 * `operator.notification` long-body free text) the adapter logs and drops
 * the publish so it cannot kill the connection. The drop is *intentional*
 * because Postgres would otherwise raise `payload string too long`.
 *
 * Caveat: subscribers do NOT receive events that were published while their
 * `LISTEN` socket was down. Recovery for the missed window is the database
 * (`/events/history`), not this bus — same posture as the in-process bus.
 *
 * The unit suite uses an in-memory `pg.Client` fake that mirrors the real
 * client's `query` / `on("notification", ...)` / `end` surface. A live
 * Postgres smoke test is intentionally NOT wired into vitest because the
 * monorepo doesn't run a postgres testcontainer.
 *
 * Manual two-process smoke test (humans only):
 *   1. Set `DATABASE_URL=postgres://...` and `VIMBUS_LOOP_BUS=postgres` in
 *      two terminals.
 *   2. In terminal A: `bun run --filter @vimbuspromax3000/api dev` (acts as
 *      publisher via SSE-fed inserts).
 *   3. In terminal B: `psql $DATABASE_URL -c "LISTEN vimbus_loop_events"` and
 *      then run any planner action in a connected CLI; you should see a
 *      `NOTIFICATION` printed for each loop event.
 *   4. Drop terminal B's psql connection (Ctrl+C), reconnect with the same
 *      LISTEN, trigger another planner action. Terminal B should receive
 *      the new event but NOT the events fired while disconnected.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { LOOP_EVENT_TYPES, type LoopEvent, type LoopEventType } from "@vimbuspromax3000/shared";
import {
  createPostgresLoopEventBus,
  POSTGRES_LOOP_CHANNEL,
  type PostgresNotifyClient,
} from "./eventBus.postgres";

/**
 * In-memory fake of the slice of `pg.Client` the adapter uses. A single
 * fake instance models *one* TCP connection — the adapter creates one for
 * the listener and uses the same one for publishes (so notifications loop
 * back the same way real Postgres does for self-LISTEN).
 *
 * The "world" object models the Postgres NOTIFY broadcast: when any client
 * publishes, every other connected client subscribed to the channel
 * receives the notification.
 */
type World = {
  clients: Set<FakePgClient>;
};

function createWorld(): World {
  return { clients: new Set() };
}

class FakePgClient implements PostgresNotifyClient {
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  private listening = new Set<string>();
  public connected = false;
  public ended = false;
  public connectError: Error | undefined;
  public queryError: Error | undefined;

  constructor(private readonly world: World) {}

  async connect(): Promise<void> {
    if (this.connectError) {
      const err = this.connectError;
      this.connectError = undefined;
      throw err;
    }
    this.connected = true;
    this.world.clients.add(this);
  }

  async query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }> {
    if (this.queryError) {
      const err = this.queryError;
      this.queryError = undefined;
      throw err;
    }
    if (!this.connected) {
      throw new Error("query on disconnected client");
    }

    const trimmed = sql.trim().toUpperCase();
    if (trimmed.startsWith("LISTEN ")) {
      const channel = sql.trim().split(/\s+/)[1]!.replace(/[";]/g, "");
      this.listening.add(channel);
      return { rows: [] };
    }
    if (trimmed.startsWith("UNLISTEN ")) {
      const channel = sql.trim().split(/\s+/)[1]!.replace(/[";]/g, "");
      this.listening.delete(channel);
      return { rows: [] };
    }
    if (trimmed.startsWith("SELECT PG_NOTIFY")) {
      // values: [channel, payload]
      const channel = String(values?.[0] ?? "");
      const payload = String(values?.[1] ?? "");
      this.broadcast(channel, payload);
      return { rows: [] };
    }
    return { rows: [] };
  }

  on(event: string, handler: (...args: unknown[]) => void): this {
    let bucket = this.listeners.get(event);
    if (!bucket) {
      bucket = [];
      this.listeners.set(event, bucket);
    }
    bucket.push(handler);
    return this;
  }

  off(event: string, handler: (...args: unknown[]) => void): this {
    const bucket = this.listeners.get(event);
    if (!bucket) return this;
    const idx = bucket.indexOf(handler);
    if (idx >= 0) bucket.splice(idx, 1);
    return this;
  }

  removeAllListeners(event?: string): this {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    return this;
  }

  async end(): Promise<void> {
    this.ended = true;
    this.connected = false;
    this.world.clients.delete(this);
    this.listeners.clear();
  }

  /** Test helper — simulate the underlying TCP connection dropping. */
  simulateConnectionDrop(error = new Error("ECONNRESET")): void {
    this.connected = false;
    this.world.clients.delete(this);
    const errBucket = this.listeners.get("error");
    if (errBucket) for (const h of [...errBucket]) h(error);
    const endBucket = this.listeners.get("end");
    if (endBucket) for (const h of [...endBucket]) h();
  }

  private broadcast(channel: string, payload: string): void {
    for (const client of this.world.clients) {
      if (!client.listening.has(channel)) continue;
      const bucket = client.listeners.get("notification");
      if (!bucket) continue;
      const message = { channel, payload, processId: 1 };
      for (const handler of [...bucket]) handler(message);
    }
  }
}

function makeFactory(world: World, options: { onCreate?: (c: FakePgClient) => void } = {}) {
  return async (): Promise<PostgresNotifyClient> => {
    const client = new FakePgClient(world);
    options.onCreate?.(client);
    return client;
  };
}

function representativePayload(type: LoopEventType): unknown {
  switch (type) {
    case "operator.notification":
      return { severity: "warn", subjectType: "patch", subjectId: "patch_42" };
    case "test.stdout":
    case "test.stderr":
      return { taskExecutionId: "exec_x", chunk: "build output line" };
    case "approval.requested":
      return { approvalId: "appr_1", reason: "patch ready" };
    case "evaluation.result":
      return { dimension: "diff_quality", score: 0.91 };
    default:
      return { fixture: true, type };
  }
}

describe("createPostgresLoopEventBus — fan-out across processes", () => {
  let world: World;

  beforeEach(() => {
    world = createWorld();
  });

  test("two subscribers (separate process buses) both receive every published event in order", async () => {
    const busA = await createPostgresLoopEventBus({ connect: makeFactory(world) });
    const busB = await createPostgresLoopEventBus({ connect: makeFactory(world) });
    const publisher = await createPostgresLoopEventBus({ connect: makeFactory(world) });

    const seenA: string[] = [];
    const seenB: string[] = [];

    busA.subscribe({ projectId: "project_1" }, (event) => {
      seenA.push(`${event.type}:${event.id}`);
    });
    busB.subscribe({ projectId: "project_1" }, (event) => {
      seenB.push(`${event.type}:${event.id}`);
    });

    // Wait one microtask so the LISTEN sockets are wired before publishing.
    await Promise.resolve();

    const events: LoopEvent[] = [
      { id: "evt_1", projectId: "project_1", type: "planner.started", payload: {}, createdAt: new Date().toISOString() },
      { id: "evt_2", projectId: "project_1", type: "planner.proposed", payload: { n: 1 }, createdAt: new Date().toISOString() },
      { id: "evt_3", projectId: "project_1", type: "task.completed", payload: { ok: true }, createdAt: new Date().toISOString() },
    ];
    for (const event of events) publisher.publish(event);

    // Allow async fan-out to flush.
    await new Promise((r) => setTimeout(r, 5));

    expect(seenA).toEqual(["planner.started:evt_1", "planner.proposed:evt_2", "task.completed:evt_3"]);
    expect(seenB).toEqual(["planner.started:evt_1", "planner.proposed:evt_2", "task.completed:evt_3"]);

    await busA.close();
    await busB.close();
    await publisher.close();
  });

  test("filters events by projectId and taskExecutionId", async () => {
    const bus = await createPostgresLoopEventBus({ connect: makeFactory(world) });
    const publisher = await createPostgresLoopEventBus({ connect: makeFactory(world) });

    const seen: string[] = [];
    bus.subscribe({ projectId: "project_1", taskExecutionId: "exec_1" }, (event) => {
      seen.push(`${event.type}:${event.taskExecutionId ?? "none"}`);
    });

    await Promise.resolve();

    publisher.publish({
      id: "a",
      projectId: "project_1",
      taskExecutionId: "exec_1",
      type: "agent.step.started",
      payload: {},
      createdAt: new Date().toISOString(),
    });
    publisher.publish({
      id: "b",
      projectId: "project_1",
      taskExecutionId: "exec_2",
      type: "agent.step.started",
      payload: {},
      createdAt: new Date().toISOString(),
    });
    publisher.publish({
      id: "c",
      projectId: "project_2",
      taskExecutionId: "exec_1",
      type: "agent.step.started",
      payload: {},
      createdAt: new Date().toISOString(),
    });

    await new Promise((r) => setTimeout(r, 5));

    expect(seen).toEqual(["agent.step.started:exec_1"]);

    await bus.close();
    await publisher.close();
  });
});

describe("createPostgresLoopEventBus — wire-format round-trip for every LOOP_EVENT_TYPES", () => {
  test.each(LOOP_EVENT_TYPES.map((t) => [t]))("round-trips event type %s", async (type) => {
    const world = createWorld();
    const bus = await createPostgresLoopEventBus({ connect: makeFactory(world) });
    const publisher = await createPostgresLoopEventBus({ connect: makeFactory(world) });

    const received: LoopEvent[] = [];
    bus.subscribe({ projectId: "p" }, (event) => {
      received.push(event);
    });

    await Promise.resolve();

    const original: LoopEvent = {
      id: `evt_${type}`,
      projectId: "p",
      taskExecutionId: type.startsWith("agent.") ? "exec_round_trip" : undefined,
      type,
      payload: representativePayload(type),
      createdAt: "2026-04-28T00:00:00.000Z",
    };

    publisher.publish(original);

    await new Promise((r) => setTimeout(r, 5));

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(original);

    await bus.close();
    await publisher.close();
  });
});

describe("createPostgresLoopEventBus — reconnect after connection drop", () => {
  test("subscriber resumes receiving NEW events after a transient LISTEN drop", async () => {
    const world = createWorld();
    const created: FakePgClient[] = [];
    const bus = await createPostgresLoopEventBus({
      connect: makeFactory(world, { onCreate: (c) => created.push(c) }),
      reconnectDelayMs: 1,
    });
    const publisher = await createPostgresLoopEventBus({ connect: makeFactory(world) });

    const seen: string[] = [];
    bus.subscribe({ projectId: "p" }, (event) => {
      seen.push(event.id);
    });

    await Promise.resolve();

    publisher.publish({
      id: "before_drop",
      projectId: "p",
      type: "planner.started",
      payload: {},
      createdAt: new Date().toISOString(),
    });

    await new Promise((r) => setTimeout(r, 5));
    expect(seen).toEqual(["before_drop"]);

    // Simulate the listener's TCP connection dropping. Adapter should detect
    // and reconnect on its own, creating a *new* FakePgClient via the factory.
    const firstClient = created[0]!;
    firstClient.simulateConnectionDrop();

    // Wait for the adapter's reconnect loop to spin up a new client.
    await waitFor(() => created.length >= 2, 200);

    // Anything published *while disconnected* (between drop and reconnect)
    // is NOT delivered. Spec is explicit about this caveat.
    publisher.publish({
      id: "while_disconnected",
      projectId: "p",
      type: "planner.started",
      payload: {},
      createdAt: new Date().toISOString(),
    });

    // Give the reconnect a moment to wire LISTEN before we publish "after".
    await waitFor(() => Boolean(created[1] && created[1].connected), 200);
    await new Promise((r) => setTimeout(r, 2));

    publisher.publish({
      id: "after_reconnect",
      projectId: "p",
      type: "planner.started",
      payload: {},
      createdAt: new Date().toISOString(),
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(seen).toContain("before_drop");
    expect(seen).toContain("after_reconnect");
    // Note: we deliberately do NOT assert on the missed event — that's the
    // documented "no delivery guarantee while disconnected" behavior.

    await bus.close();
    await publisher.close();
  });
});

describe("createPostgresLoopEventBus — error isolation + payload-size guard", () => {
  test("isolates one subscriber's failure from the rest", async () => {
    const world = createWorld();
    const bus = await createPostgresLoopEventBus({ connect: makeFactory(world) });
    const publisher = await createPostgresLoopEventBus({ connect: makeFactory(world) });

    const seen: string[] = [];

    bus.subscribe({ projectId: "p" }, () => {
      throw new Error("boom");
    });
    bus.subscribe({ projectId: "p" }, (event) => {
      seen.push(event.id);
    });

    await Promise.resolve();

    publisher.publish({
      id: "evt_iso",
      projectId: "p",
      type: "planner.started",
      payload: {},
      createdAt: new Date().toISOString(),
    });

    await new Promise((r) => setTimeout(r, 5));
    expect(seen).toEqual(["evt_iso"]);

    await bus.close();
    await publisher.close();
  });

  test("drops oversized payloads instead of crashing the connection", async () => {
    const world = createWorld();
    const bus = await createPostgresLoopEventBus({ connect: makeFactory(world) });
    const publisher = await createPostgresLoopEventBus({ connect: makeFactory(world) });

    const seen: string[] = [];
    bus.subscribe({ projectId: "p" }, (event) => {
      seen.push(event.id);
    });

    await Promise.resolve();

    const huge = "x".repeat(9000); // > 8000 bytes after JSON-encode
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    publisher.publish({
      id: "evt_huge",
      projectId: "p",
      type: "operator.notification",
      payload: { severity: "warn", subjectType: "patch", subjectId: "x", body: huge },
      createdAt: new Date().toISOString(),
    });
    publisher.publish({
      id: "evt_small",
      projectId: "p",
      type: "planner.started",
      payload: {},
      createdAt: new Date().toISOString(),
    });

    await new Promise((r) => setTimeout(r, 5));

    expect(seen).toEqual(["evt_small"]);
    expect(errSpy).toHaveBeenCalled();

    errSpy.mockRestore();

    await bus.close();
    await publisher.close();
  });

  test("listenerCount tracks subscribers", async () => {
    const world = createWorld();
    const bus = await createPostgresLoopEventBus({ connect: makeFactory(world) });

    expect(bus.listenerCount()).toBe(0);
    const off1 = bus.subscribe({ projectId: "p" }, () => {});
    const off2 = bus.subscribe({ projectId: "p" }, () => {});
    bus.subscribe({ projectId: "q" }, () => {});

    expect(bus.listenerCount()).toBe(3);
    expect(bus.listenerCount({ projectId: "p" })).toBe(2);

    off1();
    off2();
    expect(bus.listenerCount({ projectId: "p" })).toBe(0);

    await bus.close();
  });
});

describe("POSTGRES_LOOP_CHANNEL", () => {
  test("uses a deterministic channel name compatible with pg LISTEN identifier rules", () => {
    // Postgres identifiers in LISTEN are case-folded and accept letters,
    // digits, underscores. We use the same channel for all loop events so a
    // single LISTEN statement covers the bus.
    expect(POSTGRES_LOOP_CHANNEL).toMatch(/^[a-z][a-z0-9_]+$/);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 1));
  }
  if (!predicate()) {
    throw new Error(`waitFor timed out after ${timeoutMs}ms`);
  }
}
