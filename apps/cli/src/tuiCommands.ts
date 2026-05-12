import { isBenchmarkCommand, runBenchmarkCommand } from "./benchmark";
import { isDesignCommand, runDesignCommand } from "./design";
import { isDogfoodCommand, runDogfoodCommand } from "./dogfood";
import { isExecutionCommand, runExecutionCommand } from "./execution";
import { isJiraCommand, runJiraCommand } from "./jira";
import { isMcpCommand, runMcpCommand } from "./mcp";
import { isModelsCommand, runModelsCommand } from "./models";
import { isPlannerCommand, runPlannerCommand } from "./planner";
import { isPlaywrightCommand, runPlaywrightCommand } from "./playwright";
import { isReviewCommand, runReviewCommand } from "./review";
import { isSetupCommand, runSetupCommand } from "./setup";
import { isValidationCommand, runValidationCommand } from "./validation";

export type TuiCommandOptions = {
  apiUrl: string;
  projectId?: string;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
};

export function parseTuiCommandLine(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;

  for (const char of input.trim()) {
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) args.push(current);

  return args;
}

export async function runTuiCommandLine(input: string, options: TuiCommandOptions): Promise<string> {
  const args = withTuiDefaults(parseTuiCommandLine(input), options);
  const command = args[0];

  if (!command) {
    return "Type a slash command.";
  }

  const commandOptions = {
    env: {
      ...options.env,
      VIMBUS_API_URL: options.apiUrl,
    },
    fetch: options.fetch,
  };

  if (isSetupCommand(command)) return runSetupCommand(args, commandOptions);
  if (isMcpCommand(command)) return runMcpCommand(args, commandOptions);
  if (isModelsCommand(command)) return runModelsCommand(args, commandOptions);
  if (isPlannerCommand(command)) return runPlannerCommand(args, commandOptions);
  if (isDesignCommand(command)) return runDesignCommand(args, commandOptions);
  if (isReviewCommand(command)) return runReviewCommand(args, commandOptions);
  if (isValidationCommand(command)) return runValidationCommand(args, commandOptions);
  if (isPlaywrightCommand(command)) return runPlaywrightCommand(args, commandOptions);
  if (isExecutionCommand(command)) return runExecutionCommand(args, commandOptions);
  if (isJiraCommand(command)) return runJiraCommand(args, commandOptions);
  if (isBenchmarkCommand(command)) return runBenchmarkCommand(args, commandOptions);
  if (isDogfoodCommand(command)) return runDogfoodCommand(args, commandOptions);

  throw new Error(`Unknown TUI command: ${command}`);
}

function withTuiDefaults(args: string[], options: TuiCommandOptions): string[] {
  if (args.length === 0) return args;

  const next = [...args];
  if (!hasOption(next, "api-url")) {
    next.push("--api-url", options.apiUrl);
  }
  if (options.projectId && !hasOption(next, "project-id")) {
    next.push("--project-id", options.projectId);
  }

  return next;
}

function hasOption(args: readonly string[], name: string): boolean {
  const flag = `--${name}`;
  return args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
}
