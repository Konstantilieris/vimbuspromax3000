import type { LoopEvent } from "@vimbuspromax3000/shared";

/**
 * VIM-36 Sprint 2 — 3-pane live view that subscribes to `GET /events?stream=sse`
 * and renders incremental updates without re-rendering the whole screen.
 *
 * The shape splits cleanly into:
 *
 *   1. A pure reducer (`applyLiveViewEvents`) so we can snapshot-test the
 *      derived view against a fixture event tape.
 *   2. An SSE frame parser (`parseSseFrames`) that handles the wire format
 *      and partial chunk boundaries.
 *   3. A renderer (`runLiveView`) that wires the two together against an
 *      OpenTUI tree, mutating individual `Text` nodes so we don't trigger a
 *      full re-render on every event.
 */

export const LIVE_VIEW_PANES = [
  "Epics / Tasks",
  "Control Center",
  "Evaluator Transcript",
] as const;

export type EpicView = {
  key: string;
  title: string;
  tasks: Array<{
    stableId: string;
    title: string;
    status: string;
  }>;
};

export type EvaluatorEntry = {
  /** A short rendered line, e.g. `logic 92/80` or `passed (94)`. */
  line: string;
  type: string;
  taskExecutionId?: string;
};

/**
 * VIM-37 — Operator notification badge.
 *
 * Severity drives the rendered tag and (when wired into a colored TUI) the
 * badge color. The CLI clears all notifications when the operator presses the
 * `n` keybinding (see {@link handleLiveViewKey}).
 */
export type NotificationSeverity = "info" | "warn" | "error";

export type NotificationEntry = {
  id: string;
  severity: NotificationSeverity;
  subjectType: string;
  subjectId: string;
  taskExecutionId?: string;
  createdAt: string;
};

export type LiveViewState = {
  epics: EpicView[];
  /** Set of seen event ids so re-applying the same event is a no-op. */
  seenEventIds: Set<string>;
  control: {
    activeExecutionId?: string;
    lastEventType?: string;
    lastEventAt?: string;
    lastFailure?: string;
    eventCount: number;
  };
  evaluator: EvaluatorEntry[];
  /**
   * VIM-37 — operator notifications badge state. Each entry is one
   * `operator.notification` event; pressing key `n` (or calling
   * {@link acknowledgeNotifications}) clears the list.
   */
  notifications: NotificationEntry[];
};

export function createLiveViewState(): LiveViewState {
  return {
    epics: [],
    seenEventIds: new Set<string>(),
    control: { eventCount: 0 },
    evaluator: [],
    notifications: [],
  };
}

const MAX_EVALUATOR_LINES = 20;

export function applyLiveViewEvents(state: LiveViewState, events: readonly LoopEvent[]): LiveViewState {
  const next: LiveViewState = {
    epics: state.epics.map((epic) => ({
      key: epic.key,
      title: epic.title,
      tasks: epic.tasks.map((task) => ({ ...task })),
    })),
    seenEventIds: new Set(state.seenEventIds),
    control: { ...state.control },
    evaluator: [...state.evaluator],
    notifications: [...state.notifications],
  };

  for (const event of events) {
    if (next.seenEventIds.has(event.id)) continue;
    next.seenEventIds.add(event.id);

    next.control.eventCount += 1;
    next.control.lastEventType = event.type;
    next.control.lastEventAt = event.createdAt;
    if (event.taskExecutionId) {
      next.control.activeExecutionId = event.taskExecutionId;
    }

    routeEvent(next, event);
  }

  return next;
}

