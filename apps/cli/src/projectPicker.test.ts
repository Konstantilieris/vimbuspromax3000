import {
  applyProjectPickerEvent,
  createProjectPickerState,
  getProjectPickerItems,
  getProjectPickerSelection,
  getProjectPickerSnapshot,
  type ProjectPickerProject,
} from "./projectPicker";

describe("project picker state machine", () => {
  const projects: ProjectPickerProject[] = [
    { id: "project_1", name: "API", rootPath: "C:\\repo\\api", baseBranch: "main" },
    { id: "project_2", name: "Web", rootPath: "C:\\repo\\web", baseBranch: "develop" },
  ];

  test("builds project rows plus a create row", () => {
    const state = createProjectPickerState(projects, { defaultRootPath: "C:\\repo\\new" });

    expect(getProjectPickerItems(state).map((item) => item.label)).toEqual([
      "API",
      "Web",
      "Browse for a folder",
      "Create a new project",
    ]);
    expect(getProjectPickerSelection(state)?.id).toBe("project_1");
  });

  test("filters projects without hiding the create action", () => {
    const state = createProjectPickerState(projects);
    const next = applyProjectPickerEvent(state, { type: "query", value: "web" }).state;

    expect(getProjectPickerItems(next).map((item) => item.label)).toEqual([
      "Web",
      "Browse for a folder",
      "Create a new project",
    ]);
    expect(getProjectPickerSelection(next)?.id).toBe("project_2");
  });

  test("clamps arrow navigation and returns selected project on enter", () => {
    let transition = applyProjectPickerEvent(createProjectPickerState(projects), {
      type: "move",
      direction: "down",
      amount: 20,
    });
    expect(getProjectPickerSelection(transition.state)?.id).toBe("create");

    transition = applyProjectPickerEvent(transition.state, { type: "move", direction: "first" });
    transition = applyProjectPickerEvent(transition.state, { type: "move", direction: "down", amount: 1 });
    transition = applyProjectPickerEvent(transition.state, { type: "enter" });

    expect(transition.action).toEqual({ type: "select-project", project: projects[1] });
  });

  test("returns create action when the create row is selected", () => {
    const state = createProjectPickerState(projects, { defaultRootPath: "C:\\repo\\new" });
    const selectedCreate = applyProjectPickerEvent(state, { type: "move", direction: "last" }).state;
    const transition = applyProjectPickerEvent(selectedCreate, { type: "enter" });

    expect(transition.action).toEqual({ type: "create-project", rootPath: "C:\\repo\\new" });
  });

  test("returns browse action from the browse row", () => {
    const state = createProjectPickerState(projects);
    const selectedBrowse = applyProjectPickerEvent(state, { type: "move", direction: "down", amount: 2 }).state;
    const transition = applyProjectPickerEvent(selectedBrowse, { type: "enter" });

    expect(getProjectPickerSelection(selectedBrowse)?.id).toBe("browse");
    expect(transition.action).toEqual({ type: "browse-folder" });
  });

  test("uses selected folder path for create from folder", () => {
    const state = createProjectPickerState(projects, { selectedRootPath: "C:\\repo\\picked" });
    const selectedCreate = applyProjectPickerEvent(state, { type: "move", direction: "last" }).state;

    expect(getProjectPickerSelection(selectedCreate)).toMatchObject({
      kind: "create",
      detail: "Use C:\\repo\\picked",
    });
    expect(applyProjectPickerEvent(selectedCreate, { type: "enter" }).action).toEqual({
      type: "create-project",
      rootPath: "C:\\repo\\picked",
    });
  });

  test("renders a deterministic snapshot", () => {
    const state = createProjectPickerState(projects, { selectedProjectId: "project_2" });
    const snapshot = getProjectPickerSnapshot(state);

    expect(snapshot).toContain("Project picker");
    expect(snapshot).toContain("> Web - project_2 [develop] C:\\repo\\web");
  });
});
