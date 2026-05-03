import {
  filterCommands,
  initialClaudeLoginState,
  initialPlanState,
  initialState,
  initialTaskDetailState,
  PALETTE_COMMANDS,
  PANE_ORDER,
  reduce,
  type State,
} from "./state";
import type {
  ApiBranch,
  ApiExecution,
  ApiPlannerRun,
  ApiProject,
  ApiTask,
  ApiTaskVerificationReview,
  ApiTestRun,
} from "@vimbuspromax3000/api-client";

const PROJECTS: ApiProject[] = [
  { id: "p1", name: "Alpha", rootPath: "/a", baseBranch: "main" },
  { id: "p2", name: "Beta", rootPath: "/b", baseBranch: "main" },
  { id: "p3", name: "Gamma", rootPath: "/c", baseBranch: "develop" },
];

function withMode(state: State, mode: State["mode"]): State {
  return { ...state, mode };
}

describe("initialState", () => {
  test("starts in boot mode with focus on control pane", () => {
    const state = initialState();
    expect(state.mode.kind).toBe("boot");
    expect(state.focus).toBe("control");
    expect(state.overlay).toBe("none");
    expect(state.auth.source).toBeNull();
    expect(state.auth.slotResolved).toBeNull();
  });

  test("respects an injected apiUrl", () => {
    const state = initialState({ apiUrl: "http://example" });
    expect(state.apiUrl).toBe("http://example");
  });
});

describe("boot transitions", () => {
  test("health-fail moves to api-offline mode", () => {
    const next = reduce(initialState(), {
      type: "boot:health-fail",
      apiUrl: "http://api",
      reason: "ECONNREFUSED",
    });
    expect(next.mode).toEqual({
      kind: "api-offline",
      apiUrl: "http://api",
      reason: "ECONNREFUSED",
    });
  });

  test("auth-missing moves to auth-missing mode and clears auth state", () => {
    const next = reduce(initialState(), {
      type: "boot:auth-missing",
      reason: "ANTHROPIC_API_KEY not set",
    });
    expect(next.mode.kind).toBe("auth-missing");
    expect(next.auth.source).toBeNull();
    expect(next.auth.reason).toBe("ANTHROPIC_API_KEY not set");
  });

  test("projects-loaded with no persisted id opens project-picker", () => {
    const next = reduce(initialState(), {
      type: "boot:projects-loaded",
      projects: PROJECTS,
    });
    expect(next.mode).toEqual({
      kind: "project-picker",
      projects: PROJECTS,
      cursor: 0,
    });
  });

  test("projects-loaded with matching persisted id jumps to ready", () => {
    const next = reduce(initialState(), {
      type: "boot:projects-loaded",
      projects: PROJECTS,
      selectedProjectId: "p2",
    });
    expect(next.mode.kind).toBe("ready");
    if (next.mode.kind === "ready") {
      expect(next.mode.project.id).toBe("p2");
    }
  });

  test("projects-loaded with stale persisted id falls back to picker", () => {
    const next = reduce(initialState(), {
      type: "boot:projects-loaded",
      projects: PROJECTS,
      selectedProjectId: "deleted",
    });
    expect(next.mode.kind).toBe("project-picker");
  });
});

describe("auth state", () => {
  test("auth:loaded preserves slot fields", () => {
    let state = initialState();
    state = reduce(state, {
      type: "auth:slot-result",
      ok: true,
      message: "claude-opus-4-7",
    });
    state = reduce(state, { type: "auth:loaded", source: "env", reason: null });
    expect(state.auth).toEqual({
      source: "env",
      reason: null,
      slotResolved: true,
      slotMessage: "claude-opus-4-7",
    });
  });

  test("auth:slot-result records ok and message", () => {
    const state = reduce(initialState(), {
      type: "auth:slot-result",
      ok: false,
      message: "PROVIDER_SECRET_MISSING",
    });
    expect(state.auth.slotResolved).toBe(false);
    expect(state.auth.slotMessage).toBe("PROVIDER_SECRET_MISSING");
  });
});

