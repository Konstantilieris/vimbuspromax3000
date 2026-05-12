import { emitKeypressEvents } from "node:readline";
import { getDashboardSnapshot } from "./dashboard";
import { isBenchmarkCommand, runBenchmarkCommand } from "./benchmark";
import { isDesignCommand, runDesignCommand } from "./design";
import { isDogfoodCommand, runDogfoodCommand } from "./dogfood";
import { isExecutionCommand, runExecutionCommand } from "./execution";
import { applyCommandPaletteEvent, createCommandPaletteState, getCommandPaletteSnapshot, type CommandPaletteState } from "./commandPalette";
import { applyFocusAction, createFocusState, FOCUS_KEY_BINDINGS, type FocusState } from "./focus";
import { applyHelpOverlayEvent, createHelpOverlayState, getHelpOverlaySnapshot, type HelpOverlayState } from "./helpOverlay";
import {
  LIVE_VIEW_PANES,
  acknowledgeNotifications,
  applyLiveViewEvents,
  createLiveViewState,
  frameToLoopEvent,
  parseSseFrames,
  renderControlPane,
  renderEpicsPane,
  renderEvaluatorPane,
  type LiveViewState,
} from "./live";
import {
  CORE_KEY_BINDINGS,
  createKeyDispatcher,
  dispatchKey,
  normalizeKeyChord,
  type KeyDispatcherState,
  type KeyEventLike,
} from "./keyDispatcher";
import { isMcpCommand, runMcpCommand } from "./mcp";
import { isModelsCommand, runModelsCommand } from "./models";
import { isJiraCommand, runJiraCommand } from "./jira";
import { isPlannerCommand, runPlannerCommand } from "./planner";
import {
  applyProjectPickerEvent,
  createProjectPickerState,
  getProjectPickerSnapshot,
  type ProjectPickerAction,
  type ProjectPickerProject,
  type ProjectPickerState,
} from "./projectPicker";
import {
  applyFolderBrowserEvent,
  createFolderBrowserState,
  getFolderBrowserSnapshot,
  type FolderBrowserState,
} from "./folderBrowser";
import { isPlaywrightCommand, runPlaywrightCommand } from "./playwright";
import { isReviewCommand, runReviewCommand } from "./review";
import { isSetupCommand, runSetupCommand } from "./setup";
import { TUI_THEME } from "./theme";
import { parseTuiCommandLine, runTuiCommandLine } from "./tuiCommands";
import { readUserState, recordSelectedProject, writeUserState, type UserState } from "./userState";
import { isValidationCommand, runValidationCommand } from "./validation";

export type TuiKeyboardState = {
  dispatcher: KeyDispatcherState;
  focus: FocusState;
  commandPalette: CommandPaletteState;
  helpOverlay: HelpOverlayState;
  liveView: LiveViewState;
};

export type TuiKeyboardDispatchOptions = {
  commandInputValue?: string;
};

export type TuiKeyboardDispatchResult = {
  state: TuiKeyboardState;
  handled: boolean;
  action?: string;
  key: string;
};

export type StartupProjectResolution =
  | { kind: "project"; project: ApiProject }
  | { kind: "picker"; picker: ProjectPickerState; snapshot: string };

export function createTuiDispatcher(): KeyDispatcherState {
  return createKeyDispatcher([
    ...CORE_KEY_BINDINGS,
    ...FOCUS_KEY_BINDINGS,
    {
      id: "live.notifications.ack",
      key: "n",
      action: "live.notifications.ack",
      description: "Acknowledge live notifications",
      group: "Live",
    },
  ]);
}

export function createTuiKeyboardState(options: { liveView?: LiveViewState } = {}): TuiKeyboardState {
  return {
    dispatcher: createTuiDispatcher(),
    focus: createFocusState("reviews"),
    commandPalette: createCommandPaletteState(),
    helpOverlay: createHelpOverlayState(),
    liveView: options.liveView ?? createLiveViewState(),
  };
}

