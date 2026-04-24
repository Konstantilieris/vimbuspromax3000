import { PRODUCT_NAME } from "@vimbuspromax3000/shared";
import { EXECUTION_COMMANDS } from "./execution";
import { MCP_COMMANDS } from "./mcp";
import { MODEL_COMMANDS } from "./models";
import { PLANNER_COMMANDS } from "./planner";

export const DASHBOARD_COLUMNS = [
  "Epics / Tasks",
  "Control Panel",
  "Eval / Tools / Logs",
] as const;

export function getDashboardLines(): string[] {
  return [
    `${PRODUCT_NAME} operator console`,
    DASHBOARD_COLUMNS.join(" | "),
    `Models: ${MODEL_COMMANDS.join(" ")}`,
    `MCP: ${MCP_COMMANDS.join(" ")}`,
    `Planner: ${PLANNER_COMMANDS.join(" ")}`,
    `Execution: ${EXECUTION_COMMANDS.join(" ")}`,
    "No project loaded yet.",
    "Health: bootstrap placeholder",
  ];
}

export function getDashboardSnapshot(): string {
  return getDashboardLines().join("\n");
}
