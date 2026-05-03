import { BoxRenderable, TextRenderable, type CliRenderer } from "@opentui/core";
import type {
  ApiEvalResult,
  ApiEvalRun,
  ApiTestRun,
} from "@vimbuspromax3000/api-client";
import type { State } from "../state";

const MAX_TRACE_LINES = 16;

export type LogsPane = {
  root: BoxRenderable;
  update(state: State): void;
};

export function createLogs(renderer: CliRenderer): LogsPane {
  const root = new BoxRenderable(renderer, {
    id: "logs-pane",
    flexGrow: 1,
    flexDirection: "column",
    padding: 1,
    border: true,
    borderColor: "#1F2933",
    focusedBorderColor: "#3CA0FF",
    focusable: true,
  });

  const title = new TextRenderable(renderer, {
    id: "logs-title",
    content: "Eval / Tools / Logs",
    fg: "#F5C982",
    attributes: 0b001,
  });

  const note = new TextRenderable(renderer, {
    id: "logs-note",
    content: "live event log: pending API cursor support",
    fg: "#7B8794",
  });

  const trace = new TextRenderable(renderer, {
    id: "logs-trace",
    content: "",
    fg: "#C9D2DB",
  });

  const toast = new TextRenderable(renderer, {
    id: "logs-toast",
    content: "",
    fg: "#E7EDF3",
  });

  root.add(title);
  root.add(note);
  root.add(trace);
  root.add(toast);

  function update(state: State): void {
    if (state.view === "detail") {
      title.content = "Test Runs / Eval";
      note.content = describeDetailNote(state);
      trace.content = renderDetailBody(state);
      toast.content = state.toast ? formatToast(state.toast.kind, state.toast.text) : "";
      return;
    }

    title.content = "Eval / Tools / Logs";
    note.content = "live event log: pending API cursor support";
    const lines = state.bootTrace.slice(-MAX_TRACE_LINES);
    trace.content = lines.length === 0 ? "(no boot trace yet)" : lines.join("\n");
    toast.content = state.toast ? formatToast(state.toast.kind, state.toast.text) : "";
  }

  return { root, update };
}

function describeDetailNote(state: State): string {
  const detail = state.taskDetail;
  if (!detail.execution) {
    return "no execution started yet";
  }
  if (detail.testRuns.some((run) => run.status === "running")) {
    return "test-runs streaming (auto-refresh 2s)";
  }
  return `execution ${detail.execution.id} • ${detail.testRuns.length} test-runs`;
}

function renderDetailBody(state: State): string {
  const detail = state.taskDetail;
  const blocks: string[] = [];

  if (detail.testRuns.length > 0) {
    blocks.push(formatTestRuns(detail.testRuns));
  }

  if (detail.evaluation) {
    blocks.push(formatEvaluation(detail.evaluation));
  } else if (detail.execution) {
    blocks.push("eval: not run yet — press [e]");
  }

  const trace = state.bootTrace.slice(-6);
  if (trace.length > 0) {
    blocks.push(`recent: ${trace[trace.length - 1]}`);
  }

  return blocks.length === 0 ? "(idle)" : blocks.join("\n\n");
}

function formatTestRuns(testRuns: ApiTestRun[]): string {
  return testRuns
    .slice(0, 6)
    .map((run) => {
      const exit = run.exitCode === null || run.exitCode === undefined ? "?" : String(run.exitCode);
      const cmd = run.command ?? "(no command)";
      return `  [${run.orderIndex}] ${run.status.padEnd(8)} exit=${exit.padEnd(3)} ${cmd}`;
    })
    .join("\n");
}

function formatEvaluation(evaluation: ApiEvalRun): string {
  const lines = [
    `eval ${evaluation.id} status=${evaluation.status}`,
    `verdict=${evaluation.verdict ?? "n/a"} score=${evaluation.aggregateScore ?? 0}/${evaluation.threshold ?? "n/a"}`,
  ];
  const concerns = (evaluation.results ?? []).filter(
    (result: ApiEvalResult) => result.verdict !== "pass",
  );
  if (concerns.length > 0) {
    lines.push("concerns:");
    for (const concern of concerns.slice(0, 3)) {
      lines.push(`  - ${concern.dimension}: ${(concern.reasoning ?? "below threshold").slice(0, 60)}`);
    }
  }
  return lines.join("\n");
}

function formatToast(kind: "info" | "error" | "success", text: string): string {
  const tag = kind === "error" ? "[error]" : kind === "success" ? "[ok]" : "[info]";
  return `${tag} ${text}`;
}
