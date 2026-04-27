import type { LoopEventType } from "@vimbuspromax3000/shared";
import { getDefaultLoopEventBus } from "../eventBus";
import type { DatabaseClient } from "./types";

export type AppendLoopEventInput = {
  projectId: string;
  type: LoopEventType;
  payload: unknown;
  taskExecutionId?: string;
};

export type ListLoopEventsInput = {
  projectId: string;
  taskExecutionId?: string;
  limit?: number;
};

export async function appendLoopEvent(db: DatabaseClient, input: AppendLoopEventInput) {
  const event = await db.loopEvent.create({
    data: {
      projectId: input.projectId,
      taskExecutionId: input.taskExecutionId,
      type: input.type,
      payloadJson: JSON.stringify(input.payload),
    },
  });

  const parsed = parseLoopEvent(event);

  // VIM-36 Sprint 2: publish synchronously to the in-process event bus so the
  // SSE stream pushes new events without the 100ms poll tail. The bus shrugs
  // off subscriber errors internally, so a bad listener can't break inserts.
  getDefaultLoopEventBus().publish(parsed);

  return parsed;
}

export async function listLoopEvents(db: DatabaseClient, input: ListLoopEventsInput) {
  const events = await db.loopEvent.findMany({
    where: {
      projectId: input.projectId,
      taskExecutionId: input.taskExecutionId,
    },
    orderBy: [{ createdAt: "asc" }],
    take: input.limit ?? 200,
  });

  return events.map(parseLoopEvent);
}

function parseLoopEvent(event: {
  id: string;
  projectId: string;
  taskExecutionId: string | null;
  type: string;
  payloadJson: string;
  createdAt: Date;
}) {
  return {
    id: event.id,
    projectId: event.projectId,
    taskExecutionId: event.taskExecutionId ?? undefined,
    type: event.type as LoopEventType,
    payload: parseJson(event.payloadJson),
    createdAt: event.createdAt.toISOString(),
  };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
