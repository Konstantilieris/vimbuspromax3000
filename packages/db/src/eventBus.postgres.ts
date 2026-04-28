import type { LoopEvent } from "@vimbuspromax3000/shared";
import type { LoopEventBus, LoopEventBusFilter, LoopEventListener } from "./eventBus";

/**
 * VIM-45 — Postgres LISTEN/NOTIFY adapter for `LoopEventBus`.
 *
 * Multi-process delivery: any process whose `LoopEventBus` is a Postgres
 * adapter sees every event published from any other Postgres-adapter process
 * subscribed to the same channel. Wire format is JSON-encoded `LoopEvent`s
 * sent through `pg_notify(channel, payload)` and received via a dedicated
 * `LISTEN` connection.
 *
 * Caveats — also documented in eventBus.postgres.test.ts header:
 *
 *   1. **Connection-drop window has no delivery guarantee.** Events published
 *      while a subscriber's LISTEN socket is dropped are NOT replayed when
 *      the socket reconnects. Recovery for the missed window is the database
 *      (`/events/history` reads from `LoopEvent` table). Same posture as the
 *      in-process bus.
 *
 *   2. **`pg_notify` payload is capped at 8000 bytes** (Postgres
 *      `NAMEDATALEN` minus header). We serialize each event as compact JSON.
 *      Most loop events fit comfortably under that cap; the realistic tail is
 *      `operator.notification` with long free-text bodies. If a serialized
 *      event would exceed the limit we log and DROP the publish — the
 *      database row already committed (publishers call us *after*
 *      `appendLoopEvent` writes the row), so the event is recoverable via
 *      `/events/history`. Dropping is intentional: we'd rather miss one
 *      cross-process notification than crash the publish socket.
 */

export const POSTGRES_LOOP_CHANNEL = "vimbus_loop_events";

/** Postgres `pg_notify` payload cap (bytes). */
export const POSTGRES_NOTIFY_PAYLOAD_LIMIT = 7900;

/**
 * Structural slice of `pg.Client` that the adapter uses. Exposed so tests
 * can wire an in-memory fake without pulling `pg` into the test runtime.
 *
 * In production callers pass `() => new (await import("pg")).Client(url)`.
 */
export type PostgresNotifyClient = {
  connect(): Promise<void>;
  query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  on(event: "notification", handler: (msg: { channel: string; payload: string; processId: number }) => void): unknown;
  on(event: "error", handler: (err: Error) => void): unknown;
  on(event: "end", handler: () => void): unknown;
  off?(event: string, handler: (...args: unknown[]) => void): unknown;
  removeAllListeners?(event?: string): unknown;
  end(): Promise<void>;
};

export type PostgresLoopEventBusOptions = {
  /**
   * Factory that returns a connected (or about-to-connect) `pg.Client`-like
   * object. Called once at startup for the listener and once per publish for
   * stateless NOTIFY emission. The adapter calls `.connect()` itself.
   */
  connect: () => Promise<PostgresNotifyClient>;
  /** Override the LISTEN channel. Defaults to `vimbus_loop_events`. */
  channel?: string;
  /** Backoff before reconnecting after a connection error. Defaults to 250ms. */
  reconnectDelayMs?: number;
};

export type PostgresLoopEventBus = LoopEventBus & {
  /** Tear down the LISTEN connection. Test/shutdown only. */
  close(): Promise<void>;
};

type Registration = {
  filter: LoopEventBusFilter;
  listener: LoopEventListener;
};

/**
 * Build a `LoopEventBus` backed by Postgres LISTEN/NOTIFY. The returned bus
 * is structurally identical to the in-process bus from `eventBus.ts` so
 * existing callers do not change. The adapter additionally exposes a
 * `close()` method for graceful shutdown / test teardown.
 *
 * The function is `async` only because we want to surface "Postgres listener
 * cannot connect" at startup, not at first publish. If you really want a
 * lazy-connect bus, await this call inside the factory.
 */
