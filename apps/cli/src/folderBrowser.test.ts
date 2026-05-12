import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyFolderBrowserEvent,
  createFolderBrowserState,
  getFolderBrowserSelection,
  getFolderBrowserSnapshot,
  listFolderBrowserEntries,
} from "./folderBrowser";

describe("folder browser", () => {
  test("lists directories before files and hides dot folders by default", () => {
    const root = createFixtureTree();

    const entries = listFolderBrowserEntries(root, { includeFiles: true, includeParent: false });

    expect(entries.map((entry) => `${entry.kind}:${entry.name}`)).toEqual([
      "directory:alpha",
      "directory:beta",
      "file:readme.md",
    ]);
  });

  test("opens the selected directory synchronously", () => {
    const root = createFixtureTree();
    let state = createFolderBrowserState(root, { includeParent: false });
    expect(getFolderBrowserSelection(state)?.name).toBe("alpha");

    state = applyFolderBrowserEvent(state, { type: "open" }, { includeParent: false }).state;

    expect(state.currentPath).toBe(join(root, "alpha"));
    expect(state.entries.map((entry) => entry.name)).toEqual(["nested"]);
  });

  test("can select the current folder for project creation", () => {
    const root = createFixtureTree();
    const state = createFolderBrowserState(root);
    const transition = applyFolderBrowserEvent(state, { type: "select-current" });

    expect(transition.action).toEqual({ type: "selected", path: root });
  });

  test("captures filesystem errors in state snapshots", () => {
    const root = createFixtureTree();
    const state = createFolderBrowserState(join(root, "missing"));

    expect(state.error).toContain("missing");
    expect(getFolderBrowserSnapshot(state)).toContain("Error:");
  });
});

function createFixtureTree(): string {
  const root = mkdtempSync(join(tmpdir(), "taskgoblin-folder-browser-"));
  mkdirSync(join(root, "beta"));
  mkdirSync(join(root, "alpha"));
  mkdirSync(join(root, "alpha", "nested"));
  mkdirSync(join(root, ".hidden"));
  writeFileSync(join(root, "readme.md"), "# fixture\n", "utf8");
  return root;
}
