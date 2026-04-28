import { createAiSdkLanguageModel, toRuntimeProviderConfig } from "@vimbuspromax3000/agent";
import {
  getPlannerRunDetail,
  persistPlannerProposal,
  type PlannerProposalInput,
} from "@vimbuspromax3000/db";
import type { PrismaClient } from "@vimbuspromax3000/db/client";
import { resolveModelSlot } from "@vimbuspromax3000/policy-engine";
import {
  isVerificationItemKind,
  isVerificationRunner,
  type ModelSlotKey,
  type VerificationItemKind,
  type VerificationRunner,
} from "@vimbuspromax3000/shared";
import { scoreTaskComplexity } from "@vimbuspromax3000/task-intel";
import { generateObject, jsonSchema, type JSONSchema7 } from "ai";
import { runOrchestrator } from "./agents/orchestrator";
import type { PlannerAgentRole, PlannerSlotResolver } from "./agents/types";
import { getDefaultSlotForAgentRole, type PlannerAgentRole as PlannerSlotRole } from "./slots";

export const DEFAULT_PLANNER_GENERATION_SEED = 7;

export type PlannerRunDetail = NonNullable<Awaited<ReturnType<typeof getPlannerRunDetail>>>;

/**
 * VIM-34 — fixed 5-round interview order. The operator answers one round at a
 * time; the API rejects out-of-order submissions with 422 + the expected next
 * round name. Each round persists its own slice of `interviewJson` keyed by
 * round name, e.g. `interviewJson.scope`, `interviewJson.domain`.
 */
export const INTERVIEW_ROUNDS = [
  "scope",
  "domain",
  "interfaces",
  "verification",
  "policy",
] as const;

export type InterviewRound = (typeof INTERVIEW_ROUNDS)[number];

export function isInterviewRound(value: unknown): value is InterviewRound {
  return typeof value === "string" && (INTERVIEW_ROUNDS as readonly string[]).includes(value);
}

/**
 * Returns the next round name the operator is expected to submit, given the
 * rounds already persisted on `interview`. Returns `null` once all 5 rounds
 * are present (interview complete).
 */
export function getExpectedNextInterviewRound(
  interview: Record<string, unknown> | null | undefined,
): InterviewRound | null {
  const seen = interview ?? {};
  for (const round of INTERVIEW_ROUNDS) {
    if (!Object.prototype.hasOwnProperty.call(seen, round)) {
      return round;
    }
  }
  return null;
}

export type InterviewSubmission =
  | { round: InterviewRound; answer: Record<string, unknown> }
  | { rounds: Array<{ round: InterviewRound; answer: Record<string, unknown> }> };

export type InterviewSubmissionAcceptance = {
  ok: true;
  /** Rounds that were applied by this submission, in the order they were applied. */
  appliedRounds: Array<{ round: InterviewRound; answer: Record<string, unknown> }>;
  /** Interview JSON after merging all applied rounds. */
  mergedInterview: Record<string, unknown>;
  /** The next expected round after this submission, or `null` if interview is complete. */
  expectedNextRound: InterviewRound | null;
};

export type InterviewSubmissionRejection = {
  ok: false;
  reason: "out_of_order" | "invalid_round" | "missing_answer";
  /** The round name we expected (or `null` if interview is already complete). */
  expectedNextRound: InterviewRound | null;
  /** The round the operator tried to submit, if any. */
  submittedRound?: string;
};

export type InterviewSubmissionResult =
  | InterviewSubmissionAcceptance
  | InterviewSubmissionRejection;

/**
 * VIM-34 — pure round-state-machine evaluator. Given the current interview
 * slice (already persisted) and a normalized submission (single round or a
 * batch of rounds), decide whether to accept or reject the submission with a
 * single explicit branch. Out-of-order is the only rejection branch — the
 * caller is responsible for parsing the wire payload into a `submission`
 * before invoking this.
 */
