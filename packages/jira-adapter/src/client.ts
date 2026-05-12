import { Buffer } from "node:buffer";
import type { JiraIssue } from "./mapping";

export type JiraAdapterEnv = Record<string, string | undefined>;
export type JiraFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type JiraHeaders = Record<string, string>;

export type JiraClientOptions = {
  fetch?: JiraFetch;
  env?: JiraAdapterEnv;
  apiVersion?: "2" | "3";
  apiBaseUrl?: string;
  cloudId?: string | null;
  siteUrl?: string | null;
  email?: string | null;
  apiToken?: string | null;
  authHeader?: string | null;
  maxResults?: number;
};

export type FetchIssuesByJqlInput = {
  jql: string;
  fields?: readonly string[];
  expand?: readonly string[] | string;
  properties?: readonly string[];
  fieldsByKeys?: boolean;
  failFast?: boolean;
  reconcileIssues?: readonly number[];
  maxResults?: number;
  pageLimit?: number;
};

export type JiraSearchResponse = {
  issues?: JiraIssue[];
  nextPageToken?: string;
  startAt?: number;
  maxResults?: number;
  total?: number;
  errorMessages?: string[];
  warningMessages?: string[];
};

export type JiraEpicWithChildren = {
  epic: JiraIssue;
  children: JiraIssue[];
  subtasks: JiraIssue[];
  issues: JiraIssue[];
};

