import { getDashboardSnapshot } from "./dashboard";
import { isExecutionCommand, runExecutionCommand } from "./execution";
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

if (isSmokeMode) {
  console.log(getDashboardSnapshot());
  process.exit(0);
}

const { launchTui } = await import("./tui/index");
await launchTui();