export function evaluateInterviewSubmission(
  currentInterview: Record<string, unknown> | null | undefined,
  submission: InterviewSubmission,
): InterviewSubmissionResult {
  const baseInterview: Record<string, unknown> = { ...(currentInterview ?? {}) };
  const incoming = "rounds" in submission ? submission.rounds : [submission];

  if (incoming.length === 0) {
    return {
      ok: false,
      reason: "missing_answer",
      expectedNextRound: getExpectedNextInterviewRound(baseInterview),
    };
  }

  const applied: Array<{ round: InterviewRound; answer: Record<string, unknown> }> = [];
  const merged = baseInterview;

  for (const entry of incoming) {
    if (!isInterviewRound(entry.round)) {
      return {
        ok: false,
        reason: "invalid_round",
        expectedNextRound: getExpectedNextInterviewRound(merged),
        submittedRound: String(entry.round),
      };
    }

    const expected = getExpectedNextInterviewRound(merged);
    if (expected !== entry.round) {
      // Out-of-order: the only rejection branch we care about for the 422
      // contract. Surfaces the round we expected next so the CLI can re-prompt.
      return {
        ok: false,
        reason: "out_of_order",
        expectedNextRound: expected,
        submittedRound: entry.round,
      };
    }

    merged[entry.round] = entry.answer;
    applied.push({ round: entry.round, answer: entry.answer });
  }

  return {
    ok: true,
    appliedRounds: applied,
    mergedInterview: merged,
    expectedNextRound: getExpectedNextInterviewRound(merged),
  };
}

/**
 * VIM-34 — normalize a wire payload into a strict `InterviewSubmission`.
 * Accepts three shapes:
 *   1. `{ round: "scope", answer: {...} }`           — explicit single-round
 *   2. `{ answer: {...} }`                            — single round (round is
 *       the next expected); `expectedNextRound` must be supplied by caller
 *   3. `{ answers: { scope: {...}, domain: {...} } }` — legacy batch; rounds
 *       are inferred from the keys, in `INTERVIEW_ROUNDS` order, so an
 *       in-order batch still works for the existing happy-path tests
 * Returns `null` if the payload cannot be normalized to a submission shape.
 */
export function normalizeInterviewPayload(
  payload: unknown,
  options: { expectedNextRound: InterviewRound | null },
): InterviewSubmission | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const body = payload as Record<string, unknown>;

  // Shape 1: explicit single-round
  if (typeof body.round === "string" && body.answer !== undefined) {
    if (!isPlainRecord(body.answer)) return null;
    return { round: body.round as InterviewRound, answer: body.answer };
  }

  // Shape 2: implicit single-round — answer with no round means "the next one"
  if (body.answer !== undefined && body.round === undefined) {
    if (!options.expectedNextRound) return null;
    if (!isPlainRecord(body.answer)) return null;
    return { round: options.expectedNextRound, answer: body.answer };
  }

  // Shape 3: legacy batch — `answers` is a record keyed by round name
  if (isPlainRecord(body.answers)) {
    return normalizeBatchAnswers(body.answers);
  }

  // Bare batch — payload itself is the answers map (no `answers` wrapper)
  return normalizeBatchAnswers(body);
}

