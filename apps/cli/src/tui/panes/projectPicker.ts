import {
  BoxRenderable,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import type { State } from "../state";

export type ProjectPickerOverlay = {
  root: BoxRenderable;
  update(state: State): void;
};

export function createProjectPicker(renderer: CliRenderer): ProjectPickerOverlay {
  const root = new BoxRenderable(renderer, {
    id: "project-picker",
    width: 70,
    flexDirection: "column",
    padding: 1,
    border: true,
    borderColor: "#3CA0FF",
    backgroundColor: "#0D131A",
    position: "absolute",
    top: 3,
    left: 4,
    zIndex: 40,
  });

  const heading = new TextRenderable(renderer, {
    id: "project-picker-heading",
    content: "Select a project",
    fg: "#E7EDF3",
    attributes: 0b001,
  });

  const hint = new TextRenderable(renderer, {
    id: "project-picker-hint",
    content: "↑/↓ move   Enter select   Esc cancel",
    fg: "#7B8794",
  });

  const list = new BoxRenderable(renderer, {
    id: "project-picker-list",
    flexDirection: "column",
    paddingTop: 1,
  });

  root.add(heading);
  root.add(hint);
  root.add(list);

  const items: TextRenderable[] = [];

  function ensureCapacity(count: number): void {
    while (items.length < count) {
      const node = new TextRenderable(renderer, {
        id: `project-picker-item-${items.length}`,
        content: "",
        fg: "#C9D2DB",
      });
      items.push(node);
      list.add(node);
    }
    while (items.length > count) {
      const node = items.pop();
      if (node) list.remove(node.id);
    }
  }

  function update(state: State): void {
    if (state.mode.kind !== "project-picker") {
      ensureCapacity(0);
      return;
    }

    const mode = state.mode;
    const total = mode.projects.length + 1;
    ensureCapacity(total);

    mode.projects.forEach((project, index) => {
      const node = items[index];
      if (!node) return;
      const selected = index === mode.cursor;
      const marker = selected ? "›" : " ";
      node.content = `${marker} ${project.name.padEnd(28)} ${project.id}  ${project.rootPath}`;
      node.fg = selected ? "#3CA0FF" : "#C9D2DB";
    });

    const lastIndex = mode.projects.length;
    const newNode = items[lastIndex];
    if (newNode) {
      const selected = mode.cursor === lastIndex;
      const marker = selected ? "›" : " ";
      newNode.content = `${marker} (create new project — coming in PR-2)`;
      newNode.fg = selected ? "#3CA0FF" : "#7B8794";
    }
  }

  return { root, update };
}
