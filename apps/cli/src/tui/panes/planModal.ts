import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import type { ApiPlannerRun } from "@vimbuspromax3000/api-client";
import type { PlanState, State } from "../state";

export type PlanModalField = "goal" | "module" | "answers";

export type PlanModalSubmit =
  | { kind: "create"; goal: string; moduleName: string }
  | { kind: "answers"; runId: string; answers: string }
  | { kind: "approve"; runId: string }
  | { kind: "regenerate"; runId: string };

export type PlanModalCallbacks = {
  onChange: (field: PlanModalField, value: string) => void;
  onSubmit: (submit: PlanModalSubmit) => void;
  onClose: () => void;
};

export type PlanModalPane = {
  root: BoxRenderable;
  update(state: State): void;
  focus(): void;
  reset(): void;
  setCallbacks(callbacks: PlanModalCallbacks): void;
  triggerSubmit(): void;
};

const ACCENT = "#3CA0FF";
const FG = "#C9D2DB";
const TITLE_FG = "#E7EDF3";
const MUTED = "#7B8794";
const ERROR_FG = "#F5736E";
const OK_FG = "#A8E6A3";

export function createPlanModal(renderer: CliRenderer): PlanModalPane {
  let callbacks: PlanModalCallbacks | null = null;
  let activePhase: PlanState["phase"] = "idle";
  let activeRunId: string | null = null;

  const root = new BoxRenderable(renderer, {
    id: "plan-modal",
    width: 80,
    height: 22,
    padding: 1,
    border: true,
    borderColor: ACCENT,
    backgroundColor: "#0D131A",
    position: "absolute",
    top: 3,
    left: 4,
    zIndex: 65,
    flexDirection: "column",
  });

  const heading = new TextRenderable(renderer, {
    id: "plan-heading",
    content: "Create plan",
    fg: TITLE_FG,
    attributes: 0b001,
  });

  const subhead = new TextRenderable(renderer, {
    id: "plan-subhead",
    content: "",
    fg: MUTED,
  });

  const goalLabel = new TextRenderable(renderer, {
    id: "plan-goal-label",
    content: "Goal",
    fg: FG,
  });

  const goalInput = new InputRenderable(renderer, {
    id: "plan-goal-input",
    placeholder: "describe what should be built…",
    width: 76,
    backgroundColor: "#11181F",
    focusedBackgroundColor: "#11181F",
  });

  const moduleLabel = new TextRenderable(renderer, {
    id: "plan-module-label",
    content: "Module (optional)",
    fg: FG,
  });

  const moduleInput = new InputRenderable(renderer, {
    id: "plan-module-input",
    placeholder: "e.g. auth, billing, onboarding",
    width: 76,
    backgroundColor: "#11181F",
    focusedBackgroundColor: "#11181F",
  });

  const interviewLabel = new TextRenderable(renderer, {
    id: "plan-interview-label",
    content: "Pending interview — paste an answers JSON object",
    fg: FG,
  });

  const interviewBlob = new TextRenderable(renderer, {
    id: "plan-interview-blob",
    content: "",
    fg: MUTED,
  });

  const answersInput = new InputRenderable(renderer, {
    id: "plan-answers-input",
    placeholder: '{"key": "value"}',
    width: 76,
    backgroundColor: "#11181F",
    focusedBackgroundColor: "#11181F",
  });

  const proposalSummary = new TextRenderable(renderer, {
    id: "plan-proposal-summary",
    content: "",
    fg: FG,
  });

  const proposalBody = new TextRenderable(renderer, {
    id: "plan-proposal-body",
    content: "",
    fg: FG,
  });

  const errorLine = new TextRenderable(renderer, {
    id: "plan-error",
    content: "",
    fg: ERROR_FG,
  });

  const footer = new TextRenderable(renderer, {
    id: "plan-footer",
    content: "Esc cancel",
    fg: MUTED,
  });

  root.add(heading);
  root.add(subhead);
  root.add(goalLabel);
  root.add(goalInput);
  root.add(moduleLabel);
  root.add(moduleInput);
  root.add(interviewLabel);
  root.add(interviewBlob);
  root.add(answersInput);
  root.add(proposalSummary);
  root.add(proposalBody);
  root.add(errorLine);
  root.add(footer);

  goalInput.on(InputRenderableEvents.INPUT, () => {
    callbacks?.onChange("goal", goalInput.value);
  });
  goalInput.on(InputRenderableEvents.ENTER, () => {
    if (activePhase === "idle" || activePhase === "error") {
      callbacks?.onSubmit({
        kind: "create",
        goal: goalInput.value.trim(),
        moduleName: moduleInput.value.trim(),
      });
    }
  });

  moduleInput.on(InputRenderableEvents.INPUT, () => {
    callbacks?.onChange("module", moduleInput.value);
  });
  moduleInput.on(InputRenderableEvents.ENTER, () => {
    if (activePhase === "idle" || activePhase === "error") {
      callbacks?.onSubmit({
        kind: "create",
        goal: goalInput.value.trim(),
        moduleName: moduleInput.value.trim(),
      });
    }
  });

  answersInput.on(InputRenderableEvents.INPUT, () => {
    callbacks?.onChange("answers", answersInput.value);
  });
  answersInput.on(InputRenderableEvents.ENTER, () => {
    if (activePhase === "interviewing" && activeRunId) {
      callbacks?.onSubmit({
        kind: "answers",
        runId: activeRunId,
        answers: answersInput.value.trim(),
      });
    }
  });

  function update(state: State): void {
    activePhase = state.plan.phase;
    activeRunId = state.plan.run?.id ?? null;

    const showCreateForm =
      state.plan.phase === "idle" ||
      state.plan.phase === "creating" ||
      state.plan.phase === "error" && state.plan.run === null;
    const showInterview =
      state.plan.phase === "interviewing" || state.plan.phase === "answering";
    const showProposal =
      state.plan.phase === "ready" ||
      state.plan.phase === "approving" ||
      state.plan.phase === "approved" ||
      (state.plan.phase === "error" && state.plan.run !== null);
    const showSpinner =
      state.plan.phase === "creating" ||
      state.plan.phase === "answering" ||
      state.plan.phase === "generating" ||
      state.plan.phase === "approving";

    heading.content = describeHeading(state.plan.phase);
    subhead.content = describeSubhead(state, showSpinner);

    setVisible(goalLabel, showCreateForm);
    setVisible(goalInput, showCreateForm);
    setVisible(moduleLabel, showCreateForm);
    setVisible(moduleInput, showCreateForm);

    setVisible(interviewLabel, showInterview);
    setVisible(interviewBlob, showInterview);
    setVisible(answersInput, showInterview);
    if (showInterview) {
      interviewBlob.content = describeInterview(state.plan.run);
      if (answersInput.value !== state.plan.answersDraft) {
        answersInput.value = state.plan.answersDraft;
      }
    }

    setVisible(proposalSummary, showProposal);
    setVisible(proposalBody, showProposal);
    if (showProposal && state.plan.run) {
      proposalSummary.content = describeProposalSummary(state.plan.run);
      proposalBody.content = describeProposalBody(state.plan.run);
    }

    if (state.plan.error) {
      errorLine.content = `error: ${state.plan.error}`;
    } else {
      errorLine.content = "";
    }

    footer.content = describeFooter(state.plan.phase);
    footer.fg = state.plan.phase === "approved" ? OK_FG : MUTED;
  }

  function focus(): void {
    if (activePhase === "interviewing") {
      answersInput.focus();
    } else {
      goalInput.focus();
    }
  }

  function reset(): void {
    goalInput.value = "";
    moduleInput.value = "";
    answersInput.value = "";
  }

  function triggerSubmit(): void {
    if (activePhase === "ready" && activeRunId) {
      callbacks?.onSubmit({ kind: "approve", runId: activeRunId });
    }
  }

  return {
    root,
    update,
    focus,
    reset,
    triggerSubmit,
    setCallbacks(next) {
      callbacks = next;
    },
  };
}

