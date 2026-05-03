import type {
  ApiBranch,
  ApiEvalRun,
  ApiExecution,
  ApiPlannerRun,
  ApiProject,
  ApiTask,
  ApiTaskVerificationReview,
  ApiTestRun,
  AuthSource,
} from "@vimbuspromax3000/api-client";

export type Pane = "tasks" | "control" | "logs";

export const PANE_ORDER: readonly Pane[] = ["tasks", "control", "logs"] as const;

export type Mode =
  | { kind: "boot" }
  | { kind: "api-offline"; apiUrl: string; reason: string }
  | { kind: "auth-missing"; reason: string }
  | { kind: "project-picker"; projects: ApiProject[]; cursor: number }
  | { kind: "ready"; project: ApiProject };

export type AuthState = {
  source: AuthSource | null;
  reason: string | null;
  slotResolved: boolean | null;
  slotMessage: string | null;
};

export type Toast =
  | { kind: "info" | "error" | "success"; text: string; expiresAt: number };

export type Overlay =
  | "none"
  | "palette"
  | "help"
  | "api-key"
  | "plan"
  | "claude-login";

export type PaletteCommandId =
  | "test-slot"
  | "switch-project"
  | "paste-api-key"
  | "login-claude"
  | "create-plan"
  | "approve-plan"
  | "reset-plan"
  | "refresh"
  | "quit";

export type PaletteCommand = {
  id: PaletteCommandId;
  label: string;
  hint: string;
};

export type PaletteState = {
  buffer: string;
  cursor: number;
  commands: PaletteCommand[];
};

export type TasksState = {
  status: "idle" | "loading" | "ready" | "error";
  items: ApiTask[];
  cursor: number;
  error: string | null;
};

export type ClaudeLoginPhase =
  | "idle"
  | "detecting"
  | "detected"
  | "missing"
  | "error";

export type ClaudeLoginState = {
  phase: ClaudeLoginPhase;
  cliPath: string | null;
  cliVersion: string | null;
  error: string | null;
};

export const initialClaudeLoginState = (): ClaudeLoginState => ({
  phase: "idle",
  cliPath: null,
  cliVersion: null,
  error: null,
});

export type View = "list" | "detail";

export type TaskDetailStatus = "idle" | "loading" | "ready" | "error";

export type TaskDetailState = {
  taskId: string | null;
  status: TaskDetailStatus;
  verification: ApiTaskVerificationReview | null;
  branch: ApiBranch | null;
  execution: ApiExecution | null;
  testRuns: ApiTestRun[];
  evaluation: ApiEvalRun | null;
  error: string | null;
};

export const initialTaskDetailState = (): TaskDetailState => ({
  taskId: null,
  status: "idle",
  verification: null,
  branch: null,
  execution: null,
  testRuns: [],
  evaluation: null,
  error: null,
});

export type PlanPhase =
  | "idle"
  | "creating"
  | "interviewing"
  | "answering"
  | "generating"
  | "ready"
  | "approving"
  | "approved"
  | "error";

export type PlanState = {
  phase: PlanPhase;
  run: ApiPlannerRun | null;
  goalDraft: string;
  moduleNameDraft: string;
  answersDraft: string;
  error: string | null;
};

export type State = {
  apiUrl: string;
  mode: Mode;
  focus: Pane;
  overlay: Overlay;
  palette: PaletteState;
  auth: AuthState;
  toast: Toast | null;
  bootTrace: string[];
  tasks: TasksState;
  plan: PlanState;
  view: View;
  taskDetail: TaskDetailState;
  claudeLogin: ClaudeLoginState;
  exit: boolean;
};

export const DEFAULT_API_URL = "http://localhost:3000";

export const PALETTE_COMMANDS: readonly PaletteCommand[] = [
  { id: "create-plan", label: "Create plan", hint: "start a planner run for this project" },
  { id: "approve-plan", label: "Approve current plan", hint: "grant planner_review approval" },
  { id: "reset-plan", label: "Reset plan draft", hint: "discard goal/answers and start over" },
  { id: "login-claude", label: "Log in via Claude CLI", hint: "drive the official `claude login` flow" },
  { id: "test-slot", label: "Test Claude slot", hint: "verify planner_deep resolves" },
  { id: "switch-project", label: "Switch project", hint: "open the project picker" },
  { id: "paste-api-key", label: "Paste Anthropic API key", hint: "write to ~/.claude/.credentials.json" },
  { id: "refresh", label: "Refresh", hint: "re-run boot sequence" },
  { id: "quit", label: "Quit", hint: "exit the TUI" },
] as const;

