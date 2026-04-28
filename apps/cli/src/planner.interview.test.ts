import { PLANNER_INTERVIEW_ROUNDS, runPlannerCommand } from "./planner";

/**
 * VIM-34 — exercise the `/plan:interview` command end-to-end against a mock
 * fetch implementation that mimics the API's 5-round state machine. Asserts:
 *   - one round is prompted at a time, in canonical order
 *   - each round persists its own slice of `interview` keyed by round name
 *   - the API is hit once per round with `{round, answer}` (single-round mode)
 *   - planner.question + planner.answer events are observably emitted in
 *     order (the test simulates this with the same mock that records events)
 *   - out-of-order submission re-prompts for the round the API expected
 */
describe("/plan:interview (VIM-34 5-round walk)", () => {
  test("walks all 5 rounds and persists each round under its own key", async () => {
    const { mockFetch, state } = createPlannerInterviewMock();

    const promptedRounds: string[] = [];
    const ask = async (prompt: string) => {
      // The CLI prompt looks like `[scope] answer (JSON object): ` — capture
      // the round name so we can assert prompt order.
      const match = prompt.match(/\[(\w+)\]/);
      if (match) promptedRounds.push(match[1]!);
      return JSON.stringify({ value: match?.[1] ?? "unknown" });
    };

    const output = await runPlannerCommand(
      ["/plan:interview", "--planner-run-id", "planner_1"],
      { fetch: mockFetch as typeof fetch, prompt: ask },
    );

    // 1. One prompt per round, in canonical order.
    expect(promptedRounds).toEqual([
      "scope",
      "domain",
      "interfaces",
      "verification",
      "policy",
    ]);

    // 2. Each round persisted under its own interview key.
    expect(state.plannerRun.interview).toEqual({
      scope: { value: "scope" },
      domain: { value: "domain" },
      interfaces: { value: "interfaces" },
      verification: { value: "verification" },
      policy: { value: "policy" },
    });

    // 3. The API was POSTed five times, once per round.
    const answersPosts = state.requests.filter(
      (request) =>
        request.url.endsWith("/planner/runs/planner_1/answers") && request.method === "POST",
    );
    expect(answersPosts).toHaveLength(5);
    expect(answersPosts.map((request) => (request.body as { round?: string }).round)).toEqual([
      "scope",
      "domain",
      "interfaces",
      "verification",
      "policy",
    ]);

    // 4. Per-round event order: question → answer for each round.
    expect(state.events.map((event) => `${event.type}:${event.round}`)).toEqual([
      "planner.question:scope",
      "planner.answer:scope",
      "planner.question:domain",
      "planner.answer:domain",
      "planner.question:interfaces",
      "planner.answer:interfaces",
      "planner.question:verification",
      "planner.answer:verification",
      "planner.question:policy",
      "planner.answer:policy",
    ]);

    // 5. The CLI surface confirms each round was accepted and surfaces the
    //    final planner-run snapshot.
    for (const round of PLANNER_INTERVIEW_ROUNDS) {
      expect(output).toContain(`Round: ${round}`);
      expect(output).toContain(`Accepted: ${round}.`);
    }
    expect(output).toContain("Status: interviewing");
  });

  test("recovers from an out-of-order 422 by re-prompting for the expected round", async () => {
    const { mockFetch, state } = createPlannerInterviewMock();

    // First call to `ask` returns the wrong round name (domain answer), so
    // the API rejects with 422 + expectedNextRound: scope. The CLI should
    // re-prompt for scope and continue from there.
    let callCount = 0;
    const ask = async (prompt: string) => {
      callCount += 1;
      if (callCount === 1) {
        // Manually skip ahead — the prompt shows "[scope]" but we send back
        // an answer; the CLI will POST `{round: "scope", ...}`. To force the
        // out-of-order branch, we pretend the operator started from "domain"
        // by submitting a value the test API will reject. Easier: just have
        // the API return 422 once on the first POST and then 200 from then.
        return JSON.stringify({ value: "scope" });
      }
      const match = prompt.match(/\[(\w+)\]/);
      return JSON.stringify({ value: match?.[1] ?? "ok" });
    };

    state.injectFirstScopeRejection = true;

    const output = await runPlannerCommand(
      ["/plan:interview", "--planner-run-id", "planner_1"],
      { fetch: mockFetch as typeof fetch, prompt: ask },
    );

    // The CLI surfaces the recovery message.
    expect(output).toContain("Out of order");

    // All five rounds eventually persisted.
    expect(Object.keys(state.plannerRun.interview)).toEqual([
      "scope",
      "domain",
      "interfaces",
      "verification",
      "policy",
    ]);
  });

  test("supports --prompt-json for non-interactive (smoke) runs", async () => {
    const { mockFetch, state } = createPlannerInterviewMock();

    const promptJson = JSON.stringify({
      scope: { in: ["api"] },
      domain: { models: ["task"] },
      interfaces: { http: true },
      verification: { required: ["logic"] },
      policy: { license: "MIT" },
    });

    const output = await runPlannerCommand(
      [
        "/plan:interview",
        "--planner-run-id",
        "planner_1",
        "--prompt-json",
        promptJson,
      ],
      { fetch: mockFetch as typeof fetch },
    );

    expect(state.plannerRun.interview).toEqual(JSON.parse(promptJson));
    expect(output).toContain("Accepted: scope.");
    expect(output).toContain("Accepted: policy.");
  });
});

