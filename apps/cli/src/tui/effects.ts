import {
  ApiHttpError,
  ApiNetworkError,
  type ApiBranch,
  type ApiClient,
  type ApiProject,
  type ApiTaskVerificationReview,
  detectClaudeCli,
  readVimbusState,
  writeVimbusState,
  getCredentialsStatus,
} from "@vimbuspromax3000/api-client";
import {
  validateAnthropicKey,
  writeClaudeCredentialsFile,
} from "@vimbuspromax3000/model-registry";
import type { Action } from "./state";

export type Dispatch = (action: Action) => void;

export type EffectDeps = {
  client: ApiClient;
  apiUrl: string;
};

export async function runBootEffect(deps: EffectDeps, dispatch: Dispatch): Promise<void> {
  dispatch({ type: "boot:start", apiUrl: deps.apiUrl });
  dispatch({ type: "boot:trace", line: `health: probing ${deps.apiUrl}` });

  try {
    await deps.client.health();
    dispatch({ type: "boot:trace", line: "health: ok" });
  } catch (error) {
    const reason = describeError(error);
    dispatch({ type: "boot:trace", line: `health: ${reason}` });
    dispatch({ type: "boot:health-fail", apiUrl: deps.apiUrl, reason });
    return;
  }

  const auth = await getCredentialsStatus();
  if (auth.found) {
    dispatch({ type: "boot:trace", line: `auth: found via ${auth.source}` });
    dispatch({ type: "auth:loaded", source: auth.source, reason: null });
  } else {
    dispatch({ type: "boot:trace", line: `auth: ${auth.reason}` });
    dispatch({ type: "auth:loaded", source: null, reason: auth.reason });
    dispatch({ type: "boot:auth-missing", reason: auth.reason });
    return;
  }

  let projects: ApiProject[];
  try {
    projects = await deps.client.listProjects();
    dispatch({ type: "boot:trace", line: `projects: ${projects.length} loaded` });
  } catch (error) {
    const reason = describeError(error);
    dispatch({ type: "boot:trace", line: `projects: ${reason}` });
    dispatch({
      type: "toast",
      toast: { kind: "error", text: `Could not load projects: ${reason}`, expiresAt: 0 },
    });
    return;
  }

  const persisted = await readVimbusState();
  const selectedId = persisted.selectedProjectId;

  if (selectedId && !projects.some((project) => project.id === selectedId)) {
    dispatch({
      type: "boot:trace",
      line: `state: persisted project ${selectedId} no longer exists`,
    });
  }

  dispatch({
    type: "boot:projects-loaded",
    projects,
    selectedProjectId: selectedId,
  });

  const ready = projects.find((project) => project.id === selectedId);
  if (ready) {
    await Promise.all([
      runSlotTestEffect(deps, ready.id, dispatch),
      loadTasksEffect(deps, ready.id, dispatch),
    ]);
  }
}

export async function loadTasksEffect(
  deps: EffectDeps,
  projectId: string,
  dispatch: Dispatch,
): Promise<void> {
  dispatch({ type: "tasks:loading" });
  try {
    const items = await deps.client.listTasks(projectId);
    dispatch({ type: "tasks:loaded", items });
    dispatch({ type: "boot:trace", line: `tasks: ${items.length} loaded` });
  } catch (error) {
    const reason = describeError(error);
    dispatch({ type: "tasks:error", error: reason });
    dispatch({ type: "boot:trace", line: `tasks: ${reason}` });
  }
}

export async function runSlotTestEffect(
  deps: EffectDeps,
  projectId: string,
  dispatch: Dispatch,
): Promise<void> {
  try {
    const result = await deps.client.testSlot({
      projectId,
      slot: "planner_deep",
      requiredCapabilities: ["json"],
    });

    if (result.ok) {
      const message = `${result.value.concreteModelName}${result.value.usedFallback ? " (fallback)" : ""}`;
      dispatch({ type: "auth:slot-result", ok: true, message });
      dispatch({ type: "boot:trace", line: `slot planner_deep: ok (${message})` });
    } else {
      const message = `${result.code ?? "unknown"} ${result.message ?? ""}`.trim();
      dispatch({ type: "auth:slot-result", ok: false, message });
      dispatch({ type: "boot:trace", line: `slot planner_deep: ${message}` });
    }
  } catch (error) {
    const reason = describeError(error);
    dispatch({ type: "auth:slot-result", ok: false, message: reason });
    dispatch({ type: "boot:trace", line: `slot planner_deep: ${reason}` });
  }
}

