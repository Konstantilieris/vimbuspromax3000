// Confirms that the OpenTUI tree the TUI builds compiles, the native lib
// dlopens, and pane factories construct without throwing — without entering
// the keypress await loop. Useful to validate the render path on a non-TTY
// host where launchTui() can't run interactively.

import { createCliRenderer, BoxRenderable } from "@opentui/core";
import { initialState } from "../src/tui/state";
import { createHeader } from "../src/tui/panes/header";
import { createStatusBar } from "../src/tui/panes/statusBar";
import { createTasks } from "../src/tui/panes/tasks";
import { createControl } from "../src/tui/panes/control";
import { createLogs } from "../src/tui/panes/logs";
import { createHelp } from "../src/tui/panes/help";
import { createPalette } from "../src/tui/panes/palette";
import { createProjectPicker } from "../src/tui/panes/projectPicker";
import { createApiKeyModal } from "../src/tui/panes/apiKeyModal";

async function main(): Promise<void> {
  const renderer = await createCliRenderer({ exitOnCtrlC: false, targetFps: 1 });
  console.log("renderer created (FFI dlopen ok)");

  const root = new BoxRenderable(renderer, {
    id: "probe-root",
    flexDirection: "column",
  });
  renderer.root.add(root);

  const header = createHeader(renderer);
  const status = createStatusBar(renderer);
  const tasks = createTasks(renderer);
  const control = createControl(renderer);
  const logs = createLogs(renderer);
  const help = createHelp(renderer);
  const palette = createPalette(renderer);
  const projectPicker = createProjectPicker(renderer);
  const apiKeyModal = createApiKeyModal(renderer);

  console.log("all 9 panes constructed");

  root.add(header.root);
  root.add(tasks.root);
  root.add(control.root);
  root.add(logs.root);
  root.add(status.root);
  // overlays mounted on demand by index.ts; ensure they construct without
  // actually attaching to the root in this probe.
  void help;
  void palette;
  void projectPicker;
  void apiKeyModal;

  const state = initialState({ apiUrl: "http://probe" });
  header.update(state);
  tasks.update(state);
  control.update(state);
  logs.update(state);
  status.update(state);
  console.log("first state.update pass: ok");

  renderer.destroy();
  console.log("renderer destroyed cleanly");
}

main().catch((error) => {
  console.error("renderer probe failed:", error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
