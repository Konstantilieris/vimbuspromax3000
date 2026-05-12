import { readFileSync } from "node:fs";
import { PRODUCT_NAME } from "@vimbuspromax3000/shared";

export const REVIEW_COMMANDS = ["/review:list", "/review:add", "/review:show"] as const;

export type ReviewCommandOptions = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
};

type ParsedOptions = Record<string, string | undefined>;

type ApiReviewArtifact = {
  id: string;
  projectId: string;
  subjectType: string;
  subjectId: string;
  title: string;
  status: string;
  stage: string;
  createdAt?: string;
};

export function isReviewCommand(value: string): boolean {
  return REVIEW_COMMANDS.includes(value as (typeof REVIEW_COMMANDS)[number]);
}

export async function runReviewCommand(
  args: readonly string[],
  options: ReviewCommandOptions = {},
): Promise<string> {
  const command = args.find(isReviewCommand);
  if (!command) throw new Error("No review command found.");

  const parsed = parseOptions(args.filter((arg) => arg !== command));
  const apiUrl = withoutTrailingSlash(parsed["api-url"] ?? options.env?.VIMBUS_API_URL ?? "http://localhost:3000");
  const request = options.fetch ?? fetch;

  switch (command) {
    case "/review:list":
      return runListReviews(apiUrl, parsed, request);
    case "/review:add":
      return runAddReview(apiUrl, parsed, request);
    case "/review:show":
      return getReviewShowSnapshot(apiUrl, requireOption(parsed, "artifact-id"));
  }

  throw new Error(`Unknown review command: ${command}`);
}

export function getReviewListSnapshot(artifacts: readonly ApiReviewArtifact[], apiUrl: string): string {
  const lines = [`${PRODUCT_NAME} markdown reviews`];

  if (artifacts.length === 0) {
    lines.push("No markdown reviews.");
    return lines.join("\n");
  }

  for (const artifact of artifacts) {
    lines.push(
      `- ${artifact.status} ${artifact.id} ${artifact.title} (${artifact.subjectType}/${artifact.subjectId}) ${apiUrl}/review/${artifact.id}`,
    );
  }

  return lines.join("\n");
}

export function getReviewShowSnapshot(apiUrl: string, artifactId: string): string {
  return [
    `${PRODUCT_NAME} markdown review`,
    `Artifact: ${artifactId}`,
    `Open: ${withoutTrailingSlash(apiUrl)}/review/${encodeURIComponent(artifactId)}`,
  ].join("\n");
}

async function runListReviews(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const query = new URLSearchParams();
  if (options["project-id"]) query.set("projectId", options["project-id"]);
  if (options["subject-type"]) query.set("subjectType", options["subject-type"]);
  if (options["subject-id"]) query.set("subjectId", options["subject-id"]);
  if (options.status) query.set("status", options.status);

  const artifacts = await requestJson<ApiReviewArtifact[]>(
    request,
    `${apiUrl}/review-artifacts${query.size > 0 ? `?${query.toString()}` : ""}`,
  );

  return getReviewListSnapshot(artifacts, apiUrl);
}

async function runAddReview(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const markdown = options.markdown ?? readFileSync(requireOption(options, "markdown-file"), "utf8");
  const artifact = await requestJson<ApiReviewArtifact>(request, `${apiUrl}/review-artifacts`, {
    method: "POST",
    body: {
      projectId: requireOption(options, "project-id"),
      subjectType: requireOption(options, "subject-type"),
      subjectId: requireOption(options, "subject-id"),
      title: requireOption(options, "title"),
      markdown,
      stage: options.stage ?? "review",
    },
  });

  return `Created markdown review ${artifact.id}: ${apiUrl}/review/${encodeURIComponent(artifact.id)}`;
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