function routeEvent(state: LiveViewState, event: LoopEvent): void {
  switch (event.type) {
    case "planner.proposed": {
      const epics = extractEpics(event.payload);
      if (epics) {
        state.epics = mergeEpics(state.epics, epics);
      }
      return;
    }
    case "task.completed":
    case "task.failed": {
      const taskId = readString(event.payload, "taskId");
      const status = event.type === "task.completed" ? "completed" : "failed";
      if (taskId) {
        state.epics = applyTaskStatus(state.epics, taskId, status);
      }
      if (event.type === "task.failed") {
        state.control.lastFailure = `${taskId ?? "task"}: ${readString(event.payload, "reason") ?? "unknown"}`;
      }
      return;
    }
    case "evaluation.result": {
      const dimension = readString(event.payload, "dimension") ?? "?";
      const score = readNumber(event.payload, "score");
      const threshold = readNumber(event.payload, "threshold");
      pushEvaluator(state, {
        type: event.type,
        taskExecutionId: event.taskExecutionId,
        line: `${dimension} ${score ?? "?"}/${threshold ?? "?"}`,
      });
      return;
    }
    case "evaluation.finished": {
      const verdict = readString(event.payload, "verdict") ?? "?";
      const score = readNumber(event.payload, "aggregateScore");
      pushEvaluator(state, {
        type: event.type,
        taskExecutionId: event.taskExecutionId,
        line: `${verdict}${score === undefined ? "" : ` (${score})`}`,
      });
      return;
    }
    case "evaluation.started":
    case "benchmark.started":
    case "benchmark.finished":
    case "regression.compared":
    case "regression.blocked": {
      pushEvaluator(state, {
        type: event.type,
        taskExecutionId: event.taskExecutionId,
        line: event.type,
      });
      return;
    }
    case "operator.notification": {
      // VIM-37 — accumulate notifications until the operator acknowledges
      // them with the `n` keybinding. Bad payloads are skipped silently so a
      // malformed event can't crash the live view.
      const entry = parseNotificationPayload(event);
      if (entry) {
        state.notifications.push(entry);
      }
      return;
    }
    default:
      return;
  }
}

const NOTIFICATION_SEVERITIES: ReadonlySet<NotificationSeverity> = new Set([
  "info",
  "warn",
  "error",
]);

function parseNotificationPayload(event: LoopEvent): NotificationEntry | undefined {
  if (!isRecord(event.payload)) return undefined;
  const severity = event.payload.severity;
  const subjectType = event.payload.subjectType;
  const subjectId = event.payload.subjectId;
  if (typeof severity !== "string" || !NOTIFICATION_SEVERITIES.has(severity as NotificationSeverity)) {
    return undefined;
  }
  if (typeof subjectType !== "string" || subjectType.length === 0) return undefined;
  if (typeof subjectId !== "string" || subjectId.length === 0) return undefined;
  return {
    id: event.id,
    severity: severity as NotificationSeverity,
    subjectType,
    subjectId,
    taskExecutionId: event.taskExecutionId,
    createdAt: event.createdAt,
  };
}

function pushEvaluator(state: LiveViewState, entry: EvaluatorEntry): void {
  state.evaluator.push(entry);
  if (state.evaluator.length > MAX_EVALUATOR_LINES) {
    state.evaluator.splice(0, state.evaluator.length - MAX_EVALUATOR_LINES);
  }
}

function extractEpics(payload: unknown): EpicView[] | undefined {
  if (!isRecord(payload)) return undefined;
  const epics = payload.epics;
  if (!Array.isArray(epics)) return undefined;
  return epics
    .map((epic) => {
      if (!isRecord(epic)) return undefined;
      const key = readString(epic, "key");
      const title = readString(epic, "title");
      if (!key || !title) return undefined;
      const tasksRaw = Array.isArray(epic.tasks) ? epic.tasks : [];
      const tasks = tasksRaw
        .map((task) => {
          if (!isRecord(task)) return undefined;
          const stableId = readString(task, "stableId") ?? readString(task, "id");
          const taskTitle = readString(task, "title");
          if (!stableId || !taskTitle) return undefined;
          return {
            stableId,
            title: taskTitle,
            status: readString(task, "status") ?? "planned",
          };
        })
        .filter((task): task is EpicView["tasks"][number] => task !== undefined);
      return { key, title, tasks };
    })
    .filter((epic): epic is EpicView => epic !== undefined);
}