export function handleTuiKeyEvent(
  state: TuiKeyboardState,
  event: KeyEventLike,
  options: TuiKeyboardDispatchOptions = {},
): TuiKeyboardDispatchResult {
  const key = normalizeKeyChord(event);
  if (shouldLetCommandInputHandleKey(key, options.commandInputValue)) {
    return { state, handled: false, key };
  }

  const dispatched = dispatchKey(state.dispatcher, event);
  if (!dispatched.handled || !dispatched.action) {
    return { state, handled: false, key };
  }

  switch (dispatched.action) {
    case "focus.reviews":
      return {
        state: { ...state, focus: applyFocusAction(state.focus, { type: "set", paneId: "reviews" }) },
        handled: true,
        action: dispatched.action,
        key,
      };
    case "focus.tasks":
      return {
        state: { ...state, focus: applyFocusAction(state.focus, { type: "set", paneId: "tasks" }) },
        handled: true,
        action: dispatched.action,
        key,
      };
    case "focus.projects":
      return {
        state: { ...state, focus: applyFocusAction(state.focus, { type: "set", paneId: "projects" }) },
        handled: true,
        action: dispatched.action,
        key,
      };
    case "focus.logs":
      return {
        state: { ...state, focus: applyFocusAction(state.focus, { type: "set", paneId: "logs" }) },
        handled: true,
        action: dispatched.action,
        key,
      };
    case "commandPalette.toggle":
      return {
        state: {
          ...state,
          commandPalette: applyCommandPaletteEvent(state.commandPalette, { type: "toggle" }).state,
        },
        handled: true,
        action: dispatched.action,
        key,
      };
    case "help.toggle":
      return {
        state: { ...state, helpOverlay: applyHelpOverlayEvent(state.helpOverlay, { type: "toggle" }) },
        handled: true,
        action: dispatched.action,
        key,
      };
    case "live.notifications.ack":
      return {
        state: { ...state, liveView: acknowledgeNotifications(state.liveView) },
        handled: true,
        action: dispatched.action,
        key,
      };
    default:
      return { state, handled: true, action: dispatched.action, key };
  }
}

function shouldLetCommandInputHandleKey(key: string, commandInputValue: string | undefined): boolean {
  if (!commandInputValue || commandInputValue.length === 0) return false;
  return key.length === 1;
}

function readArgValue(input: readonly string[], flag: string): string | undefined {
  for (let i = 0; i < input.length; i += 1) {
    const token = input[i];
    if (token === flag) return input[i + 1];
    if (token?.startsWith(`${flag}=`)) return token.slice(flag.length + 1);
  }
  return undefined;
}

type ApiProject = ProjectPickerProject;

export async function resolveStartupProject(options: {
  apiUrl: string;
  explicitProjectId?: string;
  userState?: UserState;
  fetch?: typeof fetch;
}): Promise<ApiProject | undefined> {
  const resolution = await resolveStartupProjectSelection(options);
  return resolution.kind === "project" ? resolution.project : undefined;
}

export async function resolveStartupProjectSelection(options: {
  apiUrl: string;
  explicitProjectId?: string;
  userState?: UserState;
  fetch?: typeof fetch;
}): Promise<StartupProjectResolution> {
  const request = options.fetch ?? fetch;

  if (options.explicitProjectId) {
    const project = await loadProjectById(options.apiUrl, options.explicitProjectId, request);
    if (project) return { kind: "project", project };
  }

  const lastProjectId = options.userState?.lastSelectedProjectId;
  if (lastProjectId) {
    const project = await loadProjectById(options.apiUrl, lastProjectId, request);
    if (project) return { kind: "project", project };
  }

  const projects = await loadProjects(options.apiUrl, request);
  const picker = createProjectPickerState(projects, {
    allowCreate: true,
    allowBrowse: true,
    createLabel: "Create from selected folder",
  });
  return { kind: "picker", picker, snapshot: getProjectPickerSnapshot(picker) };
}

