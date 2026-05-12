import { PRODUCT_NAME } from "@vimbuspromax3000/shared";

export const DESIGN_COMMANDS = [
  "/design",
  "/design:add",
  "/design:approve",
  "/design:results",
] as const;

export type DesignCommandOptions = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
};

type ParsedOptions = Record<string, string | undefined>;

type ApiSourceAsset = {
  id: string;
  projectId: string;
  taskId?: string | null;
  verificationItemId?: string | null;
  kind: string;
  relativePath: string;
  mimeType: string;
  sha256: string;
  width?: number | null;
  height?: number | null;
  pageCount?: number | null;
  comparisonMode?: string | null;
  status: string;
};

type ApiVisualResult = {
  id: string;
  taskExecutionId: string;
  verificationItemId?: string | null;
  sourceAssetId?: string | null;
  mode: string;
  status: string;
  actualPath?: string | null;
  diffPath?: string | null;
  reportPath?: string | null;
  diffRatio?: number | null;
  threshold?: number | null;
  createdAt?: string;
};

export function isDesignCommand(value: string): boolean {
  return DESIGN_COMMANDS.includes(value as (typeof DESIGN_COMMANDS)[number]);
}

export async function runDesignCommand(
  args: readonly string[],
  options: DesignCommandOptions = {},
): Promise<string> {
  const command = args.find(isDesignCommand) ?? "/design";
  const parsed = parseOptions(args.filter((arg) => arg !== command));
  const apiUrl = withoutTrailingSlash(parsed["api-url"] ?? options.env?.VIMBUS_API_URL ?? "http://localhost:3000");
  const request = options.fetch ?? fetch;

  switch (command) {
    case "/design":
      return runListDesignDocs(apiUrl, parsed, request);
    case "/design:add":
      return runAddDesignDoc(apiUrl, parsed, request);
    case "/design:approve":
      return runApproveDesignDoc(apiUrl, parsed, request);
    case "/design:results":
      return runDesignResults(apiUrl, parsed, request);
  }

  throw new Error(`Unknown design command: ${command}`);
}

export function getDesignDocsViewSnapshot(assets: readonly ApiSourceAsset[]): string {
  const lines = [`${PRODUCT_NAME} design docs`];

  if (assets.length === 0) {
    lines.push("No design docs.");
    return lines.join("\n");
  }

  for (const asset of assets) {
    lines.push(formatDesignDoc(asset));
  }

  return lines.join("\n");
}

export function getDesignResultsViewSnapshot(results: readonly ApiVisualResult[]): string {
  const lines = [`${PRODUCT_NAME} design results`];

  if (results.length === 0) {
    lines.push("No visual results.");
    return lines.join("\n");
  }

  for (const result of results) {
    lines.push(formatDesignResult(result));
  }

  return lines.join("\n");
}

async function runListDesignDocs(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const taskId = options["task-id"];
  const query = new URLSearchParams();

  if (options["verification-item-id"]) query.set("verificationItemId", options["verification-item-id"]);
  if (options.status) query.set("status", options.status);

  const url = taskId
    ? `${apiUrl}/tasks/${encodeURIComponent(taskId)}/source-assets`
    : `${apiUrl}/projects/${encodeURIComponent(requireOption(options, "project-id"))}/source-assets${
        query.size > 0 ? `?${query.toString()}` : ""
      }`;

  const assets = await requestJson<ApiSourceAsset[]>(request, url);
  return getDesignDocsViewSnapshot(assets);
}

async function runAddDesignDoc(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const projectId = requireOption(options, "project-id");
  const asset = await requestJson<ApiSourceAsset>(
    request,
    `${apiUrl}/projects/${encodeURIComponent(projectId)}/source-assets`,
    {
      method: "POST",
      body: {
        relativePath: requireOption(options, "path"),
        taskId: options["task-id"] ?? null,
        verificationItemId: options["verification-item-id"] ?? null,
        comparisonMode: options["comparison-mode"] ?? null,
        setAsExpectedAsset: parseBooleanOption(options["set-expected"]),
      },
    },
  );

  return `Added design doc ${asset.relativePath} (${asset.id}) status=${asset.status}.`;
}

async function runApproveDesignDoc(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const assetId = requireOption(options, "asset-id");
  const asset = await requestJson<ApiSourceAsset>(
    request,
    `${apiUrl}/source-assets/${encodeURIComponent(assetId)}/approve`,
    { method: "POST", body: {} },
  );

  return `Approved design doc ${asset.relativePath} (${asset.id}).`;
}

async function runDesignResults(apiUrl: string, options: ParsedOptions, request: typeof fetch) {
  const assetId = requireOption(options, "asset-id");
  const results = await requestJson<ApiVisualResult[]>(
    request,
    `${apiUrl}/source-assets/${encodeURIComponent(assetId)}/visual-results`,
  );

  return getDesignResultsViewSnapshot(results);
}

function formatDesignDoc(asset: ApiSourceAsset): string {
  const dims = formatDimensions(asset);
  const task = asset.taskId ? ` task=${asset.taskId}` : "";
  const item = asset.verificationItemId ? ` item=${asset.verificationItemId}` : "";
  const mode = asset.comparisonMode ? ` mode=${asset.comparisonMode}` : "";

  return `- ${asset.status} ${asset.kind} ${asset.relativePath}${dims} ${asset.id}${task}${item}${mode}`;
}

function formatDesignResult(result: ApiVisualResult): string {
  const ratio = typeof result.diffRatio === "number" ? ` diff=${formatRatio(result.diffRatio)}` : "";
  const threshold = typeof result.threshold === "number" ? ` threshold=${formatRatio(result.threshold)}` : "";
  const item = result.verificationItemId ? ` item=${result.verificationItemId}` : "";
  const diffPath = result.diffPath ? ` diffPath=${result.diffPath}` : "";

  return `- ${result.status} ${result.mode} ${result.taskExecutionId}${item}${ratio}${threshold}${diffPath}`;
}

function formatDimensions(asset: ApiSourceAsset): string {
  if (typeof asset.width === "number" && typeof asset.height === "number") {
    return ` ${asset.width}x${asset.height}`;
  }

  if (typeof asset.pageCount === "number") {
    return ` ${asset.pageCount}p`;
  }

  return "";
}

function formatRatio(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
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

function parseBooleanOption(value: string | undefined): boolean {
  return value === "true" || value === "1" || value === "yes";
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