describe("project picker navigation", () => {
  const picker = withMode(initialState(), {
    kind: "project-picker",
    projects: PROJECTS,
    cursor: 0,
  });

  test("cursor wraps within projects + create-new slot", () => {
    let state = picker;
    for (let i = 0; i < PROJECTS.length + 1; i += 1) {
      state = reduce(state, { type: "project:cursor", delta: 1 });
    }
    if (state.mode.kind === "project-picker") {
      expect(state.mode.cursor).toBe(0);
    } else {
      throw new Error("expected project-picker");
    }
  });

  test("cursor wraps backwards from 0", () => {
    const state = reduce(picker, { type: "project:cursor", delta: -1 });
    if (state.mode.kind === "project-picker") {
      expect(state.mode.cursor).toBe(PROJECTS.length);
    } else {
      throw new Error("expected project-picker");
    }
  });

  test("project:select moves to ready and closes palette", () => {
    const state = reduce(
      { ...picker, overlay: "palette" },
      { type: "project:select", project: PROJECTS[1]! },
    );
    expect(state.mode.kind).toBe("ready");
    expect(state.overlay).toBe("none");
  });
});

describe("focus rotation", () => {
  test("rotates forward across the pane order", () => {
    let state = initialState();
    expect(state.focus).toBe("control");
    state = reduce(state, { type: "focus:rotate", delta: 1 });
    expect(state.focus).toBe(PANE_ORDER[(PANE_ORDER.indexOf("control") + 1) % PANE_ORDER.length]);
  });

  test("rotates backward and wraps", () => {
    let state = initialState();
    state = reduce(state, { type: "focus:rotate", delta: -1 });
    state = reduce(state, { type: "focus:rotate", delta: -1 });
    state = reduce(state, { type: "focus:rotate", delta: -1 });
    expect(state.focus).toBe("control");
  });

  test("does not rotate while an overlay is open", () => {
    let state = reduce(initialState(), { type: "overlay:open", overlay: "palette" });
    state = reduce(state, { type: "focus:rotate", delta: 1 });
    expect(state.focus).toBe("control");
  });
});

describe("overlays", () => {
  test("palette opens, then esc-equivalent close clears buffer", () => {
    let state = reduce(initialState(), { type: "overlay:open", overlay: "palette" });
    state = reduce(state, { type: "palette:input", buffer: "test" });
    expect(state.palette.buffer).toBe("test");
    state = reduce(state, { type: "overlay:close" });
    expect(state.overlay).toBe("none");
    expect(state.palette.buffer).toBe("");
  });

  test("palette filter narrows the command list", () => {
    let state = reduce(initialState(), { type: "overlay:open", overlay: "palette" });
    state = reduce(state, { type: "palette:input", buffer: "key" });
    expect(state.palette.commands.length).toBe(1);
    expect(state.palette.commands[0]?.id).toBe("paste-api-key");
  });

  test("palette cursor wraps within filtered commands", () => {
    let state = reduce(initialState(), { type: "overlay:open", overlay: "palette" });
    for (let i = 0; i < PALETTE_COMMANDS.length + 2; i += 1) {
      state = reduce(state, { type: "palette:cursor", delta: 1 });
    }
    expect(state.palette.cursor).toBe(2 % PALETTE_COMMANDS.length);
  });

  test("opening help replaces palette overlay", () => {
    let state = reduce(initialState(), { type: "overlay:open", overlay: "palette" });
    state = reduce(state, { type: "overlay:open", overlay: "help" });
    expect(state.overlay).toBe("help");
  });
});

