import {
  BoxRenderable,
  TextRenderable,
  createCliRenderer,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";
import { createApiClient } from "@vimbuspromax3000/api-client";
import {
  initialState,
  reduce,
  type Action,
  type Pane,
  type State,
} from "./state";
import {
  loadTaskDetailEffect,
  pasteApiKeyEffect,
  refreshAuthEffect,
  runApprovePlanEffect,
  runBootEffect,
  runCreateBranchEffect,
  runCreatePlanEffect,
  runAnswerPlanEffect,
  runDetectClaudeCliEffect,
  runEvaluatePatchEffect,
  runGeneratePlanEffect,
  runRefreshTestRunsEffect,
  runSlotTestEffect,
  runStartExecutionEffect,
  runStartTestRunsEffect,
  selectProjectEffect,
  type EffectDeps,
} from "./effects";
import { createHeader } from "./panes/header";
import { createStatusBar } from "./panes/statusBar";
import { createTasks } from "./panes/tasks";
import { createControl } from "./panes/control";
import { createLogs } from "./panes/logs";
import { createHelp } from "./panes/help";
import { createPalette } from "./panes/palette";
import { createProjectPicker } from "./panes/projectPicker";
import { createApiKeyModal } from "./panes/apiKeyModal";
import { createPlanModal } from "./panes/planModal";
import { createClaudeLoginModal } from "./panes/claudeLoginModal";

export type LaunchTuiOptions = {
  apiUrl?: string;
};

export async function launchTui(options: LaunchTuiOptions = {}): Promise<void> {
  const apiUrl = options.apiUrl ?? process.env.VIMBUS_API_URL ?? "http://localhost:3000";
  const client = createApiClient({ baseUrl: apiUrl });
  const deps: EffectDeps = { client, apiUrl: client.baseUrl };

  const renderer = await createCliRenderer({ exitOnCtrlC: true, targetFps: 30 });

  const root = new BoxRenderable(renderer, {
    id: "root",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    backgroundColor: "#0B1014",
  });
  renderer.root.add(root);

  const header = createHeader(renderer);

  const main = new BoxRenderable(renderer, {
    id: "main",
    width: "100%",
    flexGrow: 1,
    flexDirection: "row",
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 1,
    paddingBottom: 1,
  });

  const tasks = createTasks(renderer);
  const control = createControl(renderer);
  const logs = createLogs(renderer);
  main.add(tasks.root);
  main.add(control.root);
  main.add(logs.root);

  const status = createStatusBar(renderer);

  root.add(header.root);
  root.add(main);
  root.add(status.root);

  const help = createHelp(renderer);
  const palette = createPalette(renderer);
  const projectPicker = createProjectPicker(renderer);
  const apiKeyModal = createApiKeyModal(renderer);
  const planModal = createPlanModal(renderer);
  const claudeLoginModal = createClaudeLoginModal(renderer);
  planModal.setCallbacks({
    onChange: (field, value) => {
      if (field === "goal") dispatch({ type: "plan:goal-changed", value });
      else if (field === "module") dispatch({ type: "plan:module-changed", value });
      else dispatch({ type: "plan:answers-changed", value });
    },
    onSubmit: (submit) => {
      if (submit.kind === "create") {
        if (state.mode.kind !== "ready") return;
        if (!submit.goal) {
          dispatch({ type: "plan:error", error: "Goal is required." });
          return;
        }
        const projectId = state.mode.project.id;
        const moduleName = submit.moduleName.length > 0 ? submit.moduleName : undefined;
        void runCreatePlanEffect(deps, { projectId, goal: submit.goal, moduleName }, dispatch);
        return;
      }
      if (submit.kind === "answers") {
        void runAnswerPlanEffect(deps, submit.runId, submit.answers || "{}", dispatch);
        return;
      }
      if (submit.kind === "approve") {
        if (state.mode.kind !== "ready") return;
        void runApprovePlanEffect(deps, state.mode.project.id, submit.runId, dispatch);
        return;
      }
      if (submit.kind === "regenerate") {
        void runGeneratePlanEffect(deps, submit.runId, dispatch);
      }
    },
    onClose: () => dispatch({ type: "overlay:close" }),
  });

  let state: State = initialState({ apiUrl });
  let currentOverlay: State["overlay"] = "none";
  let pickerMounted = false;

  const dispatch = (action: Action): void => {
    state = reduce(state, action);
    render();
  };

  function focusPane(pane: Pane): void {
    const target =
      pane === "tasks" ? tasks.root : pane === "control" ? control.root : logs.root;
    target.focus();
  }

  function syncOverlay(): void {
    const next = state.overlay;
    if (next === currentOverlay) {
      // overlay didn't toggle, but contents may have updated
      if (next === "palette") palette.update(state);
      return;
    }

    if (currentOverlay === "palette") {
      root.remove(palette.root.id);
    } else if (currentOverlay === "help") {
      root.remove(help.root.id);
    } else if (currentOverlay === "api-key") {
      root.remove(apiKeyModal.root.id);
    } else if (currentOverlay === "plan") {
      root.remove(planModal.root.id);
    } else if (currentOverlay === "claude-login") {
      root.remove(claudeLoginModal.root.id);
    }

    if (next === "palette") {
      root.add(palette.root);
      palette.reset();
      palette.update(state);
      palette.focus();
    } else if (next === "help") {
      root.add(help.root);
    } else if (next === "api-key") {
      root.add(apiKeyModal.root);
      apiKeyModal.reset();
      apiKeyModal.focus();
    } else if (next === "plan") {
      root.add(planModal.root);
      planModal.update(state);
      planModal.focus();
    } else if (next === "claude-login") {
      root.add(claudeLoginModal.root);
      claudeLoginModal.update(state);
      void runDetectClaudeCliEffect(dispatch);
    } else {
      focusPane(state.focus);
    }

    currentOverlay = next;
  }

  function syncProjectPicker(): void {
    const shouldShow = state.mode.kind === "project-picker";
    if (shouldShow && !pickerMounted) {
      root.add(projectPicker.root);
      pickerMounted = true;
    } else if (!shouldShow && pickerMounted) {
      root.remove(projectPicker.root.id);
      pickerMounted = false;
    }
    if (shouldShow) {
      projectPicker.update(state);
    }
  }

  function render(): void {
    header.update(state);
    tasks.update(state);
    control.update(state);
    logs.update(state);
    status.update(state);
    syncProjectPicker();
    syncOverlay();
    if (state.overlay === "plan") {
      planModal.update(state);
    }
    if (state.overlay === "claude-login") {
      claudeLoginModal.update(state);
    }
    if (state.exit) {
      renderer.destroy();
    }
  }

  palette.onInput((value) => dispatch({ type: "palette:input", buffer: value }));
  apiKeyModal.onSubmit((value) => {
    dispatch({ type: "overlay:close" });
    void pasteApiKeyEffect(value, dispatch);
  });

  renderer.keyInput.on("keypress", (event: KeyEvent) => {
    handleKey(event);
  });

  function handleKey(event: KeyEvent): void {
    if (state.overlay === "help") {
      if (event.name === "escape" || event.name === "?") {
        dispatch({ type: "overlay:close" });
      }
      return;
    }

    if (state.overlay === "api-key") {
      if (event.name === "escape") dispatch({ type: "overlay:close" });
      return;
    }

    if (state.overlay === "claude-login") {
      if (event.name === "escape") {
        void refreshAuthEffect(dispatch);
        dispatch({ type: "overlay:close" });
        return;
      }
      if (event.name === "d") {
        void runDetectClaudeCliEffect(dispatch);
        return;
      }
      if (event.name === "r") {
        void refreshAuthEffect(dispatch);
        return;
      }
      return;
    }

    if (state.overlay === "plan") {
      if (event.name === "escape") {
        dispatch({ type: "overlay:close" });
        return;
      }
      if (state.plan.phase === "ready" && state.plan.run) {
        if (event.name === "a") {
          if (state.mode.kind !== "ready") return;
          void runApprovePlanEffect(deps, state.mode.project.id, state.plan.run.id, dispatch);
          return;
        }
        if (event.name === "g") {
          void runGeneratePlanEffect(deps, state.plan.run.id, dispatch);
          return;
        }
      }
      return;
    }

    if (state.overlay === "palette") {
      if (event.name === "escape") {
        dispatch({ type: "overlay:close" });
        return;
      }
      if (event.name === "up") {
        dispatch({ type: "palette:cursor", delta: -1 });
        return;
      }
      if (event.name === "down") {
        dispatch({ type: "palette:cursor", delta: 1 });
        return;
      }
      if (event.name === "return") {
        runPaletteAction();
      }
      return;
    }

    if (state.mode.kind === "project-picker") {
      if (event.name === "up") {
        dispatch({ type: "project:cursor", delta: -1 });
        return;
      }
      if (event.name === "down") {
        dispatch({ type: "project:cursor", delta: 1 });
        return;
      }
      if (event.name === "return") {
        commitProjectPicker();
        return;
      }
      if (event.name === "escape") {
        return;
      }
    }

    if (state.view === "detail") {
      if (event.name === "escape") {
        dispatch({ type: "view:exit-detail" });
        return;
      }
      if (event.name === "b") {
        if (state.taskDetail.taskId) {
          void runCreateBranchEffect(deps, state.taskDetail.taskId, dispatch);
        }
        return;
      }
      if (event.name === "x") {
        if (state.taskDetail.taskId) {
          void runStartExecutionEffect(deps, state.taskDetail.taskId, dispatch);
        }
        return;
      }
      if (event.name === "v") {
        if (state.taskDetail.execution) {
          void runStartTestRunsEffect(deps, state.taskDetail.execution.id, dispatch);
        }
        return;
      }
      if (event.name === "e") {
        if (state.taskDetail.execution) {
          void runEvaluatePatchEffect(deps, state.taskDetail.execution.id, dispatch);
        }
        return;
      }
      if (event.name === "tab") {
        dispatch({ type: "focus:rotate", delta: event.shift ? -1 : 1 });
        return;
      }
      if (event.name === ":") {
        dispatch({ type: "overlay:open", overlay: "palette" });
        return;
      }
      if (event.name === "?") {
        dispatch({ type: "overlay:open", overlay: "help" });
        return;
      }
      if (event.name === "q") {
        dispatch({ type: "exit" });
        return;
      }
      return;
    }

    if (state.mode.kind === "ready" && state.tasks.status === "ready") {
      if (event.name === "up") {
        dispatch({ type: "tasks:cursor", delta: -1 });
        return;
      }
      if (event.name === "down") {
        dispatch({ type: "tasks:cursor", delta: 1 });
        return;
      }
      if (event.name === "return") {
        const selected = state.tasks.items[state.tasks.cursor];
        if (selected) {
          dispatch({ type: "view:enter-detail", taskId: selected.id });
          void loadTaskDetailEffect(deps, selected.id, dispatch);
        }
        return;
      }
    }

    switch (event.name) {
      case "tab":
        dispatch({ type: "focus:rotate", delta: event.shift ? -1 : 1 });
        return;
      case "?":
        dispatch({ type: "overlay:open", overlay: "help" });
        return;
      case ":":
        dispatch({ type: "overlay:open", overlay: "palette" });
        return;
      case "k":
        dispatch({ type: "overlay:open", overlay: "api-key" });
        return;
      case "l":
        dispatch({ type: "overlay:open", overlay: "claude-login" });
        return;
      case "p":
        if (state.mode.kind === "ready") {
          dispatch({ type: "overlay:open", overlay: "plan" });
        }
        return;
      case "t":
        if (state.mode.kind === "ready") {
          void runSlotTestEffect(deps, state.mode.project.id, dispatch);
        }
        return;
      case "s":
        if (state.mode.kind === "ready") {
          dispatch({
            type: "boot:projects-loaded",
            projects: [state.mode.project],
            selectedProjectId: undefined,
          });
        }
        return;
      case "r":
        void runBootEffect(deps, dispatch);
        return;
      case "q":
        dispatch({ type: "exit" });
        return;
    }
  }

  function commitProjectPicker(): void {
    if (state.mode.kind !== "project-picker") return;
    const project = state.mode.projects[state.mode.cursor];
    if (!project) {
      // "Create new" placeholder selected
      return;
    }
    void selectProjectEffect(deps, project, dispatch);
  }

  function runPaletteAction(): void {
    const command = state.palette.commands[state.palette.cursor];
    dispatch({ type: "overlay:close" });
    if (!command) return;
    switch (command.id) {
      case "test-slot":
        if (state.mode.kind === "ready") {
          void runSlotTestEffect(deps, state.mode.project.id, dispatch);
        }
        return;
      case "switch-project":
        if (state.mode.kind === "ready") {
          dispatch({
            type: "boot:projects-loaded",
            projects: [state.mode.project],
            selectedProjectId: undefined,
          });
        }
        return;
      case "paste-api-key":
        dispatch({ type: "overlay:open", overlay: "api-key" });
        return;
      case "login-claude":
        dispatch({ type: "overlay:open", overlay: "claude-login" });
        return;
      case "create-plan":
        if (state.mode.kind === "ready") {
          dispatch({ type: "overlay:open", overlay: "plan" });
        }
        return;
      case "approve-plan":
        if (state.mode.kind === "ready" && state.plan.run && state.plan.phase === "ready") {
          void runApprovePlanEffect(deps, state.mode.project.id, state.plan.run.id, dispatch);
        }
        return;
      case "reset-plan":
        dispatch({ type: "plan:reset" });
        return;
      case "refresh":
        void runBootEffect(deps, dispatch);
        return;
      case "quit":
        dispatch({ type: "exit" });
        return;
    }
  }

  // initial render + boot
  render();
  void runBootEffect(deps, dispatch);

  const pollInterval = setInterval(() => {
    if (state.view !== "detail") return;
    const execution = state.taskDetail.execution;
    if (!execution) return;
    if (!state.taskDetail.testRuns.some((run) => run.status === "running")) return;
    void runRefreshTestRunsEffect(deps, execution.id, dispatch);
  }, 2000);
  renderer.once("destroy", () => clearInterval(pollInterval));

  // Hold the process alive on the OpenTUI loop. The renderer.destroy() call
  // (triggered by `q` / Ctrl-C) will release it.
  await new Promise<void>((resolve) => {
    renderer.once("destroy", () => resolve());
  });
}

// satisfy verbatimModuleSyntax: keep an explicit no-op reference to TextRenderable
// so the compiler doesn't complain when this barrel grows.
export type _OpaqueText = TextRenderable;
export type _OpaqueRenderer = CliRenderer;
