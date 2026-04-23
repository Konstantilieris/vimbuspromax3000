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
import { generateObject, jsonSchema, type JSONSchema7 } from "ai";
import { getDefaultSlotForAgentRole } from "./slots";

export const DEFAULT_PLANNER_GENERATION_SEED = 7;

export type PlannerRunDetail = NonNullable<Awaited<ReturnType<typeof getPlannerRunDetail>>>;

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

      const slotKey = getDefaultSlotForAgentRole("epic_planner");
      const resolution = await resolveModelSlot(
        prisma,
        {
          projectId: plannerRun.projectId,
          slotKey,
          requiredCapabilities: ["json"],
        },
        env,
      );

      if (!resolution.ok) {
        throw new Error(`Planner model resolution failed for ${slotKey}: ${resolution.message}`);
      }

      const model = await loadPlannerModel(prisma, resolution.value, env);
      const result = await generator({
        model,
        system: buildPlannerSystemPrompt(),
        prompt: buildPlannerPrompt(plannerRun),
        seed: input.seed ?? DEFAULT_PLANNER_GENERATION_SEED,
      });

      const proposal = normalizeGeneratedPlannerProposal(plannerRun.id, result.object, {
        summaryFallback: `Plan for ${plannerRun.goal}`,
      });

      await persistPlannerProposal(prisma, proposal);

      const generatedPlannerRun = await getPlannerRunDetail(prisma, plannerRun.id);

      if (!generatedPlannerRun) {
        throw new Error(`Planner run ${plannerRun.id} was not found after generation.`);
      }

      return {
        plannerRun: generatedPlannerRun,
        proposal,
        slotKey,
        concreteModelName: resolution.value.concreteModelName,
        reasoning: result.reasoning,
      };
    },
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

function buildPlannerSystemPrompt() {
  return [
    "You are TaskGoblin's planner service.",
    "Produce a software delivery proposal that can be persisted directly into SQLite planning records.",
    "Keep the output grounded in the operator goal and interview JSON.",
    "Every epic must include one or more tasks.",
    "Every task must include acceptance criteria and at least one verification item.",
    "Keep tasks narrowly scoped, ordered, and implementation-oriented.",
    "Do not include execution, branching, or patch-review tasks yet.",
    "Prefer repo-native verification commands such as bun run test:vitest and bun run typecheck when they fit.",
    "The current POST /executions/:id/test-runs slice executes only approved verification items with a non-empty shell command.",
    "Kind alone never makes a verification item runnable in this slice.",
    "Treat Playwright CLI as a normal shell command when needed; do not assume browser MCP or tool-session execution.",
    "If a visual or evidence check cannot be expressed as a shell command, it is not runnable by the current execution slice.",
  ].join("\n");
}

function buildPlannerPrompt(plannerRun: PlannerRunDetail) {
  const lines = [
    `Project: ${plannerRun.project.name}`,
    `Root Path: ${plannerRun.project.rootPath}`,
    `Base Branch: ${plannerRun.project.baseBranch}`,
    `Branch Naming: ${plannerRun.project.branchNaming}`,
    `Goal: ${plannerRun.goal}`,
  ];

  if (plannerRun.moduleName) {
    lines.push(`Module: ${plannerRun.moduleName}`);
  }

  if (plannerRun.contextPath) {
    lines.push(`Context Path: ${plannerRun.contextPath}`);
  }

  lines.push("Interview JSON:");
  lines.push(JSON.stringify(plannerRun.interview ?? {}, null, 2));
  lines.push("Output guidance:");
  lines.push("- Use concise epic and task titles.");
  lines.push("- Keep acceptance and risks specific.");
  lines.push("- Use arrays of strings for acceptance, risks, targetFiles, and requires.");
  lines.push("- Prefer command-backed verification items that can run through POST /executions/:id/test-runs.");
  lines.push("- A verification item is executable in this slice only when it has a non-empty command.");
  lines.push("- Treat Playwright CLI as a normal shell command only; do not assume MCP-backed browser execution.");
  lines.push("- Non-command visual or evidence items are valid future review inputs, but they are not runnable now.");
  lines.push("- Prefer logic, integration, typecheck, lint, a11y, visual, or evidence verification kinds.");

  return lines.join("\n");
}

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
