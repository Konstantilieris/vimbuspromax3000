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
 */
export function resetDefaultLoopEventBus(): void {
  defaultBus = createLoopEventBus();
}