function mergeEpics(existing: EpicView[], incoming: EpicView[]): EpicView[] {
  const byKey = new Map<string, EpicView>();
  for (const epic of existing) byKey.set(epic.key, epic);
  for (const epic of incoming) {
    const prior = byKey.get(epic.key);
    if (!prior) {
      byKey.set(epic.key, epic);
      continue;
    }
    const taskByStableId = new Map<string, EpicView["tasks"][number]>();
    for (const task of prior.tasks) taskByStableId.set(task.stableId, task);
    for (const task of epic.tasks) taskByStableId.set(task.stableId, task);
    byKey.set(epic.key, {
      key: epic.key,
      title: epic.title,
      tasks: Array.from(taskByStableId.values()),
    });
  }
  return Array.from(byKey.values());
}

function applyTaskStatus(epics: EpicView[], taskId: string, status: string): EpicView[] {
  return epics.map((epic) => ({
    key: epic.key,
    title: epic.title,
    tasks: epic.tasks.map((task) =>
      task.stableId === taskId ? { ...task, status } : task,
    ),
  }));
}

export function getLiveViewSnapshot(state: LiveViewState): string {
  return [
    renderEpicsPane(state),
    renderControlPane(state),
    renderEvaluatorPane(state),
    renderNotificationsPane(state),
  ].join("\n\n");
}

export function renderEpicsPane(state: LiveViewState): string {
  const lines: string[] = [LIVE_VIEW_PANES[0]];
  if (state.epics.length === 0) {
    lines.push("No epics yet.");
    return lines.join("\n");
  }
  for (const epic of state.epics) {
    lines.push(`${epic.key} ${epic.title}`);
    for (const task of epic.tasks) {
      lines.push(`  - ${task.stableId} ${task.title} [${task.status}]`);
    }
  }
  return lines.join("\n");
}

export function renderControlPane(state: LiveViewState): string {
  const lines: string[] = [LIVE_VIEW_PANES[1]];
  if (state.control.eventCount === 0) {
    lines.push("Idle.");
    return lines.join("\n");
  }
  lines.push(`Events seen: ${state.control.eventCount}`);
  if (state.control.activeExecutionId) {
    lines.push(`Active execution: ${state.control.activeExecutionId}`);
  }
  if (state.control.lastEventType) {
    lines.push(`Last event: ${state.control.lastEventType}`);
  }
  if (state.control.lastEventAt) {
    lines.push(`At: ${state.control.lastEventAt}`);
  }
  if (state.control.lastFailure) {
    lines.push(`Last failure: ${state.control.lastFailure}`);
  }
  return lines.join("\n");
}

export function renderEvaluatorPane(state: LiveViewState): string {
  const lines: string[] = [LIVE_VIEW_PANES[2]];
  if (state.evaluator.length === 0) {
    lines.push("No evaluator activity.");
    return lines.join("\n");
  }
  for (const entry of state.evaluator) {
    lines.push(`- ${entry.line}`);
  }
  return lines.join("\n");
}

/**
 * VIM-37 — Severity tag rendered in the badge. The TUI wiring (OpenTUI) maps
 * each tag to a color: `info` (cyan), `warn` (yellow), `error` (red). This
 * function exposes the canonical color name so a future renderer change has
 * a single source of truth.
 */
export function severityColor(severity: NotificationSeverity): string {
  switch (severity) {
    case "info":
      return "cyan";
    case "warn":
      return "yellow";
    case "error":
      return "red";
  }
}

export function renderNotificationsPane(state: LiveViewState): string {
  const lines: string[] = ["Notifications"];
  if (state.notifications.length === 0) {
    lines.push("No notifications.");
    return lines.join("\n");
  }
  for (const entry of state.notifications) {
    const tag = `[${entry.severity.toUpperCase()}]`;
    lines.push(`${tag} ${entry.subjectType} ${entry.subjectId}`);
  }
  lines.push("Press 'n' to acknowledge.");
  return lines.join("\n");
}

/**
 * VIM-37 — Clear all pending operator notifications. Returns a new state when
 * the badge is non-empty so React-style consumers see a referential change;
 * returns the same state when there is nothing to clear so callers can short
 * circuit re-renders.
 */