describe("filterCommands", () => {
  test("returns full list when buffer is empty", () => {
    expect(filterCommands("")).toEqual([...PALETTE_COMMANDS]);
  });

  test("matches by label, hint, or id case-insensitively", () => {
    // "CLAUDE" matches multiple commands; test-slot must be included.
    const claudeMatches = filterCommands("CLAUDE").map((c) => c.id);
    expect(claudeMatches).toEqual(expect.arrayContaining(["test-slot", "login-claude"]));
    expect(filterCommands("refresh")[0]?.id).toBe("refresh");
    const plannerMatches = filterCommands("planner").map((c) => c.id);
    expect(plannerMatches).toEqual(
      expect.arrayContaining(["create-plan", "approve-plan", "test-slot"]),
    );
  });

  test("returns empty list when nothing matches", () => {
    expect(filterCommands("zzz-nope")).toEqual([]);
  });
});

describe("tasks slice", () => {
  test("starts idle and transitions through loading → ready", () => {
    let state = initialState();
    expect(state.tasks).toEqual({ status: "idle", items: [], cursor: 0, error: null });

    state = reduce(state, { type: "tasks:loading" });
    expect(state.tasks.status).toBe("loading");

    state = reduce(state, {
      type: "tasks:loaded",
      items: [
        {
          id: "t1",
          stableId: "TG-1",
          title: "Do the thing",
          status: "ready",
          epic: { id: "e1", key: "E1", title: "Epic" },
        },
      ],
    });
    expect(state.tasks.status).toBe("ready");
    expect(state.tasks.items).toHaveLength(1);
    expect(state.tasks.error).toBeNull();
  });

  test("error replaces items and sets reason", () => {
    let state = reduce(initialState(), {
      type: "tasks:loaded",
      items: [
        { id: "t1", stableId: "X", title: "y", status: "ready" },
      ],
    });
    state = reduce(state, { type: "tasks:error", error: "boom" });
    expect(state.tasks.status).toBe("error");
    expect(state.tasks.items).toEqual([]);
    expect(state.tasks.error).toBe("boom");
  });

  test("project:select resets stale tasks state", () => {
    let state = reduce(initialState(), {
      type: "tasks:loaded",
      items: [{ id: "t1", stableId: "X", title: "y", status: "ready" }],
    });
    state = reduce(state, {
      type: "project:select",
      project: { id: "p2", name: "Beta", rootPath: "/b", baseBranch: "main" },
    });
    expect(state.tasks).toEqual({ status: "idle", items: [], cursor: 0, error: null });
  });

  test("boot:projects-loaded resets stale tasks state", () => {
    let state = reduce(initialState(), {
      type: "tasks:loaded",
      items: [{ id: "t1", stableId: "X", title: "y", status: "ready" }],
    });
    state = reduce(state, {
      type: "boot:projects-loaded",
      projects: PROJECTS,
    });
    expect(state.tasks).toEqual({ status: "idle", items: [], cursor: 0, error: null });
  });
});

