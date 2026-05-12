export type ProjectPickerProject = {
  id: string;
  name: string;
  rootPath: string;
  baseBranch?: string | null;
};

export type ProjectPickerItem =
  | {
      kind: "project";
      id: string;
      label: string;
      detail: string;
      project: ProjectPickerProject;
    }
  | {
      kind: "create";
      id: "create";
      label: string;
      detail: string;
      rootPath?: string;
    }
  | {
      kind: "browse";
      id: "browse";
      label: string;
      detail: string;
    };

export type ProjectPickerState = {
  projects: ProjectPickerProject[];
  query: string;
  selectedIndex: number;
  allowCreate: boolean;
  allowBrowse: boolean;
  createLabel: string;
  browseLabel: string;
  defaultRootPath?: string;
  selectedRootPath?: string;
};

export type ProjectPickerInput =
  | { type: "move"; direction: "up" | "down" | "first" | "last"; amount?: number }
  | { type: "query"; value: string }
  | { type: "type"; value: string }
  | { type: "backspace" }
  | { type: "clear" }
  | { type: "enter" }
  | { type: "escape" };

export type ProjectPickerAction =
  | { type: "select-project"; project: ProjectPickerProject }
  | { type: "create-project"; rootPath?: string }
  | { type: "browse-folder" }
  | { type: "cancel" };

export type ProjectPickerTransition = {
  state: ProjectPickerState;
  action?: ProjectPickerAction;
};

export type CreateProjectPickerOptions = {
  query?: string;
  selectedProjectId?: string;
  allowCreate?: boolean;
  allowBrowse?: boolean;
  createLabel?: string;
  browseLabel?: string;
  defaultRootPath?: string;
  selectedRootPath?: string;
};

export function createProjectPickerState(
  projects: readonly ProjectPickerProject[],
  options: CreateProjectPickerOptions = {},
): ProjectPickerState {
  const state: ProjectPickerState = {
    projects: [...projects],
    query: options.query ?? "",
    selectedIndex: 0,
    allowCreate: options.allowCreate ?? true,
    allowBrowse: options.allowBrowse ?? true,
    createLabel: options.createLabel ?? "Create a new project",
    browseLabel: options.browseLabel ?? "Browse for a folder",
    defaultRootPath: options.defaultRootPath,
    selectedRootPath: options.selectedRootPath,
  };

  if (options.selectedProjectId) {
    const index = getProjectPickerItems(state).findIndex(
      (item) => item.kind === "project" && item.project.id === options.selectedProjectId,
    );
    if (index >= 0) {
      return { ...state, selectedIndex: index };
    }
  }

  return clampProjectPickerSelection(state);
}

export function applyProjectPickerEvent(
  state: ProjectPickerState,
  input: ProjectPickerInput,
): ProjectPickerTransition {
  switch (input.type) {
    case "move":
      return { state: moveProjectPickerSelection(state, input.direction, input.amount) };
    case "query":
      return { state: clampProjectPickerSelection({ ...state, query: input.value, selectedIndex: 0 }) };
    case "type":
      return { state: clampProjectPickerSelection({ ...state, query: state.query + input.value, selectedIndex: 0 }) };
    case "backspace":
      return {
        state: clampProjectPickerSelection({
          ...state,
          query: state.query.slice(0, Math.max(0, state.query.length - 1)),
          selectedIndex: 0,
        }),
      };
    case "clear":
      return { state: clampProjectPickerSelection({ ...state, query: "", selectedIndex: 0 }) };
    case "enter": {
      const item = getProjectPickerSelection(state);
      if (!item) return { state };
      if (item.kind === "project") {
        return { state, action: { type: "select-project", project: item.project } };
      }
      if (item.kind === "browse") {
        return { state, action: { type: "browse-folder" } };
      }
      return { state, action: { type: "create-project", rootPath: item.rootPath } };
    }
    case "escape":
      return { state, action: { type: "cancel" } };
  }
}

export const reduceProjectPicker = applyProjectPickerEvent;

export function getProjectPickerItems(state: ProjectPickerState): ProjectPickerItem[] {
  const query = normalizeSearch(state.query);
  const projects = state.projects
    .filter((project) => matchesProject(project, query))
    .map<ProjectPickerItem>((project) => ({
      kind: "project",
      id: project.id,
      label: project.name,
      detail: formatProjectDetail(project),
      project,
    }));

  if (state.allowBrowse) {
    projects.push({
      kind: "browse",
      id: "browse",
      label: state.browseLabel,
      detail: "Choose a repository folder",
    });
  }

  if (state.allowCreate) {
    const rootPath = state.selectedRootPath ?? state.defaultRootPath;
    projects.push({
      kind: "create",
      id: "create",
      label: state.createLabel,
      detail: rootPath ? `Use ${rootPath}` : "Choose a folder first",
      rootPath,
    });
  }

  return projects;
}

export function getProjectPickerSelection(state: ProjectPickerState): ProjectPickerItem | undefined {
  const items = getProjectPickerItems(state);
  return items[clampIndex(state.selectedIndex, items.length)];
}

export function moveProjectPickerSelection(
  state: ProjectPickerState,
  direction: "up" | "down" | "first" | "last",
  amount = 1,
): ProjectPickerState {
  const itemCount = getProjectPickerItems(state).length;
  if (itemCount === 0) return { ...state, selectedIndex: 0 };

  switch (direction) {
    case "up":
      return { ...state, selectedIndex: clampIndex(state.selectedIndex - amount, itemCount) };
    case "down":
      return { ...state, selectedIndex: clampIndex(state.selectedIndex + amount, itemCount) };
    case "first":
      return { ...state, selectedIndex: 0 };
    case "last":
      return { ...state, selectedIndex: itemCount - 1 };
  }
}

export function getProjectPickerSnapshot(state: ProjectPickerState): string {
  const items = getProjectPickerItems(state);
  const lines = ["Project picker", `Filter: ${state.query || "(none)"}`];

  if (items.length === 0) {
    lines.push("No matching projects.");
    return lines.join("\n");
  }

  items.forEach((item, index) => {
    const marker = index === clampIndex(state.selectedIndex, items.length) ? ">" : " ";
    lines.push(`${marker} ${item.label} - ${item.detail}`);
  });

  return lines.join("\n");
}

function clampProjectPickerSelection(state: ProjectPickerState): ProjectPickerState {
  const itemCount = getProjectPickerItems(state).length;
  return { ...state, selectedIndex: clampIndex(state.selectedIndex, itemCount) };
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
}

function matchesProject(project: ProjectPickerProject, query: string): boolean {
  if (!query) return true;
  return normalizeSearch(`${project.name} ${project.id} ${project.rootPath} ${project.baseBranch ?? ""}`).includes(query);
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function formatProjectDetail(project: ProjectPickerProject): string {
  const branch = project.baseBranch ? ` [${project.baseBranch}]` : "";
  return `${project.id}${branch} ${project.rootPath}`;
}
