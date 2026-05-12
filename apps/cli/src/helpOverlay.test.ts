import { createKeyDispatcher, CORE_KEY_BINDINGS, LIST_NAVIGATION_KEY_BINDINGS } from "./keyDispatcher";
import {
  applyHelpOverlayEvent,
  createHelpOverlayState,
  getHelpOverlayBindings,
  getHelpOverlaySnapshot,
} from "./helpOverlay";

describe("help overlay", () => {
  test("opens, toggles, and closes through pure events", () => {
    const closed = createHelpOverlayState();
    const open = applyHelpOverlayEvent(closed, { type: "open" });

    expect(open.isOpen).toBe(true);
    expect(applyHelpOverlayEvent(open, { type: "toggle" }).isOpen).toBe(false);
    expect(applyHelpOverlayEvent(open, { type: "escape" }).isOpen).toBe(false);
  });

  test("renders visible dispatcher bindings from the registry", () => {
    const dispatcher = createKeyDispatcher([
      ...CORE_KEY_BINDINGS,
      ...LIST_NAVIGATION_KEY_BINDINGS,
      {
        id: "internal.hidden",
        key: "x",
        description: "Hidden shortcut",
        hidden: true,
      },
    ]);

    expect(getHelpOverlayBindings(dispatcher).map((binding) => binding.id)).not.toContain("internal.hidden");

    const snapshot = getHelpOverlaySnapshot(createHelpOverlayState({ isOpen: true }), dispatcher);

    expect(snapshot).toContain("Keyboard help");
    expect(snapshot).toContain("ctrl+k: Open command palette");
    expect(snapshot).toContain("enter: Choose selected item");
    expect(snapshot).not.toContain("Hidden shortcut");
  });
});
