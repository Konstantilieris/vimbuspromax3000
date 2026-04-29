import { getDashboardSnapshot } from "./dashboard";
import { isBenchmarkCommand, runBenchmarkCommand } from "./benchmark";
import { isDogfoodCommand, runDogfoodCommand } from "./dogfood";
import { isExecutionCommand, runExecutionCommand } from "./execution";
import {
  LIVE_VIEW_PANES,
  applyLiveViewEvents,
  createLiveViewState,
  frameToLoopEvent,
  parseSseFrames,
  renderControlPane,
  renderEpicsPane,
  renderEvaluatorPane,
  type LiveViewState,
} from "./live";
import { isMcpCommand, runMcpCommand } from "./mcp";
import { isModelsCommand, runModelsCommand } from "./models";
import { isPlannerCommand, runPlannerCommand } from "./planner";
import { isSetupCommand, runSetupCommand } from "./setup";

const args = process.argv.slice(2);
const isSmokeMode = args.includes("--smoke") || process.env.CI === "true" || !process.stdout.isTTY;
const isSetupMode = args.some(isSetupCommand);
const isMcpMode = args.some(isMcpCommand);
const isModelsMode = args.some(isModelsCommand);
const isPlannerMode = args.some(isPlannerCommand);
const isExecutionMode = args.some(isExecutionCommand);
const isBenchmarkMode = args.some(isBenchmarkCommand);
const isDogfoodMode = args.some(isDogfoodCommand);
const projectIdArg = readArgValue(args, "--project-id");
const apiUrlArg = readArgValue(args, "--api-url") ?? process.env.VIMBUS_API_URL ?? "http://localhost:3000";

function readArgValue(input: readonly string[], flag: string): string | undefined {
  for (let i = 0; i < input.length; i += 1) {
    const token = input[i];
    if (token === flag) return input[i + 1];
    if (token?.startsWith(`${flag}=`)) return token.slice(flag.length + 1);
  }
  return undefined;
}

if (isSetupMode) {
  try {
    console.log(await runSetupCommand(args));
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (isMcpMode) {
  try {
    console.log(await runMcpCommand(args));
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (isModelsMode) {
  try {
    console.log(await runModelsCommand(args));
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (isPlannerMode) {
  try {
    console.log(await runPlannerCommand(args));
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (isExecutionMode) {
  try {
    console.log(await runExecutionCommand(args));
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (isBenchmarkMode) {
  try {
    console.log(await runBenchmarkCommand(args));
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (isDogfoodMode) {
  try {
    console.log(await runDogfoodCommand(args));
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (isSmokeMode) {
  console.log(getDashboardSnapshot());
  process.exit(0);
}

// VIM-36 Sprint 2: 3-pane live TUI subscribed to GET /events?stream=sse.
// Each pane has a dedicated `Text` node we mutate in place when new SSE
// frames arrive, so individual events do not cause a full re-render of the
// screen tree. The reducer + parser live in `./live.ts` so the snapshot test
// can exercise the same code path against a fixture event tape.
const { Box, Text, createCliRenderer } = await import("@opentui/core");

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  targetFps: 30,
});

// `Text(...)` returns a proxied vnode whose `.content` getter is typed as
// `StyledText`, but the underlying setter also accepts plain `string`. We
// route writes through `setContent` to keep the rest of the file free of
// `as any` casts.
const epicsText = Text({ content: "No epics yet." });
const controlText = Text({ content: "Idle." });
const evaluatorText = Text({ content: "No evaluator activity." });

function setContent(node: { content: unknown }, value: string): void {
  (node as { content: string }).content = value;
}

renderer.root.add(
  Box(
    {
      width: "100%",
      height: "100%",
      flexDirection: "column",
      padding: 1,
      gap: 1,
      backgroundColor: "#101418",
    },
    Text({
      content: "VimbusProMax3000",
      fg: "#E7EDF3",
    }),
    Box(
      {
        width: "100%",
        flexGrow: 1,
        flexDirection: "row",
        gap: 1,
      },
      Box(
        {
          flexGrow: 1,
          flexDirection: "column",
          padding: 1,
          borderStyle: "single",
        },
        Text({ content: LIVE_VIEW_PANES[0], fg: "#8AD4FF" }),
        epicsText,
      ),
      Box(
        {
          flexGrow: 1,
          flexDirection: "column",
          padding: 1,
          borderStyle: "single",
        },
        Text({ content: LIVE_VIEW_PANES[1], fg: "#A8E6A3" }),
        controlText,
      ),
      Box(
        {
          flexGrow: 1,
          flexDirection: "column",
          padding: 1,
          borderStyle: "single",
        },
        Text({ content: LIVE_VIEW_PANES[2], fg: "#F5C982" }),
        evaluatorText,
      ),
    ),
  ),
);

if (projectIdArg) {
  void runLiveSubscription(projectIdArg, apiUrlArg);
} else {
  setContent(controlText, "Pass --project-id <id> to subscribe to /events?stream=sse.");
}

async function runLiveSubscription(projectId: string, apiUrl: string): Promise<void> {
  let state: LiveViewState = createLiveViewState();
  const updatePanes = (next: LiveViewState) => {
    state = next;
    // Strip the header line — the OpenTUI Box already labels each pane.
    setContent(epicsText, stripHeader(renderEpicsPane(state), LIVE_VIEW_PANES[0]));
    setContent(controlText, stripHeader(renderControlPane(state), LIVE_VIEW_PANES[1]));
    setContent(evaluatorText, stripHeader(renderEvaluatorPane(state), LIVE_VIEW_PANES[2]));
  };

  try {
    const url = `${apiUrl.replace(/\/$/, "")}/events?projectId=${encodeURIComponent(projectId)}&stream=sse`;
    const response = await fetch(url, { headers: { accept: "text/event-stream" } });
    if (!response.ok || !response.body) {
      setContent(controlText, `SSE connect failed: HTTP ${response.status}`);
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { frames, remainder } = parseSseFrames(buffer);
      buffer = remainder;
      const incoming = frames
        .map(frameToLoopEvent)
        .filter((event): event is NonNullable<ReturnType<typeof frameToLoopEvent>> => event !== undefined);
      if (incoming.length > 0) {
        updatePanes(applyLiveViewEvents(state, incoming));
      }
    }
  } catch (error) {
    setContent(controlText, `SSE error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function stripHeader(rendered: string, header: string): string {
  if (rendered.startsWith(`${header}\n`)) return rendered.slice(header.length + 1);
  if (rendered === header) return "";
  return rendered;
}
