import { BENCHMARK_COMMANDS } from "./benchmark";
import { DESIGN_COMMANDS } from "./design";
import { DOGFOOD_COMMANDS } from "./dogfood";
import { EXECUTION_COMMANDS } from "./execution";
import { JIRA_COMMANDS } from "./jira";
import { MCP_COMMANDS } from "./mcp";
import { MODEL_COMMANDS } from "./models";
import { PLANNER_COMMANDS } from "./planner";
import { PLAYWRIGHT_COMMANDS } from "./playwright";
import { REVIEW_COMMANDS } from "./review";
import { SETUP_COMMANDS } from "./setup";
import { VALIDATION_COMMANDS } from "./validation";

export type CommandPaletteRegistrySection = {
  group: string;
  commands: readonly string[];
};

export type CommandPaletteItem = {
  id: string;
  command: string;
  title: string;
  group: string;
  description: string;
  keywords: string[];
};

export type CommandPaletteState = {
  isOpen: boolean;
  query: string;
  selectedIndex: number;
  items: CommandPaletteItem[];
};

export type CommandPaletteEvent =
  | { type: "open" }
  | { type: "close" }
  | { type: "toggle" }
  | { type: "query"; value: string }
  | { type: "type"; value: string }
  | { type: "backspace" }
  | { type: "clear" }
  | { type: "move"; direction: "up" | "down" | "first" | "last"; amount?: number }
  | { type: "enter" }
  | { type: "escape" };

export type CommandPaletteAction = {
  type: "run-command";
  command: string;
};

export type CommandPaletteTransition = {
  state: CommandPaletteState;
  action?: CommandPaletteAction;
};

export const DEFAULT_COMMAND_PALETTE_REGISTRY: readonly CommandPaletteRegistrySection[] = [
  { group: "Setup", commands: SETUP_COMMANDS },
  { group: "Projects / Planning", commands: PLANNER_COMMANDS },
  { group: "Models", commands: MODEL_COMMANDS },
  { group: "MCP", commands: MCP_COMMANDS },
  { group: "Design", commands: DESIGN_COMMANDS },
  { group: "Review", commands: REVIEW_COMMANDS },
  { group: "Validation", commands: VALIDATION_COMMANDS },
  { group: "Playwright", commands: PLAYWRIGHT_COMMANDS },
  { group: "Execution", commands: EXECUTION_COMMANDS },
  { group: "Jira", commands: JIRA_COMMANDS },
  { group: "Benchmark", commands: BENCHMARK_COMMANDS },
  { group: "Dogfood", commands: DOGFOOD_COMMANDS },
];

export const DEFAULT_COMMAND_PALETTE_ITEMS = buildCommandPaletteItems(DEFAULT_COMMAND_PALETTE_REGISTRY);

export function buildCommandPaletteItems(
  registry: readonly CommandPaletteRegistrySection[],
): CommandPaletteItem[] {
  const items: CommandPaletteItem[] = [];
  const seen = new Set<string>();

  for (const section of registry) {
    for (const command of section.commands) {
      if (seen.has(command)) continue;
      seen.add(command);
      items.push({
        id: command,
        command,
        title: titleFromCommand(command),
        group: section.group,
        description: descriptionFromCommand(command, section.group),
        keywords: keywordsFromCommand(command, section.group),
      });
    }
  }

  return items;
}

export function createCommandPaletteState(
  items: readonly CommandPaletteItem[] = DEFAULT_COMMAND_PALETTE_ITEMS,
  options: { isOpen?: boolean; query?: string; selectedIndex?: number } = {},
): CommandPaletteState {
  return clampCommandPaletteSelection({
    isOpen: options.isOpen ?? false,
    query: options.query ?? "",
    selectedIndex: options.selectedIndex ?? 0,
    items: [...items],
  });
}

