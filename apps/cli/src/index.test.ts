import { describe, expect, test } from "vitest";
import type { LoopEvent } from "@vimbuspromax3000/shared";
import { applyLiveViewEvents, createLiveViewState } from "./live";
import {
  createTuiKeyboardState,
  handleTuiKeyEvent,
  resolveStartupProject,
  resolveStartupProjectSelection,
  shouldOpenProjectCreateFolderBrowser,
} from "./index";
import type { UserState } from "./userState";

const projectOne = {
  id: "project_1",
  name: "API",
  rootPath: "C:\\repo\\api",
  baseBranch: "main",
};

const projectTwo = {
  id: "project_2",
  name: "Web",
  rootPath: "C:\\repo\\web",
  baseBranch: "main",
};

function responseJson(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

describe("TUI entrypoint adapters", () => {
  test("resolves startup project from valid user state when no explicit project is passed", async () => {
    const requests: string[] = [];
    const request = async (input: string | URL | Request) => {
      requests.push(String(input));
      return responseJson(projectOne);
    };
    const state: UserState = {
      version: 1,
      lastSelectedProjectId: "project_1",
      recentProjects: [],
    };

    const project = await resolveStartupProject({
      apiUrl: "http://localhost:3000",
      userState: state,
      fetch: request as typeof fetch,
    });

    expect(project?.id).toBe("project_1");
    expect(requests).toEqual(["http://localhost:3000/projects/project_1"]);
  });

  test("falls back to the project picker instead of latest-project auto-load", async () => {
    const request = async () => responseJson([projectOne, projectTwo]);

    const resolution = await resolveStartupProjectSelection({
      apiUrl: "http://localhost:3000",
      userState: { version: 1, recentProjects: [] },
      fetch: request as typeof fetch,
    });

    expect(resolution.kind).toBe("picker");
    expect(resolution.snapshot).toContain("Project picker");
    if (resolution.kind === "picker") {
      expect(resolution.picker.projects.map((project) => project.id)).toEqual(["project_1", "project_2"]);
    }
  });

  test("dispatches documented global shortcuts through the adapter", () => {
    let state = createTuiKeyboardState();

    let result = handleTuiKeyEvent(state, "f1");
    expect(result.handled).toBe(true);
    expect(result.state.focus.focusedPaneId).toBe("reviews");
    state = result.state;

    result = handleTuiKeyEvent(state, "f2");
    expect(result.state.focus.focusedPaneId).toBe("tasks");
    state = result.state;

    result = handleTuiKeyEvent(state, "f3");
    expect(result.state.focus.focusedPaneId).toBe("projects");
    state = result.state;

    result = handleTuiKeyEvent(state, "f4");
    expect(result.state.focus.focusedPaneId).toBe("logs");
    state = result.state;

    result = handleTuiKeyEvent(state, { name: "k", ctrl: true });
    expect(result.state.commandPalette.isOpen).toBe(true);
    state = result.state;

    result = handleTuiKeyEvent(state, "?");
    expect(result.state.helpOverlay.isOpen).toBe(true);
  });

  test("acknowledges live notifications through the dispatcher", () => {
    const event: LoopEvent = {
      id: "evt_notify",
      projectId: "project_1",
      type: "operator.notification",
      payload: { severity: "warn", subjectType: "eval_run", subjectId: "eval_1" },
      createdAt: "2026-05-11T10:00:00.000Z",
    };
    const liveView = applyLiveViewEvents(createLiveViewState(), [event]);

    const result = handleTuiKeyEvent(createTuiKeyboardState({ liveView }), "n");

    expect(result.handled).toBe(true);
    expect(result.state.liveView.notifications).toHaveLength(0);
  });

  test("leaves notification ack key alone while a slash command is being edited", () => {
    const event: LoopEvent = {
      id: "evt_notify",
      projectId: "project_1",
      type: "operator.notification",
      payload: { severity: "warn", subjectType: "eval_run", subjectId: "eval_1" },
      createdAt: "2026-05-11T10:00:00.000Z",
    };
    const liveView = applyLiveViewEvents(createLiveViewState(), [event]);
    const state = createTuiKeyboardState({ liveView });

    const result = handleTuiKeyEvent(state, "n", { commandInputValue: "/pla" });

    expect(result.handled).toBe(false);
    expect(result.state).toBe(state);
    expect(result.state.liveView.notifications).toHaveLength(1);
  });

  test("leaves question mark input alone while a slash command is being edited", () => {
    const state = createTuiKeyboardState();

    const result = handleTuiKeyEvent(state, "?", { commandInputValue: "/review:list " });

    expect(result.handled).toBe(false);
    expect(result.state).toBe(state);
  });

  test("detects no-arg project create as the interactive folder-browser fallback", () => {
    expect(shouldOpenProjectCreateFolderBrowser("/projects:create")).toBe(true);
    expect(shouldOpenProjectCreateFolderBrowser("  /projects:create  ")).toBe(true);
    expect(shouldOpenProjectCreateFolderBrowser("/projects:create --root-path C:\\repo")).toBe(false);
    expect(shouldOpenProjectCreateFolderBrowser("/projects:create --name API")).toBe(false);
  });
});