function normalizeBatchAnswers(record: Record<string, unknown>): InterviewSubmission | null {
  // Pull the rounds out in canonical order so a `{verification, scope}` batch
  // is treated as `{scope, verification}` — the state machine still rejects
  // skipped rounds, so this only helps when keys arrive in jumbled order but
  // are otherwise contiguous from the next expected round.
  const rounds: Array<{ round: InterviewRound; answer: Record<string, unknown> }> = [];
  for (const round of INTERVIEW_ROUNDS) {
    if (!Object.prototype.hasOwnProperty.call(record, round)) continue;
    const answer = record[round];
    if (!isPlainRecord(answer)) return null;
    rounds.push({ round, answer });
  }

  // Reject the batch if the operator passed unknown keys — protects against a
  // typo silently being ignored.
  for (const key of Object.keys(record)) {
    if (!isInterviewRound(key)) return null;
  }

  if (rounds.length === 0) return null;
  if (rounds.length === 1) return rounds[0]!;
  return { rounds };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export type PlannerGenerator = (input: {
  model: unknown;
  system: string;
  prompt: string;
  seed: number;
}) => Promise<{
  object: unknown;
  reasoning?: string;
}>;

export type PlannerGenerationInput = {
  plannerRunId: string;
  seed?: number;
};

export type PlannerGenerationResult = {
  plannerRun: PlannerRunDetail;
  proposal: PlannerProposalInput;
  slotKey: ModelSlotKey;
  concreteModelName: string;
  reasoning?: string;
};

export type PlannerService = {
  generateAndPersist(input: PlannerGenerationInput): Promise<PlannerGenerationResult>;
};

export type PlannerServiceOptions = {
  prisma: PrismaClient;
  env?: Record<string, string | undefined>;
  generator?: PlannerGenerator;
};

type NormalizeMode = "strict" | "generated";

type GeneratedPlannerProposal = {
  summary?: string;
  epics: Array<{
    key?: string;
    title?: string;
    goal?: string;
    orderIndex?: number;
    acceptance?: unknown;
    risks?: unknown;
    tasks: Array<{
      stableId?: string;
      title?: string;
      description?: string;
      type?: string;
      complexity?: string;
      orderIndex?: number;
      acceptance?: unknown;
      targetFiles?: unknown;
      requires?: unknown;
      verificationPlan?: {
        rationale?: string;
        items?: Array<{
          kind?: string;
          runner?: string;
          title?: string;
          description?: string;
          rationale?: string;
          command?: string;
          testFilePath?: string;
          route?: string;
          interaction?: string;
          expectedAssetId?: string;
          orderIndex?: number;
          config?: unknown;
        }>;
      };
    }>;
  }>;
};

export function createPlannerService(options: PlannerServiceOptions): PlannerService {
  const prisma = options.prisma;
  const env = options.env ?? process.env;
  const generator = options.generator ?? defaultPlannerGenerator;

  return {
    async generateAndPersist(input) {
      const plannerRun = await getPlannerRunDetail(prisma, input.plannerRunId);

      if (!plannerRun) {
        throw new Error(`Planner run ${input.plannerRunId} was not found.`);
      }

      // VIM-33 + VIM-35 follow-up: each agent resolves its own slot through
      // `resolveModelSlot` keyed on its role. The role->slot mapping lives in
      // `getDefaultSlotForAgentRole` (sourced from
      // `DEFAULT_AGENT_ROLE_MODEL_SLOTS` in @vimbuspromax3000/shared). We still
      // resolve `epic_planner` eagerly so the service can return its slotKey
      // and concreteModelName fields (which historically described the lead
      // planner agent's model).
      const leadSlotKey = getDefaultSlotForAgentRole("epic_planner");
      const leadResolution = await resolveModelSlot(
        prisma,
        {
          projectId: plannerRun.projectId,
          slotKey: leadSlotKey,
          requiredCapabilities: ["json"],
        },
        env,
      );

      if (!leadResolution.ok) {
        throw new Error(
          `Planner model resolution failed for ${leadSlotKey}: ${leadResolution.message}`,
        );
      }

      const concreteModelName = leadResolution.value.concreteModelName;
      const leadModel = await loadPlannerModel(prisma, leadResolution.value, env);
      const leadCache = new Map<ModelSlotKey, { model: unknown; concreteModelName: string }>([
        [leadSlotKey, { model: leadModel, concreteModelName }],
      ]);

      const slotResolver: PlannerSlotResolver = async (role: PlannerAgentRole) => {
        const roleSlotKey = resolvePlannerSlotForRole(role);
        const cached = leadCache.get(roleSlotKey);
        if (cached) {
          return {
            slotKey: roleSlotKey,
            model: cached.model,
            concreteModelName: cached.concreteModelName,
          };
        }

        const resolution = await resolveModelSlot(
          prisma,
          {
            projectId: plannerRun.projectId,
            slotKey: roleSlotKey,
            requiredCapabilities: ["json"],
          },
          env,
        );

        if (!resolution.ok) {
          throw new Error(
            `Planner model resolution failed for role=${role} slot=${roleSlotKey}: ${resolution.message}`,
          );
        }

        const model = await loadPlannerModel(prisma, resolution.value, env);
        const entry = { model, concreteModelName: resolution.value.concreteModelName };
        leadCache.set(roleSlotKey, entry);
        return {
          slotKey: roleSlotKey,
          model,
          concreteModelName: entry.concreteModelName,
        };
      };

      const orchestratorResult = await runOrchestrator(
        { generator, slotResolver },
        {
          plannerRun,
          seed: input.seed ?? DEFAULT_PLANNER_GENERATION_SEED,
        },
      );

      // VIM-35: derive each task's complexity label deterministically from the
      // task-intel scorer rather than trusting whatever label the LLM emitted.
      // This is the single source of truth for the persisted complexity column.
      const annotatedProposal = annotateProposalComplexity(orchestratorResult.proposal);

      await persistPlannerProposal(prisma, annotatedProposal);

      const generatedPlannerRun = await getPlannerRunDetail(prisma, plannerRun.id);

      if (!generatedPlannerRun) {
        throw new Error(`Planner run ${plannerRun.id} was not found after generation.`);
      }

      return {
        plannerRun: generatedPlannerRun,
        proposal: annotatedProposal,
        slotKey: leadSlotKey,
        concreteModelName,
        reasoning: orchestratorResult.reasoning,
      };
    },
  };
}

/**
 * Re-derive each task's `complexity` label from the task-intel scorer using
 * the signals available on the proposal (target file count as a proxy for
 * fan-out + lines touched, distinct verification kinds as the diversity
 * signal). The proposal is shallow-cloned so callers can keep the original
 * untouched if they need it for diffing.
 */
export function annotateProposalComplexity(proposal: PlannerProposalInput): PlannerProposalInput {
  return {
    ...proposal,
    epics: proposal.epics.map((epic) => ({
      ...epic,
      tasks: epic.tasks.map((task) => {
        const targetFileCount = Array.isArray(task.targetFiles) ? task.targetFiles.length : 0;
        const requiresCount = Array.isArray(task.requires) ? task.requires.length : 0;
        const verificationKinds = task.verificationPlan.items
          .map((item) => item.kind)
          .filter((kind): kind is string => typeof kind === "string");

        const score = scoreTaskComplexity({
          // Each target file is a rough proxy for ~50 touched lines until the
          // planner produces a real estimate.
          estimatedLinesTouched: targetFileCount * 50,
          fanOut: targetFileCount + requiresCount,
          verificationKinds,
        });

        return {
          ...task,
          complexity: score.label,
        };
      }),
    })),
  };
}

export function normalizePlannerProposalInput(plannerRunId: string, value: unknown): PlannerProposalInput {
  return normalizePlannerProposal(plannerRunId, value, {
    mode: "strict",
  });
}

export function normalizeGeneratedPlannerProposal(
  plannerRunId: string,
  value: unknown,
  options: {
    summaryFallback?: string;
  } = {},
): PlannerProposalInput {
  return normalizePlannerProposal(plannerRunId, value, {
    mode: "generated",
    summaryFallback: options.summaryFallback,
  });
}

function normalizePlannerProposal(
  plannerRunId: string,
  value: unknown,
  options: {
    mode: NormalizeMode;
    summaryFallback?: string;
  },
): PlannerProposalInput {
  const body = requireRecord(value, "planner proposal");
  const epicValues = requireArray(body.epics, "epics");
  const usedEpicKeys = new Set<string>();
  const usedTaskIds = new Set<string>();
  const namespace = getPlannerNamespace(plannerRunId);

  return {
    plannerRunId,
    summary: normalizeString(body.summary) ?? options.summaryFallback ?? null,
    epics: epicValues.map((epic, epicIndex) => {
      const epicRecord = requireRecord(epic, `epics[${epicIndex}]`);
      const title =
        requireStringLike(
          epicRecord.title,
          `epics[${epicIndex}].title`,
          options.mode === "generated" ? `Epic ${epicIndex + 1}` : undefined,
        ) ?? `Epic ${epicIndex + 1}`;
      const rawEpicKey = normalizeIdentifier(
        extractStringValue(epicRecord.key) ?? slugToIdentifier(title) ?? `EPIC-${epicIndex + 1}`,
      );
      const epicKey = reserveIdentifier(prefixNamespace(namespace, rawEpicKey), usedEpicKeys);
      const taskValues = requireArray(epicRecord.tasks, `epics[${epicIndex}].tasks`);

      if (options.mode === "strict" && taskValues.length === 0) {
        throw new Error(`epics[${epicIndex}].tasks must include at least one task.`);
      }

      return {
        key: epicKey,
        title,
        goal:
          requireStringLike(
            epicRecord.goal,
            `epics[${epicIndex}].goal`,
            options.mode === "generated" ? title : undefined,
          ) ?? title,
        orderIndex: normalizeInteger(epicRecord.orderIndex) ?? epicIndex,
        acceptance: normalizeChecklist(epicRecord.acceptance, {
          fallback: options.mode === "generated" ? [`Ship ${title}`] : undefined,
        }),
        risks: normalizeChecklist(epicRecord.risks),
        tasks: taskValues.map((task, taskIndex) => {
          const taskRecord = requireRecord(task, `epics[${epicIndex}].tasks[${taskIndex}]`);
          const taskTitle =
            requireStringLike(
              taskRecord.title,
              `epics[${epicIndex}].tasks[${taskIndex}].title`,
              options.mode === "generated" ? `${title} Task ${taskIndex + 1}` : undefined,
            ) ?? `${title} Task ${taskIndex + 1}`;
          const rawStableId = normalizeIdentifier(
            extractStringValue(taskRecord.stableId) ?? slugToIdentifier(taskTitle) ?? `TASK-${taskIndex + 1}`,
          );
          const stableId = reserveIdentifier(prefixNamespace(namespace, rawStableId), usedTaskIds);
          const verificationPlan = isRecord(taskRecord.verificationPlan)
            ? taskRecord.verificationPlan
            : options.mode === "generated"
              ? {}
              : requireRecord(
                  taskRecord.verificationPlan,
                  `epics[${epicIndex}].tasks[${taskIndex}].verificationPlan`,
                );
          const verificationItems =
            Array.isArray(verificationPlan.items) && verificationPlan.items.length > 0
              ? verificationPlan.items
              : options.mode === "generated"
                ? [buildFallbackVerificationItem(taskTitle)]
                : requireArray(
                    verificationPlan.items,
                    `epics[${epicIndex}].tasks[${taskIndex}].verificationPlan.items`,
                  );

          if (options.mode === "strict" && verificationItems.length === 0) {
            throw new Error(
              `epics[${epicIndex}].tasks[${taskIndex}].verificationPlan.items must include at least one item.`,
            );
          }

          return {
            stableId,
            title: taskTitle,
            description: normalizeString(taskRecord.description) ?? null,
            type:
              requireStringLike(
                taskRecord.type,
                `epics[${epicIndex}].tasks[${taskIndex}].type`,
                options.mode === "generated" ? "general" : undefined,
              ) ?? "general",
            complexity:
              requireStringLike(
                taskRecord.complexity,
                `epics[${epicIndex}].tasks[${taskIndex}].complexity`,
                options.mode === "generated" ? "medium" : undefined,
              ) ?? "medium",
            orderIndex: normalizeInteger(taskRecord.orderIndex) ?? taskIndex,
            acceptance: normalizeChecklist(taskRecord.acceptance, {
              fallback: [`Complete ${taskTitle}`],
            }),
            targetFiles: normalizeStringList(taskRecord.targetFiles) ?? null,
            requires: normalizeStringList(taskRecord.requires) ?? null,
            verificationPlan: {
              rationale: normalizeString(verificationPlan.rationale) ?? null,
              items: verificationItems.map((item, itemIndex) =>
                normalizeVerificationItem(item, {
                  path: `epics[${epicIndex}].tasks[${taskIndex}].verificationPlan.items[${itemIndex}]`,
                  taskTitle,
                  itemIndex,
                  mode: options.mode,
                }),
              ),
            },
          };
        }),
      };
    }),
  };
}

/**
 * Map an orchestrator-level `PlannerAgentRole` to the slot key the policy
 * engine should resolve for that role. Falls back to `epic_planner`'s slot
 * for any role we have not enumerated yet so the resolver never throws on an
 * unknown role from a future agent addition.
 */
function resolvePlannerSlotForRole(role: PlannerAgentRole): ModelSlotKey {
  const knownRoles: Record<PlannerAgentRole, PlannerSlotRole> = {
    epic_planner: "epic_planner",
    task_writer: "task_writer",
    verification_designer: "verification_designer",
    reviewer: "reviewer",
  };
  const slotRole = knownRoles[role];
  return getDefaultSlotForAgentRole(slotRole);
}

async function defaultPlannerGenerator(input: {
  model: unknown;
  system: string;
  prompt: string;
  seed: number;
}) {
  const result = await generateObject({
    model: input.model as any,
    schema: generatedPlannerSchema,
    schemaName: "planner_proposal",
    schemaDescription:
      "Structured planner output with epics, tasks, and verification plans that can be persisted directly.",
    system: input.system,
    prompt: input.prompt,
    temperature: 0,
    seed: input.seed,
    maxRetries: 0,
  });

  return {
    object: result.object,
    reasoning: result.reasoning,
  };
}

async function loadPlannerModel(
  prisma: PrismaClient,
  snapshot: {
    modelId: string;
    modelSlug: string;
    providerKey: string;
    providerKind: string;
    concreteModelName: string;
    slotKey: ModelSlotKey;
  },
  env: Record<string, string | undefined>,
) {
  const model = await prisma.registeredModel.findUnique({
    where: { id: snapshot.modelId },
    include: {
      provider: {
        include: {
          secretRef: true,
        },
      },
    },
  });

  if (!model) {
    throw new Error(`Registered model ${snapshot.modelId} was not found.`);
  }

  return createAiSdkLanguageModel(
    toRuntimeProviderConfig(
      {
        slotKey: snapshot.slotKey,
        providerId: model.provider.id,
        providerKey: model.provider.key,
        providerKind: model.provider.providerKind as any,
        modelId: model.id,
        modelName: model.name,
        modelSlug: model.slug,
        concreteModelName: snapshot.concreteModelName,
        usedFallback: false,
        requiredCapabilities: ["json"],
      },
      {
        baseUrl: model.provider.baseUrl,
        apiKey: model.provider.secretRef ? env[model.provider.secretRef.reference] : undefined,
      },
    ),
  );
}

export {
  getVerificationDeferredReason,
  isVerificationItemRunnableNow,
} from "@vimbuspromax3000/shared";

// Planner system + user prompts now live in the per-agent files under
// `packages/planner/src/agents/`. Sprint 2 keeps the monolithic prompt content
// inside `epicPlanner.ts` as a fallback while downstream agents are stubs;
// Sprint 3 will replace those stubs with the real per-role prompts from
// docs/planner/agent-roles.md.

function normalizeVerificationItem(
  value: unknown,
  options: {
    path: string;
    taskTitle: string;
    itemIndex: number;
    mode: NormalizeMode;
  },
) {
  const item = requireRecord(value, options.path);
  const title =
    requireStringLike(item.title, `${options.path}.title`, options.mode === "generated" ? verificationFallbackTitle(options.taskTitle) : undefined) ??
    verificationFallbackTitle(options.taskTitle);
  const kind = normalizeVerificationKind(item.kind, options.mode);
  const runner = normalizeVerificationRunner(item.runner, kind, options.mode);

  return {
    kind,
    runner,
    title,
    description:
      requireStringLike(
        item.description,
        `${options.path}.description`,
        options.mode === "generated" ? `${title} verifies ${options.taskTitle}.` : undefined,
      ) ?? `${title} verifies ${options.taskTitle}.`,
    rationale: normalizeString(item.rationale) ?? null,
    command: normalizeString(item.command) ?? defaultCommandForRunner(runner),
    testFilePath: normalizeString(item.testFilePath) ?? null,
    route: normalizeString(item.route) ?? null,
    interaction: normalizeString(item.interaction) ?? null,
    expectedAssetId: normalizeString(item.expectedAssetId) ?? null,
    orderIndex: normalizeInteger(item.orderIndex) ?? options.itemIndex,
    config: item.config ?? null,
  };
}

function buildFallbackVerificationItem(taskTitle: string) {
  return {
    kind: "logic",
    runner: "vitest",
    title: verificationFallbackTitle(taskTitle),
    description: `Verify ${taskTitle} with a logic-level test.`,
    command: "bun run test:vitest",
  };
}

function verificationFallbackTitle(taskTitle: string) {
  return `${taskTitle} verification`;
}

function normalizeVerificationKind(value: unknown, mode: NormalizeMode): VerificationItemKind {
  const normalized = normalizeString(value)?.toLowerCase();

  if (normalized && isVerificationItemKind(normalized)) {
    return normalized;
  }

  if (mode === "generated") {
    return "logic";
  }

  throw new Error(`Unknown verification item kind: ${String(value)}`);
}

function normalizeVerificationRunner(
  value: unknown,
  kind: VerificationItemKind,
  mode: NormalizeMode,
): VerificationRunner | null {
  const normalized = normalizeString(value)?.toLowerCase();

  if (normalized && isVerificationRunner(normalized)) {
    return normalized;
  }

  if (mode === "generated") {
    return defaultRunnerForKind(kind);
  }

  return null;
}

function defaultRunnerForKind(kind: VerificationItemKind): VerificationRunner | null {
  switch (kind) {
    case "logic":
      return "vitest";
    case "integration":
    case "visual":
    case "a11y":
      return "playwright";
    case "typecheck":
      return "tsc";
    case "lint":
      return "eslint";
    case "evidence":
      return "custom";
  }
}

function defaultCommandForRunner(runner: VerificationRunner | null): string | null {
  switch (runner) {
    case "vitest":
      return "bun run test:vitest";
    case "tsc":
      return "bun run typecheck";
    default:
      return null;
  }
}

function normalizeChecklist(
  value: unknown,
  options: {
    fallback?: string[];
  } = {},
) {
  const items = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const normalized = items
    .map((item) => extractStringValue(item))
    .filter((item): item is string => Boolean(item))
    .map((label) => ({ label }));

  if (normalized.length > 0) {
    return normalized;
  }

  return options.fallback?.map((label) => ({ label })) ?? [];
}

function normalizeStringList(value: unknown): string[] | undefined {
  const items = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const normalized = items
    .map((item) => extractStringValue(item))
    .filter((item): item is string => Boolean(item));

  return normalized.length > 0 ? normalized : undefined;
}

function requireStringLike(value: unknown, fieldName: string, fallback?: string) {
  const normalized = extractStringValue(value) ?? fallback;

  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }

  return normalized;
}

function extractStringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return normalizeString(value);
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const candidates = [
    value.label,
    value.title,
    value.description,
    value.text,
    value.name,
    value.path,
    value.reason,
    value.value,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const normalized = normalizeString(candidate);

      if (normalized) {
        return normalized;
      }
    }
  }

  return undefined;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function requireRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }

  return value;
}

function requireArray(value: unknown, fieldName: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array.`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw new Error(`Expected an integer value, received ${String(value)}.`);
  }

  return parsed;
}

function getPlannerNamespace(plannerRunId: string) {
  const compact = plannerRunId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const suffix = compact.slice(-6) || "RUN";

  return `PLAN-${suffix}`;
}

function prefixNamespace(namespace: string, identifier: string) {
  return identifier.startsWith(`${namespace}-`) ? identifier : `${namespace}-${identifier}`;
}

function reserveIdentifier(identifier: string, used: Set<string>) {
  let candidate = identifier;
  let counter = 2;

  while (used.has(candidate)) {
    candidate = `${identifier}-${counter}`;
    counter += 1;
  }

  used.add(candidate);
  return candidate;
}

function normalizeIdentifier(value: string) {
  const normalized = value
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .toUpperCase();

  return normalized.length > 0 ? normalized : "ITEM";
}

function slugToIdentifier(value: string) {
  const parts = value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);

  return parts.length > 0 ? parts.join("-") : undefined;
}

const PLANNER_GENERATION_JSON_SCHEMA: JSONSchema7 = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "epics"],
  properties: {
    summary: { type: "string" },
    epics: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "title", "goal", "tasks"],
        properties: {
          key: { type: "string" },
          title: { type: "string" },
          goal: { type: "string" },
          orderIndex: { type: "integer" },
          acceptance: {
            type: "array",
            items: { type: "string" },
          },
          risks: {
            type: "array",
            items: { type: "string" },
          },
          tasks: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["stableId", "title", "type", "complexity", "acceptance", "verificationPlan"],
              properties: {
                stableId: { type: "string" },
                title: { type: "string" },
                description: { type: "string" },
                type: { type: "string" },
                complexity: { type: "string" },
                orderIndex: { type: "integer" },
                acceptance: {
                  type: "array",
                  minItems: 1,
                  items: { type: "string" },
                },
                targetFiles: {
                  type: "array",
                  items: { type: "string" },
                },
                requires: {
                  type: "array",
                  items: { type: "string" },
                },
                verificationPlan: {
                  type: "object",
                  additionalProperties: false,
                  required: ["items"],
                  properties: {
                    rationale: { type: "string" },
                    items: {
                      type: "array",
                      minItems: 1,
                      items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["kind", "title", "description"],
                        properties: {
                          kind: { type: "string" },
                          runner: {
                            type: "string",
                            description:
                              "Optional execution hint only. Runner choice alone does not make an item runnable in the current slice.",
                          },
                          title: { type: "string" },
                          description: { type: "string" },
                          rationale: { type: "string" },
                          command: {
                            type: "string",
                            description:
                              "Required for any item intended to run through POST /executions/:id/test-runs. Use a deterministic shell command. Playwright is supported only via its CLI command string, not MCP.",
                          },
                          testFilePath: { type: "string" },
                          route: { type: "string" },
                          interaction: { type: "string" },
                          expectedAssetId: { type: "string" },
                          orderIndex: { type: "integer" },
                          config: {
                            type: "object",
                            additionalProperties: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

const generatedPlannerSchema = jsonSchema<GeneratedPlannerProposal>(PLANNER_GENERATION_JSON_SCHEMA);