function describeHeading(phase: PlanState["phase"]): string {
  switch (phase) {
    case "idle":
      return "Create plan";
    case "creating":
      return "Creating planner run…";
    case "interviewing":
      return "Planner interview";
    case "answering":
      return "Submitting answers…";
    case "generating":
      return "Generating proposal…";
    case "ready":
      return "Plan ready for approval";
    case "approving":
      return "Approving plan…";
    case "approved":
      return "Plan approved";
    case "error":
      return "Plan error";
  }
}

function describeSubhead(state: State, spinner: boolean): string {
  if (state.mode.kind !== "ready") {
    return "(open a project before creating a plan)";
  }
  const project = `project ${state.mode.project.name}`;
  const lastTrace = state.bootTrace[state.bootTrace.length - 1];
  if (spinner && lastTrace) return `${project}  •  ${lastTrace}`;
  return project;
}

function describeInterview(run: ApiPlannerRun | null): string {
  if (!run) return "(no run loaded)";
  const interview = run.interview ?? {};
  const keys = Object.keys(interview);
  if (keys.length === 0) {
    return "Interview is empty. Submit {} to advance.";
  }
  try {
    return JSON.stringify(interview, null, 2).split("\n").slice(0, 8).join("\n");
  } catch {
    return `(${keys.length} keys: ${keys.join(", ")})`;
  }
}

function describeProposalSummary(run: ApiPlannerRun): string {
  const summary = run.proposalSummary;
  if (!summary) return `Run ${run.id} status=${run.status}`;
  return `Run ${run.id}  •  epics=${summary.epicCount}  tasks=${summary.taskCount}  verification=${summary.verificationPlanCount}`;
}

function describeProposalBody(run: ApiPlannerRun): string {
  const epics = run.epics ?? [];
  if (epics.length === 0) return "(no epics in proposal)";
  const lines: string[] = [];
  for (const epic of epics.slice(0, 6)) {
    lines.push(`▸ ${epic.key}  ${epic.title}  (${epic.tasks.length})`);
    for (const task of epic.tasks.slice(0, 3)) {
      lines.push(`   ${task.status.padEnd(10)} ${task.stableId.padEnd(12)} ${task.title}`);
    }
    if (epic.tasks.length > 3) {
      lines.push(`   … ${epic.tasks.length - 3} more`);
    }
  }
  if (epics.length > 6) {
    lines.push(`… ${epics.length - 6} more epics`);
  }
  return lines.join("\n");
}

function describeFooter(phase: PlanState["phase"]): string {
  switch (phase) {
    case "idle":
    case "error":
      return "Enter submit  •  Esc cancel";
    case "interviewing":
      return "Enter submit answers  •  Esc cancel";
    case "ready":
      return "[a] approve  •  [g] regenerate  •  Esc close";
    case "approved":
      return "approved — Esc to close";
    default:
      return "Esc cancel";
  }
}

function setVisible(node: TextRenderable | InputRenderable, visible: boolean): void {
  // OpenTUI does not expose hide/show on these renderables in this version, so
  // we collapse content/value when hidden. Reuse-friendly: callers always assign
  // fresh content when visible=true.
  if (!visible) {
    if (node instanceof TextRenderable) {
      node.content = "";
    } else {
      // Leave value alone — input drafts are owned by the reducer slice.
    }
  }
}