export async function createPostgresLoopEventBus(
  options: PostgresLoopEventBusOptions,
): Promise<PostgresLoopEventBus> {
  const channel = options.channel ?? POSTGRES_LOOP_CHANNEL;
  const reconnectDelayMs = options.reconnectDelayMs ?? 250;

  const registrations = new Set<Registration>();
  let closed = false;
  let listenerClient: PostgresNotifyClient | undefined;

  const dispatch = (event: LoopEvent): void => {
    // Snapshot so subscribers added/removed during fan-out don't disturb
    // the current dispatch — same posture as the in-process bus.
    const snapshot = Array.from(registrations);
    for (const registration of snapshot) {
      if (registration.filter.projectId !== event.projectId) continue;
      if (
        registration.filter.taskExecutionId !== undefined &&
        registration.filter.taskExecutionId !== event.taskExecutionId
      ) {
        continue;
      }
      try {
        registration.listener(event);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("[loopEventBus.postgres] subscriber threw", error);
      }
    }
  };

  const onNotification = (msg: { channel: string; payload: string }): void => {
    if (msg.channel !== channel) return;
    let parsed: LoopEvent | undefined;
    try {
      parsed = JSON.parse(msg.payload) as LoopEvent;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[loopEventBus.postgres] invalid notification payload", error);
      return;
    }
    if (parsed) dispatch(parsed);
  };

  const wireListener = async (): Promise<void> => {
    if (closed) return;
    try {
      const client = await options.connect();
      listenerClient = client;
      client.on("error", onClientError);
      client.on("end", onClientEnd);
      client.on("notification", onNotification);
      await client.connect();
      // Channel name must be a valid identifier — POSTGRES_LOOP_CHANNEL is
      // a hard-coded constant and any override is the caller's
      // responsibility, so we do not parameterize-quote it here.
      await client.query(`LISTEN ${channel}`);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[loopEventBus.postgres] listener connect failed", error);
      scheduleReconnect();
    }
  };

  const onClientError = (error: Error): void => {
    // Don't tear the in-process subscriber list down on a transient socket
    // error — just rewire the listener. Subscribers stay registered and
    // start receiving NEW events again as soon as the new LISTEN is up.
    // eslint-disable-next-line no-console
    console.error("[loopEventBus.postgres] listener error", error);
    scheduleReconnect();
  };

  const onClientEnd = (): void => {
    // Mirror error handling — Postgres can drop the connection cleanly.
    if (!closed) scheduleReconnect();
  };

  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleReconnect = (): void => {
    if (closed) return;
    if (reconnectTimer !== undefined) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      // Best-effort cleanup of the dead client. If `.end()` rejects (already
      // ended) we don't care.
      const dead = listenerClient;
      listenerClient = undefined;
      if (dead) {
        dead.removeAllListeners?.();
        dead.end().catch(() => {});
      }
      void wireListener();
    }, reconnectDelayMs);
  };

  await wireListener();

  return {
    publish(event) {
      // Each publish opens a one-shot client. This keeps publish stateless
      // and avoids head-of-line blocking with the LISTEN socket. In
      // production you can connection-pool by passing a factory that hands
      // out idle clients from a pool — the structural type is the same.
      void publishViaNotify(options.connect, channel, event);
    },
    subscribe(filter, listener) {
      const registration: Registration = { filter, listener };
      registrations.add(registration);
      return () => {
        registrations.delete(registration);
      };
    },
    listenerCount(filter) {
      if (!filter?.projectId) return registrations.size;
      let count = 0;
      for (const registration of registrations) {
        if (registration.filter.projectId === filter.projectId) count += 1;
      }
      return count;
    },
    async close() {
      closed = true;
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      const dead = listenerClient;
      listenerClient = undefined;
      if (dead) {
        dead.removeAllListeners?.();
        try {
          await dead.end();
        } catch {
          // already ended
        }
      }
      registrations.clear();
    },
  };
}

async function publishViaNotify(
  connect: () => Promise<PostgresNotifyClient>,
  channel: string,
  event: LoopEvent,
): Promise<void> {
  const payload = JSON.stringify(event);
  // Postgres pg_notify caps payloads at ~8000 bytes. We log + drop oversize
  // events rather than crash the publish socket — see header caveat.
  if (Buffer.byteLength(payload, "utf8") > POSTGRES_NOTIFY_PAYLOAD_LIMIT) {
    // eslint-disable-next-line no-console
    console.error(
      "[loopEventBus.postgres] dropping publish: payload exceeds pg_notify 8KB limit",
      { id: event.id, type: event.type, bytes: Buffer.byteLength(payload, "utf8") },
    );
    return;
  }

  let client: PostgresNotifyClient | undefined;
  try {
    client = await connect();
    await client.connect();
    await client.query("SELECT pg_notify($1, $2)", [channel, payload]);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[loopEventBus.postgres] publish failed", error);
  } finally {
    if (client) {
      try {
        await client.end();
      } catch {
        // ignore
      }
    }
  }
}
