import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import type { State, PaletteCommand } from "../state";

export type PaletteOverlay = {
  root: BoxRenderable;
  input: InputRenderable;
  update(state: State): void;
  focus(): void;
  reset(): void;
  onInput(handler: (value: string) => void): void;
  getSelected(): PaletteCommand | undefined;
};

export function createPalette(renderer: CliRenderer): PaletteOverlay {
  const root = new BoxRenderable(renderer, {
    id: "palette-overlay",
    width: 60,
    height: 12,
    padding: 1,
    border: true,
    borderColor: "#3CA0FF",
    backgroundColor: "#0D131A",
    position: "absolute",
    top: 4,
    left: 8,
    zIndex: 60,
    flexDirection: "column",
  });

  const heading = new TextRenderable(renderer, {
    id: "palette-heading",
    content: "Command palette",
    fg: "#E7EDF3",
    attributes: 0b001,
  });

  const input = new InputRenderable(renderer, {
    id: "palette-input",
    placeholder: "type to filter…",
    width: 56,
    backgroundColor: "#11181F",
    focusedBackgroundColor: "#11181F",
  });

  const list = new BoxRenderable(renderer, {
    id: "palette-list",
    flexGrow: 1,
    flexDirection: "column",
  });

  root.add(heading);
  root.add(input);
  root.add(list);

  const itemNodes: TextRenderable[] = [];

  function ensureCapacity(count: number): void {
    while (itemNodes.length < count) {
      const node = new TextRenderable(renderer, {
        id: `palette-item-${itemNodes.length}`,
        content: "",
        fg: "#C9D2DB",
      });
      itemNodes.push(node);
      list.add(node);
    }
    while (itemNodes.length > count) {
      const node = itemNodes.pop();
      if (node) list.remove(node.id);
    }
  }

  function update(state: State): void {
    const commands = state.palette.commands;
    ensureCapacity(Math.max(commands.length, 1));
    if (commands.length === 0) {
      const empty = itemNodes[0];
      if (empty) {
        empty.content = "(no matches)";
        empty.fg = "#7B8794";
      }
      return;
    }
    commands.forEach((command, index) => {
      const node = itemNodes[index];
      if (!node) return;
      const selected = index === state.palette.cursor;
      const marker = selected ? "›" : " ";
      node.content = `${marker} ${command.label.padEnd(28)} ${command.hint}`;
      node.fg = selected ? "#3CA0FF" : "#C9D2DB";
    });
  }

  return {
    root,
    input,
    update,
    focus: () => input.focus(),
    reset: () => {
      input.value = "";
    },
    onInput: (handler) => {
      input.on(InputRenderableEvents.INPUT, () => handler(input.value));
    },
    getSelected: () => undefined,
  };
}
