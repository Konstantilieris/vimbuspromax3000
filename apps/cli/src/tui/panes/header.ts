import { BoxRenderable, TextRenderable, type CliRenderer } from "@opentui/core";
import { PRODUCT_NAME } from "@vimbuspromax3000/shared";
import type { State } from "../state";

export type HeaderPane = {
  root: BoxRenderable;
  update(state: State): void;
};

export function createHeader(renderer: CliRenderer): HeaderPane {
  const root = new BoxRenderable(renderer, {
    id: "header",
    width: "100%",
    height: 1,
    flexDirection: "row",
    paddingLeft: 1,
    paddingRight: 1,
    backgroundColor: "#0F151B",
  });

  const title = new TextRenderable(renderer, {
    id: "header-title",
    content: `${PRODUCT_NAME} operator console`,
    fg: "#E7EDF3",
  });

  const breadcrumb = new TextRenderable(renderer, {
    id: "header-breadcrumb",
    content: "",
    fg: "#7B8794",
  });

  root.add(title);
  root.add(breadcrumb);

  function update(state: State): void {
    breadcrumb.content = `   ${describeMode(state)}`;
  }

  return { root, update };
}

function describeMode(state: State): string {
  if (state.view === "detail" && state.taskDetail.taskId) {
    const project = state.mode.kind === "ready" ? state.mode.project.name : "?";
    return `project ${project}  ›  task ${state.taskDetail.taskId}`;
  }
  switch (state.mode.kind) {
    case "boot":
      return "booting…";
    case "api-offline":
      return `API offline: ${state.mode.apiUrl}`;
    case "auth-missing":
      return "Anthropic API key missing";
    case "project-picker":
      return "select a project";
    case "ready":
      return `project ${state.mode.project.name}`;
  }
}