describe("plan slice", () => {
  const sampleRun: ApiPlannerRun = {
    id: "run-1",
    projectId: "p1",
    status: "ready",
    goal: "ship it",
    proposalSummary: { epicCount: 2, taskCount: 5, verificationPlanCount: 3 },
    epics: [],
  };

  test("starts in idle phase with empty drafts", () => {
    expect(initialState().plan).toEqual(initialPlanState());
    expect(initialState().plan.phase).toBe("idle");
  });

  test("plan:goal-changed and plan:module-changed update drafts", () => {
    let state = reduce(initialState(), { type: "plan:goal-changed", value: "go" });
    state = reduce(state, { type: "plan:module-changed", value: "auth" });
    expect(state.plan.goalDraft).toBe("go");
    expect(state.plan.moduleNameDraft).toBe("auth");
  });

  test("plan:create-start clears any previous error", () => {
    let state = reduce(initialState(), { type: "plan:error", error: "boom" });
    expect(state.plan.phase).toBe("error");
    state = reduce(state, { type: "plan:create-start" });
    expect(state.plan.phase).toBe("creating");
    expect(state.plan.error).toBeNull();
  });

  test("plan:created routes to interviewing when status==='interviewing'", () => {
    const state = reduce(initialState(), {
      type: "plan:created",
      run: { ...sampleRun, status: "interviewing" },
    });
    expect(state.plan.phase).toBe("interviewing");
    expect(state.plan.run?.id).toBe("run-1");
  });

  test("plan:created routes to generating for non-interview status", () => {
    const state = reduce(initialState(), { type: "plan:created", run: sampleRun });
    expect(state.plan.phase).toBe("generating");
  });

  test("plan:answered clears answers draft when interview completes", () => {
    let state = reduce(initialState(), { type: "plan:answers-changed", value: '{"x":1}' });
    state = reduce(state, {
      type: "plan:answered",
      run: { ...sampleRun, status: "ready_to_generate" },
    });
    expect(state.plan.phase).toBe("generating");
    expect(state.plan.answersDraft).toBe("");
  });

  test("plan:answered keeps answers draft when interview continues", () => {
    let state = reduce(initialState(), { type: "plan:answers-changed", value: '{"x":1}' });
    state = reduce(state, {
      type: "plan:answered",
      run: { ...sampleRun, status: "interviewing" },
    });
    expect(state.plan.phase).toBe("interviewing");
    expect(state.plan.answersDraft).toBe('{"x":1}');
  });

  test("plan:generated lands on ready with the proposal", () => {
    const state = reduce(initialState(), { type: "plan:generated", run: sampleRun });
    expect(state.plan.phase).toBe("ready");
    expect(state.plan.run?.proposalSummary?.taskCount).toBe(5);
  });

  test("plan:approved closes the plan overlay if open", () => {
    let state: State = {
      ...initialState(),
      overlay: "plan",
      plan: { ...initialPlanState(), phase: "approving", run: sampleRun },
    };
    state = reduce(state, { type: "plan:approved" });
    expect(state.plan.phase).toBe("approved");
    expect(state.overlay).toBe("none");
  });

  test("plan:approved does not touch other overlays", () => {
    const state: State = {
      ...initialState(),
      overlay: "help",
      plan: { ...initialPlanState(), phase: "approving", run: sampleRun },
    };
    expect(reduce(state, { type: "plan:approved" }).overlay).toBe("help");
  });

  test("plan:reset wipes the slice back to initial", () => {
    let state = reduce(initialState(), { type: "plan:goal-changed", value: "x" });
    state = reduce(state, { type: "plan:created", run: sampleRun });
    state = reduce(state, { type: "plan:reset" });
    expect(state.plan).toEqual(initialPlanState());
  });

  test("create-plan, approve-plan, reset-plan are filterable in the palette", () => {
    expect(filterCommands("plan").map((c) => c.id)).toEqual(
      expect.arrayContaining(["create-plan", "approve-plan", "reset-plan"]),
    );
  });
});

