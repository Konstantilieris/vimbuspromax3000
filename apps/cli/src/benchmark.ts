import { PRODUCT_NAME } from "@vimbuspromax3000/shared";

export const BENCHMARK_COMMANDS = ["benchmark"] as const;

export type BenchmarkCommandOptions = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
};

type ParsedOptions = Record<string, string | undefined>;

type ApiBenchmarkScenario = {
  id: string;
  name: string;
};

type ApiBenchmarkRunResponse = {
  run: {
    runId: string;
    verdict: string;
    aggregateScore: number;
    dimensionScores: ApiBenchmarkDimensionScore[];
  };
  evalRun?: {
    id: string;
  };
};

type ApiBenchmarkDimensionScore = {
  dimension: string;
  score: number;
  passThreshold: number;
  passed: boolean;
};

export function isBenchmarkCommand(value: string): boolean {
  return BENCHMARK_COMMANDS.includes(value as (typeof BENCHMARK_COMMANDS)[number]);
}

export async function runBenchmarkCommand(
  args: readonly string[],
  options: BenchmarkCommandOptions = {},
): Promise<string> {
  const commandIndex = args.findIndex(isBenchmarkCommand);
  if (commandIndex < 0) throw new Error("No benchmark command found.");

  const subcommand = args[commandIndex + 1];
  const parsed = parseOptions(args.filter((_, index) => index !== commandIndex && index !== commandIndex + 1));
  const apiUrl = withoutTrailingSlash(parsed["api-url"] ?? options.env?.VIMBUS_API_URL ?? "http://localhost:3000");
  const request = options.fetch ?? fetch;

  if (subcommand === "run") {
    return runBenchmarkScenario(apiUrl, parsed, request);
  }

  throw new Error("Unknown benchmark command. Use: benchmark run --execution <id>.");
}

export function getBenchmarkRunViewSnapshot(
  response: ApiBenchmarkRunResponse,
  scenario?: ApiBenchmarkScenario,
): string {
  const lines = [
    `${PRODUCT_NAME} benchmark run`,
    scenario ? `Scenario: ${scenario.name} (${scenario.id})` : null,
    `Run: ${response.run.runId}`,
    response.evalRun ? `EvalRun: ${response.evalRun.id}` : null,
    `Verdict: ${response.run.verdict}`,
    `Aggregate: ${formatScore(response.run.aggregateScore)}`,
    "Dimensions:",
    ...response.run.dimensionScores.map(formatDimensionScore),
  ];

  return lines.filter((line): line is string => typeof line === "string").join("\n");
}

async function runBenchmarkScenario(
  apiUrl: string,
  options: ParsedOptions,
  request: typeof fetch,
): Promise<string> {
  const executionId = requireOption(options, "execution");
  const scenarioId = options["scenario-id"] ?? options.scenario;
  const scenario = scenarioId ? undefined : await resolveBenchmarkScenario(apiUrl, executionId, options, request);
  const targetScenarioId = scenarioId ?? scenario?.id;

  if (!targetScenarioId) {
    throw new Error("Missing benchmark scenario id.");
  }
  const run = await requestJson<ApiBenchmarkRunResponse>(
    request,
    `${apiUrl}/benchmarks/scenarios/${encodeURIComponent(targetScenarioId)}/run`,
    {
      method: "POST",
      body: {
        taskExecutionId: executionId,
        ...(options["run-id"] ? { runId: options["run-id"] } : {}),
      },
    },
  );

  return getBenchmarkRunViewSnapshot(run, scenario);
}

async function resolveBenchmarkScenario(
  apiUrl: string,
  executionId: string,
  options: ParsedOptions,
  request: typeof fetch,
): Promise<ApiBenchmarkScenario> {
  const query = new URLSearchParams({
    taskExecutionId: executionId,
    status: options.status ?? "active",
  });

  if (options["project-id"]) {
    query.set("projectId", options["project-id"]);
  }

  const scenarios = await requestJson<ApiBenchmarkScenario[]>(
    request,
    `${apiUrl}/benchmarks/scenarios?${query.toString()}`,
  );

  if (scenarios.length === 0) {
    throw new Error("No active benchmark scenarios were found for this execution.");
  }

  return scenarios[0]!;
}

async function requestJson<T>(
  request: typeof fetch,
  url: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await request(url, {
    method: options.method ?? "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : undefined;

  if (!response.ok) {
    const message = isObject(payload) && typeof payload.error === "string" ? payload.error : response.statusText;
    throw new Error(`API ${response.status}: ${message}`);
  }

  return payload as T;
}

function formatDimensionScore(score: ApiBenchmarkDimensionScore) {
  return `- ${score.dimension}: ${formatScore(score.score)} / ${formatScore(score.passThreshold)} ${
    score.passed ? "passed" : "failed"
  }`;
}

function formatScore(score: number) {
  return Number.isInteger(score) ? String(score) : score.toFixed(2);
}

function parseOptions(args: readonly string[]): ParsedOptions {
  const parsed: ParsedOptions = {};

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (!token?.startsWith("--")) {
      continue;
    }

    const inlineValueIndex = token.indexOf("=");
    if (inlineValueIndex >= 0) {
      parsed[token.slice(2, inlineValueIndex)] = token.slice(inlineValueIndex + 1);
      continue;
    }

    const next = args[index + 1];
    parsed[token.slice(2)] = next && !next.startsWith("--") ? next : "true";

    if (next && !next.startsWith("--")) {
      index += 1;
    }
  }

  return parsed;
}

function requireOption(options: ParsedOptions, name: string): string {
  const value = options[name];

  if (!value || value === "true") {
    throw new Error(`Missing required option --${name}.`);
  }

  return value;
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function isObject(value: unknown): value is { error?: unknown } {
  return typeof value === "object" && value !== null;
}
