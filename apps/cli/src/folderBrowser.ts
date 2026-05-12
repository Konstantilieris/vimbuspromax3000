import { readdirSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export type FolderBrowserEntryKind = "parent" | "directory" | "file";

export type FolderBrowserEntry = {
  name: string;
  path: string;
  kind: FolderBrowserEntryKind;
};

export type FolderBrowserState = {
  currentPath: string;
  entries: FolderBrowserEntry[];
  selectedIndex: number;
  error?: string;
};

export type FolderBrowserEvent =
  | { type: "move"; direction: "up" | "down" | "first" | "last"; amount?: number }
  | { type: "open" }
  | { type: "back" }
  | { type: "refresh" }
  | { type: "select-current" }
  | { type: "select-entry" }
  | { type: "cancel" };

export type FolderBrowserAction =
  | { type: "selected"; path: string }
  | { type: "cancel" };

export type FolderBrowserTransition = {
  state: FolderBrowserState;
  action?: FolderBrowserAction;
};

export type FolderBrowserDirent = {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
};

export type FolderBrowserStats = {
  isDirectory(): boolean;
};

export type FolderBrowserFs = {
  readdirSync(path: string, options: { withFileTypes: true }): FolderBrowserDirent[];
  statSync(path: string): FolderBrowserStats;
};

export type FolderBrowserOptions = {
  fs?: FolderBrowserFs;
  cwd?: string;
  showHidden?: boolean;
  includeFiles?: boolean;
  includeParent?: boolean;
  maxEntries?: number;
};

const DEFAULT_FS: FolderBrowserFs = { readdirSync, statSync };

export function listFolderBrowserEntries(
  directory: string,
  options: FolderBrowserOptions = {},
): FolderBrowserEntry[] {
  const fs = options.fs ?? DEFAULT_FS;
  const currentPath = resolveFolderBrowserPath(directory, options.cwd);
  const stats = fs.statSync(currentPath);

  if (!stats.isDirectory()) {
    throw new Error(`Not a directory: ${currentPath}`);
  }

  const entries: FolderBrowserEntry[] = [];
  const parentPath = dirname(currentPath);
  if (options.includeParent !== false && parentPath !== currentPath) {
    entries.push({ name: "..", path: parentPath, kind: "parent" });
  }

  for (const dirent of fs.readdirSync(currentPath, { withFileTypes: true })) {
    if (!options.showHidden && isHiddenName(dirent.name)) continue;

    if (dirent.isDirectory()) {
      entries.push({ name: dirent.name, path: join(currentPath, dirent.name), kind: "directory" });
      continue;
    }

    if (options.includeFiles && dirent.isFile()) {
      entries.push({ name: dirent.name, path: join(currentPath, dirent.name), kind: "file" });
    }
  }

  const sorted = entries.sort(compareFolderBrowserEntries);
  return typeof options.maxEntries === "number" ? sorted.slice(0, Math.max(0, options.maxEntries)) : sorted;
}

export function createFolderBrowserState(
  directory = ".",
  options: FolderBrowserOptions = {},
): FolderBrowserState {
  const currentPath = resolveFolderBrowserPath(directory, options.cwd);
  try {
    return {
      currentPath,
      entries: listFolderBrowserEntries(currentPath, options),
      selectedIndex: 0,
    };
  } catch (error) {
    return {
      currentPath,
      entries: [],
      selectedIndex: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function applyFolderBrowserEvent(
  state: FolderBrowserState,
  event: FolderBrowserEvent,
  options: FolderBrowserOptions = {},
): FolderBrowserTransition {
  switch (event.type) {
    case "move":
      return { state: moveFolderBrowserSelection(state, event.direction, event.amount) };
    case "open":
      return { state: openFolderBrowserSelection(state, options) };
    case "back":
      return { state: createFolderBrowserState(dirname(state.currentPath), options) };
    case "refresh":
      return { state: createFolderBrowserState(state.currentPath, options) };
    case "select-current":
      return { state, action: { type: "selected", path: state.currentPath } };
    case "select-entry": {
      const selected = getFolderBrowserSelection(state);
      return { state, action: { type: "selected", path: selected?.path ?? state.currentPath } };
    }
    case "cancel":
      return { state, action: { type: "cancel" } };
  }
}

export const reduceFolderBrowser = applyFolderBrowserEvent;

export function getFolderBrowserSelection(state: FolderBrowserState): FolderBrowserEntry | undefined {
  return state.entries[clampIndex(state.selectedIndex, state.entries.length)];
}

export function moveFolderBrowserSelection(
  state: FolderBrowserState,
  direction: "up" | "down" | "first" | "last",
  amount = 1,
): FolderBrowserState {
  if (state.entries.length === 0) return { ...state, selectedIndex: 0 };

  switch (direction) {
    case "up":
      return { ...state, selectedIndex: clampIndex(state.selectedIndex - amount, state.entries.length) };
    case "down":
      return { ...state, selectedIndex: clampIndex(state.selectedIndex + amount, state.entries.length) };
    case "first":
      return { ...state, selectedIndex: 0 };
    case "last":
      return { ...state, selectedIndex: state.entries.length - 1 };
  }
}

export function openFolderBrowserSelection(
  state: FolderBrowserState,
  options: FolderBrowserOptions = {},
): FolderBrowserState {
  const selected = getFolderBrowserSelection(state);
  if (!selected || selected.kind === "file") {
    return state;
  }
  return createFolderBrowserState(selected.path, options);
}

export function getFolderBrowserSnapshot(state: FolderBrowserState): string {
  const lines = ["Folder browser", state.currentPath];
  if (state.error) {
    lines.push(`Error: ${state.error}`);
    return lines.join("\n");
  }
  if (state.entries.length === 0) {
    lines.push("(empty)");
    return lines.join("\n");
  }
  state.entries.forEach((entry, index) => {
    const marker = index === clampIndex(state.selectedIndex, state.entries.length) ? ">" : " ";
    lines.push(`${marker} ${entry.name}${entry.kind === "directory" || entry.kind === "parent" ? "/" : ""}`);
  });
  return lines.join("\n");
}

export function resolveFolderBrowserPath(path: string, cwd = process.cwd()): string {
  return isAbsolute(path) ? resolve(path) : resolve(cwd, path);
}

function compareFolderBrowserEntries(a: FolderBrowserEntry, b: FolderBrowserEntry): number {
  const kindOrder = (entry: FolderBrowserEntry) => {
    if (entry.kind === "parent") return 0;
    if (entry.kind === "directory") return 1;
    return 2;
  };
  const kindDiff = kindOrder(a) - kindOrder(b);
  if (kindDiff !== 0) return kindDiff;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function isHiddenName(name: string): boolean {
  return basename(name).startsWith(".");
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
}
