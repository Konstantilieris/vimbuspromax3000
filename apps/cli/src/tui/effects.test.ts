import {
  loadTaskDetailEffect,
  runApprovePlanEffect,
  runCreateBranchEffect,
  runCreatePlanEffect,
  runAnswerPlanEffect,
  runEvaluatePatchEffect,
  runGeneratePlanEffect,
  runRefreshTestRunsEffect,
  runStartExecutionEffect,
  runStartTestRunsEffect,
  type EffectDeps,
} from "./effects";
import type { Action } from "./state";
import {
  ApiHttpError,
  type ApiApproval,
  type ApiBranch,
  type ApiClient,
  type ApiEvalRun,
  type ApiExecution,
  type ApiPlannerRun,
  type ApiTask,
  type ApiTaskVerificationReview,
  type ApiTestRun,
} from "@vimbuspromax3000/api-client";

type ClientOverrides = Partial<ApiClient>;

function stubClient(overrides: ClientOverrides = {}): ApiClient {
  const notImplemented = (name: string) => () => {
    throw new Error(`stub client: ${name} not configured`);
  };
  return {
    baseUrl: "http://test",
    health: notImplemented("health"),
    listProjects: notImplemented("listProjects"),
    createProject: notImplemented("createProject"),
    listSlots: notImplemented("listSlots"),
    testSlot: notImplemented("testSlot"),
    listTasks: notImplemented("listTasks"),
    createPlannerRun: notImplemented("createPlannerRun"),
    getPlannerRun: notImplemented("getPlannerRun"),
    answerPlannerRun: notImplemented("answerPlannerRun"),
    generatePlannerRun: notImplemented("generatePlannerRun"),
    listApprovals: notImplemented("listApprovals"),
    createApproval: notImplemented("createApproval"),
    startExecution: notImplemented("startExecution"),
    getExecutionPatch: notImplemented("getExecutionPatch"),
    createBranch: notImplemented("createBranch"),
    getBranch: notImplemented("getBranch"),
    abandonBranch: notImplemented("abandonBranch"),
    startTestRuns: notImplemented("startTestRuns"),
    listTestRuns: notImplemented("listTestRuns"),
    listEvaluations: notImplemented("listEvaluations"),
    runEvaluation: notImplemented("runEvaluation"),
    getTaskVerification: notImplemented("getTaskVerification"),
    ...overrides,
  } as ApiClient;
}

function recorder(): { dispatch: (action: Action) => void; actions: Action[] } {
  const actions: Action[] = [];
  return {
    actions,
    dispatch: (action: Action) => {
      actions.push(action);
    },
  };
}

function deps(client: ApiClient): EffectDeps {
  return { client, apiUrl: client.baseUrl };
}

const READY_RUN: ApiPlannerRun = {
  id: "run-1",
  projectId: "p1",
  status: "ready",
  goal: "ship it",
  proposalSummary: { epicCount: 1, taskCount: 2, verificationPlanCount: 1 },
  epics: [],
};

const INTERVIEW_RUN: ApiPlannerRun = {
  id: "run-1",
  projectId: "p1",
  status: "interviewing",
  goal: "ship it",
  interview: { question1: "what?" },
};

describe("runCreatePlanEffect", () => {
  test("creates a run and auto-generates when status is non-interview", async () => {
    const client = stubClient({
      createPlannerRun: async () => ({ ...READY_RUN, status: "ready_to_generate" }),
      generatePlannerRun: async () => READY_RUN,
    });
    const { dispatch, actions } = recorder();

    await runCreatePlanEffect(deps(client), { projectId: "p1", goal: "ship it" }, dispatch);

    const types = actions.map((a) => a.type);
    expect(types).toEqual(
      expect.arrayContaining([
        "plan:create-start",
        "plan:created",
        "plan:generate-start",
        "plan:generated",
      ]),
    );
  });

  test("stops at plan:created when status is interviewing", async () => {
    const client = stubClient({
      createPlannerRun: async () => INTERVIEW_RUN,
    });
    const { dispatch, actions } = recorder();

    await runCreatePlanEffect(deps(client), { projectId: "p1", goal: "ship it" }, dispatch);

    const types = actions.map((a) => a.type);
    expect(types).toContain("plan:created");
    expect(types).not.toContain("plan:generate-start");
  });

  test("dispatches plan:error when create fails", async () => {
    const client = stubClient({
      createPlannerRun: async () => {
        throw new Error("boom");
      },
    });
    const { dispatch, actions } = recorder();

    await runCreatePlanEffect(deps(client), { projectId: "p1", goal: "x" }, dispatch);

    const error = actions.find((a) => a.type === "plan:error");
    expect(error && "error" in error ? error.error : "").toContain("boom");
  });
});

