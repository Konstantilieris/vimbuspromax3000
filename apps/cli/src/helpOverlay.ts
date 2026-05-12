import { getKeyDispatcherBindings, type KeyDispatcherState, type RegisteredKeyBinding } from "./keyDispatcher";

export type HelpOverlayState = {
  isOpen: boolean;
};

export type HelpOverlayEvent = { type: "open" } | { type: "close" } | { type: "toggle" } | { type: "escape" };

export function createHelpOverlayState(options: { isOpen?: boolean } = {}): HelpOverlayState {
  return {
    isOpen: options.isOpen ?? false,
  };
}

export function applyHelpOverlayEvent(state: HelpOverlayState, event: HelpOverlayEvent): HelpOverlayState {
  switch (event.type) {
    case "open":
      return { isOpen: true };
    case "close":
    case "escape":
      return { isOpen: false };
    case "toggle":
      return { isOpen: !state.isOpen };
  }
}

export const reduceHelpOverlay = applyHelpOverlayEvent;

export function getHelpOverlayBindings(dispatcher: KeyDispatcherState): RegisteredKeyBinding[] {
  return getKeyDispatcherBindings(dispatcher).filter((binding) => !binding.hidden);
}

export function getHelpOverlaySnapshot(state: HelpOverlayState, dispatcher: KeyDispatcherState): string {
  const lines = ["Keyboard help", `State: ${state.isOpen ? "open" : "closed"}`];
  const bindings = getHelpOverlayBindings(dispatcher);

  if (bindings.length === 0) {
    lines.push("No shortcuts registered.");
    return lines.join("\n");
  }

  let currentGroup = "";
  for (const binding of bindings) {
    const group = binding.group ?? "Shortcuts";
    if (group !== currentGroup) {
      currentGroup = group;
      lines.push(group);
    }

    lines.push(`- ${binding.keys.join(", ")}: ${binding.description}`);
  }

  return lines.join("\n");
}
