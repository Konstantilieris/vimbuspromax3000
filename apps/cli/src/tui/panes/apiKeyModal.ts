import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";

export type ApiKeyModal = {
  root: BoxRenderable;
  input: InputRenderable;
  focus(): void;
  reset(): void;
  onSubmit(handler: (value: string) => void): void;
};

export function createApiKeyModal(renderer: CliRenderer): ApiKeyModal {
  const root = new BoxRenderable(renderer, {
    id: "api-key-modal",
    width: 64,
    height: 8,
    padding: 1,
    border: true,
    borderColor: "#3CA0FF",
    backgroundColor: "#0D131A",
    position: "absolute",
    top: 5,
    left: 6,
    zIndex: 70,
    flexDirection: "column",
  });

  const heading = new TextRenderable(renderer, {
    id: "api-key-heading",
    content: "Paste your Anthropic API key",
    fg: "#E7EDF3",
    attributes: 0b001,
  });

  const hint = new TextRenderable(renderer, {
    id: "api-key-hint",
    content: "Stored at ~/.claude/.credentials.json (mode 600). Esc cancels.",
    fg: "#7B8794",
  });

  const input = new InputRenderable(renderer, {
    id: "api-key-input",
    placeholder: "sk-ant-...",
    width: 60,
    backgroundColor: "#11181F",
    focusedBackgroundColor: "#11181F",
  });

  root.add(heading);
  root.add(hint);
  root.add(input);

  return {
    root,
    input,
    focus: () => input.focus(),
    reset: () => {
      input.value = "";
    },
    onSubmit: (handler) => {
      input.on(InputRenderableEvents.ENTER, () => handler(input.value.trim()));
    },
  };
}
