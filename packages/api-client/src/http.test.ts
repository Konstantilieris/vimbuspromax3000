import { ApiHttpError, ApiNetworkError } from "./errors";
import { request, type FetchLike } from "./http";

function makeFetch(impl: FetchLike): FetchLike {
  return impl;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("request", () => {
  test("parses JSON on 2xx", async () => {
    const fetchMock = makeFetch(async () => jsonResponse(200, { ok: true }));
    const result = await request<{ ok: boolean }>(
      { baseUrl: "http://api", fetch: fetchMock },
      "/x",
    );
    expect(result).toEqual({ ok: true });
  });

  test("strips trailing slash on baseUrl and prepends slash on path", async () => {
    const calls: string[] = [];
    const fetchMock = makeFetch(async (input) => {
      calls.push(typeof input === "string" ? input : input.toString());
      return jsonResponse(200, {});
    });

    await request(
      { baseUrl: "http://api/", fetch: fetchMock },
      "no-leading",
    );
    await request(
      { baseUrl: "http://api///", fetch: fetchMock },
      "/with-leading",
    );

    expect(calls).toEqual(["http://api/no-leading", "http://api/with-leading"]);
  });

  test("encodes query parameters and skips undefined/null", async () => {
    let captured = "";
    const fetchMock = makeFetch(async (input) => {
      captured = typeof input === "string" ? input : input.toString();
      return jsonResponse(200, {});
    });

    await request(
      { baseUrl: "http://api", fetch: fetchMock },
      "/things",
      { query: { a: "1", b: 2, c: undefined, d: null } },
    );

    expect(captured).toBe("http://api/things?a=1&b=2");
  });

  test("sends body as JSON with content-type when provided", async () => {
    let receivedInit: RequestInit | undefined;
    const fetchMock = makeFetch(async (_input, init) => {
      receivedInit = init;
      return jsonResponse(200, {});
    });

    await request(
      { baseUrl: "http://api", fetch: fetchMock },
      "/x",
      { method: "POST", body: { hello: "world" } },
    );

    expect(receivedInit?.method).toBe("POST");
    expect(receivedInit?.body).toBe('{"hello":"world"}');
    const headers = receivedInit?.headers as Record<string, string> | undefined;
    expect(headers?.["content-type"]).toBe("application/json");
  });

  test("throws ApiHttpError with parsed error message", async () => {
    const fetchMock = makeFetch(async () =>
      jsonResponse(404, { error: "not found", code: "NOT_FOUND" }),
    );

    let caught: unknown;
    try {
      await request({ baseUrl: "http://api", fetch: fetchMock }, "/x");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiHttpError);
    const err = caught as ApiHttpError;
    expect(err.status).toBe(404);
    expect(err.message).toBe("not found");
    expect(err.code).toBe("NOT_FOUND");
  });

  test("falls back to statusText when body lacks error message", async () => {
    const fetchMock = makeFetch(async () =>
      new Response("", { status: 500, statusText: "Server Error" }),
    );

    let caught: unknown;
    try {
      await request({ baseUrl: "http://api", fetch: fetchMock }, "/x");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiHttpError);
    expect((caught as ApiHttpError).status).toBe(500);
    expect((caught as ApiHttpError).message).toBe("Server Error");
  });

  test("wraps fetch network failures in ApiNetworkError", async () => {
    const cause = new Error("connection refused");
    const fetchMock = makeFetch(async () => {
      throw cause;
    });

    let caught: unknown;
    try {
      await request({ baseUrl: "http://api", fetch: fetchMock }, "/x");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiNetworkError);
    expect((caught as ApiNetworkError).cause).toBe(cause);
    expect((caught as Error).message).toContain("connection refused");
  });

  test("returns undefined when response body is empty", async () => {
    const fetchMock = makeFetch(async () => new Response("", { status: 200 }));
    const result = await request<unknown>(
      { baseUrl: "http://api", fetch: fetchMock },
      "/x",
    );
    expect(result).toBeUndefined();
  });
});
