import type { LoopEvent } from "@vimbuspromax3000/shared";

/**
 * VIM-36 Sprint 2 — in-process event bus that backs the SSE stream. Each
 * `appendLoopEvent` insert publishes synchronously after the row commits, so
 * subscribers see events with sub-millisecond latency (well inside the 200ms
 * delivery acceptance criterion).
 *
 * The bus is intentionally tiny: a project-scoped (and optionally
 * execution-scoped) listener registry plus a synchronous fan-out. A future
 * Postgres `LISTEN/NOTIFY` adapter can plug in by wrapping `subscribe` /
 * `publish` without changing call sites.
 */

export type LoopEventBusFilter = {
  projectId: string;
  taskExecutionId?: string;
};

export type LoopEventListener = (event: LoopEvent) => void;

export type LoopEventBus = {
  publish(event: LoopEvent): void;
  subscribe(filter: LoopEventBusFilter, listener: LoopEventListener): () => void;
  /** Listener count, exposed for tests so we can assert teardown. */
  listenerCount(filter?: { projectId?: string }): number;
};

type Registration = {
  filter: LoopEventBusFilter;
  listener: LoopEventListener;
};

export function createLoopEventBus(): LoopEventBus {
  const registrations = new Set<Registration>();

  return {
    publish(event) {
      // Snapshot so subscribers added/removed during fan-out don't disturb the
      // current dispatch.
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
          // Log but never let one bad subscriber break the rest. SSE stream
          // teardown is the most likely failure here and is already handled
          // by aborting the generator on the writer side.
          // eslint-disable-next-line no-console
          console.error("[loopEventBus] subscriber threw", error);
        }
      }
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
  };
}

let defaultBus: LoopEventBus | undefined;

export function getDefaultLoopEventBus(): LoopEventBus {
  if (!defaultBus) {
    defaultBus = createLoopEventBus();
  }
  return defaultBus;
}

/**
 * Reset the process-wide singleton. Test-only — production code never calls
 * this. Exported so vitest suites can isolate subscription state per test.
 *
 * Optional override accepts a pre-built bus so tests of the Postgres adapter
 * (or any future transport) can install their own instance without touching
 * this module's internals.
 */
export function resetDefaultLoopEventBus(override?: LoopEventBus): void {
  defaultBus = override ?? createLoopEventBus();
}

/**
 * VIM-45 — Bus selection helper. Reads `VIMBUS_LOOP_BUS` and returns either
 * the in-process bus (default) or the Postgres LISTEN/NOTIFY adapter. The
 * Postgres branch is async because we want listener-connect failures to
 * surface at startup, not at first publish.
 *
 * In-process is the default to keep every existing caller unchanged. Today
 * only API-layer wiring needs to know about this helper; agent / planner
 * code keeps calling `getDefaultLoopEventBus()`.
 */
export type LoopEventBusEnv = {
  VIMBUS_LOOP_BUS?: string;
};

export type LoopEventBusFactoryOptions = {
  env?: LoopEventBusEnv;
  /**
   * Postgres adapter wiring. Required when `env.VIMBUS_LOOP_BUS === "postgres"`.
   * The `connect` shape lives in `./eventBus.postgres` (`PostgresNotifyClient`)
   * so importing *this* module never pulls a real `pg` dependency at runtime.
   */
  postgres?: import("./eventBus.postgres").PostgresLoopEventBusOptions;
};

export async function buildLoopEventBus(
  options: LoopEventBusFactoryOptions = {},
): Promise<LoopEventBus> {
  const env = options.env ?? (process.env as LoopEventBusEnv);
  const mode = (env.VIMBUS_LOOP_BUS ?? "memory").toLowerCase();
  if (mode === "postgres" || mode === "pg") {
    if (!options.postgres) {
      throw new Error(
        "VIM-45: VIMBUS_LOOP_BUS=postgres requires options.postgres (a pg.Client factory).",
      );
    }
    // Lazy import keeps the in-process branch free of any postgres module
    // load cost.
    const { createPostgresLoopEventBus } = await import("./eventBus.postgres");
    return createPostgresLoopEventBus(options.postgres);
  }
  return createLoopEventBus();
}