export async function selectProjectEffect(
  deps: EffectDeps,
  project: ApiProject,
  dispatch: Dispatch,
): Promise<void> {
  dispatch({ type: "project:select", project });
  try {
    await writeVimbusState({
      patch: { selectedProjectId: project.id, lastApiUrl: deps.apiUrl },
    });
  } catch (error) {
    dispatch({
      type: "toast",
      toast: {
        kind: "error",
        text: `Could not persist project selection: ${describeError(error)}`,
        expiresAt: 0,
      },
    });
  }
  await Promise.all([
    runSlotTestEffect(deps, project.id, dispatch),
    loadTasksEffect(deps, project.id, dispatch),
  ]);
}

export type CreatePlanInput = {
  projectId: string;
  goal: string;
  moduleName?: string;
  contextPath?: string;
};

export async function runCreatePlanEffect(
  deps: EffectDeps,
  input: CreatePlanInput,
  dispatch: Dispatch,
): Promise<void> {
  dispatch({ type: "plan:create-start" });
  dispatch({ type: "boot:trace", line: `plan: creating run for goal "${input.goal}"` });

  let run;
  try {
    run = await deps.client.createPlannerRun({
      projectId: input.projectId,
      goal: input.goal,
      moduleName: input.moduleName,
      contextPath: input.contextPath,
    });
  } catch (error) {
    const reason = describeError(error);
    dispatch({ type: "plan:error", error: reason });
    dispatch({ type: "boot:trace", line: `plan: create failed — ${reason}` });
    return;
  }

  dispatch({ type: "plan:created", run });
  dispatch({ type: "boot:trace", line: `plan: run ${run.id} status=${run.status}` });

  if (run.status !== "interviewing") {
    await runGeneratePlanEffect(deps, run.id, dispatch);
  }
}

export async function runAnswerPlanEffect(
  deps: EffectDeps,
  plannerRunId: string,
  answersJson: string,
  dispatch: Dispatch,
): Promise<void> {
  let answers: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(answersJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("answers must decode to a JSON object");
    }
    answers = parsed as Record<string, unknown>;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    dispatch({ type: "plan:error", error: `Invalid answers JSON: ${reason}` });
    return;
  }

  dispatch({ type: "plan:answer-start" });

  let run;
  try {
    run = await deps.client.answerPlannerRun({ plannerRunId, answers });
  } catch (error) {
    const reason = describeError(error);
    dispatch({ type: "plan:error", error: reason });
    dispatch({ type: "boot:trace", line: `plan: answer failed — ${reason}` });
    return;
  }

  dispatch({ type: "plan:answered", run });
  dispatch({ type: "boot:trace", line: `plan: answered, status=${run.status}` });

  if (run.status !== "interviewing") {
    await runGeneratePlanEffect(deps, run.id, dispatch);
  }
}

export async function runGeneratePlanEffect(
  deps: EffectDeps,
  plannerRunId: string,
  dispatch: Dispatch,
): Promise<void> {
  dispatch({ type: "plan:generate-start" });
  dispatch({ type: "boot:trace", line: `plan: generating ${plannerRunId}` });

  let run;
  try {
    run = await deps.client.generatePlannerRun({ plannerRunId });
  } catch (error) {
    const reason = describeError(error);
    dispatch({ type: "plan:error", error: reason });
    dispatch({ type: "boot:trace", line: `plan: generate failed — ${reason}` });
    return;
  }

  dispatch({ type: "plan:generated", run });
  const summary = run.proposalSummary;
  if (summary) {
    dispatch({
      type: "boot:trace",
      line: `plan: proposal epics=${summary.epicCount} tasks=${summary.taskCount} verification=${summary.verificationPlanCount}`,
    });
  }
}

