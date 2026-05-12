export const TUI_THEME = {
  colors: {
    background: "#000000",
    surface: "#050505",
    surfaceRaised: "#0A0A0A",
    border: "#2A2A2A",
    borderSubtle: "#1A1A1A",
    borderFocused: "#FAFAFA",
    text: "#EDEDED",
    textMuted: "#A1A1A1",
    textFaint: "#666666",
    inverseText: "#000000",
    inverseSurface: "#F5F5F5",
  },
  panel: {
    borderStyle: "single" as const,
    padding: 1,
  },
  copy: {
    appTitle: "VimbusProMax3000",
    prompt: "/review:list",
    commandHint: "Type a slash command, then Enter.",
  },
} as const;

export type TuiTheme = typeof TUI_THEME;