async function loadProjectById(apiUrl: string, projectId: string, request: typeof fetch = fetch): Promise<ApiProject | undefined> {
  try {
    const response = await request(`${apiUrl.replace(/\/$/, "")}/projects/${encodeURIComponent(projectId)}`);
    if (!response.ok) return undefined;
    return (await response.json()) as ApiProject;
  } catch {
    return undefined;
  }
}

async function loadProjects(apiUrl: string, request: typeof fetch = fetch): Promise<ApiProject[]> {
  try {
    const response = await request(`${apiUrl.replace(/\/$/, "")}/projects`);
    if (!response.ok) return [];
    return (await response.json()) as ApiProject[];
  } catch {
    return [];
  }
}

async function loadLatestProject(apiUrl: string, request: typeof fetch = fetch): Promise<ApiProject | undefined> {
  const projects = await loadProjects(apiUrl, request);
  return projects[projects.length - 1];
}

function safeReadUserState(): UserState {
  try {
    return readUserState();
  } catch {
    return { version: 1, recentProjects: [] };
  }
}

function safeRecordSelectedProject(state: UserState, project: ApiProject): void {
  try {
    writeUserState(recordSelectedProject(state, project));
  } catch {
    // User state should not make command execution fail.
  }
}

function isProjectCreateCommand(command: string): boolean {
  return command.trim().startsWith("/projects:create");
}