type RecordedRequest = { method: string; url: string; body?: unknown };
type RecordedEvent = { type: "planner.question" | "planner.answer"; round: string };

type PlannerInterviewMockState = {
  plannerRun: {
    id: string;
    projectId: string;
    status: string;
    goal: string;
    summary: string | null;
    interview: Record<string, unknown>;
    proposalSummary: { epicCount: number; taskCount: number; verificationPlanCount: number };
    epics: never[];
  };
  requests: RecordedRequest[];
  events: RecordedEvent[];
  injectFirstScopeRejection: boolean;
};

const ROUND_ORDER = ["scope", "domain", "interfaces", "verification", "policy"] as const;

function getNextExpectedRound(interview: Record<string, unknown>): string | null {
  for (const round of ROUND_ORDER) {
    if (!Object.prototype.hasOwnProperty.call(interview, round)) return round;
  }
  return null;
}

/**
 * Build a mock fetch + recording state that mirrors the production
 * `/planner/runs/:id/answers` 5-round contract closely enough to drive the
 * CLI loop. Records each request and the resulting event pair.
 */
function createPlannerInterviewMock(): {
  mockFetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  state: PlannerInterviewMockState;
} {
  const state: PlannerInterviewMockState = {
    plannerRun: {
      id: "planner_1",
      projectId: "project_1",
      status: "interviewing",
      goal: "Walk the interview",
      summary: null,
      interview: {},
      proposalSummary: { epicCount: 0, taskCount: 0, verificationPlanCount: 0 },
      epics: [],
    },
    requests: [],
    events: [],
    injectFirstScopeRejection: false,
  };

  const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    state.requests.push({ method, url, body });

    if (url.endsWith("/planner/runs/planner_1/answers") && method === "POST") {
      const submission = body as { round?: string; answer?: Record<string, unknown> };
      const expected = getNextExpectedRound(state.plannerRun.interview);

      if (state.injectFirstScopeRejection) {
        // One-shot: simulate an API 422 to exercise recovery.
        state.injectFirstScopeRejection = false;
        return Response.json(
          { error: "out_of_order", expectedNextRound: expected, submittedRound: submission.round },
          { status: 422 },
        );
      }

      if (submission.round !== expected) {
        return Response.json(
          { error: "out_of_order", expectedNextRound: expected, submittedRound: submission.round },
          { status: 422 },
        );
      }

      // Emit the question + answer event pair, then persist.
      state.events.push({ type: "planner.question", round: submission.round! });
      state.plannerRun.interview = {
        ...state.plannerRun.interview,
        [submission.round!]: submission.answer ?? {},
      };
      state.events.push({ type: "planner.answer", round: submission.round! });

      return Response.json({
        ...state.plannerRun,
        expectedNextRound: getNextExpectedRound(state.plannerRun.interview),
      });
    }

    return new Response("not found", { status: 404 });
  };

  return { mockFetch, state };
}