describe("runAnswerPlanEffect", () => {
  test("rejects non-JSON answers without calling the client", async () => {
    let called = false;
    const client = stubClient({
      answerPlannerRun: async () => {
        called = true;
        return READY_RUN;
      },
    });
    const { dispatch, actions } = recorder();

    await runAnswerPlanEffect(deps(client), "run-1", "not json", dispatch);

    expect(called).toBe(false);
    const error = actions.find((a) => a.type === "plan:error");
    expect(error && "error" in error ? error.error : "").toMatch(/Invalid answers JSON/);
  });

  test("posts answers and auto-generates when interview completes", async () => {
    const client = stubClient({
      answerPlannerRun: async () => ({ ...READY_RUN, status: "ready_to_generate" }),
      generatePlannerRun: async () => READY_RUN,
    });
    const { dispatch, actions } = recorder();

    await runAnswerPlanEffect(deps(client), "run-1", '{"q":"a"}', dispatch);

    const types = actions.map((a) => a.type);
    expect(types).toEqual(
      expect.arrayContaining([
        "plan:answer-start",
        "plan:answered",
        "plan:generate-start",
        "plan:generated",
      ]),
    );
  });
});

describe("runApprovePlanEffect", () => {
  test("approves and refreshes tasks on success", async () => {
    const approval: ApiApproval = {
      id: "ap1",
      subjectType: "planner_run",
      subjectId: "run-1",
      stage: "planner_review",
      status: "granted",
    };
    const tasks: ApiTask[] = [
      { id: "t1", stableId: "T-1", title: "x", status: "ready" },
    ];
    const client = stubClient({
      createApproval: async () => approval,
      listTasks: async () => tasks,
    });
    const { dispatch, actions } = recorder();

    await runApprovePlanEffect(deps(client), "p1", "run-1", dispatch);

    const types = actions.map((a) => a.type);
    expect(types).toEqual(
      expect.arrayContaining(["plan:approve-start", "plan:approved", "tasks:loaded"]),
    );
  });

  test("emits plan:error and skips task refresh on approval failure", async () => {
    let listed = false;
    const client = stubClient({
      createApproval: async () => {
        throw new Error("denied");
      },
      listTasks: async () => {
        listed = true;
        return [];
      },
    });
    const { dispatch, actions } = recorder();

    await runApprovePlanEffect(deps(client), "p1", "run-1", dispatch);

    expect(listed).toBe(false);
    const error = actions.find((a) => a.type === "plan:error");
    expect(error && "error" in error ? error.error : "").toContain("denied");
  });
});

describe("runGeneratePlanEffect", () => {
  test("dispatches generated with proposalSummary trace line", async () => {
    const client = stubClient({
      generatePlannerRun: async () => READY_RUN,
    });
    const { dispatch, actions } = recorder();

    await runGeneratePlanEffect(deps(client), "run-1", dispatch);

    expect(actions.find((a) => a.type === "plan:generated")).toBeTruthy();
    const trace = actions.filter((a): a is { type: "boot:trace"; line: string } =>
      a.type === "boot:trace",
    );
    expect(trace.some((t) => t.line.includes("proposal"))).toBe(true);
  });
});

const VERIFICATION: ApiTaskVerificationReview = {
  taskId: "t1",
  plan: {
    id: "vp1",
    taskId: "t1",
    status: "proposed",
    items: [{ id: "i1", name: "lint", status: "ready", orderIndex: 1, runnableNow: true }],
  },
  summary: { totalCount: 1, runnableCount: 1, deferredCount: 0, allRunnableNow: true },
};

const BRANCH: ApiBranch = {
  id: "b1",
  taskId: "t1",
  branchName: "feat/t1",
  state: "open",
  baseBranch: "main",
};

const EXECUTION: ApiExecution = {
  id: "e1",
  taskId: "t1",
  status: "queued",
  createdAt: "2026-01-01",
};

describe("loadTaskDetailEffect", () => {
  test("loads verification and branch when both succeed", async () => {
    const client = stubClient({
      getTaskVerification: async () => VERIFICATION,
      getBranch: async () => BRANCH,
    });
    const { dispatch, actions } = recorder();

    await loadTaskDetailEffect(deps(client), "t1", dispatch);

    const loaded = actions.find((a) => a.type === "task-detail:loaded");
    if (!loaded || loaded.type !== "task-detail:loaded") {
      throw new Error("expected task-detail:loaded action");
    }
    expect(loaded.verification).toEqual(VERIFICATION);
    expect(loaded.branch).toEqual(BRANCH);
  });

  test("treats 404 from getBranch as no branch", async () => {
    const client = stubClient({
      getTaskVerification: async () => VERIFICATION,
      getBranch: async () => {
        throw new ApiHttpError(404, "no branch");
      },
    });
    const { dispatch, actions } = recorder();

    await loadTaskDetailEffect(deps(client), "t1", dispatch);

    const loaded = actions.find((a) => a.type === "task-detail:loaded");
    if (!loaded || loaded.type !== "task-detail:loaded") {
      throw new Error("expected task-detail:loaded action");
    }
    expect(loaded.branch).toBeNull();
  });

  test("dispatches task-detail:error when verification fails", async () => {
    const client = stubClient({
      getTaskVerification: async () => {
        throw new Error("nope");
      },
      getBranch: async () => BRANCH,
    });
    const { dispatch, actions } = recorder();

    await loadTaskDetailEffect(deps(client), "t1", dispatch);

    const error = actions.find((a) => a.type === "task-detail:error");
    expect(error && "error" in error ? error.error : "").toContain("nope");
    expect(actions.find((a) => a.type === "task-detail:loaded")).toBeUndefined();
  });
});