export function shouldOpenProjectCreateFolderBrowser(command: string): boolean {
  const args = parseTuiCommandLine(command);
  return args.length === 1 && args[0] === "/projects:create";
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<void> {
const isSmokeMode = args.includes("--smoke") || process.env.CI === "true" || !process.stdout.isTTY;
const isSetupMode = args.some(isSetupCommand);
const isMcpMode = args.some(isMcpCommand);
const isModelsMode = args.some(isModelsCommand);
const isPlannerMode = args.some(isPlannerCommand);
const isDesignMode = args.some(isDesignCommand);
const isReviewMode = args.some(isReviewCommand);
const isValidationMode = args.some(isValidationCommand);
const isPlaywrightMode = args.some(isPlaywrightCommand);
const isExecutionMode = args.some(isExecutionCommand);
const isBenchmarkMode = args.some(isBenchmarkCommand);
const isDogfoodMode = args.some(isDogfoodCommand);
const isJiraMode = args.some(isJiraCommand);
const projectIdArg = readArgValue(args, "--project-id");

if (isSetupMode) {
  try {
    console.log(await runSetupCommand(args));
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (isMcpMode) {
  try {
    console.log(await runMcpCommand(args));
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (isModelsMode) {
  try {
    console.log(await runModelsCommand(args));
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (isPlannerMode) {
  try {
    const output = await runPlannerCommand(args);
    console.log(output);
    await persistNonInteractiveProjectSelection(args);
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (isDesignMode) {
  try {
    console.log(await runDesignCommand(args));
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (isReviewMode) {
  try {
    console.log(await runReviewCommand(args));
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (isValidationMode) {
  try {
    console.log(await runValidationCommand(args));
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (isPlaywrightMode) {
  try {
    console.log(await runPlaywrightCommand(args));
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (isExecutionMode) {
  try {
    console.log(await runExecutionCommand(args));
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (isJiraMode) {
  try {
    console.log(await runJiraCommand(args));
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (isBenchmarkMode) {
  try {
    console.log(await runBenchmarkCommand(args));
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (isDogfoodMode) {
  try {
    console.log(await runDogfoodCommand(args));
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (isSmokeMode) {
  console.log(getDashboardSnapshot());
  process.exit(0);
}

const apiUrlArg = await resolveApiUrl(readArgValue(args, "--api-url") ?? process.env.VIMBUS_API_URL);
const userState = safeReadUserState();
const startupResolution = await resolveStartupProjectSelection({
  apiUrl: apiUrlArg,
  explicitProjectId: projectIdArg,
  userState,
});
const startupProject = startupResolution.kind === "project" ? startupResolution.project : undefined;
let projectPickerState: ProjectPickerState | undefined = startupResolution.kind === "picker" ? startupResolution.picker : undefined;
let folderBrowserState: FolderBrowserState | undefined;
let tuiMode: "project-picker" | "folder-browser" | "normal" = projectPickerState ? "project-picker" : "normal";
let activeProjectId = startupProject?.id;
let activeProjectLabel = startupProject
  ? `Project: ${startupProject.name} (${startupProject.id})`
  : "Project: select one";

if (projectIdArg && startupProject) {
  safeRecordSelectedProject(userState, startupProject);
}

// VIM-36 Sprint 2: 3-pane live TUI subscribed to GET /events?stream=sse.
// Each pane has a dedicated `Text` node we mutate in place when new SSE
// frames arrive, so individual events do not cause a full re-render of the
// screen tree. The reducer + parser live in `./live.ts` so the snapshot test
// can exercise the same code path against a fixture event tape.
const { Box, Input, Text, createCliRenderer } = await import("@opentui/core");

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  targetFps: 30,
  useMouse: true,
});

// `Text(...)` returns a proxied vnode whose `.content` getter is typed as
// `StyledText`, but the underlying setter also accepts plain `string`. We
// route writes through `setContent` to keep the rest of the file free of
// `as any` casts.
const reviewsText = Text({ content: "Run /review:list to load reviews.", fg: TUI_THEME.colors.textMuted });
const tasksText = Text({ content: "No tasks yet.", fg: TUI_THEME.colors.textMuted });
const projectsText = Text({ content: activeProjectLabel, fg: TUI_THEME.colors.textMuted });
const logsText = Text({ content: "No log activity.", fg: TUI_THEME.colors.textMuted });
const commandOutputText = Text({
  content: `${TUI_THEME.copy.commandHint} Example: ${TUI_THEME.copy.prompt}`,
  fg: TUI_THEME.colors.textMuted,
});
const commandInput = Input({
  value: "",
  placeholder: TUI_THEME.copy.prompt,
  width: "100%",
  backgroundColor: TUI_THEME.colors.background,
  textColor: TUI_THEME.colors.text,
  focusedBackgroundColor: TUI_THEME.colors.background,
  focusedTextColor: TUI_THEME.colors.text,
  placeholderColor: TUI_THEME.colors.textFaint,
  onSubmit: () => {
    void submitTuiCommand();
  },
});
let commandIsRunning = false;
let keyboardState = createTuiKeyboardState();
let liveViewState: LiveViewState = keyboardState.liveView;

function createCommandButton(label: string, command: string, options: { primary?: boolean } = {}) {
  return Box(
    {
      height: 3,
      minWidth: Math.max(14, label.length + 4),
      paddingX: 1,
      borderStyle: TUI_THEME.panel.borderStyle,
      borderColor: options.primary ? TUI_THEME.colors.borderFocused : TUI_THEME.colors.border,
      backgroundColor: options.primary ? TUI_THEME.colors.inverseSurface : TUI_THEME.colors.background,
      onMouseDown: () => {
        void executeTuiCommand(command);
      },
    },
    Text({
      content: label,
      fg: options.primary ? TUI_THEME.colors.inverseText : TUI_THEME.colors.textMuted,
    }),
  );
}

function setContent(node: { content: unknown }, value: string): void {
  (node as { content: string }).content = value;
}

function setStyle(node: unknown, style: Record<string, string | number>): void {
  Object.assign(node as Record<string, unknown>, style);
}

const reviewsLabel = Text({ content: "F1  REVIEWS", fg: TUI_THEME.colors.textMuted });
const tasksLabel = Text({ content: "F2  TASKS", fg: TUI_THEME.colors.textMuted });
const projectsLabel = Text({ content: "F3  PROJECTS", fg: TUI_THEME.colors.textMuted });
const logsLabel = Text({ content: "F4  LOGS", fg: TUI_THEME.colors.textMuted });

const reviewsPane = Box(
  {
    flexGrow: 1,
    flexDirection: "column",
    padding: TUI_THEME.panel.padding,
    borderStyle: TUI_THEME.panel.borderStyle,
    borderColor: TUI_THEME.colors.border,
    backgroundColor: TUI_THEME.colors.surface,
    gap: 1,
  },
  reviewsLabel,
  reviewsText,
);
const tasksPane = Box(
  {
    flexGrow: 1,
    flexDirection: "column",
    padding: TUI_THEME.panel.padding,
    borderStyle: TUI_THEME.panel.borderStyle,
    borderColor: TUI_THEME.colors.border,
    backgroundColor: TUI_THEME.colors.surface,
    gap: 1,
  },
  tasksLabel,
  tasksText,
);
const projectsPane = Box(
  {
    flexGrow: 1,
    flexDirection: "column",
    padding: TUI_THEME.panel.padding,
    borderStyle: TUI_THEME.panel.borderStyle,
    borderColor: TUI_THEME.colors.border,
    backgroundColor: TUI_THEME.colors.surface,
    gap: 1,
  },
  projectsLabel,
  projectsText,
);
const logsPane = Box(
  {
    flexGrow: 1,
    flexDirection: "column",
    padding: TUI_THEME.panel.padding,
    borderStyle: TUI_THEME.panel.borderStyle,
    borderColor: TUI_THEME.colors.border,
    backgroundColor: TUI_THEME.colors.surface,
    gap: 1,
  },
  logsLabel,
  logsText,
);

const paneStyles = [
  { id: "reviews", box: reviewsPane, label: reviewsLabel },
  { id: "tasks", box: tasksPane, label: tasksLabel },
  { id: "projects", box: projectsPane, label: projectsLabel },
  { id: "logs", box: logsPane, label: logsLabel },
] as const;

renderer.root.add(
  Box(
    {
      width: "100%",
      height: "100%",
      flexDirection: "column",
      padding: 1,
      gap: 1,
      backgroundColor: TUI_THEME.colors.background,
    },
    Box(
      {
        width: "100%",
        height: 1,
        flexDirection: "row",
        justifyContent: "space-between",
      },
      Text({
        content: TUI_THEME.copy.appTitle,
        fg: TUI_THEME.colors.text,
      }),
      Text({
        content: "local operator console",
        fg: TUI_THEME.colors.textFaint,
      }),
    ),
    Box(
      {
        width: "100%",
        flexGrow: 1,
        flexDirection: "row",
        gap: 1,
      },
      reviewsPane,
      tasksPane,
      projectsPane,
      logsPane,
    ),
    Box(
      {
        width: "100%",
        height: 11,
        flexDirection: "column",
        padding: 1,
        borderStyle: TUI_THEME.panel.borderStyle,
        borderColor: TUI_THEME.colors.border,
        backgroundColor: TUI_THEME.colors.surface,
        gap: 1,
      },
      Text({ content: "COMMAND", fg: TUI_THEME.colors.textMuted }),
      Box(
        {
          width: "100%",
          height: 3,
          flexDirection: "row",
          gap: 1,
        },
        createCommandButton("Reviews", "/review:list", { primary: true }),
        createCommandButton(
          "Add demo review",
          '/review:add --subject-type agent_plan --subject-id demo-plan --title "Demo plan review" --markdown-file docs\\SPRINT-7-PLAN.md',
        ),
        createCommandButton("Projects", "/projects"),
        createCommandButton("Tasks", "/tasks"),
      ),
      commandOutputText,
      Box(
        {
          width: "100%",
          height: 1,
          flexDirection: "row",
          gap: 1,
        },
        Text({ content: ">", fg: TUI_THEME.colors.text }),
        commandInput,
      ),
    ),
  ),
);

applyPaneFocusStyles();

commandInput.focus();
installKeyboardHandler();

setContent(
  commandOutputText,
  projectPickerState
    ? `${getProjectPickerSnapshot(projectPickerState)}\n\nUse Up/Down and Enter. Browse picks a folder for project creation.`
    : `${activeProjectLabel}\nAPI: ${apiUrlArg}\nType a slash command, then Enter.`,
);

if (activeProjectId) {
  void runLiveSubscription(activeProjectId, apiUrlArg);
} else {
  setContent(projectsText, "No project selected. Choose an existing project, browse a folder, or pass --project-id.");
}

function installKeyboardHandler(): void {
  if (!process.stdin.isTTY) return;
  emitKeypressEvents(process.stdin);
  process.stdin.on("keypress", (_value: string, key: KeyEventLike) => {
    if (handleModalKeyEvent(key)) return;

    const result = handleTuiKeyEvent(keyboardState, key, {
      commandInputValue: String(commandInput.value ?? ""),
    });
    if (!result.handled) return;

    keyboardState = result.state;
    liveViewState = keyboardState.liveView;
    renderKeyboardSurface(result.action);
  });
}

function handleModalKeyEvent(keyEvent: KeyEventLike): boolean {
  if (tuiMode === "project-picker" && projectPickerState) {
    const key = normalizeKeyChord(keyEvent);
    const input =
      key === "up" ? { type: "move" as const, direction: "up" as const } :
      key === "down" ? { type: "move" as const, direction: "down" as const } :
      key === "home" ? { type: "move" as const, direction: "first" as const } :
      key === "end" ? { type: "move" as const, direction: "last" as const } :
      key === "enter" ? { type: "enter" as const } :
      key === "escape" ? { type: "escape" as const } :
      undefined;
    if (!input) return false;

    const transition = applyProjectPickerEvent(projectPickerState, input);
    projectPickerState = transition.state;
    void handleProjectPickerAction(transition.action);
    renderProjectPicker();
    return true;
  }

  if (tuiMode === "folder-browser" && folderBrowserState) {
    const key = normalizeKeyChord(keyEvent);
    const event =
      key === "up" ? { type: "move" as const, direction: "up" as const } :
      key === "down" ? { type: "move" as const, direction: "down" as const } :
      key === "home" ? { type: "move" as const, direction: "first" as const } :
      key === "end" ? { type: "move" as const, direction: "last" as const } :
      key === "enter" ? { type: "open" as const } :
      key === "backspace" || key === "left" ? { type: "back" as const } :
      key === "space" ? { type: "select-current" as const } :
      key === "escape" ? { type: "cancel" as const } :
      undefined;
    if (!event) return false;

    const transition = applyFolderBrowserEvent(folderBrowserState, event);
    folderBrowserState = transition.state;
    void handleFolderBrowserAction(transition.action);
    renderFolderBrowser();
    return true;
  }

  return false;
}

async function handleProjectPickerAction(action: ProjectPickerAction | undefined): Promise<void> {
  if (!action) return;
  if (action.type === "cancel") {
    tuiMode = "normal";
    projectPickerState = undefined;
    setContent(commandOutputText, `${activeProjectLabel}\nPicker cancelled.`);
    return;
  }
  if (action.type === "browse-folder") {
    folderBrowserState = createFolderBrowserState(process.cwd(), { includeFiles: false });
    tuiMode = "folder-browser";
    renderFolderBrowser();
    return;
  }
  if (action.type === "select-project") {
    setActiveProject(action.project);
    tuiMode = "normal";
    projectPickerState = undefined;
    setContent(commandOutputText, `Selected project ${action.project.name} (${action.project.id}).`);
    void runLiveSubscription(action.project.id, apiUrlArg);
    return;
  }
  if (action.type === "create-project") {
    if (!action.rootPath) {
      folderBrowserState = createFolderBrowserState(process.cwd(), { includeFiles: false });
      tuiMode = "folder-browser";
      renderFolderBrowser();
      return;
    }
    await createProjectFromFolder(action.rootPath);
  }
}

function setActiveProject(project: ApiProject): void {
  activeProjectId = project.id;
  activeProjectLabel = `Project: ${project.name} (${project.id})`;
  setContent(projectsText, activeProjectLabel);
  safeRecordSelectedProject(safeReadUserState(), project);
}

async function createProjectFromFolder(rootPath: string): Promise<void> {
  const name =
    rootPath
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .filter(Boolean)
      .at(-1) ?? "TaskGoblin Project";
  const response = await fetch(`${apiUrlArg.replace(/\/$/, "")}/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name,
      rootPath,
    }),
  });

  if (!response.ok) {
    throw new Error(`Project create failed: HTTP ${response.status}`);
  }

  const project = (await response.json()) as ApiProject;
  setActiveProject(project);
  tuiMode = "normal";
  projectPickerState = undefined;
  folderBrowserState = undefined;
  setContent(commandOutputText, `Created project ${project.name} (${project.id}).`);
  void runLiveSubscription(project.id, apiUrlArg);
}

async function handleFolderBrowserAction(action: { type: "selected"; path: string } | { type: "cancel" } | undefined): Promise<void> {
  if (!action) return;
  if (action.type === "cancel") {
    tuiMode = projectPickerState ? "project-picker" : "normal";
    folderBrowserState = undefined;
    renderProjectPicker();
    return;
  }

  folderBrowserState = undefined;
  projectPickerState = createProjectPickerState(projectPickerState?.projects ?? [], {
    selectedRootPath: action.path,
    allowBrowse: true,
    allowCreate: true,
    createLabel: "Create from selected folder",
  });
  tuiMode = "project-picker";
  renderProjectPicker();
}

function renderProjectPicker(): void {
  if (!projectPickerState) return;
  setContent(commandOutputText, `${getProjectPickerSnapshot(projectPickerState)}\n\nEnter selects. Browse opens folders.`);
}

function renderFolderBrowser(): void {
  if (!folderBrowserState) return;
  setContent(commandOutputText, `${getFolderBrowserSnapshot(folderBrowserState)}\n\nEnter opens. Space selects current folder. Esc cancels.`);
}

function renderKeyboardSurface(action: string | undefined): void {
  applyPaneFocusStyles();

  if (keyboardState.commandPalette.isOpen) {
    setContent(commandOutputText, getCommandPaletteSnapshot(keyboardState.commandPalette));
    return;
  }

  if (keyboardState.helpOverlay.isOpen) {
    setContent(commandOutputText, getHelpOverlaySnapshot(keyboardState.helpOverlay, keyboardState.dispatcher));
    return;
  }

  if (action?.startsWith("focus.")) {
    setContent(commandOutputText, `${activeProjectLabel}\nFocus: ${keyboardState.focus.focusedPaneId}`);
    return;
  }

  if (action === "live.notifications.ack") {
    renderLiveViewPanes(liveViewState);
  }
}

function applyPaneFocusStyles(): void {
  for (const pane of paneStyles) {
    const isFocused = keyboardState.focus.focusedPaneId === pane.id;
    setStyle(pane.box, {
      borderColor: isFocused ? TUI_THEME.colors.borderFocused : TUI_THEME.colors.borderSubtle,
      backgroundColor: isFocused ? TUI_THEME.colors.surfaceRaised : TUI_THEME.colors.surface,
    });
    setStyle(pane.label, {
      fg: isFocused ? TUI_THEME.colors.text : TUI_THEME.colors.textFaint,
    });
  }
}

function renderLiveViewPanes(state: LiveViewState): void {
  setContent(tasksText, stripHeader(renderEpicsPane(state), LIVE_VIEW_PANES[0]));
  setContent(projectsText, `${activeProjectLabel}\n\n${stripHeader(renderControlPane(state), LIVE_VIEW_PANES[1])}`);
  setContent(logsText, stripHeader(renderEvaluatorPane(state), LIVE_VIEW_PANES[2]));
}

async function runLiveSubscription(projectId: string, apiUrl: string): Promise<void> {
  let state: LiveViewState = liveViewState;
  const updatePanes = (next: LiveViewState) => {
    state = next;
    liveViewState = next;
    keyboardState = { ...keyboardState, liveView: next };
    // Strip the header line — the OpenTUI Box already labels each pane.
    renderLiveViewPanes(state);
  };

  try {
    const url = `${apiUrl.replace(/\/$/, "")}/events?projectId=${encodeURIComponent(projectId)}&stream=sse`;
    const response = await fetch(url, { headers: { accept: "text/event-stream" } });
    if (!response.ok || !response.body) {
      setContent(logsText, `SSE connect failed: HTTP ${response.status}`);
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { frames, remainder } = parseSseFrames(buffer);
      buffer = remainder;
      const incoming = frames
        .map(frameToLoopEvent)
        .filter((event): event is NonNullable<ReturnType<typeof frameToLoopEvent>> => event !== undefined);
      if (incoming.length > 0) {
        updatePanes(applyLiveViewEvents(state, incoming));
      }
    }
  } catch (error) {
    setContent(logsText, `SSE error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function stripHeader(rendered: string, header: string): string {
  if (rendered.startsWith(`${header}\n`)) return rendered.slice(header.length + 1);
  if (rendered === header) return "";
  return rendered;
}

async function submitTuiCommand(): Promise<void> {
  await executeTuiCommand(String(commandInput.value ?? "").trim());
}

async function executeTuiCommand(command: string): Promise<void> {
  if (commandIsRunning) return;

  if (!command) return;

  if (shouldOpenProjectCreateFolderBrowser(command)) {
    commandInput.value = "";
    folderBrowserState = createFolderBrowserState(process.cwd(), { includeFiles: false });
    tuiMode = "folder-browser";
    renderFolderBrowser();
    commandInput.focus();
    return;
  }

  commandInput.value = "";
  commandIsRunning = true;
  setContent(commandOutputText, `$ ${command}\nRunning...`);

  try {
    const output = await runTuiCommandLine(command, {
      apiUrl: apiUrlArg,
      projectId: activeProjectId,
      env: process.env,
    });
    if (isProjectCreateCommand(command) || !activeProjectId) {
      const project = await loadLatestProject(apiUrlArg);
      if (project) {
        activeProjectId = project.id;
        activeProjectLabel = `Project: ${project.name} (${project.id})`;
        safeRecordSelectedProject(safeReadUserState(), project);
        void runLiveSubscription(activeProjectId, apiUrlArg);
      }
    }
    setContent(commandOutputText, `$ ${command}\n${clipCommandOutput(output)}`);
  } catch (error) {
    setContent(commandOutputText, `$ ${command}\n${error instanceof Error ? error.message : String(error)}`);
  } finally {
    commandIsRunning = false;
    commandInput.focus();
  }
}

function clipCommandOutput(output: string): string {
  const lines = output.split(/\r?\n/);
  return lines.slice(0, 5).join("\n");
}

async function persistNonInteractiveProjectSelection(commandArgs: readonly string[]): Promise<void> {
  const apiUrl = await resolveApiUrl(readArgValue(commandArgs, "--api-url") ?? process.env.VIMBUS_API_URL);
  const explicitProjectId = readArgValue(commandArgs, "--project-id");

  if (explicitProjectId) {
    const project = await loadProjectById(apiUrl, explicitProjectId);
    if (project) safeRecordSelectedProject(safeReadUserState(), project);
    return;
  }

  if (commandArgs.some((arg) => isProjectCreateCommand(arg))) {
    const project = await loadLatestProject(apiUrl);
    if (project) safeRecordSelectedProject(safeReadUserState(), project);
  }
}

async function resolveApiUrl(explicitApiUrl: string | undefined): Promise<string> {
  if (explicitApiUrl) return explicitApiUrl.replace(/\/$/, "");

  for (const candidate of ["http://localhost:3000", "http://localhost:3100", "http://localhost:3001"]) {
    if (await isTaskGoblinApi(candidate)) return candidate;
  }

  return "http://localhost:3000";
}

async function isTaskGoblinApi(apiUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 700);

  try {
    const response = await fetch(`${apiUrl}/health`, { signal: controller.signal });
    if (!response.ok) return false;
    const payload = (await response.json()) as { service?: unknown };
    return payload.service === "vimbuspromax3000-api";
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

}

if ((import.meta as ImportMeta & { main?: boolean }).main) {
  await main();
}