export function acknowledgeNotifications(state: LiveViewState): LiveViewState {
  if (state.notifications.length === 0) return state;
  return {
    ...state,
    notifications: [],
  };
}

/**
 * VIM-37 — Keypress dispatcher for the live view. Pressing `n` acknowledges
 * the notification badge; any other key returns the same state so the caller
 * can preserve ===-equality and skip a re-render.
 */
export function handleLiveViewKey(state: LiveViewState, key: string): LiveViewState {
  if (key === "n" || key === "N") {
    return acknowledgeNotifications(state);
  }
  return state;
}

// ---------------------------------------------------------------------------
// SSE wire format
// ---------------------------------------------------------------------------

export type SseFrame = {
  event: string;
  id?: string;
  data: string;
};

export function parseSseFrames(buffer: string): { frames: SseFrame[]; remainder: string } {
  const frames: SseFrame[] = [];
  let remainder = buffer;
  // SSE frames are separated by a blank line. Normalize CRLF to LF first.
  const normalized = remainder.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  remainder = parts.pop() ?? "";

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith(":")) continue; // comment frame (heartbeat)

    let event = "message";
    let id: string | undefined;
    const dataLines: string[] = [];

    for (const line of trimmed.split("\n")) {
      if (line.startsWith(":")) continue;
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const field = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "id") id = value;
      else if (field === "data") dataLines.push(value);
    }

    if (dataLines.length === 0) continue;
    frames.push({ event, id, data: dataLines.join("\n") });
  }

  return { frames, remainder };
}

export function frameToLoopEvent(frame: SseFrame): LoopEvent | undefined {
  try {
    const parsed = JSON.parse(frame.data) as LoopEvent;
    if (parsed && typeof parsed === "object" && typeof parsed.id === "string") {
      return parsed;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Stream consumer (testable + reusable from the OpenTUI wiring)
// ---------------------------------------------------------------------------

export type RunLiveViewWithStreamOptions = {
  onUpdate?: (snapshot: string, state: LiveViewState) => void;
  signal?: AbortSignal;
};

/**
 * Drains the SSE body stream and applies events to the reducer. Returns the
 * final state. Used by the snapshot test against a fixture tape and by
 * `runLiveView` against the live API.
 */
export async function runLiveViewWithStream(
  stream: ReadableStream<Uint8Array>,
  options: RunLiveViewWithStreamOptions = {},
): Promise<LiveViewState> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let state = createLiveViewState();

  try {
    while (true) {
      if (options.signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { frames, remainder } = parseSseFrames(buffer);
      buffer = remainder;
      const events: LoopEvent[] = [];
      for (const frame of frames) {
        const event = frameToLoopEvent(frame);
        if (event) events.push(event);
      }
      if (events.length > 0) {
        state = applyLiveViewEvents(state, events);
        options.onUpdate?.(getLiveViewSnapshot(state), state);
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }

  return state;
}

export type RunLiveViewOptions = {
  apiUrl: string;
  projectId: string;
  taskExecutionId?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  onUpdate?: (snapshot: string, state: LiveViewState) => void;
};

/**
 * Opens the SSE stream and pipes it through the reducer. Returns the final
 * state when the stream closes (or the abort signal fires).
 */
export async function subscribeLiveView(options: RunLiveViewOptions): Promise<LiveViewState> {
  const request = options.fetch ?? fetch;
  const query = new URLSearchParams({ projectId: options.projectId, stream: "sse" });
  if (options.taskExecutionId) query.set("taskExecutionId", options.taskExecutionId);
  const response = await request(`${withoutTrailingSlash(options.apiUrl)}/events?${query.toString()}`, {
    headers: { accept: "text/event-stream" },
    signal: options.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`SSE subscribe failed: HTTP ${response.status}`);
  }
  return runLiveViewWithStream(response.body, {
    onUpdate: options.onUpdate,
    signal: options.signal,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const next = value[key];
  return typeof next === "string" ? next : undefined;
}

function readNumber(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) return undefined;
  const next = value[key];
  return typeof next === "number" ? next : undefined;
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}
