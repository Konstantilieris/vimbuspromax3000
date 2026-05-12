import { Buffer } from "node:buffer";
import { fetchEpicWithChildren, fetchIssuesByJql, JiraRestError, type JiraFetch } from "./client";
import type { JiraIssue } from "./mapping";

describe("Jira REST client", () => {
  test("fetchIssuesByJql uses cloud id env first, auth headers, fields, and token pagination", async () => {
    const calls: Array<{ url: URL; init?: RequestInit }> = [];
    const fetchStub: JiraFetch = async (input, init) => {
      const url = new URL(input.toString());
      calls.push({ url, init });

      if (!url.searchParams.get("nextPageToken")) {
        return jsonResponse({
          issues: [issue("HC-1", "First issue")],
          nextPageToken: "token-2",
        });
      }

      return jsonResponse({
        issues: [issue("HC-2", "Second issue")],
      });
    };

    const issues = await fetchIssuesByJql(
      {
        jql: "project = HC",
        fields: ["summary", "customfield_12345"],
        maxResults: 1,
      },
      {
        fetch: fetchStub,
        env: {
          TASKGOBLIN_JIRA_CLOUD_ID: "cloud-123",
          TASKGOBLIN_JIRA_SITE_URL: "https://ignored.atlassian.net",
          TASKGOBLIN_JIRA_EMAIL: "agent@example.com",
          TASKGOBLIN_JIRA_API_TOKEN: "secret",
        },
      },
    );

    expect(issues.map((item) => item.key)).toEqual(["HC-1", "HC-2"]);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url.toString()).toContain("https://api.atlassian.com/ex/jira/cloud-123/rest/api/3/search/jql");
    expect(calls[0]?.url.searchParams.get("jql")).toBe("project = HC");
    expect(calls[0]?.url.searchParams.getAll("fields")).toEqual(["summary", "customfield_12345"]);
    expect(calls[1]?.url.searchParams.get("nextPageToken")).toBe("token-2");
    expect(readHeader(calls[0]?.init?.headers, "Authorization")).toBe(
      `Basic ${Buffer.from("agent@example.com:secret").toString("base64")}`,
    );
  });

  test("fetchEpicWithChildren falls back to site URL env and fetches epic, children, and subtasks", async () => {
    const jqls: string[] = [];
    const fetchStub: JiraFetch = async (input) => {
      const url = new URL(input.toString());
      const jql = url.searchParams.get("jql") ?? "";
      jqls.push(jql);

      if (jql === 'key = "HC-100"') {
        return jsonResponse({ issues: [issue("HC-100", "Epic", "Epic")] });
      }

      if (jql === 'parent = "HC-100" ORDER BY created ASC') {
        return jsonResponse({
          issues: [issue("HC-101", "Story", "Story"), issue("HC-102", "Task", "Task")],
        });
      }

      if (jql === 'parent in ("HC-101", "HC-102") ORDER BY created ASC') {
        return jsonResponse({
          issues: [issue("HC-103", "Sub-task", "Sub-task", { parentKey: "HC-101", subtask: true })],
        });
      }

      return jsonResponse({ issues: [] });
    };

    const result = await fetchEpicWithChildren(
      {
        epicKey: "HC-100",
        fields: ["summary", "description", "issuetype", "parent", "customfield_12345"],
      },
      {
        fetch: fetchStub,
        env: {
          TASKGOBLIN_JIRA_SITE_URL: "https://example.atlassian.net/",
        },
      },
    );

    expect(jqls).toEqual([
      'key = "HC-100"',
      'parent = "HC-100" ORDER BY created ASC',
      'parent in ("HC-101", "HC-102") ORDER BY created ASC',
    ]);
    expect(result.epic.key).toBe("HC-100");
    expect(result.children.map((item) => item.key)).toEqual(["HC-101", "HC-102"]);
    expect(result.subtasks.map((item) => item.key)).toEqual(["HC-103"]);
    expect(result.issues.map((item) => item.key)).toEqual(["HC-100", "HC-101", "HC-102", "HC-103"]);
  });

  test("fetchIssuesByJql surfaces Jira error responses", async () => {
    const fetchStub: JiraFetch = async () =>
      new Response(JSON.stringify({ errorMessages: ["Invalid JQL"] }), {
        status: 400,
        statusText: "Bad Request",
      });

    await expect(
      fetchIssuesByJql(
        {
          jql: "project =",
        },
        {
          fetch: fetchStub,
          env: {
            TASKGOBLIN_JIRA_SITE_URL: "https://example.atlassian.net",
          },
        },
      ),
    ).rejects.toMatchObject<JiraRestError>({
      name: "JiraRestError",
      status: 400,
      statusText: "Bad Request",
    });
  });
});

function issue(
  key: string,
  summary: string,
  issueType = "Task",
  options: { parentKey?: string; subtask?: boolean } = {},
): JiraIssue {
  return {
    id: key.replace(/\D/g, ""),
    key,
    self: `https://example.atlassian.net/rest/api/3/issue/${key}`,
    fields: {
      summary,
      issuetype: {
        name: issueType,
        subtask: options.subtask ?? false,
      },
      parent: options.parentKey ? { key: options.parentKey } : undefined,
      status: {
        name: "To Do",
      },
    },
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function readHeader(headers: HeadersInit | undefined, name: string): string | null {
  if (!headers) {
    return null;
  }

  return new Headers(headers).get(name);
}
