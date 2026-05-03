import { BoxRenderable, TextRenderable, type CliRenderer } from "@opentui/core";
import type {
  ApiBranch,
  ApiExecution,
  ApiTestRun,
} from "@vimbuspromax3000/api-client";
import type { State } from "../state";

export type ControlPane = {
  root: BoxRenderable;
  update(state: State): void;
};

export function createControl(renderer: CliRenderer): ControlPane {
  const root = new BoxRenderable(renderer, {
    id: "control-pane",
    flexGrow: 1,
    flexDirection: "column",
    padding: 1,
    border: true,
    borderColor: "#1F2933",
    focusedBorderColor: "#3CA0FF",
    focusable: true,
  });

  const title = new TextRenderable(renderer, {
    id: "control-title",
    content: "Control Panel",
    fg: "#A8E6A3",
    attributes: 0b001,
  });

  const body = new TextRenderable(renderer, {
    id: "control-body",
    content: "",
    fg: "#C9D2DB",
  });

  root.add(title);
  root.add(body);

  function update(state: State): void {
    if (state.view === "detail") {
      title.content = "Task Pipeline";
      body.content = describeDetail(state);
      return;
    }
    title.content = "Control Panel";
    body.content = describeList(state);
  }

  return { root, update };
}

function describeList(state: State): string {
  const auth = describeAuth(state);
  const slot = describeSlot(state);
  const project = describeProject(state);

  const actions = [
    "[t] test Claude slot",
    "[s] switch project",
    "[k] paste API key",
    "[l] log in via Claude CLI",
    "[p] create plan",
    "[r] refresh",
    "[:] command palette",
    "[?] help",
  ].join("\n");

  return [auth, slot, project, "", actions].filter(Boolean).join("\n");
}

function describeAuth(state: State): string {
  if (state.auth.source) {
    return `auth: ${state.auth.source}`;
  }
  if (state.auth.reason) {
    return `auth: missing (${state.auth.reason})`;
  }
  return "auth: pending";
}

function describeSlot(state: State): string {
  if (state.auth.slotResolved === null) {
    return "slot planner_deep: not tested yet";
  }
  if (state.auth.slotResolved) {
    return `slot planner_deep: ✓ ${state.auth.slotMessage ?? ""}`.trim();
  }
  return `slot planner_deep: ✗ ${state.auth.slotMessage ?? ""}`.trim();
}

function describeProject(state: State): string {
  switch (state.mode.kind) {
    case "ready":
      return `project: ${state.mode.project.name}`;
    case "project-picker":
      return "project: not selected";
    case "boot":
      return "project: loading";
    case "api-offline":
      return `project: API offline at ${state.mode.apiUrl}`;
    case "auth-missing":
      return "project: blocked on auth";
  }
}

function describeDetail(state: State): string {
  const detail = state.taskDetail;
  const taskId = detail.taskId ?? "(none)";
  const lines = [`task: ${taskId}`, describeBranch(detail.branch), describeExecution(detail.execution), describeTestRuns(detail.testRuns)];

  const actions = [
    "[b] create branch",
    "[x] start execution",
    "[v] start test-runs",
    "[e] evaluate patch",
    "[Esc] back to list",
  ].join("\n");

  return [...lines, "", actions].filter(Boolean).join("\n");
}

function describeBranch(branch: ApiBranch | null): string {
  if (!branch) return "branch: none — press [b] to create";
  return `branch: ${branch.branchName} (${branch.state}) base=${branch.baseBranch}`;
}

function describeExecution(execution: ApiExecution | null): string {
  if (!execution) return "execution: none — press [x] to start";
  return `execution: ${execution.id} status=${execution.status}`;
}

function describeTestRuns(testRuns: ApiTestRun[]): string {
  if (testRuns.length === 0) return "test-runs: none — press [v] when execution is ready";
  const counts = testRuns.reduce<Record<string, number>>((acc, run) => {
    acc[run.status] = (acc[run.status] ?? 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(counts)
    .map(([status, n]) => `${status}=${n}`)
    .join(" ");
  return `test-runs: ${testRuns.length}  •  ${summary}`;
}