describe("runCreateBranchEffect", () => {
  test("dispatches branch-created on success", async () => {
    const client = stubClient({ createBranch: async () => BRANCH });
    const { dispatch, actions } = recorder();

    await runCreateBranchEffect(deps(client), "t1", dispatch);

    expect(actions.find((a) => a.type === "task-detail:branch-created")).toBeTruthy();
  });

  test("emits a toast on failure without crashing", async () => {
    const client = stubClient({
      createBranch: async () => {
        throw new Error("merge conflict");
      },
    });
    const { dispatch, actions } = recorder();

    await runCreateBranchEffect(deps(client), "t1", dispatch);

    const toast = actions.find((a) => a.type === "toast");
    expect(toast && "toast" in toast ? toast.toast?.kind : "").toBe("error");
  });
});

describe("runStartExecutionEffect", () => {
  test("dispatches execution-started", async () => {
    const client = stubClient({ startExecution: async () => EXECUTION });
    const { dispatch, actions } = recorder();

    await runStartExecutionEffect(deps(client), "t1", dispatch);

    const started = actions.find((a) => a.type === "task-detail:execution-started");
    if (!started || started.type !== "task-detail:execution-started") {
      throw new Error("expected execution-started");
    }
    expect(started.execution.id).toBe("e1");
  });
});

describe("runStartTestRunsEffect", () => {
  test("dispatches test-runs-updated with the kicked-off runs", async () => {
    const runs: ApiTestRun[] = [
      { id: "tr1", executionId: "e1", status: "running", orderIndex: 0 },
    ];
    const client = stubClient({ startTestRuns: async () => runs });
    const { dispatch, actions } = recorder();

    await runStartTestRunsEffect(deps(client), "e1", dispatch);

    const updated = actions.find((a) => a.type === "task-detail:test-runs-updated");
    if (!updated || updated.type !== "task-detail:test-runs-updated") {
      throw new Error("expected test-runs-updated");
    }
    expect(updated.testRuns).toEqual(runs);
  });
});

describe("runRefreshTestRunsEffect", () => {
  test("emits trace line and continues when polling fails", async () => {
    const client = stubClient({
      listTestRuns: async () => {
        throw new Error("connection reset");
      },
    });
    const { dispatch, actions } = recorder();

    await runRefreshTestRunsEffect(deps(client), "e1", dispatch);

    const trace = actions.find(
      (a): a is { type: "boot:trace"; line: string } => a.type === "boot:trace",
    );
    expect(trace?.line).toContain("poll failed");
  });
});

describe("runDetectClaudeCliEffect / refreshAuthEffect", () => {
  // These are exercised indirectly: the underlying detector and credentials
  // discovery hit real environment / fs, so we just confirm the action sequence
  // shape — never the verdict, which depends on the host machine.
  test("runDetectClaudeCliEffect always emits detect-start before a terminal action", async () => {
    const { runDetectClaudeCliEffect } = await import("./effects");
    const { dispatch, actions } = recorder();
    await runDetectClaudeCliEffect(dispatch);
    expect(actions[0]?.type).toBe("claude-login:detect-start");
    const terminal = actions.find(
      (a) => a.type === "claude-login:detected" || a.type === "claude-login:missing",
    );
    expect(terminal).toBeTruthy();
  });

  test("refreshAuthEffect always emits an auth:loaded action", async () => {
    const { refreshAuthEffect } = await import("./effects");
    const { dispatch, actions } = recorder();
    await refreshAuthEffect(dispatch);
    expect(actions.find((a) => a.type === "auth:loaded")).toBeTruthy();
  });
});

describe("runEvaluatePatchEffect", () => {
  test("dispatches evaluation-updated on success", async () => {
    const evalRun: ApiEvalRun = {
      id: "ev1",
      status: "completed",
      verdict: "pass",
      aggregateScore: 90,
      threshold: 80,
    };
    const client = stubClient({ runEvaluation: async () => evalRun });
    const { dispatch, actions } = recorder();

    await runEvaluatePatchEffect(deps(client), "e1", dispatch);

    const updated = actions.find((a) => a.type === "task-detail:evaluation-updated");
    if (!updated || updated.type !== "task-detail:evaluation-updated") {
      throw new Error("expected evaluation-updated");
    }
    expect(updated.evaluation.id).toBe("ev1");
  });
});
