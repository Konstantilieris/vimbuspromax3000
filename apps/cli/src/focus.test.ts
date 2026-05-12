import {
  FOCUS_PANES,
  applyFocusKey,
  createFocusState,
  getFocusKeyBindings,
  getFocusSnapshot,
  moveFocus,
  setFocusedPane,
} from "./focus";

describe("focus state", () => {
  test("declares F1-F4 pane shortcuts", () => {
    expect(FOCUS_PANES.map((pane) => pane.key)).toEqual(["f1", "f2", "f3", "f4"]);
    expect(getFocusKeyBindings().map((binding) => binding.action)).toEqual([
      "focus.reviews",
      "focus.tasks",
      "focus.projects",
      "focus.logs",
    ]);
  });

  test("sets focus by pane id and records history", () => {
    const state = setFocusedPane(createFocusState(), "projects");

    expect(state.focusedPaneId).toBe("projects");
    expect(state.history).toEqual(["reviews", "projects"]);
  });

  test("cycles focus forward and backward", () => {
    const state = createFocusState("logs");

    expect(moveFocus(state, "next").focusedPaneId).toBe("reviews");
    expect(moveFocus(state, "previous").focusedPaneId).toBe("projects");
  });

  test("applies function key events", () => {
    const state = applyFocusKey(createFocusState(), { name: "f3" });

    expect(state.focusedPaneId).toBe("projects");
    expect(getFocusSnapshot(state)).toContain("> F3 Projects");
  });
});
