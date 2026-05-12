import type { KeyBinding, KeyEventLike } from "./keyDispatcher";
import { normalizeKeyChord } from "./keyDispatcher";

export const FOCUS_PANES = [
  { id: "reviews", label: "Reviews", key: "f1" },
  { id: "tasks", label: "Tasks", key: "f2" },
  { id: "projects", label: "Projects", key: "f3" },
  { id: "logs", label: "Logs", key: "f4" },
] as const;

export type FocusPaneId = (typeof FOCUS_PANES)[number]["id"];

export type FocusPane = {
  id: FocusPaneId;
  label: string;
  key: string;
};

export type FocusState = {
  focusedPaneId: FocusPaneId;
  history: FocusPaneId[];
};

export type FocusAction =
  | { type: "set"; paneId: FocusPaneId }
  | { type: "move"; direction: "next" | "previous" };

export function createFocusState(initialPaneId: FocusPaneId = "reviews"): FocusState {
  assertFocusPaneId(initialPaneId);
  return {
    focusedPaneId: initialPaneId,
    history: [initialPaneId],
  };
}

export function setFocusedPane(state: FocusState, paneId: FocusPaneId): FocusState {
  assertFocusPaneId(paneId);
  if (state.focusedPaneId === paneId) return state;
  return {
    focusedPaneId: paneId,
    history: [...state.history, paneId],
  };
}

export function moveFocus(state: FocusState, direction: "next" | "previous"): FocusState {
  const currentIndex = FOCUS_PANES.findIndex((pane) => pane.id === state.focusedPaneId);
  const index = currentIndex < 0 ? 0 : currentIndex;
  const offset = direction === "next" ? 1 : -1;
  const nextIndex = (index + offset + FOCUS_PANES.length) % FOCUS_PANES.length;
  const nextPane = FOCUS_PANES[nextIndex];
  return nextPane ? setFocusedPane(state, nextPane.id) : state;
}

export function applyFocusAction(state: FocusState, action: FocusAction): FocusState {
  switch (action.type) {
    case "set":
      return setFocusedPane(state, action.paneId);
    case "move":
      return moveFocus(state, action.direction);
  }
}

export function applyFocusKey(state: FocusState, event: KeyEventLike): FocusState {
  const key = normalizeKeyChord(event);
  const pane = FOCUS_PANES.find((candidate) => normalizeKeyChord(candidate.key) === key);
  return pane ? setFocusedPane(state, pane.id) : state;
}

export function getFocusedPane(state: FocusState): FocusPane {
  return FOCUS_PANES.find((pane) => pane.id === state.focusedPaneId) ?? FOCUS_PANES[0];
}

export function getFocusKeyBindings(): KeyBinding[] {
  return FOCUS_PANES.map((pane) => ({
    id: `focus.${pane.id}`,
    key: pane.key,
    action: `focus.${pane.id}`,
    description: `Focus ${pane.label}`,
    group: "Focus",
  }));
}

export const FOCUS_KEY_BINDINGS = getFocusKeyBindings();

export function getFocusSnapshot(state: FocusState): string {
  const focusedPaneId = state.focusedPaneId;
  const lines = ["Focus"];
  for (const pane of FOCUS_PANES) {
    const marker = pane.id === focusedPaneId ? ">" : " ";
    lines.push(`${marker} ${pane.key.toUpperCase()} ${pane.label}`);
  }
  return lines.join("\n");
}

function assertFocusPaneId(value: string): asserts value is FocusPaneId {
  if (!FOCUS_PANES.some((pane) => pane.id === value)) {
    throw new Error(`Unknown focus pane: ${value}`);
  }
}
