import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

export const USER_STATE_VERSION = 1;
export const DEFAULT_USER_STATE_DIR = ".taskgoblin";
export const DEFAULT_USER_STATE_FILE = "cli-state.json";
export const MAX_RECENT_PROJECTS = 10;

export type UserStateProjectRef = {
  id: string;
  name: string;
  rootPath: string;
  selectedAt: string;
};

export type UserState = {
  version: typeof USER_STATE_VERSION;
  lastSelectedProjectId?: string;
  recentProjects: UserStateProjectRef[];
};

export type UserStatePathOptions = {
  env?: Record<string, string | undefined>;
  home?: string;
  cwd?: string;
};

export type UserStateFs = {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: "utf8"): string;
  mkdirSync(path: string, options: { recursive: true }): unknown;
  writeFileSync(path: string, data: string, encoding: "utf8"): void;
  renameSync(oldPath: string, newPath: string): void;
};

export type UserStateIoOptions = UserStatePathOptions & {
  fs?: UserStateFs;
  path?: string;
};

const DEFAULT_FS: UserStateFs = {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
};

export function createDefaultUserState(): UserState {
  return {
    version: USER_STATE_VERSION,
    recentProjects: [],
  };
}

export function resolveUserStatePath(options: UserStatePathOptions = {}): string {
  const env = options.env ?? process.env;
  const explicitPath = env.TASKGOBLIN_CLI_STATE_PATH;
  if (explicitPath) {
    return resolve(options.cwd ?? process.cwd(), explicitPath);
  }

  const home = options.home ?? env.USERPROFILE ?? env.HOME ?? homedir();
  return resolve(home, DEFAULT_USER_STATE_DIR, DEFAULT_USER_STATE_FILE);
}

export function readUserState(options: UserStateIoOptions = {}): UserState {
  const fs = options.fs ?? DEFAULT_FS;
  const path = options.path ?? resolveUserStatePath(options);

  if (!fs.existsSync(path)) {
    return createDefaultUserState();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not read user state at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }

  return parseUserState(parsed);
}

export function writeUserState(state: UserState, options: UserStateIoOptions = {}): void {
  const fs = options.fs ?? DEFAULT_FS;
  const path = options.path ?? resolveUserStatePath(options);
  const dir = dirname(path);
  const tempPath = `${path}.tmp`;
  const normalized = parseUserState(state);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tempPath, JSON.stringify(normalized, null, 2) + "\n", "utf8");
  fs.renameSync(tempPath, path);
}

export function recordSelectedProject(
  state: UserState,
  project: { id: string; name: string; rootPath: string },
  options: { now?: () => Date; maxRecentProjects?: number } = {},
): UserState {
  const selectedAt = (options.now ?? (() => new Date()))().toISOString();
  const recentProject: UserStateProjectRef = {
    id: project.id,
    name: project.name,
    rootPath: project.rootPath,
    selectedAt,
  };
  const maxRecentProjects = options.maxRecentProjects ?? MAX_RECENT_PROJECTS;
  const remaining = state.recentProjects.filter((entry) => entry.id !== project.id);

  return {
    version: USER_STATE_VERSION,
    lastSelectedProjectId: project.id,
    recentProjects: [recentProject, ...remaining].slice(0, Math.max(0, maxRecentProjects)),
  };
}

export function getLastSelectedProject(state: UserState): UserStateProjectRef | undefined {
  if (!state.lastSelectedProjectId) return undefined;
  return state.recentProjects.find((project) => project.id === state.lastSelectedProjectId);
}

export function parseUserState(value: unknown): UserState {
  if (!isRecord(value)) {
    throw new Error("User state must be a JSON object.");
  }

  const recentProjects = Array.isArray(value.recentProjects)
    ? value.recentProjects.map(parseProjectRef).filter((entry): entry is UserStateProjectRef => entry !== undefined)
    : [];
  const legacyLastProjectId = typeof value.lastProjectId === "string" ? value.lastProjectId : undefined;
  const lastSelectedProjectId = typeof value.lastSelectedProjectId === "string"
    ? value.lastSelectedProjectId
    : legacyLastProjectId ?? recentProjects[0]?.id;

  return {
    version: USER_STATE_VERSION,
    ...(lastSelectedProjectId ? { lastSelectedProjectId } : {}),
    recentProjects,
  };
}

function parseProjectRef(value: unknown): UserStateProjectRef | undefined {
  if (!isRecord(value)) return undefined;
  const id = value.id;
  const name = value.name;
  const rootPath = value.rootPath;
  const selectedAt = value.selectedAt;
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof rootPath !== "string" ||
    typeof selectedAt !== "string"
  ) {
    return undefined;
  }
  return { id, name, rootPath, selectedAt };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
