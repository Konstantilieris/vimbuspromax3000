export type KeyScope = "global" | string;
export type KeyChord = string;

export type KeyEventLike =
  | string
  | {
      name?: string;
      key?: string;
      sequence?: string;
      ctrl?: boolean;
      meta?: boolean;
      shift?: boolean;
    };

export type KeyBinding = {
  id: string;
  key: KeyChord | readonly KeyChord[];
  description: string;
  action?: string;
  group?: string;
  scope?: KeyScope;
  priority?: number;
  hidden?: boolean;
};

export type RegisteredKeyBinding = Omit<KeyBinding, "key"> & {
  keys: KeyChord[];
  order: number;
};

export type KeyDispatcherState = {
  bindings: RegisteredKeyBinding[];
  activeScope: KeyScope;
};

export type KeyDispatchResult = {
  handled: boolean;
  key: KeyChord;
  action?: string;
  binding?: RegisteredKeyBinding;
};

export const GLOBAL_KEY_SCOPE: KeyScope = "global";

export const CORE_KEY_BINDINGS: readonly KeyBinding[] = [
  {
    id: "commandPalette.toggle",
    key: "ctrl+k",
    action: "commandPalette.toggle",
    description: "Open command palette",
    group: "Global",
  },
  {
    id: "help.toggle",
    key: "?",
    action: "help.toggle",
    description: "Toggle keyboard help",
    group: "Global",
  },
];

export const LIST_NAVIGATION_KEY_BINDINGS: readonly KeyBinding[] = [
  {
    id: "list.up",
    key: "up",
    action: "list.moveUp",
    description: "Move selection up",
    group: "Navigation",
  },
  {
    id: "list.down",
    key: "down",
    action: "list.moveDown",
    description: "Move selection down",
    group: "Navigation",
  },
  {
    id: "list.confirm",
    key: "enter",
    action: "list.confirm",
    description: "Choose selected item",
    group: "Navigation",
  },
];

export function createKeyDispatcher(
  bindings: readonly KeyBinding[] = [],
  options: { activeScope?: KeyScope } = {},
): KeyDispatcherState {
  const initialState: KeyDispatcherState = {
    bindings: [],
    activeScope: options.activeScope ?? GLOBAL_KEY_SCOPE,
  };

  return bindings.reduce<KeyDispatcherState>(
    (state, binding) => registerKeyBinding(state, binding),
    initialState,
  );
}

export function registerKeyBinding(state: KeyDispatcherState, binding: KeyBinding): KeyDispatcherState {
  const nextOrder = state.bindings.reduce((max, item) => Math.max(max, item.order), -1) + 1;
  const registered = normalizeBinding(binding, nextOrder);
  return {
    ...state,
    bindings: [
      ...state.bindings.filter((item) => item.id !== registered.id),
      registered,
    ],
  };
}

export function setKeyDispatcherScope(state: KeyDispatcherState, activeScope: KeyScope): KeyDispatcherState {
  return { ...state, activeScope };
}

export function dispatchKey(
  state: KeyDispatcherState,
  event: KeyEventLike,
  options: { scope?: KeyScope } = {},
): KeyDispatchResult {
  const key = normalizeKeyChord(event);
  const scope = options.scope ?? state.activeScope;
  const binding = state.bindings
    .filter((candidate) => candidate.keys.includes(key) && bindingAppliesToScope(candidate, scope))
    .sort(compareDispatchCandidates(scope))[0];

  if (!binding) {
    return { handled: false, key };
  }

  return {
    handled: true,
    key,
    action: binding.action ?? binding.id,
    binding,
  };
}

export function getKeyDispatcherBindings(state: KeyDispatcherState): RegisteredKeyBinding[] {
  return [...state.bindings].sort((a, b) => a.order - b.order);
}

export function normalizeKeyChord(event: KeyEventLike): KeyChord {
  if (typeof event === "string") {
    return normalizeChordString(event);
  }

  const name = event.name ?? event.key ?? event.sequence ?? "";
  const key = normalizeKeyName(name);
  const modifiers = [
    event.ctrl ? "ctrl" : undefined,
    event.meta ? "meta" : undefined,
    event.shift && shouldRenderShiftModifier(key) ? "shift" : undefined,
  ].filter((modifier): modifier is string => Boolean(modifier));

  return normalizeChordString([...modifiers, key].filter(Boolean).join("+"));
}

function normalizeBinding(binding: KeyBinding, order: number): RegisteredKeyBinding {
  const rawKeys = Array.isArray(binding.key) ? binding.key : [binding.key];
  return {
    ...binding,
    keys: rawKeys.map(normalizeKeyChord),
    scope: binding.scope ?? GLOBAL_KEY_SCOPE,
    priority: binding.priority ?? 0,
    order,
  };
}

function normalizeChordString(value: string): KeyChord {
  return value
    .trim()
    .replace(/\s+/g, "")
    .replace(/^control\+/i, "ctrl+")
    .replace(/^cmd\+/i, "meta+")
    .toLocaleLowerCase();
}

function normalizeKeyName(value: string): string {
  const normalized = value.trim().toLocaleLowerCase();
  switch (normalized) {
    case "\r":
    case "\n":
    case "return":
      return "enter";
    case "esc":
      return "escape";
    case "space":
    case " ":
      return "space";
    case "backspace":
    case "delete":
    case "tab":
    case "enter":
    case "escape":
    case "up":
    case "down":
    case "left":
    case "right":
    case "home":
    case "end":
    case "pageup":
    case "pagedown":
    case "f1":
    case "f2":
    case "f3":
    case "f4":
      return normalized;
    default:
      return normalized;
  }
}

function shouldRenderShiftModifier(key: string): boolean {
  return key.length > 1 && key !== "space";
}

function bindingAppliesToScope(binding: RegisteredKeyBinding, scope: KeyScope): boolean {
  return binding.scope === GLOBAL_KEY_SCOPE || binding.scope === scope;
}

function compareDispatchCandidates(scope: KeyScope) {
  return (a: RegisteredKeyBinding, b: RegisteredKeyBinding) => {
    const priorityDiff = (b.priority ?? 0) - (a.priority ?? 0);
    if (priorityDiff !== 0) return priorityDiff;

    const aScoped = a.scope === scope && a.scope !== GLOBAL_KEY_SCOPE ? 1 : 0;
    const bScoped = b.scope === scope && b.scope !== GLOBAL_KEY_SCOPE ? 1 : 0;
    const scopeDiff = bScoped - aScoped;
    if (scopeDiff !== 0) return scopeDiff;

    return b.order - a.order;
  };
}