describe("tasks cursor and detail view", () => {
  const items: ApiTask[] = [
    { id: "t1", stableId: "T-1", title: "first", status: "ready" },
    { id: "t2", stableId: "T-2", title: "second", status: "ready" },
    { id: "t3", stableId: "T-3", title: "third", status: "ready" },
  ];

  test("tasks:loaded clamps cursor when items shrink", () => {
    let state = reduce(initialState(), { type: "tasks:loaded", items });
    state = reduce(state, { type: "tasks:cursor", delta: 1 });
    state = reduce(state, { type: "tasks:cursor", delta: 1 });
    expect(state.tasks.cursor).toBe(2);
    state = reduce(state, { type: "tasks:loaded", items: items.slice(0, 1) });
    expect(state.tasks.cursor).toBe(0);
  });

  test("tasks:cursor wraps inside the items range", () => {
    let state = reduce(initialState(), { type: "tasks:loaded", items });
    state = reduce(state, { type: "tasks:cursor", delta: -1 });
    expect(state.tasks.cursor).toBe(items.length - 1);
    state = reduce(state, { type: "tasks:cursor", delta: 1 });
    expect(state.tasks.cursor).toBe(0);
  });

  test("view:enter-detail switches view and seeds taskDetail with the id", () => {
    const state = reduce(initialState(), { type: "view:enter-detail", taskId: "t-7" });
    expect(state.view).toBe("detail");
    expect(state.taskDetail.taskId).toBe("t-7");
    expect(state.taskDetail.status).toBe("idle");
  });

  test("view:exit-detail returns to list and clears the detail slice", () => {
    let state = reduce(initialState(), { type: "view:enter-detail", taskId: "t-7" });
    state = reduce(state, { type: "view:exit-detail" });
    expect(state.view).toBe("list");
    expect(state.taskDetail).toEqual(initialTaskDetailState());
  });

  test("task-detail:loaded marks status ready and stores verification + branch", () => {
    const verification: ApiTaskVerificationReview = {
      taskId: "t1",
      plan: {
        id: "vp1",
        taskId: "t1",
        status: "proposed",
        items: [
          { id: "i1", name: "lint", status: "ready", orderIndex: 1, runnableNow: true },
        ],
      },
      summary: { totalCount: 1, runnableCount: 1, deferredCount: 0, allRunnableNow: true },
    };
    const branch: ApiBranch = {
      id: "b1",
      taskId: "t1",
      branchName: "feat/t1",
      state: "open",
      baseBranch: "main",
    };

    let state = reduce(initialState(), { type: "view:enter-detail", taskId: "t1" });
    state = reduce(state, { type: "task-detail:loaded", verification, branch });
    expect(state.taskDetail.status).toBe("ready");
    expect(state.taskDetail.verification).toEqual(verification);
    expect(state.taskDetail.branch).toEqual(branch);
  });

  test("task-detail:execution-started clears stale test-runs and evaluation", () => {
    const execution: ApiExecution = {
      id: "e1",
      taskId: "t1",
      status: "queued",
      createdAt: "2026-01-01",
    };
    let state: State = {
      ...initialState(),
      view: "detail",
      taskDetail: {
        ...initialTaskDetailState(),
        taskId: "t1",
        testRuns: [{ id: "tr1", executionId: "old", status: "passed", orderIndex: 0 }],
        evaluation: { id: "ev1", status: "completed" },
      },
    };
    state = reduce(state, { type: "task-detail:execution-started", execution });
    expect(state.taskDetail.execution).toEqual(execution);
    expect(state.taskDetail.testRuns).toEqual([]);
    expect(state.taskDetail.evaluation).toBeNull();
  });

  test("task-detail:test-runs-updated replaces the test-runs array", () => {
    const runs: ApiTestRun[] = [
      { id: "tr1", executionId: "e1", status: "running", orderIndex: 0 },
      { id: "tr2", executionId: "e1", status: "passed", orderIndex: 1 },
    ];
    let state: State = {
      ...initialState(),
      view: "detail",
      taskDetail: { ...initialTaskDetailState(), taskId: "t1" },
    };
    state = reduce(state, { type: "task-detail:test-runs-updated", testRuns: runs });
    expect(state.taskDetail.testRuns).toEqual(runs);
  });
});

