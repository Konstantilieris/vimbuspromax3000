import { createApp } from "./app";
import { createIsolatedPrisma, removeTempDir } from "@vimbuspromax3000/db/testing";
import type { PrismaClient } from "@vimbuspromax3000/db/client";

/**
 * VIM-34 — POST /planner/runs/:id/answers contract tests for the 5-round
 * interview state machine. Covers:
 *   - 422 + expectedNextRound on out-of-order submission
 *   - per-round persistence keyed by round name (`interview.scope`, etc.)
 *   - planner.question + planner.answer event pair emitted in order per round
 */
describe("POST /planner/runs/:id/answers (VIM-34 5-round interview)", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-planner-answers-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  });

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test("returns 422 with expectedNextRound 'scope' when domain is submitted first", async () => {
    const api = createApp({ prisma });
    const { plannerRun } = await seedPlannerRun(api, tempDir);

    const response = await postJson(api, `/planner/runs/${plannerRun.id}/answers`, {
      round: "domain",
      answer: { models: ["task"] },
    });

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toBe("out_of_order");
    expect(body.expectedNextRound).toBe("scope");
    expect(body.submittedRound).toBe("domain");
  });

  test("returns 422 when a batch skips a round", async () => {
    const api = createApp({ prisma });
    const { plannerRun } = await seedPlannerRun(api, tempDir);

    const response = await postJson(api, `/planner/runs/${plannerRun.id}/answers`, {
      answers: {
        scope: { in: ["api"] },
        interfaces: { http: true }, // skips `domain`
      },
    });

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toBe("out_of_order");
    expect(body.expectedNextRound).toBe("domain");
  });

  test("accepts the next-expected round and persists it under interview.<round>", async () => {
    const api = createApp({ prisma });
    const { project, plannerRun } = await seedPlannerRun(api, tempDir);

    const response = await postJson(api, `/planner/runs/${plannerRun.id}/answers`, {
      round: "scope",
      answer: { in: ["api"], out: ["cli"] },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.interview.scope).toEqual({ in: ["api"], out: ["cli"] });
    expect(body.expectedNextRound).toBe("domain");

    // Per-round events: planner.question first, then planner.answer.
    const events = await prisma.loopEvent.findMany({
      where: { projectId: project.id },
      orderBy: [{ createdAt: "asc" }],
    });
    const interviewEvents = events.filter((event) =>
      event.type === "planner.question" || event.type === "planner.answer",
    );
    expect(interviewEvents.map((event) => event.type)).toEqual([
      "planner.question",
      "planner.answer",
    ]);
  });

  test("walks all 5 rounds and emits a question+answer pair per round in order", async () => {
    const api = createApp({ prisma });
    const { project, plannerRun } = await seedPlannerRun(api, tempDir);

    const rounds: Array<[string, Record<string, unknown>]> = [
      ["scope", { in: ["api"] }],
      ["domain", { models: ["task"] }],
      ["interfaces", { http: true }],
      ["verification", { required: ["logic"] }],
      ["policy", { license: "MIT" }],
    ];

    for (const [round, answer] of rounds) {
      const response = await postJson(api, `/planner/runs/${plannerRun.id}/answers`, {
        round,
        answer,
      });
      expect(response.status).toBe(200);
    }

    const finalRunRef = await api.fetch(
      new Request(`http://localhost/planner/runs/${plannerRun.id}`),
    );
    const finalRun = await finalRunRef.json();
    expect(finalRun.interview.scope).toEqual({ in: ["api"] });
    expect(finalRun.interview.domain).toEqual({ models: ["task"] });
    expect(finalRun.interview.interfaces).toEqual({ http: true });
    expect(finalRun.interview.verification).toEqual({ required: ["logic"] });
    expect(finalRun.interview.policy).toEqual({ license: "MIT" });

    const events = await prisma.loopEvent.findMany({
      where: { projectId: project.id },
      orderBy: [{ createdAt: "asc" }],
    });
    const interviewEvents = events
      .filter((event) => event.type === "planner.question" || event.type === "planner.answer")
      .map((event) => ({
        type: event.type,
        round: (JSON.parse(event.payloadJson) as { round?: string; answers?: Record<string, unknown> })
          .round
          ?? Object.keys(
            (JSON.parse(event.payloadJson) as { answers?: Record<string, unknown> }).answers ?? {},
          )[0],
      }));

    expect(interviewEvents).toEqual([
      { type: "planner.question", round: "scope" },
      { type: "planner.answer", round: "scope" },
      { type: "planner.question", round: "domain" },
      { type: "planner.answer", round: "domain" },
      { type: "planner.question", round: "interfaces" },
      { type: "planner.answer", round: "interfaces" },
      { type: "planner.question", round: "verification" },
      { type: "planner.answer", round: "verification" },
      { type: "planner.question", round: "policy" },
      { type: "planner.answer", round: "policy" },
    ]);
  });

  test("returns expectedNextRound: null after the final round is accepted", async () => {
    const api = createApp({ prisma });
    const { plannerRun } = await seedPlannerRun(api, tempDir);

    const response = await postJson(api, `/planner/runs/${plannerRun.id}/answers`, {
      answers: {
        scope: { in: ["api"] },
        domain: { models: ["task"] },
        interfaces: { http: true },
        verification: { required: ["logic"] },
        policy: { license: "MIT" },
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.expectedNextRound).toBeNull();
  });

  test("returns 422 when a round is resubmitted after it was already accepted", async () => {
    const api = createApp({ prisma });
    const { plannerRun } = await seedPlannerRun(api, tempDir);

    const first = await postJson(api, `/planner/runs/${plannerRun.id}/answers`, {
      round: "scope",
      answer: { in: ["api"] },
    });
    expect(first.status).toBe(200);

    // Re-submitting `scope` should now fail — the next-expected round is `domain`.
    const second = await postJson(api, `/planner/runs/${plannerRun.id}/answers`, {
      round: "scope",
      answer: { in: ["cli"] },
    });
    expect(second.status).toBe(422);
    const body = await second.json();
    expect(body.error).toBe("out_of_order");
    expect(body.expectedNextRound).toBe("domain");
  });
});

async function seedPlannerRun(
  api: ReturnType<typeof createApp>,
  rootPath: string,
): Promise<{ project: { id: string }; plannerRun: { id: string } }> {
  const projectRef = await postJson(api, "/projects", {
    name: "Interview Test Project",
    rootPath,
  });
  const project = await projectRef.json();

  const plannerRunRef = await postJson(api, "/planner/runs", {
    projectId: project.id,
    goal: "Walk the 5-round interview",
    moduleName: "interview",
  });
  const plannerRun = await plannerRunRef.json();

  return { project, plannerRun };
}

function postJson(api: ReturnType<typeof createApp>, path: string, body: unknown) {
  return api.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