export async function runApprovePlanEffect(
  deps: EffectDeps,
  projectId: string,
  plannerRunId: string,
  dispatch: Dispatch,
): Promise<void> {
  dispatch({ type: "plan:approve-start" });

  try {
    const approval = await deps.client.createApproval({
      projectId,
      subjectType: "planner_run",
      subjectId: plannerRunId,
      stage: "planner_review",
      status: "granted",
    });
    dispatch({ type: "plan:approved" });
    dispatch({
      type: "toast",
      toast: { kind: "success", text: `Plan approved (${approval.id}).`, expiresAt: 0 },
    });
    dispatch({ type: "boot:trace", line: `plan: approved (${approval.id})` });
  } catch (error) {
    const reason = describeError(error);
    dispatch({ type: "plan:error", error: reason });
    dispatch({
      type: "toast",
      toast: { kind: "error", text: `Approval failed: ${reason}`, expiresAt: 0 },
    });
    return;
  }

  await loadTasksEffect(deps, projectId, dispatch);
}

export async function loadTaskDetailEffect(
  deps: EffectDeps,
  taskId: string,
  dispatch: Dispatch,
): Promise<void> {
  dispatch({ type: "task-detail:loading" });
  dispatch({ type: "boot:trace", line: `task-detail: loading ${taskId}` });

  let verification: ApiTaskVerificationReview | null = null;
  try {
    verification = await deps.client.getTaskVerification(taskId);
  } catch (error) {
    const reason = describeError(error);
    dispatch({ type: "task-detail:error", error: reason });
    dispatch({ type: "boot:trace", line: `task-detail: verification failed — ${reason}` });
    return;
  }

  let branch: ApiBranch | null = null;
  try {
    branch = await deps.client.getBranch(taskId);
  } catch (error) {
    if (error instanceof ApiHttpError && error.status === 404) {
      branch = null;
    } else {
      dispatch({
        type: "boot:trace",
        line: `task-detail: branch lookup failed — ${describeError(error)}`,
      });
    }
  }

  dispatch({ type: "task-detail:loaded", verification, branch });
}

export async function runCreateBranchEffect(
  deps: EffectDeps,
  taskId: string,
  dispatch: Dispatch,
): Promise<void> {
  try {
    const branch = await deps.client.createBranch({ taskId });
    dispatch({ type: "task-detail:branch-created", branch });
    dispatch({ type: "boot:trace", line: `task-detail: branch ${branch.branchName} created` });
  } catch (error) {
    const reason = describeError(error);
    dispatch({
      type: "toast",
      toast: { kind: "error", text: `Branch create failed: ${reason}`, expiresAt: 0 },
    });
    dispatch({ type: "boot:trace", line: `task-detail: branch create failed — ${reason}` });
  }
}

export async function runStartExecutionEffect(
  deps: EffectDeps,
  taskId: string,
  dispatch: Dispatch,
): Promise<void> {
  try {
    const execution = await deps.client.startExecution(taskId);
    dispatch({ type: "task-detail:execution-started", execution });
    dispatch({
      type: "boot:trace",
      line: `task-detail: execution ${execution.id} started (${execution.status})`,
    });
  } catch (error) {
    const reason = describeError(error);
    dispatch({
      type: "toast",
      toast: { kind: "error", text: `Execution start failed: ${reason}`, expiresAt: 0 },
    });
    dispatch({ type: "boot:trace", line: `task-detail: execution failed — ${reason}` });
  }
}

export async function runStartTestRunsEffect(
  deps: EffectDeps,
  executionId: string,
  dispatch: Dispatch,
): Promise<void> {
  try {
    const testRuns = await deps.client.startTestRuns(executionId);
    dispatch({ type: "task-detail:test-runs-updated", testRuns });
    dispatch({ type: "boot:trace", line: `task-detail: ${testRuns.length} test-runs started` });
  } catch (error) {
    const reason = describeError(error);
    dispatch({
      type: "toast",
      toast: { kind: "error", text: `Test-runs start failed: ${reason}`, expiresAt: 0 },
    });
    dispatch({ type: "boot:trace", line: `task-detail: test-runs failed — ${reason}` });
  }
}

