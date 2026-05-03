import { BoxRenderable, TextRenderable, type CliRenderer } from "@opentui/core";

export type HelpOverlay = {
  root: BoxRenderable;
};

const HELP_LINES = [
  "Keys (list view)",
  "  Tab / Shift-Tab    rotate focus across panes",
  "  ↑ / ↓              move task cursor",
  "  Enter              open task detail view",
  "  :                  open command palette",
  "  ?                  toggle this help",
  "  t                  test Claude slot",
  "  s                  switch project (open picker)",
  "  k                  paste Anthropic API key",
  "  l                  log in via Claude CLI",
  "  p                  open plan modal",
  "  a / g              (plan ready) approve / regenerate",
  "  r                  refresh / re-run boot",
  "  q  /  Ctrl-C       quit",
  "",
  "Keys (detail view)",
  "  b   create branch",
  "  x   start execution",
  "  v   start test-runs",
  "  e   evaluate patch",
  "  Esc back to list",
];

export function createHelp(renderer: CliRenderer): HelpOverlay {
  const root = new BoxRenderable(renderer, {
    id: "help-overlay",
    width: 56,
    height: HELP_LINES.length + 2,
    padding: 1,
    border: true,
    borderColor: "#3CA0FF",
    backgroundColor: "#0D131A",
    position: "absolute",
    top: 4,
    left: 4,
    zIndex: 50,
    flexDirection: "column",
  });

  for (const line of HELP_LINES) {
    root.add(
      new TextRenderable(renderer, {
        id: `help-${line}`,
        content: line,
        fg: line === "Keys" ? "#E7EDF3" : "#C9D2DB",
        attributes: line === "Keys" ? 0b001 : 0,
      }),
    );
  }

  return { root };
}
