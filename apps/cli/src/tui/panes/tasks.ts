import { BoxRenderable, TextRenderable, type CliRenderer } from "@opentui/core";
import type { ApiTask, ApiVerificationItem } from "@vimbuspromax3000/api-client";
import type { State } from "../state";

const MAX_VISIBLE_LINES = 24;

export type TasksPane = {
  root: BoxRenderable;
  update(state: State): void;
};

export function createTasks(renderer: CliRenderer): TasksPane {
  const root = new BoxRenderable(renderer, {
    id: "tasks-pane",
    flexGrow: 1,
    flexDirection: "column",
    padding: 1,
    border: true,
    borderColor: "#1F2933",
    focusedBorderColor: "#3CA0FF",
    focusable: true,
  });

  const title = new TextRenderable(renderer, {
    id: "tasks-title",
    content: "Epics / Tasks",
    fg: "#8AD4FF",
    attributes: 0b001,
  });

  const summary = new TextRenderable(renderer, {
    id: "tasks-summary",
    content: "",
    fg: "#7B8794",
  });

  const body = new TextRenderable(renderer, {
    id: "tasks-body",
    content: "",
    fg: "#C9D2DB",
  });

  root.add(title);
  root.add(summary);
  root.add(body);

  function update(state: State): void {
    if (state.view === "detail") {
      title.content = "Verification";
      summary.content = describeVerificationSummary(state);
      body.content = renderVerificationBody(state);
      return;
    }

    title.content = "Epics / Tasks";
    summary.content = describeSummary(state);
    body.content = renderBody(state);
  }

  return { root, update };
}

function describeSummary(state: State): string {
  switch (state.mode.kind) {
    case "boot":
      return "booting…";
    case "api-offline":
    case "auth-missing":
      return "complete onboarding to load tasks.";
    case "project-picker":
      return "pick a project to load tasks.";
    case "ready":
      return summarizeTasks(state);
  }
}

function summarizeTasks(state: State): string {
  switch (state.tasks.status) {
    case "idle":
      return "tasks: idle";
    case "loading":
      return "tasks: loading…";
    case "error":
      return `tasks: error — ${state.tasks.error ?? "unknown"}`;
    case "ready":
      return `tasks: ${state.tasks.items.length} loaded  •  ↑/↓ select  •  Enter open`;
  }
}

function renderBody(state: State): string {
  if (state.mode.kind !== "ready") return "";
  if (state.tasks.status !== "ready") return "";
  if (state.tasks.items.length === 0) {
    return "no tasks yet — press `p` (or `:` → create plan) to start a planner run.";
  }

  const grouped = groupByEpic(state.tasks.items);
  const lines: string[] = [];
  let flatIndex = 0;

  for (const group of grouped) {
    lines.push(formatEpicHeader(group));
    for (const task of group.tasks) {
      lines.push(formatTask(task, flatIndex === state.tasks.cursor));
      flatIndex += 1;
    }
  }

  if (lines.length > MAX_VISIBLE_LINES) {
    return [
      ...lines.slice(0, MAX_VISIBLE_LINES - 1),
      `… ${lines.length - (MAX_VISIBLE_LINES - 1)} more`,
    ].join("\n");
  }

  return lines.join("\n");
}

type EpicGroup = {
  key: string;
  title: string;
  tasks: ApiTask[];
};

function groupByEpic(items: ApiTask[]): EpicGroup[] {
  const order: string[] = [];
  const map = new Map<string, EpicGroup>();

  for (const task of items) {
    const key = task.epic?.key ?? "(no-epic)";
    const title = task.epic?.title ?? "Unassigned";
    if (!map.has(key)) {
      map.set(key, { key, title, tasks: [] });
      order.push(key);
    }
    map.get(key)!.tasks.push(task);
  }

  return order.map((key) => map.get(key)!);
}

function formatEpicHeader(group: EpicGroup): string {
  return `▸ ${group.key}  ${group.title}  (${group.tasks.length})`;
}

function formatTask(task: ApiTask, selected: boolean): string {
  const marker = selected ? "›" : " ";
  const status = task.status.padEnd(10);
  return `  ${marker} ${status} ${task.stableId.padEnd(12)} ${task.title}`;
}

function describeVerificationSummary(state: State): string {
  switch (state.taskDetail.status) {
    case "idle":
      return "verification: idle";
    case "loading":
      return "verification: loading…";
    case "error":
      return `verification: error — ${state.taskDetail.error ?? "unknown"}`;
    case "ready": {
      const summary = state.taskDetail.verification?.summary;
      if (!summary) return "verification: no plan yet";
      return `verification: ${summary.runnableCount}/${summary.totalCount} runnable  •  ${summary.deferredCount} deferred`;
    }
  }
}

function renderVerificationBody(state: State): string {
  const detail = state.taskDetail;
  if (detail.status === "loading") return "loading verification plan…";
  if (detail.status === "error") return detail.error ?? "(unknown error)";
  if (!detail.verification?.plan) {
    return "no verification plan attached to this task.";
  }
  const items = detail.verification.plan.items;
  if (items.length === 0) return "(verification plan has no items)";
  return items.slice(0, MAX_VISIBLE_LINES).map(formatVerificationItem).join("\n");
}

function formatVerificationItem(item: ApiVerificationItem): string {
  const marker = item.runnableNow ? "●" : "○";
  const status = item.status.padEnd(10);
  return `  ${marker} ${status} ${String(item.orderIndex).padStart(2)}. ${item.name}`;
}