export function applyCommandPaletteEvent(
  state: CommandPaletteState,
  event: CommandPaletteEvent,
): CommandPaletteTransition {
  switch (event.type) {
    case "open":
      return { state: { ...state, isOpen: true } };
    case "close":
      return { state: { ...state, isOpen: false } };
    case "toggle":
      return { state: { ...state, isOpen: !state.isOpen } };
    case "query":
      return { state: clampCommandPaletteSelection({ ...state, query: event.value, selectedIndex: 0 }) };
    case "type":
      return {
        state: clampCommandPaletteSelection({ ...state, query: state.query + event.value, selectedIndex: 0 }),
      };
    case "backspace":
      return {
        state: clampCommandPaletteSelection({
          ...state,
          query: state.query.slice(0, Math.max(0, state.query.length - 1)),
          selectedIndex: 0,
        }),
      };
    case "clear":
      return { state: clampCommandPaletteSelection({ ...state, query: "", selectedIndex: 0 }) };
    case "move":
      return { state: moveCommandPaletteSelection(state, event.direction, event.amount) };
    case "enter": {
      const selected = getCommandPaletteSelection(state);
      if (!selected) return { state };
      return {
        state: { ...state, isOpen: false },
        action: { type: "run-command", command: selected.command },
      };
    }
    case "escape":
      return { state: { ...state, isOpen: false } };
  }
}

export const reduceCommandPalette = applyCommandPaletteEvent;

export function getCommandPaletteVisibleItems(state: CommandPaletteState): CommandPaletteItem[] {
  const query = normalizeSearch(state.query);
  if (!query) return [...state.items];
  const tokens = query.split(" ").filter(Boolean);

  return state.items
    .filter((item) => {
      const text = normalizeSearch([item.command, item.title, item.group, item.description, ...item.keywords].join(" "));
      return tokens.every((token) => text.includes(token));
    })
    .sort(comparePaletteItems(query));
}

export function getCommandPaletteSelection(state: CommandPaletteState): CommandPaletteItem | undefined {
  const visible = getCommandPaletteVisibleItems(state);
  return visible[clampIndex(state.selectedIndex, visible.length)];
}

export function moveCommandPaletteSelection(
  state: CommandPaletteState,
  direction: "up" | "down" | "first" | "last",
  amount = 1,
): CommandPaletteState {
  const length = getCommandPaletteVisibleItems(state).length;
  if (length === 0) return { ...state, selectedIndex: 0 };

  switch (direction) {
    case "up":
      return { ...state, selectedIndex: clampIndex(state.selectedIndex - amount, length) };
    case "down":
      return { ...state, selectedIndex: clampIndex(state.selectedIndex + amount, length) };
    case "first":
      return { ...state, selectedIndex: 0 };
    case "last":
      return { ...state, selectedIndex: length - 1 };
  }
}

export function getCommandPaletteSnapshot(state: CommandPaletteState): string {
  const visible = getCommandPaletteVisibleItems(state);
  const lines = ["Command palette", `State: ${state.isOpen ? "open" : "closed"}`, `Query: ${state.query || "(none)"}`];

  if (visible.length === 0) {
    lines.push("No matching commands.");
    return lines.join("\n");
  }

  visible.forEach((item, index) => {
    const marker = index === clampIndex(state.selectedIndex, visible.length) ? ">" : " ";
    lines.push(`${marker} ${item.command} - ${item.description}`);
  });

  return lines.join("\n");
}

function clampCommandPaletteSelection(state: CommandPaletteState): CommandPaletteState {
  return {
    ...state,
    selectedIndex: clampIndex(state.selectedIndex, getCommandPaletteVisibleItems(state).length),
  };
}

function comparePaletteItems(query: string) {
  return (a: CommandPaletteItem, b: CommandPaletteItem) => {
    const aScore = scorePaletteItem(a, query);
    const bScore = scorePaletteItem(b, query);
    if (aScore !== bScore) return bScore - aScore;
    return a.command.localeCompare(b.command);
  };
}

function scorePaletteItem(item: CommandPaletteItem, query: string): number {
  const command = normalizeSearch(item.command);
  const title = normalizeSearch(item.title);
  if (command === query) return 100;
  if (command.startsWith(query)) return 75;
  if (title.startsWith(query)) return 50;
  return 0;
}

function titleFromCommand(command: string): string {
  return command
    .replace(/^\//, "")
    .split(/[:\s-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toLocaleUpperCase() + part.slice(1))
    .join(" ");
}

function descriptionFromCommand(command: string, group: string): string {
  return `${titleFromCommand(command)} (${group})`;
}

function keywordsFromCommand(command: string, group: string): string[] {
  return [
    command.replace(/^\//, ""),
    ...command.replace(/^\//, "").split(/[:\s-]+/),
    group,
  ].map(normalizeSearch).filter(Boolean);
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
}