export const initialPlanState = (): PlanState => ({
  phase: "idle",
  run: null,
  goalDraft: "",
  moduleNameDraft: "",
  answersDraft: "",
  error: null,
});

export function initialState(opts: { apiUrl?: string } = {}): State {
  return {
    apiUrl: opts.apiUrl ?? DEFAULT_API_URL,
    mode: { kind: "boot" },
    focus: "control",
    overlay: "none",
    palette: { buffer: "", cursor: 0, commands: [...PALETTE_COMMANDS] },
    auth: { source: null, reason: null, slotResolved: null, slotMessage: null },
    toast: null,
    bootTrace: [],
    tasks: { status: "idle", items: [], cursor: 0, error: null },
    plan: initialPlanState(),
    view: "list",
    taskDetail: initialTaskDetailState(),
    claudeLogin: initialClaudeLoginState(),
    exit: false,
  };
}

export type Action =
  | { type: "boot:start"; apiUrl: string }
  | { type: "boot:trace"; line: string }
  | { type: "boot:health-fail"; apiUrl: string; reason: string }
  | { type: "boot:auth-missing"; reason: string }
  | { type: "boot:projects-loaded"; projects: ApiProject[]; selectedProjectId?: string }
  | { type: "auth:loaded"; source: AuthSource | null; reason: string | null }
  | { type: "auth:slot-result"; ok: boolean; message: string }
  | { type: "project:select"; project: ApiProject }
  | { type: "project:cursor"; delta: 1 | -1 }
  | { type: "focus:rotate"; delta: 1 | -1 }
  | { type: "overlay:open"; overlay: Exclude<Overlay, "none"> }
  | { type: "overlay:close" }
  | { type: "palette:input"; buffer: string }
  | { type: "palette:cursor"; delta: 1 | -1 }
  | { type: "tasks:loading" }
  | { type: "tasks:loaded"; items: ApiTask[] }
  | { type: "tasks:error"; error: string }
  | { type: "tasks:cursor"; delta: 1 | -1 }
  | { type: "view:enter-detail"; taskId: string }
  | { type: "view:exit-detail" }
  | { type: "task-detail:loading" }
  | {
      type: "task-detail:loaded";
      verification: ApiTaskVerificationReview | null;
      branch: ApiBranch | null;
    }
  | { type: "task-detail:error"; error: string }
  | { type: "task-detail:branch-created"; branch: ApiBranch }
  | { type: "task-detail:execution-started"; execution: ApiExecution }
  | { type: "task-detail:test-runs-updated"; testRuns: ApiTestRun[] }
  | { type: "task-detail:evaluation-updated"; evaluation: ApiEvalRun }
  | { type: "claude-login:detect-start" }
  | { type: "claude-login:detected"; cliPath: string; cliVersion: string | null }
  | { type: "claude-login:missing"; reason: string }
  | { type: "claude-login:reset" }
  | { type: "plan:goal-changed"; value: string }
  | { type: "plan:module-changed"; value: string }
  | { type: "plan:answers-changed"; value: string }
  | { type: "plan:create-start" }
  | { type: "plan:created"; run: ApiPlannerRun }
  | { type: "plan:answer-start" }
  | { type: "plan:answered"; run: ApiPlannerRun }
  | { type: "plan:generate-start" }
  | { type: "plan:generated"; run: ApiPlannerRun }
  | { type: "plan:approve-start" }
  | { type: "plan:approved" }
  | { type: "plan:error"; error: string }
  | { type: "plan:reset" }
  | { type: "toast"; toast: Toast | null }
  | { type: "exit" };

