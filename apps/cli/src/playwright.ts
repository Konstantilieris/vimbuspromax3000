export const PLAYWRIGHT_COMMANDS = ["/playwright:generate"] as const;

export type PlaywrightCommandOptions = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
};

type ParsedOptions = Record<string, string | undefined>;

type GenerateSpecResponse = {
  artifactId: string;
  reviewUrl: string;
  stagingFilePath: string;
};

export function isPlaywrightCommand(value: string): boolean {
  return PLAYWRIGHT_COMMANDS.includes(value as (typeof PLAYWRIGHT_COMMANDS)[number]);
}

export async function runPlaywrightCommand(
  args: readonly string[],
  options: PlaywrightCommandOptions = {},
): Promise<string> {
  const command = args.find(isPlaywrightCommand);
  if (!command) throw new Error("No Playwright command found.");

  const parsed = parseOptions(args.filter((arg) => arg !== command));
  const apiUrl = withoutTrailingSlash(parsed["api-url"] ?? options.env?.VIMBUS_API_URL ?? "http://localhost:3000");
  const request = options.fetch ?? fetch;

  switch (command) {
    case "/playwright:generate":
      return runGenerateSpec(apiUrl, parsed, request);
  }

  throw new Error(`Unknown Playwright command: ${command}`);
}

async function runGenerateSpec(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const validationId = requireValidationId(options);
  const response = await requestJson<GenerateSpecResponse>(
    request,
    `${apiUrl}/validations/${encodeURIComponent(validationId)}/generate-spec`,
    {
      method: "POST",
      body: {
        route: getOptionValue(options, "route"),
      },
    },
  );

  return [
    `Generated Playwright spec for validation ${validationId}.`,
    `Artifact: ${response.artifactId}`,
    `Review: ${response.reviewUrl}`,
    `Staged: ${response.stagingFilePath}`,
  ].join("\n");
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
    throw new Error(`API ${response.status}: ${message}`, { cause: payload });
  }

  return payload as T;
}

function parseOptions(args: readonly string[]): ParsedOptions {
  const parsed: ParsedOptions = {};

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (!token?.startsWith("--")) {
      const position = nextPositionIndex(parsed);
      parsed[`_${position}`] = token;
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

function requireValidationId(options: ParsedOptions): string {
  const validationId = getOptionValue(options, "validation-id") ?? getOptionValue(options, "_0");

  if (!validationId) {
    throw new Error("Missing required option --validation-id or positional <validation-id>.");
  }

  return validationId;
}

function getOptionValue(options: ParsedOptions, name: string): string | null {
  const value = options[name];
  return value && value !== "true" ? value : null;
}

function nextPositionIndex(options: ParsedOptions) {
  let index = 0;

  while (options[`_${index}`] !== undefined) {
    index += 1;
  }

  return index;
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function isObject(value: unknown): value is { error?: unknown } {
  return typeof value === "object" && value !== null;
}
