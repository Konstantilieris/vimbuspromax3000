import { ApiHttpError, ApiNetworkError } from "./errors";

export type FetchLike = typeof fetch;

export type RequestOptions = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
  signal?: AbortSignal;
};

export type RequestContext = {
  baseUrl: string;
  fetch: FetchLike;
};

export async function request<T>(
  ctx: RequestContext,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const url = buildUrl(ctx.baseUrl, path, options.query);
  const init: RequestInit = {
    method: options.method ?? "GET",
    signal: options.signal,
  };

  if (options.body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await ctx.fetch(url, init);
  } catch (error) {
    throw new ApiNetworkError(
      `Failed to reach ${url}: ${formatError(error)}`,
      error,
    );
  }

  const text = await response.text();
  let payload: unknown;

  if (text.length === 0) {
    payload = undefined;
  } else {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      if (response.ok) {
        throw new ApiHttpError(response.status, `Invalid JSON from ${url}: ${formatError(error)}`);
      }
      throw new ApiHttpError(response.status, response.statusText || "request failed", {
        body: text,
      });
    }
  }

  if (!response.ok) {
    const message = extractMessage(payload) ?? response.statusText ?? "request failed";
    const code = extractCode(payload);
    throw new ApiHttpError(response.status, message, { code, body: payload });
  }

  return payload as T;
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | undefined | null>,
): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const search = buildQuery(query);
  return `${trimmed}${normalizedPath}${search}`;
}

function buildQuery(query?: Record<string, string | number | undefined | null>): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.append(key, String(value));
  }
  const out = params.toString();
  return out.length > 0 ? `?${out}` : "";
}

function extractMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const value = payload.error ?? payload.message;
  return typeof value === "string" ? value : undefined;
}

function extractCode(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const value = payload.code;
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
