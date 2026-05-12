import { readFileSync } from "node:fs";
import { generateText as aiGenerateText, type LanguageModel } from "ai";
import {
  writePlaywrightStagingFile,
  type PlaywrightStagingInput,
  type PlaywrightStagingPath,
} from "./staging";

export type PlaywrightSpecPayload = {
  kind: "playwright_spec";
  taskId: string;
  validationId: string;
  stagingFilePath: string;
  targetTestFilePath: string;
};

export type PlaywrightSpecArtifactFields = {
  subjectType: "validation";
  subjectId: string;
  title: string;
  markdown: string;
  payloadJson: string;
  stage: "validation_review";
};

export type GeneratePlaywrightSpecInput = {
  taskId: string;
  validationId: string;
  title: string;
  description?: string | null;
  acceptanceCriteria?: unknown;
  route?: string | null;
  workspaceRoot?: string;
};

export type PlaywrightGenerateTextInput = {
  languageModel?: LanguageModel;
  systemPrompt: string;
  prompt: string;
  temperature: number;
};

export type PlaywrightGenerateText = (
  input: PlaywrightGenerateTextInput,
) => Promise<string | { text: string }>;

export type GeneratePlaywrightSpecDeps = {
  languageModel?: LanguageModel;
  temperature?: number;
  generateText?: PlaywrightGenerateText;
  loadSystemPrompt?: () => string | Promise<string>;
  writeStagingFile?: (
    input: PlaywrightStagingInput & { code: string },
  ) => PlaywrightStagingPath;
};

export type GeneratePlaywrightSpecResult = {
  code: string;
  prompt: string;
  systemPrompt: string;
  stagingPath: PlaywrightStagingPath;
  payload: PlaywrightSpecPayload;
  payloadJson: string;
  reviewArtifact: PlaywrightSpecArtifactFields;
};

const DEFAULT_TEMPERATURE = 0;

export async function generatePlaywrightSpec(
  input: GeneratePlaywrightSpecInput,
  deps: GeneratePlaywrightSpecDeps = {},
): Promise<GeneratePlaywrightSpecResult> {
  const loadSystemPrompt = deps.loadSystemPrompt ?? loadPlaywrightSystemPrompt;
  const generateText = deps.generateText ?? generatePlaywrightTextWithAiSdk;
  const writeStagingFile = deps.writeStagingFile ?? writePlaywrightStagingFile;
  const systemPrompt = await loadSystemPrompt();
  const prompt = buildPlaywrightPrompt(input);
  const generated = await generateText({
    languageModel: deps.languageModel,
    systemPrompt,
    prompt,
    temperature: deps.temperature ?? DEFAULT_TEMPERATURE,
  });
  const code = normalizeGeneratedSpec(typeof generated === "string" ? generated : generated.text);
  const stagingPath = writeStagingFile({
    workspaceRoot: input.workspaceRoot,
    taskId: input.taskId,
    validationId: input.validationId,
    code,
  });
  const payload: PlaywrightSpecPayload = {
    kind: "playwright_spec",
    taskId: input.taskId,
    validationId: input.validationId,
    stagingFilePath: stagingPath.relativePath,
    targetTestFilePath: getGeneratedPlaywrightSpecPath(input),
  };
  const payloadJson = JSON.stringify(payload);
  const reviewArtifact: PlaywrightSpecArtifactFields = {
    subjectType: "validation",
    subjectId: input.validationId,
    title: `Review Playwright spec: ${input.title}`,
    markdown: buildReviewMarkdown(input, stagingPath),
    payloadJson,
    stage: "validation_review",
  };

  return {
    code,
    prompt,
    systemPrompt,
    stagingPath,
    payload,
    payloadJson,
    reviewArtifact,
  };
}

export function loadPlaywrightSystemPrompt(): string {
  return readFileSync(new URL("./prompts/playwrightSystem.md", import.meta.url), "utf8").trim();
}

function buildPlaywrightPrompt(input: GeneratePlaywrightSpecInput): string {
  const parts = [
    `Generate a Playwright spec for validation ${input.validationId} on task ${input.taskId}.`,
    `Title: ${input.title}`,
  ];

  if (input.description) {
    parts.push(`Description:\n${input.description}`);
  }
  if (input.route) {
    parts.push(`Preferred route:\n${input.route}`);
  }

  parts.push(`Acceptance criteria:\n${formatAcceptanceCriteria(input.acceptanceCriteria)}`);

  return parts.join("\n\n");
}

function formatAcceptanceCriteria(value: unknown): string {
  if (value === undefined || value === null) {
    return "- No acceptance criteria provided.";
  }

  const parsed = typeof value === "string" ? parseJson(value) : value;
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return "- No acceptance criteria provided.";
    }

    return parsed.map((item, index) => `- ${index + 1}. ${formatCriterion(item)}`).join("\n");
  }

  return formatCriterion(parsed);
}

function formatCriterion(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (isRecord(value)) {
    const label = value.label ?? value.title ?? value.description ?? value.text;
    if (typeof label === "string") {
      return label;
    }
  }

  return JSON.stringify(value) ?? String(value);
}

function normalizeGeneratedSpec(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:ts|typescript)?\r?\n([\s\S]*?)\r?\n```$/i);
  const code = fenced?.[1]?.trim() ?? trimmed;
  return `${code}\n`;
}

async function generatePlaywrightTextWithAiSdk(input: PlaywrightGenerateTextInput): Promise<string> {
  if (!input.languageModel) {
    throw new Error("generatePlaywrightSpec requires either deps.generateText or deps.languageModel.");
  }

  const result = await aiGenerateText({
    model: input.languageModel,
    system: input.systemPrompt,
    prompt: input.prompt,
    temperature: input.temperature,
    maxRetries: 0,
  });

  return result.text;
}

function buildReviewMarkdown(
  input: GeneratePlaywrightSpecInput,
  stagingPath: PlaywrightStagingPath,
): string {
  const targetTestFilePath = getGeneratedPlaywrightSpecPath(input);

  return [
    `Generated Playwright spec for validation \`${input.validationId}\`.`,
    "",
    `Staged file: \`${stagingPath.relativePath}\``,
    `Approval target: \`${targetTestFilePath}\``,
    "",
    "Approval moves this spec into the project's generated Playwright test directory.",
  ].join("\n");
}

function getGeneratedPlaywrightSpecPath(input: Pick<GeneratePlaywrightSpecInput, "taskId" | "validationId">): string {
  return ["tests", "generated", input.taskId, `${input.validationId}.spec.ts`].join("/");
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
