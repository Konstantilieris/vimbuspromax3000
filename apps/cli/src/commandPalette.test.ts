import {
  DEFAULT_COMMAND_PALETTE_ITEMS,
  applyCommandPaletteEvent,
  buildCommandPaletteItems,
  createCommandPaletteState,
  getCommandPaletteSelection,
  getCommandPaletteSnapshot,
  getCommandPaletteVisibleItems,
} from "./commandPalette";

describe("command palette", () => {
  const items = buildCommandPaletteItems([
    {
      group: "Review",
      commands: ["/review:list", "/review:show", "/review:add"],
    },
    {
      group: "Execution",
      commands: ["/execution:start"],
    },
  ]);

  test("filters slash commands and keeps selection clamped", () => {
    const initial = createCommandPaletteState(items, { isOpen: true });
    const queried = applyCommandPaletteEvent(initial, { type: "query", value: "revi" }).state;

    expect(getCommandPaletteVisibleItems(queried).map((item) => item.command)).toEqual([
      "/review:add",
      "/review:list",
      "/review:show",
    ]);
    expect(getCommandPaletteSelection(queried)?.command).toBe("/review:add");

    const moved = applyCommandPaletteEvent(queried, { type: "move", direction: "down", amount: 10 }).state;
    expect(getCommandPaletteSelection(moved)?.command).toBe("/review:show");
  });

  test("enter closes and returns the selected command action", () => {
    const state = createCommandPaletteState(items, {
      isOpen: true,
      query: "exec",
    });

    const transition = applyCommandPaletteEvent(state, { type: "enter" });

    expect(transition.state.isOpen).toBe(false);
    expect(transition.action).toEqual({
      type: "run-command",
      command: "/execution:start",
    });
  });

  test("snapshot includes visible command descriptions", () => {
    const state = createCommandPaletteState(items, {
      isOpen: true,
      query: "review",
    });

    const snapshot = getCommandPaletteSnapshot(state);

    expect(snapshot).toContain("Command palette");
    expect(snapshot).toContain("/review:add");
    expect(snapshot).not.toContain("/execution:start");
  });

  test("default registry includes validation commands", () => {
    expect(DEFAULT_COMMAND_PALETTE_ITEMS.map((item) => item.command)).toEqual(
      expect.arrayContaining([
        "/validation:list",
        "/validation:show",
        "/validation:approve",
        "/validation:reject",
        "/jira:import",
      ]),
    );
  });
});
