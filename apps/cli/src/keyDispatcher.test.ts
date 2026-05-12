import {
  CORE_KEY_BINDINGS,
  LIST_NAVIGATION_KEY_BINDINGS,
  createKeyDispatcher,
  dispatchKey,
  normalizeKeyChord,
  registerKeyBinding,
  setKeyDispatcherScope,
} from "./keyDispatcher";

describe("key dispatcher", () => {
  test("normalizes string and keypress-like events", () => {
    expect(normalizeKeyChord("Control+K")).toBe("ctrl+k");
    expect(normalizeKeyChord({ name: "k", ctrl: true })).toBe("ctrl+k");
    expect(normalizeKeyChord({ name: "return" })).toBe("enter");
    expect(normalizeKeyChord({ name: "tab", shift: true })).toBe("shift+tab");
  });

  test("dispatches core and list navigation bindings", () => {
    const dispatcher = createKeyDispatcher([
      ...CORE_KEY_BINDINGS,
      ...LIST_NAVIGATION_KEY_BINDINGS,
    ]);

    expect(dispatchKey(dispatcher, { name: "k", ctrl: true })).toMatchObject({
      handled: true,
      action: "commandPalette.toggle",
    });
    expect(dispatchKey(dispatcher, "down")).toMatchObject({
      handled: true,
      action: "list.moveDown",
    });
  });

  test("prefers scoped bindings over global bindings for the same key", () => {
    const dispatcher = setKeyDispatcherScope(
      createKeyDispatcher([
        { id: "global.enter", key: "enter", action: "global.confirm", description: "Confirm" },
        {
          id: "palette.enter",
          key: "enter",
          action: "palette.run",
          description: "Run command",
          scope: "commandPalette",
        },
      ]),
      "commandPalette",
    );

    expect(dispatchKey(dispatcher, "enter")).toMatchObject({
      handled: true,
      action: "palette.run",
    });
  });

  test("registering a binding with the same id replaces the old binding", () => {
    let dispatcher = createKeyDispatcher([
      { id: "help", key: "?", action: "help.toggle", description: "Help" },
    ]);
    dispatcher = registerKeyBinding(dispatcher, {
      id: "help",
      key: "f1",
      action: "help.open",
      description: "Open help",
    });

    expect(dispatchKey(dispatcher, "?").handled).toBe(false);
    expect(dispatchKey(dispatcher, "f1")).toMatchObject({
      handled: true,
      action: "help.open",
    });
  });
});
