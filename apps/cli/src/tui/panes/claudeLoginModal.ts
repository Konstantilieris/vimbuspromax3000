import {
  BoxRenderable,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import type { State } from "../state";

export type ClaudeLoginModalPane = {
  root: BoxRenderable;
  update(state: State): void;
};

const ACCENT = "#3CA0FF";
const TITLE_FG = "#E7EDF3";
const FG = "#C9D2DB";
const MUTED = "#7B8794";
const OK_FG = "#A8E6A3";
const WARN_FG = "#F5C982";
const ERROR_FG = "#F5736E";

export function createClaudeLoginModal(renderer: CliRenderer): ClaudeLoginModalPane {
  const root = new BoxRenderable(renderer, {
    id: "claude-login-modal",
    width: 78,
    height: 18,
    padding: 1,
    border: true,
    borderColor: ACCENT,
    backgroundColor: "#0D131A",
    position: "absolute",
    top: 4,
    left: 5,
    zIndex: 75,
    flexDirection: "column",
  });

  const heading = new TextRenderable(renderer, {
    id: "claude-login-heading",
    content: "Log in via Claude CLI",
    fg: TITLE_FG,
    attributes: 0b001,
  });

  const subhead = new TextRenderable(renderer, {
    id: "claude-login-subhead",
    content:
      "Anthropic doesn't expose a public OAuth flow, so this drives the official `claude` CLI.",
    fg: MUTED,
  });

  const cliStatus = new TextRenderable(renderer, {
    id: "claude-login-cli-status",
    content: "",
    fg: FG,
  });

  const authStatus = new TextRenderable(renderer, {
    id: "claude-login-auth-status",
    content: "",
    fg: FG,
  });

  const instructionsTitle = new TextRenderable(renderer, {
    id: "claude-login-instructions-title",
    content: "Steps",
    fg: TITLE_FG,
    attributes: 0b001,
  });

  const instructions = new TextRenderable(renderer, {
    id: "claude-login-instructions",
    content: "",
    fg: FG,
  });

  const footer = new TextRenderable(renderer, {
    id: "claude-login-footer",
    content: "[d] re-detect  •  [r] refresh credentials  •  Esc close",
    fg: MUTED,
  });

  root.add(heading);
  root.add(subhead);
  root.add(cliStatus);
  root.add(authStatus);
  root.add(instructionsTitle);
  root.add(instructions);
  root.add(footer);

  function update(state: State): void {
    cliStatus.content = describeCli(state);
    cliStatus.fg = colorForCli(state);
    authStatus.content = describeAuth(state);
    authStatus.fg = colorForAuth(state);
    instructions.content = describeInstructions(state);
  }

  return { root, update };
}

function describeCli(state: State): string {
  switch (state.claudeLogin.phase) {
    case "idle":
      return "CLI: not yet detected — press [d]";
    case "detecting":
      return "CLI: probing PATH for `claude`…";
    case "detected": {
      const version = state.claudeLogin.cliVersion ?? "unknown version";
      return `CLI: ✓ ${state.claudeLogin.cliPath} (${version})`;
    }
    case "missing":
      return `CLI: ✗ ${state.claudeLogin.error ?? "claude not found on PATH"}`;
    case "error":
      return `CLI: error — ${state.claudeLogin.error ?? "unknown"}`;
  }
}

function colorForCli(state: State): string {
  if (state.claudeLogin.phase === "detected") return OK_FG;
  if (state.claudeLogin.phase === "missing" || state.claudeLogin.phase === "error") {
    return ERROR_FG;
  }
  return FG;
}

function describeAuth(state: State): string {
  if (state.auth.source === "claude-cli") {
    return "auth: ✓ credentials present (source=claude-cli)";
  }
  if (state.auth.source) {
    return `auth: ✓ credentials present (source=${state.auth.source})`;
  }
  if (state.auth.reason) {
    return `auth: ✗ no credentials (${state.auth.reason})`;
  }
  return "auth: pending";
}

function colorForAuth(state: State): string {
  if (state.auth.source === "claude-cli") return OK_FG;
  if (state.auth.source) return WARN_FG;
  return ERROR_FG;
}

function describeInstructions(state: State): string {
  const haveCli = state.claudeLogin.phase === "detected";
  const haveAuth = state.auth.source === "claude-cli";

  if (haveCli && haveAuth) {
    return [
      "Already logged in via the Claude CLI — nothing to do.",
      "Press Esc to close, or [r] to re-verify credentials.",
    ].join("\n");
  }

  if (haveCli) {
    return [
      "1. Open a separate terminal and run:",
      "     claude login",
      "2. Complete the browser flow Anthropic opens.",
      "3. Return here and press [r] to re-check ~/.claude/.credentials.json.",
    ].join("\n");
  }

  return [
    "Claude CLI is not installed (or not on PATH).",
    "1. Install per Anthropic's docs (npm i -g @anthropic-ai/claude-code, then `claude`).",
    "2. Reopen this modal and press [d] to re-detect.",
    "3. Or use [k] from the main view to paste an API key instead.",
  ].join("\n");
}