export async function runRefreshTestRunsEffect(
  deps: EffectDeps,
  executionId: string,
  dispatch: Dispatch,
): Promise<void> {
  try {
    const testRuns = await deps.client.listTestRuns(executionId);
    dispatch({ type: "task-detail:test-runs-updated", testRuns });
  } catch (error) {
    dispatch({
      type: "boot:trace",
      line: `task-detail: poll failed — ${describeError(error)}`,
    });
  }
}

export async function runEvaluatePatchEffect(
  deps: EffectDeps,
  executionId: string,
  dispatch: Dispatch,
): Promise<void> {
  try {
    const evaluation = await deps.client.runEvaluation(executionId);
    dispatch({ type: "task-detail:evaluation-updated", evaluation });
    dispatch({
      type: "boot:trace",
      line: `task-detail: eval ${evaluation.id} verdict=${evaluation.verdict ?? "n/a"}`,
    });
  } catch (error) {
    const reason = describeError(error);
    dispatch({
      type: "toast",
      toast: { kind: "error", text: `Evaluation failed: ${reason}`, expiresAt: 0 },
    });
    dispatch({ type: "boot:trace", line: `task-detail: eval failed — ${reason}` });
  }
}

export async function runDetectClaudeCliEffect(dispatch: Dispatch): Promise<void> {
  dispatch({ type: "claude-login:detect-start" });
  dispatch({ type: "boot:trace", line: "claude-login: detecting CLI" });

  const result = await detectClaudeCli();
  if (result.found) {
    dispatch({
      type: "claude-login:detected",
      cliPath: result.path,
      cliVersion: result.version,
    });
    dispatch({
      type: "boot:trace",
      line: `claude-login: detected ${result.path} (${result.version ?? "unknown version"})`,
    });
  } else {
    dispatch({ type: "claude-login:missing", reason: result.reason });
    dispatch({ type: "boot:trace", line: `claude-login: ${result.reason}` });
  }
}

export async function refreshAuthEffect(dispatch: Dispatch): Promise<void> {
  const status = await getCredentialsStatus();
  if (status.found) {
    dispatch({ type: "auth:loaded", source: status.source, reason: null });
    dispatch({ type: "boot:trace", line: `auth: refreshed via ${status.source}` });
  } else {
    dispatch({ type: "auth:loaded", source: null, reason: status.reason });
    dispatch({ type: "boot:trace", line: `auth: ${status.reason}` });
  }
}

export async function pasteApiKeyEffect(
  apiKey: string,
  dispatch: Dispatch,
): Promise<{ ok: boolean; message: string }> {
  if (!validateAnthropicKey(apiKey)) {
    return {
      ok: false,
      message: "Pasted value did not look like an Anthropic API key (sk-ant-...).",
    };
  }

  try {
    const result = await writeClaudeCredentialsFile({ apiKey });
    dispatch({
      type: "toast",
      toast: {
        kind: "success",
        text: `Wrote API key to ${result.path}.`,
        expiresAt: 0,
      },
    });
    const status = await getCredentialsStatus();
    dispatch({
      type: "auth:loaded",
      source: status.found ? status.source : null,
      reason: status.found ? null : status.reason,
    });
    return { ok: true, message: result.path };
  } catch (error) {
    const reason = describeError(error);
    dispatch({
      type: "toast",
      toast: { kind: "error", text: `Could not save API key: ${reason}`, expiresAt: 0 },
    });
    return { ok: false, message: reason };
  }
}

export function describeError(error: unknown): string {
  if (error instanceof ApiHttpError) {
    const code = error.code ? `${error.code} ` : "";
    return `HTTP ${error.status}: ${code}${error.message}`.trim();
  }
  if (error instanceof ApiNetworkError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
