import { BoxRenderable, TextRenderable, type CliRenderer } from "@opentui/core";
import type { State } from "../state";

export type StatusBarPane = {
  root: BoxRenderable;
  update(state: State): void;
};

export function createStatusBar(renderer: CliRenderer): StatusBarPane {
  const root = new BoxRenderable(renderer, {
    id: "status-bar",
    width: "100%",
    height: 1,
    flexDirection: "row",
    paddingLeft: 1,
    paddingRight: 1,
    backgroundColor: "#0B1014",
  });

  const left = new TextRenderable(renderer, {
    id: "status-left",
    content: "",
    fg: "#A6B1BC",
    flexGrow: 1,
  });

  const right = new TextRenderable(renderer, {
    id: "status-right",
    content: "",
    fg: "#7B8794",
  });

  root.add(left);
  root.add(right);

  function update(state: State): void {
    left.content = formatLeft(state);
    right.content = formatRight(state);
  }

  return { root, update };
}

function formatRight(state: State): string {
  if (state.view === "detail") {
    return "[b] branch  [x] exec  [v] verify  [e] eval  [Esc] back";
  }
  return "[?] help  [:] cmd  [p] plan  [l] login  [Tab] focus  [q] quit";
}

function formatLeft(state: State): string {
  const project =
    state.mode.kind === "ready" ? state.mode.project.name : "no project";

  const auth = state.auth.source ? `auth=${state.auth.source}` : "auth=missing";

  let slot: string;
  if (state.auth.slotResolved === true) {
    slot = "slot ✓";
  } else if (state.auth.slotResolved === false) {
    slot = "slot ✗";
  } else {
    slot = "slot ?";
  }

  const focus = `focus=${state.focus}`;

  return `${state.apiUrl}  •  ${project}  •  ${auth}  •  ${slot}  •  ${focus}`;
}
