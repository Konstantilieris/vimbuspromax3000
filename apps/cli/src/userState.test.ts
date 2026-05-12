import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDefaultUserState,
  getLastSelectedProject,
  readUserState,
  recordSelectedProject,
  resolveUserStatePath,
  writeUserState,
} from "./userState";

describe("CLI user state persistence", () => {
  test("resolves an explicit ignored state path from env", () => {
    const path = resolveUserStatePath({
      cwd: "C:\\repo",
      env: { TASKGOBLIN_CLI_STATE_PATH: ".ignored\\state.json" },
    });

    expect(path).toBe("C:\\repo\\.ignored\\state.json");
  });

  test("returns the default state when no file exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "taskgoblin-user-state-"));
    const state = readUserState({ path: join(dir, "missing.json") });

    expect(state).toEqual(createDefaultUserState());
  });

  test("records selected projects most-recent first and de-duplicates", () => {
    let state = createDefaultUserState();
    state = recordSelectedProject(
      state,
      { id: "project_1", name: "API", rootPath: "C:\\repo\\api" },
      { now: () => new Date("2026-05-11T10:00:00.000Z") },
    );
    state = recordSelectedProject(
      state,
      { id: "project_2", name: "Web", rootPath: "C:\\repo\\web" },
      { now: () => new Date("2026-05-11T11:00:00.000Z") },
    );
    state = recordSelectedProject(
      state,
      { id: "project_1", name: "API", rootPath: "C:\\repo\\api" },
      { now: () => new Date("2026-05-11T12:00:00.000Z") },
    );

    expect(state.lastSelectedProjectId).toBe("project_1");
    expect(state.recentProjects.map((project) => project.id)).toEqual(["project_1", "project_2"]);
    expect(getLastSelectedProject(state)?.selectedAt).toBe("2026-05-11T12:00:00.000Z");
  });

  test("accepts legacy lastProjectId as the last selected project", () => {
    const state = readUserState({
      path: "ignored",
      fs: {
        existsSync: () => true,
        readFileSync: () =>
          JSON.stringify({
            version: 1,
            lastProjectId: "project_1",
            recentProjects: [
              {
                id: "project_1",
                name: "API",
                rootPath: "C:\\repo\\api",
                selectedAt: "2026-05-11T10:00:00.000Z",
              },
            ],
          }),
        mkdirSync: () => undefined,
        writeFileSync: () => undefined,
        renameSync: () => undefined,
      },
    });

    expect(state.lastSelectedProjectId).toBe("project_1");
  });

  test("writes and reads JSON atomically", () => {
    const dir = mkdtempSync(join(tmpdir(), "taskgoblin-user-state-"));
    const path = join(dir, "cli-state.json");
    const state = recordSelectedProject(
      createDefaultUserState(),
      { id: "project_1", name: "API", rootPath: "C:\\repo\\api" },
      { now: () => new Date("2026-05-11T10:00:00.000Z") },
    );

    writeUserState(state, { path });

    expect(readUserState({ path })).toEqual(state);
  });
});