describe("claude-login slice", () => {
  test("starts in idle phase with no CLI info", () => {
    expect(initialState().claudeLogin).toEqual(initialClaudeLoginState());
  });

  test("detect-start moves to detecting and clears error", () => {
    let state = reduce(initialState(), {
      type: "claude-login:missing",
      reason: "earlier failure",
    });
    state = reduce(state, { type: "claude-login:detect-start" });
    expect(state.claudeLogin.phase).toBe("detecting");
    expect(state.claudeLogin.error).toBeNull();
  });

  test("detected stores path + version", () => {
    const state = reduce(initialState(), {
      type: "claude-login:detected",
      cliPath: "/usr/local/bin/claude",
      cliVersion: "1.2.3",
    });
    expect(state.claudeLogin).toEqual({
      phase: "detected",
      cliPath: "/usr/local/bin/claude",
      cliVersion: "1.2.3",
      error: null,
    });
  });

  test("missing records the reason and clears stale path/version", () => {
    let state = reduce(initialState(), {
      type: "claude-login:detected",
      cliPath: "/old",
      cliVersion: "0.9.0",
    });
    state = reduce(state, { type: "claude-login:missing", reason: "not on PATH" });
    expect(state.claudeLogin.cliPath).toBeNull();
    expect(state.claudeLogin.cliVersion).toBeNull();
    expect(state.claudeLogin.phase).toBe("missing");
    expect(state.claudeLogin.error).toBe("not on PATH");
  });

  test("reset wipes the slice back to initial", () => {
    let state = reduce(initialState(), {
      type: "claude-login:detected",
      cliPath: "/x",
      cliVersion: "1.0.0",
    });
    state = reduce(state, { type: "claude-login:reset" });
    expect(state.claudeLogin).toEqual(initialClaudeLoginState());
  });

  test("login-claude is filterable in the palette", () => {
    expect(filterCommands("login").map((c) => c.id)).toContain("login-claude");
    expect(filterCommands("Claude CLI").map((c) => c.id)).toContain("login-claude");
  });
});

describe("claude-login slice", () => {
  test("starts in idle phase with no detection results", () => {
    expect(initialState().claudeLogin).toEqual(initialClaudeLoginState());
    expect(initialState().claudeLogin.phase).toBe("idle");
  });

  test("claude-login:detect-start moves to detecting and clears prior error", () => {
    let state = reduce(initialState(), {
      type: "claude-login:missing",
      reason: "claude not on PATH",
    });
    state = reduce(state, { type: "claude-login:detect-start" });
    expect(state.claudeLogin.phase).toBe("detecting");
    expect(state.claudeLogin.error).toBeNull();
  });

  test("claude-login:detected stores path and version", () => {
    const state = reduce(initialState(), {
      type: "claude-login:detected",
      cliPath: "/usr/local/bin/claude",
      cliVersion: "1.2.3",
    });
    expect(state.claudeLogin.phase).toBe("detected");
    expect(state.claudeLogin.cliPath).toBe("/usr/local/bin/claude");
    expect(state.claudeLogin.cliVersion).toBe("1.2.3");
  });

  test("claude-login:missing records the reason and clears prior detection", () => {
    let state = reduce(initialState(), {
      type: "claude-login:detected",
      cliPath: "/x/claude",
      cliVersion: "0.9.0",
    });
    state = reduce(state, { type: "claude-login:missing", reason: "removed" });
    expect(state.claudeLogin.phase).toBe("missing");
    expect(state.claudeLogin.cliPath).toBeNull();
    expect(state.claudeLogin.cliVersion).toBeNull();
    expect(state.claudeLogin.error).toBe("removed");
  });

  test("claude-login:reset returns the slice to its initial form", () => {
    let state = reduce(initialState(), {
      type: "claude-login:detected",
      cliPath: "/x/claude",
      cliVersion: "1.0",
    });
    state = reduce(state, { type: "claude-login:reset" });
    expect(state.claudeLogin).toEqual(initialClaudeLoginState());
  });

  test("login-claude is filterable in the palette", () => {
    expect(filterCommands("claude").map((c) => c.id)).toEqual(
      expect.arrayContaining(["login-claude"]),
    );
  });
});

describe("toast and exit", () => {
  test("toast can be set and cleared", () => {
    const toast = { kind: "info" as const, text: "hello", expiresAt: 0 };
    let state = reduce(initialState(), { type: "toast", toast });
    expect(state.toast).toEqual(toast);
    state = reduce(state, { type: "toast", toast: null });
    expect(state.toast).toBeNull();
  });

  test("exit flips the exit flag", () => {
    const state = reduce(initialState(), { type: "exit" });
    expect(state.exit).toBe(true);
  });
});
