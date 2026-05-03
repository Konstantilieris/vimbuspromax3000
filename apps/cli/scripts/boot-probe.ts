// Probe that exercises the TUI's boot pipeline end-to-end without OpenTUI
// rendering. Drives runBootEffect with a captured dispatch and prints each
// action so we can verify the live integration without needing a TTY.

import { createApiClient } from "@vimbuspromax3000/api-client";
import {
  runBootEffect,
  selectProjectEffect,
  runSlotTestEffect,
} from "../src/tui/effects";
import { initialState, reduce, type Action, type State } from "../src/tui/state";

const apiUrl = process.env.VIMBUS_API_URL ?? "http://localhost:3000";
const stage = process.argv[2] ?? "boot";

const client = createApiClient({ baseUrl: apiUrl });
let state: State = initialState({ apiUrl: client.baseUrl });

const actions: Action[] = [];
const dispatch = (action: Action): void => {
  actions.push(action);
  state = reduce(state, action);
};

function describeAction(action: Action): string {
  switch (action.type) {
    case "boot:start":
      return `boot:start apiUrl=${action.apiUrl}`;
    case "boot:trace":
      return `trace: ${action.line}`;
    case "boot:health-fail":
      return `boot:health-fail apiUrl=${action.apiUrl} reason="${action.reason}"`;
    case "boot:auth-missing":
      return `boot:auth-missing reason="${action.reason}"`;
    case "boot:projects-loaded":
      return `boot:projects-loaded count=${action.projects.length} selectedProjectId=${action.selectedProjectId ?? "(none)"}`;
    case "auth:loaded":
      return `auth:loaded source=${action.source ?? "null"} reason="${action.reason ?? ""}"`;
    case "auth:slot-result":
      return `auth:slot-result ok=${action.ok} message="${action.message}"`;
    case "project:select":
      return `project:select id=${action.project.id} name=${action.project.name}`;
    case "project:cursor":
      return `project:cursor delta=${action.delta}`;
    case "focus:rotate":
      return `focus:rotate delta=${action.delta}`;
    case "overlay:open":
      return `overlay:open ${action.overlay}`;
    case "overlay:close":
      return "overlay:close";
    case "palette:input":
      return `palette:input "${action.buffer}"`;
    case "palette:cursor":
      return `palette:cursor delta=${action.delta}`;
    case "tasks:loading":
      return "tasks:loading";
    case "tasks:loaded":
      return `tasks:loaded count=${action.items.length}`;
    case "tasks:error":
      return `tasks:error reason="${action.error}"`;
    case "tasks:cursor":
      return `tasks:cursor delta=${action.delta}`;
    case "view:enter-detail":
      return `view:enter-detail taskId=${action.taskId}`;
    case "view:exit-detail":
      return "view:exit-detail";
    case "task-detail:loading":
      return "task-detail:loading";
    case "task-detail:loaded":
      return `task-detail:loaded verification=${action.verification ? "yes" : "no"} branch=${action.branch ? "yes" : "no"}`;
    case "task-detail:error":
      return `task-detail:error error="${action.error}"`;
    case "task-detail:branch-created":
      return `task-detail:branch-created ${action.branch.branchName}`;
    case "task-detail:execution-started":
      return `task-detail:execution-started ${action.execution.id}`;
    case "task-detail:test-runs-updated":
      return `task-detail:test-runs-updated count=${action.testRuns.length}`;
    case "task-detail:evaluation-updated":
      return `task-detail:evaluation-updated ${action.evaluation.id}`;
    case "plan:goal-changed":
      return `plan:goal-changed value="${action.value}"`;
    case "plan:module-changed":
      return `plan:module-changed value="${action.value}"`;
    case "plan:answers-changed":
      return `plan:answers-changed bytes=${action.value.length}`;
    case "plan:create-start":
      return "plan:create-start";
    case "plan:created":
      return `plan:created run=${action.run.id} status=${action.run.status}`;
    case "plan:answer-start":
      return "plan:answer-start";
    case "plan:answered":
      return `plan:answered status=${action.run.status}`;
    case "plan:generate-start":
      return "plan:generate-start";
    case "plan:generated":
      return `plan:generated status=${action.run.status}`;
    case "plan:approve-start":
      return "plan:approve-start";
    case "plan:approved":
      return "plan:approved";
    case "plan:error":
      return `plan:error error="${action.error}"`;
    case "plan:reset":
      return "plan:reset";
    case "claude-login:detect-start":
      return "claude-login:detect-start";
    case "claude-login:detected":
      return `claude-login:detected path=${action.cliPath} version=${action.cliVersion ?? "?"}`;
    case "claude-login:missing":
      return `claude-login:missing reason="${action.reason}"`;
    case "claude-login:reset":
      return "claude-login:reset";
    case "toast":
      return `toast: ${action.toast ? `${action.toast.kind}: ${action.toast.text}` : "null"}`;
    case "exit":
      return "exit";
  }
}

async function probeBoot(): Promise<void> {
  await runBootEffect({ client, apiUrl: client.baseUrl }, dispatch);
  for (const action of actions) {
    console.log(`  ${describeAction(action)}`);
  }
  console.log("");
  console.log(`final mode: ${state.mode.kind}`);
  console.log(`final auth.source: ${state.auth.source ?? "null"}`);
  console.log(`final auth.slotResolved: ${state.auth.slotResolved ?? "null"}`);
}

async function probeSelect(): Promise<void> {
  const projects = await client.listProjects();
  if (projects.length === 0) {
    console.log("no projects available; create one first");
    return;
  }
  const project = projects[0]!;
  console.log(`selecting project ${project.id} (${project.name})`);
  await selectProjectEffect({ client, apiUrl: client.baseUrl }, project, dispatch);
  for (const action of actions) {
    console.log(`  ${describeAction(action)}`);
  }
  console.log("");
  console.log(`final mode: ${state.mode.kind}`);
  console.log(`final auth.slotResolved: ${state.auth.slotResolved ?? "null"}`);
  console.log(`final auth.slotMessage: ${state.auth.slotMessage ?? "null"}`);
}

async function probeSlot(): Promise<void> {
  const projects = await client.listProjects();
  if (projects.length === 0) {
    console.log("no projects available");
    return;
  }
  const project = projects[0]!;
  console.log(`testing slot for project ${project.id} (${project.name})`);
  await runSlotTestEffect({ client, apiUrl: client.baseUrl }, project.id, dispatch);
  for (const action of actions) {
    console.log(`  ${describeAction(action)}`);
  }
}

async function main(): Promise<void> {
  console.log(`stage=${stage} apiUrl=${client.baseUrl}`);
  console.log("---");
  switch (stage) {
    case "boot":
      await probeBoot();
      break;
    case "select":
      await probeSelect();
      break;
    case "slot":
      await probeSlot();
      break;
    default:
      console.log(`unknown stage: ${stage}`);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error("probe failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