export class JiraRestError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body: string;

  constructor(status: number, statusText: string, body: string) {
    super(`Jira REST request failed with ${status} ${statusText}: ${body}`);
    this.name = "JiraRestError";
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

export function createJiraClient(options: JiraClientOptions = {}) {
  return {
    fetchIssuesByJql: (input: FetchIssuesByJqlInput) => fetchIssuesByJql(input, options),
    fetchEpicWithChildren: (input: Omit<FetchEpicWithChildrenInput, "fields"> & { fields?: readonly string[] }) =>
      fetchEpicWithChildren(input, options),
  };
}

export async function fetchIssuesByJql(
  input: FetchIssuesByJqlInput,
  options: JiraClientOptions = {},
): Promise<JiraIssue[]> {
  if (!input.jql.trim()) {
    throw new Error("JQL is required.");
  }

  const fetchImpl = resolveFetch(options);
  const apiBaseUrl = resolveApiBaseUrl(options);
  const headers = buildHeaders(options);
  const maxResults = input.maxResults ?? options.maxResults ?? 100;
  const pageLimit = input.pageLimit ?? 100;
  const issues: JiraIssue[] = [];
  let nextPageToken: string | undefined;
  let startAt = 0;

  for (let page = 0; page < pageLimit; page += 1) {
    const url = new URL(`${apiBaseUrl}/search/jql`);
    url.searchParams.set("jql", input.jql);
    url.searchParams.set("maxResults", String(maxResults));

    appendParams(url, "fields", input.fields);
    appendParams(url, "properties", input.properties);
    appendExpand(url, input.expand);
    appendBooleanParam(url, "fieldsByKeys", input.fieldsByKeys);
    appendBooleanParam(url, "failFast", input.failFast);
    appendNumberParams(url, "reconcileIssues", input.reconcileIssues);

    if (nextPageToken) {
      url.searchParams.set("nextPageToken", nextPageToken);
    } else if (startAt > 0) {
      url.searchParams.set("startAt", String(startAt));
    }

    const response = await fetchImpl(url, {
      method: "GET",
      headers,
    });

    const bodyText = await response.text();

    if (!response.ok) {
      throw new JiraRestError(response.status, response.statusText, bodyText);
    }

    const body = parseSearchResponse(bodyText);
    issues.push(...(body.issues ?? []));

    if (body.nextPageToken) {
      nextPageToken = body.nextPageToken;
      continue;
    }

    const currentStart = body.startAt ?? startAt;
    const currentMax = body.maxResults ?? maxResults;
    const total = body.total;

    if (typeof total === "number" && currentMax > 0 && currentStart + currentMax < total) {
      startAt = currentStart + currentMax;
      nextPageToken = undefined;
      continue;
    }

    return issues;
  }

  throw new Error(`Jira search exceeded the page limit of ${pageLimit}.`);
}

export type FetchEpicWithChildrenInput = {
  epicKey: string;
  fields?: readonly string[];
  maxResults?: number;
  pageLimit?: number;
  includeSubtasks?: boolean;
};

export async function fetchEpicWithChildren(
  input: FetchEpicWithChildrenInput,
  options: JiraClientOptions = {},
): Promise<JiraEpicWithChildren> {
  const epicKey = input.epicKey.trim();

  if (!epicKey) {
    throw new Error("Epic key is required.");
  }

  const sharedSearchInput = {
    fields: input.fields,
    maxResults: input.maxResults,
    pageLimit: input.pageLimit,
  };
  const epicIssues = await fetchIssuesByJql(
    {
      ...sharedSearchInput,
      jql: `key = ${quoteJqlString(epicKey)}`,
    },
    options,
  );
  const epic = epicIssues[0];

  if (!epic) {
    throw new Error(`Jira epic ${epicKey} was not found.`);
  }

  const children = await fetchIssuesByJql(
    {
      ...sharedSearchInput,
      jql: `parent = ${quoteJqlString(epicKey)} ORDER BY created ASC`,
    },
    options,
  );
  const childKeys = children.map((child) => child.key).filter((key) => key.length > 0);
  const subtasks =
    input.includeSubtasks === false || childKeys.length === 0
      ? []
      : await fetchIssuesByJql(
          {
            ...sharedSearchInput,
            jql: `parent in (${childKeys.map(quoteJqlString).join(", ")}) ORDER BY created ASC`,
          },
          options,
        );

  return {
    epic,
    children,
    subtasks,
    issues: [epic, ...children, ...subtasks],
  };
}

function resolveFetch(options: JiraClientOptions): JiraFetch {
  if (options.fetch) {
    return options.fetch;
  }

  if (typeof fetch === "function") {
    return fetch;
  }

  throw new Error("A fetch implementation is required.");
}

function resolveApiBaseUrl(options: JiraClientOptions): string {
  if (options.apiBaseUrl) {
    return trimTrailingSlash(options.apiBaseUrl);
  }

  const env = resolveEnv(options);
  const apiVersion = options.apiVersion ?? "3";
  const cloudId = firstNonEmpty(options.cloudId, env.TASKGOBLIN_JIRA_CLOUD_ID);

  if (cloudId) {
    return `https://api.atlassian.com/ex/jira/${encodeURIComponent(cloudId)}/rest/api/${apiVersion}`;
  }

  const siteUrl = firstNonEmpty(options.siteUrl, env.TASKGOBLIN_JIRA_SITE_URL);

  if (siteUrl) {
    return `${trimTrailingSlash(siteUrl)}/rest/api/${apiVersion}`;
  }

  throw new Error("Jira target is required. Set TASKGOBLIN_JIRA_CLOUD_ID or TASKGOBLIN_JIRA_SITE_URL.");
}

function resolveEnv(options: JiraClientOptions): JiraAdapterEnv {
  if (options.env) {
    return options.env;
  }

  if (typeof process !== "undefined") {
    return process.env;
  }

  return {};
}

function buildHeaders(options: JiraClientOptions): JiraHeaders {
  const env = resolveEnv(options);
  const authHeader = firstNonEmpty(options.authHeader, env.TASKGOBLIN_JIRA_AUTH_HEADER);
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (authHeader) {
    headers.Authorization = authHeader;
    return headers;
  }

  const email = firstNonEmpty(
    options.email,
    env.TASKGOBLIN_JIRA_EMAIL,
    env.JIRA_EMAIL,
    env.ATLASSIAN_EMAIL,
  );
  const apiToken = firstNonEmpty(
    options.apiToken,
    env.TASKGOBLIN_JIRA_API_TOKEN,
    env.JIRA_API_TOKEN,
    env.ATLASSIAN_API_TOKEN,
  );

  if (email && apiToken) {
    headers.Authorization = `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;
  }

  return headers;
}

function parseSearchResponse(bodyText: string): JiraSearchResponse {
  if (!bodyText.trim()) {
    return {};
  }

  const parsed = JSON.parse(bodyText) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Jira search response must be an object.");
  }

  return parsed as JiraSearchResponse;
}

function appendParams(url: URL, name: string, values: readonly string[] | undefined) {
  for (const value of values ?? []) {
    if (value.trim()) {
      url.searchParams.append(name, value);
    }
  }
}

function appendNumberParams(url: URL, name: string, values: readonly number[] | undefined) {
  for (const value of values ?? []) {
    url.searchParams.append(name, String(value));
  }
}

function appendExpand(url: URL, expand: readonly string[] | string | undefined) {
  if (typeof expand === "string") {
    if (expand.trim()) {
      url.searchParams.set("expand", expand);
    }
    return;
  }

  if (expand && expand.length > 0) {
    url.searchParams.set("expand", expand.filter((value) => value.trim()).join(","));
  }
}

function appendBooleanParam(url: URL, name: string, value: boolean | undefined) {
  if (value !== undefined) {
    url.searchParams.set(name, String(value));
  }
}

function quoteJqlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}