export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "boot:start":
      return {
        ...state,
        apiUrl: action.apiUrl,
        mode: { kind: "boot" },
        bootTrace: [],
        toast: null,
      };

    case "boot:trace":
      return { ...state, bootTrace: [...state.bootTrace, action.line] };

    case "boot:health-fail":
      return {
        ...state,
        mode: { kind: "api-offline", apiUrl: action.apiUrl, reason: action.reason },
      };

    case "boot:auth-missing":
      return {
        ...state,
        mode: { kind: "auth-missing", reason: action.reason },
        auth: { source: null, reason: action.reason, slotResolved: null, slotMessage: null },
      };

    case "boot:projects-loaded": {
      const preferred = action.selectedProjectId
        ? action.projects.find((project) => project.id === action.selectedProjectId)
        : undefined;

      const tasksReset: TasksState = { status: "idle", items: [], cursor: 0, error: null };

      if (preferred) {
        return {
          ...state,
          mode: { kind: "ready", project: preferred },
          tasks: tasksReset,
          view: "list",
          taskDetail: initialTaskDetailState(),
        };
      }

      return {
        ...state,
        mode: { kind: "project-picker", projects: action.projects, cursor: 0 },
        tasks: tasksReset,
        view: "list",
        taskDetail: initialTaskDetailState(),
      };
    }

    case "auth:loaded":
      return {
        ...state,
        auth: {
          source: action.source,
          reason: action.reason,
          slotResolved: state.auth.slotResolved,
          slotMessage: state.auth.slotMessage,
        },
      };

    case "auth:slot-result":
      return {
        ...state,
        auth: {
          ...state.auth,
          slotResolved: action.ok,
          slotMessage: action.message,
        },
      };

    case "project:select":
      return {
        ...state,
        mode: { kind: "ready", project: action.project },
        overlay: state.overlay === "palette" ? "none" : state.overlay,
        tasks: { status: "idle", items: [], cursor: 0, error: null },
        view: "list",
        taskDetail: initialTaskDetailState(),
      };

    case "project:cursor": {
      if (state.mode.kind !== "project-picker") return state;
      const total = state.mode.projects.length + 1;
      if (total === 0) return state;
      const next = wrap(state.mode.cursor + action.delta, total);
      return { ...state, mode: { ...state.mode, cursor: next } };
    }

    case "focus:rotate": {
      if (state.overlay !== "none") return state;
      const idx = PANE_ORDER.indexOf(state.focus);
      const next = wrap(idx + action.delta, PANE_ORDER.length);
      const pane = PANE_ORDER[next] ?? state.focus;
      return { ...state, focus: pane };
    }

    case "overlay:open":
      return { ...state, overlay: action.overlay };

    case "overlay:close":
      return {
        ...state,
        overlay: "none",
        palette: { ...state.palette, buffer: "", cursor: 0 },
      };

    case "palette:input": {
      const filtered = filterCommands(action.buffer);
      const cursor = filtered.length === 0 ? 0 : Math.min(state.palette.cursor, filtered.length - 1);
      return {
        ...state,
        palette: { buffer: action.buffer, cursor, commands: filtered },
      };
    }

    case "palette:cursor": {
      const total = state.palette.commands.length;
      if (total === 0) return state;
      const next = wrap(state.palette.cursor + action.delta, total);
      return { ...state, palette: { ...state.palette, cursor: next } };
    }

    case "tasks:loading":
      return {
        ...state,
        tasks: { status: "loading", items: [], cursor: 0, error: null },
      };

    case "tasks:loaded": {
      const cursor = action.items.length === 0
        ? 0
        : Math.min(state.tasks.cursor, action.items.length - 1);
      return {
        ...state,
        tasks: { status: "ready", items: action.items, cursor, error: null },
      };
    }

    case "tasks:error":
      return {
        ...state,
        tasks: { status: "error", items: [], cursor: 0, error: action.error },
      };

    case "tasks:cursor": {
      if (state.tasks.items.length === 0) return state;
      const next = wrap(state.tasks.cursor + action.delta, state.tasks.items.length);
      return { ...state, tasks: { ...state.tasks, cursor: next } };
    }

    case "view:enter-detail":
      return {
        ...state,
        view: "detail",
        focus: "control",
        taskDetail: { ...initialTaskDetailState(), taskId: action.taskId },
      };

    case "view:exit-detail":
      return {
        ...state,
        view: "list",
        taskDetail: initialTaskDetailState(),
      };

    case "task-detail:loading":
      return {
        ...state,
        taskDetail: { ...state.taskDetail, status: "loading", error: null },
      };

    case "task-detail:loaded":
      return {
        ...state,
        taskDetail: {
          ...state.taskDetail,
          status: "ready",
          verification: action.verification,
          branch: action.branch,
          error: null,
        },
      };

    case "task-detail:error":
      return {
        ...state,
        taskDetail: { ...state.taskDetail, status: "error", error: action.error },
      };

    case "task-detail:branch-created":
      return {
        ...state,
        taskDetail: { ...state.taskDetail, branch: action.branch },
      };

    case "task-detail:execution-started":
      return {
        ...state,
        taskDetail: {
          ...state.taskDetail,
          execution: action.execution,
          testRuns: [],
          evaluation: null,
        },
      };

    case "task-detail:test-runs-updated":
      return {
        ...state,
        taskDetail: { ...state.taskDetail, testRuns: action.testRuns },
      };

    case "task-detail:evaluation-updated":
      return {
        ...state,
        taskDetail: { ...state.taskDetail, evaluation: action.evaluation },
      };

    case "claude-login:detect-start":
      return {
        ...state,
        claudeLogin: { ...state.claudeLogin, phase: "detecting", error: null },
      };

    case "claude-login:detected":
      return {
        ...state,
        claudeLogin: {
          phase: "detected",
          cliPath: action.cliPath,
          cliVersion: action.cliVersion,
          error: null,
        },
      };

    case "claude-login:missing":
      return {
        ...state,
        claudeLogin: {
          phase: "missing",
          cliPath: null,
          cliVersion: null,
          error: action.reason,
        },
      };

    case "claude-login:reset":
      return { ...state, claudeLogin: initialClaudeLoginState() };

    case "plan:goal-changed":
      return { ...state, plan: { ...state.plan, goalDraft: action.value } };

    case "plan:module-changed":
      return { ...state, plan: { ...state.plan, moduleNameDraft: action.value } };

    case "plan:answers-changed":
      return { ...state, plan: { ...state.plan, answersDraft: action.value } };

    case "plan:create-start":
      return {
        ...state,
        plan: { ...state.plan, phase: "creating", error: null },
      };

    case "plan:created":
      return {
        ...state,
        plan: {
          ...state.plan,
          phase: action.run.status === "interviewing" ? "interviewing" : "generating",
          run: action.run,
          error: null,
        },
      };

    case "plan:answer-start":
      return {
        ...state,
        plan: { ...state.plan, phase: "answering", error: null },
      };

    case "plan:answered":
      return {
        ...state,
        plan: {
          ...state.plan,
          phase: action.run.status === "interviewing" ? "interviewing" : "generating",
          run: action.run,
          answersDraft: action.run.status === "interviewing" ? state.plan.answersDraft : "",
          error: null,
        },
      };

    case "plan:generate-start":
      return {
        ...state,
        plan: { ...state.plan, phase: "generating", error: null },
      };

    case "plan:generated":
      return {
        ...state,
        plan: { ...state.plan, phase: "ready", run: action.run, error: null },
      };

    case "plan:approve-start":
      return {
        ...state,
        plan: { ...state.plan, phase: "approving", error: null },
      };

    case "plan:approved":
      return {
        ...state,
        overlay: state.overlay === "plan" ? "none" : state.overlay,
        plan: { ...state.plan, phase: "approved" },
      };

    case "plan:error":
      return {
        ...state,
        plan: { ...state.plan, phase: "error", error: action.error },
      };

    case "plan:reset":
      return { ...state, plan: initialPlanState() };

    case "toast":
      return { ...state, toast: action.toast };

    case "exit":
      return { ...state, exit: true };
  }
}

export function filterCommands(buffer: string): PaletteCommand[] {
  const trimmed = buffer.trim().toLowerCase();
  if (trimmed.length === 0) return [...PALETTE_COMMANDS];
  return PALETTE_COMMANDS.filter((command) => {
    return (
      command.id.toLowerCase().includes(trimmed) ||
      command.label.toLowerCase().includes(trimmed) ||
      command.hint.toLowerCase().includes(trimmed)
    );
  });
}

function wrap(index: number, length: number): number {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}
