import { getDashboardSnapshot } from "./dashboard";
import { isModelsCommand, runModelsCommand } from "./models";
import { isPlannerCommand, runPlannerCommand } from "./planner";

const args = process.argv.slice(2);
const isSmokeMode = args.includes("--smoke") || process.env.CI === "true" || !process.stdout.isTTY;
const isModelsMode = args.some(isModelsCommand);
const isPlannerMode = args.some(isPlannerCommand);

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

if (isSmokeMode) {
  console.log(getDashboardSnapshot());
  process.exit(0);
}

const { Box, Text, createCliRenderer } = await import("@opentui/core");

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  targetFps: 30,
});

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
        Text({ content: "Epics / Tasks", fg: "#8AD4FF" }),
        Text({ content: "No tasks loaded." }),
      ),
      Box(
        {
          flexGrow: 1,
          flexDirection: "column",
          padding: 1,
          borderStyle: "single",
        },
        Text({ content: "Control Panel", fg: "#A8E6A3" }),
        Text({ content: "Bootstrap placeholder." }),
      ),
      Box(
        {
          flexGrow: 1,
          flexDirection: "column",
          padding: 1,
          borderStyle: "single",
        },
        Text({ content: "Eval / Tools / Logs", fg: "#F5C982" }),
        Text({ content: "Waiting for API events." }),
      ),
    ),
  ),
);
