export type JiraIssue = {
  id: string;
  key: string;
  self?: string;
  fields: JiraIssueFields;
};

export type JiraIssueFields = Record<string, unknown> & {
  summary?: unknown;
  description?: unknown;
  issuetype?: unknown;
  parent?: unknown;
  status?: unknown;
  labels?: unknown;
};

export type AcceptanceCriterionDraft = {
  label: string;
};

export type JiraIssueSourceDraft = {
  provider: "jira";
  issueId: string;
  issueKey: string;
  issueUrl: string | null;
  issueType: string | null;
  status: string | null;
};

export type TaskComplexityDraft = "low" | "medium" | "high";

export type ValidationDraft = {
  stableId: string;
  taskStableId: string | null;
  testType: string;
  title: string;
  description: string | null;
  acceptanceCriteria: AcceptanceCriterionDraft[];
  rationale: string | null;
  command: string | null;
  testFilePath: string | null;
  orderIndex: number;
  source: JiraIssueSourceDraft;
  metadata: {
    parentKey: string | null;
    labels: string[];
  };
};

export type TaskDraft = {
  stableId: string;
  title: string;
  description: string | null;
  type: string;
  complexity: TaskComplexityDraft;
  orderIndex: number;
  acceptance: AcceptanceCriterionDraft[];
  targetFiles: null;
  requires: null;
  source: JiraIssueSourceDraft;
  validations: ValidationDraft[];
};

export type EpicDraft = {
  key: string;
  title: string;
  goal: string;
  orderIndex: number;
  acceptance: AcceptanceCriterionDraft[];
  risks: null;
  source: JiraIssueSourceDraft;
  tasks: TaskDraft[];
};

export type JiraImportDraft = {
  epic: EpicDraft;
  orphanValidations: ValidationDraft[];
  ignoredIssues: JiraIssueSourceDraft[];
};

export type MapJiraIssuesToDraftsOptions = {
  epicKey?: string;
  acceptanceCriteriaField?: string | readonly string[];
  defaultComplexity?: TaskComplexityDraft;
};

const DEFAULT_ACCEPTANCE_FIELDS = ["acceptanceCriteria", "acceptance", "Acceptance Criteria"] as const;
const KNOWN_VALIDATION_TYPES = new Set([
  "logic",
  "integration",
  "visual",
  "typecheck",
  "lint",
  "a11y",
  "evidence",
  "playwright",
  "manual",
]);

export function mapJiraIssuesToDrafts(
  issues: readonly JiraIssue[],
  options: MapJiraIssuesToDraftsOptions = {},
): JiraImportDraft {
  const epic = selectEpicIssue(issues, options.epicKey);

  if (!epic) {
    throw new Error("Jira issues must include an Epic issue.");
  }

  const epicAcceptance = normalizeAcceptanceCriteria(readAcceptanceField(epic, options), [
    `Complete ${getSummary(epic)}`,
  ]);
  const taskIssues = issues.filter((issue) => isTaskIssue(issue, epic.key));
  const subtaskIssues = issues.filter(isSubtaskIssue);
  const validationsByParent = groupValidationsByParent(subtaskIssues, options);
  const mappedValidationIds = new Set<string>();

  const tasks = taskIssues.map((issue, index) => {
    const validations = validationsByParent.get(issue.key) ?? [];

    for (const validation of validations) {
      mappedValidationIds.add(validation.source.issueKey);
    }

    return mapTaskIssue(issue, validations, index, options);
  });
  const orphanValidations = subtaskIssues
    .filter((issue) => !mappedValidationIds.has(issue.key))
    .map((issue, index) => mapValidationIssue(issue, index, options));
  const ignoredIssues = issues
    .filter((issue) => issue.key !== epic.key && !taskIssues.includes(issue) && !subtaskIssues.includes(issue))
    .map(toIssueSource);

  return {
    epic: {
      key: epic.key,
      title: getSummary(epic),
      goal: extractText(epic.fields.description) ?? getSummary(epic),
      orderIndex: 0,
      acceptance: epicAcceptance,
      risks: null,
      source: toIssueSource(epic),
      tasks,
    },
    orphanValidations,
    ignoredIssues,
  };
}

function selectEpicIssue(issues: readonly JiraIssue[], epicKey: string | undefined): JiraIssue | undefined {
  if (epicKey) {
    return issues.find((issue) => issue.key === epicKey);
  }

  return issues.find(isEpicIssue);
}

function mapTaskIssue(
  issue: JiraIssue,
  validations: ValidationDraft[],
  orderIndex: number,
  options: MapJiraIssuesToDraftsOptions,
): TaskDraft {
  return {
    stableId: issue.key,
    title: getSummary(issue),
    description: extractText(issue.fields.description),
    type: normalizeIssueType(getIssueTypeName(issue)),
    complexity: options.defaultComplexity ?? "medium",
    orderIndex,
    acceptance: normalizeAcceptanceCriteria(readAcceptanceField(issue, options), [`Complete ${getSummary(issue)}`]),
    targetFiles: null,
    requires: null,
    source: toIssueSource(issue),
    validations,
  };
}

function groupValidationsByParent(
  subtaskIssues: readonly JiraIssue[],
  options: MapJiraIssuesToDraftsOptions,
): Map<string, ValidationDraft[]> {
  const groups = new Map<string, ValidationDraft[]>();

  for (const [index, issue] of subtaskIssues.entries()) {
    const parentKey = getParentKey(issue);
    const validation = mapValidationIssue(issue, index, options);

    if (!parentKey) {
      continue;
    }

    const existing = groups.get(parentKey) ?? [];
    existing.push(validation);
    groups.set(parentKey, existing);
  }

  for (const validations of groups.values()) {
    validations.sort((left, right) => left.orderIndex - right.orderIndex);
  }

  return groups;
}

function mapValidationIssue(
  issue: JiraIssue,
  orderIndex: number,
  options: MapJiraIssuesToDraftsOptions,
): ValidationDraft {
  const labels = getLabels(issue);

  return {
    stableId: issue.key,
    taskStableId: getParentKey(issue),
    testType: inferValidationTestType(issue, labels),
    title: getSummary(issue),
    description: extractText(issue.fields.description),
    acceptanceCriteria: normalizeAcceptanceCriteria(readAcceptanceField(issue, options), [`Complete ${getSummary(issue)}`]),
    rationale: null,
    command: null,
    testFilePath: null,
    orderIndex,
    source: toIssueSource(issue),
    metadata: {
      parentKey: getParentKey(issue),
      labels,
    },
  };
}

function readAcceptanceField(issue: JiraIssue, options: MapJiraIssuesToDraftsOptions): unknown {
  const fields =
    typeof options.acceptanceCriteriaField === "string"
      ? [options.acceptanceCriteriaField]
      : options.acceptanceCriteriaField ?? DEFAULT_ACCEPTANCE_FIELDS;

  for (const field of fields) {
    const value = getFieldValue(issue, field);

    if (hasMeaningfulValue(value)) {
      return value;
    }
  }

  return null;
}

function getFieldValue(issue: JiraIssue, field: string): unknown {
  if (field.startsWith("fields.")) {
    return getPathValue(issue, field);
  }

  return issue.fields[field];
}

function getPathValue(value: unknown, path: string): unknown {
  let current = value;

  for (const segment of path.split(".")) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function normalizeAcceptanceCriteria(value: unknown, fallback: readonly string[]): AcceptanceCriterionDraft[] {
  const labels = extractAcceptanceLabels(value);
  const normalized = labels.length > 0 ? labels : fallback;

  return uniqueLabels(normalized).map((label) => ({ label }));
}

function extractAcceptanceLabels(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(extractAcceptanceLabels);
  }

  if (isRecord(value)) {
    const labeledValue = firstRecordString(value, ["label", "title", "summary", "name", "value"]);

    if (labeledValue) {
      return splitAcceptanceText(labeledValue);
    }
  }

  const text = extractText(value);

  if (!text) {
    return [];
  }

  return splitAcceptanceText(text);
}

function splitAcceptanceText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)]|\[[ xX]\])\s*/, "").trim())
    .filter((line) => line.length > 0);
}

function extractText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return joinText(value.map(extractText));
  }

  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.text === "string") {
    return value.text;
  }

  const stringValue = firstRecordString(value, ["value", "name", "displayName"]);

  if (stringValue) {
    return stringValue;
  }

  if (Array.isArray(value.content)) {
    return extractAdfText(value);
  }

  return null;
}

function extractAdfText(value: Record<string, unknown>): string | null {
  const lines: string[] = [];

  collectAdfText(value, lines);

  return joinText(lines);
}

function collectAdfText(node: unknown, lines: string[]) {
  if (typeof node === "string") {
    lines.push(node);
    return;
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      collectAdfText(child, lines);
    }
    return;
  }

  if (!isRecord(node)) {
    return;
  }

  if (typeof node.text === "string") {
    lines.push(node.text);
  }

  if (Array.isArray(node.content)) {
    const beforeLength = lines.length;

    for (const child of node.content) {
      collectAdfText(child, lines);
    }

    if (lines.length > beforeLength && createsTextBoundary(node.type)) {
      lines.push("\n");
    }
  }
}

function createsTextBoundary(type: unknown): boolean {
  return type === "paragraph" || type === "listItem" || type === "heading";
}

function joinText(values: Array<string | null>): string | null {
  const text = values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text.length > 0 ? text : null;
}

function isTaskIssue(issue: JiraIssue, epicKey: string): boolean {
  if (isEpicIssue(issue) || isSubtaskIssue(issue)) {
    return false;
  }

  const parentKey = getParentKey(issue);
  return parentKey === epicKey || parentKey === null;
}

function isEpicIssue(issue: JiraIssue): boolean {
  return normalizeIssueType(getIssueTypeName(issue)) === "epic";
}

function isSubtaskIssue(issue: JiraIssue): boolean {
  const issueType = getIssueType(issue);

  if (isRecord(issueType) && issueType.subtask === true) {
    return true;
  }

  const normalizedType = normalizeIssueType(getIssueTypeName(issue));
  return normalizedType === "subtask" || normalizedType === "sub-task";
}

function getIssueType(issue: JiraIssue): unknown {
  return issue.fields.issuetype;
}

function getIssueTypeName(issue: JiraIssue): string | null {
  const issueType = getIssueType(issue);

  if (isRecord(issueType) && typeof issueType.name === "string") {
    return issueType.name;
  }

  return null;
}

function normalizeIssueType(value: string | null): string {
  return value?.trim().toLowerCase().replace(/\s+/g, "-") ?? "task";
}

function getSummary(issue: JiraIssue): string {
  return extractText(issue.fields.summary) ?? issue.key;
}

function getParentKey(issue: JiraIssue): string | null {
  const parent = issue.fields.parent;

  if (isRecord(parent) && typeof parent.key === "string" && parent.key.trim()) {
    return parent.key.trim();
  }

  return null;
}

function getLabels(issue: JiraIssue): string[] {
  const labels = issue.fields.labels;

  if (!Array.isArray(labels)) {
    return [];
  }

  return labels.filter((label): label is string => typeof label === "string");
}

function inferValidationTestType(issue: JiraIssue, labels: readonly string[]): string {
  for (const label of labels) {
    const match = label.toLowerCase().match(/^(?:validation|test|test-type)[:/=](?<type>[a-z0-9_-]+)$/);
    const type = match?.groups?.type;

    if (type && KNOWN_VALIDATION_TYPES.has(type)) {
      return type;
    }
  }

  const summary = getSummary(issue).toLowerCase();

  if (summary.includes("typecheck")) return "typecheck";
  if (summary.includes("lint")) return "lint";
  if (summary.includes("playwright")) return "playwright";
  if (summary.includes("a11y") || summary.includes("accessibility")) return "a11y";
  if (summary.includes("visual") || summary.includes("screenshot")) return "visual";
  if (summary.includes("integration")) return "integration";
  if (summary.includes("unit") || summary.includes("logic")) return "logic";

  return "manual";
}

function toIssueSource(issue: JiraIssue): JiraIssueSourceDraft {
  return {
    provider: "jira",
    issueId: issue.id,
    issueKey: issue.key,
    issueUrl: issue.self ?? null,
    issueType: getIssueTypeName(issue),
    status: getStatusName(issue),
  };
}

function getStatusName(issue: JiraIssue): string | null {
  const status = issue.fields.status;

  if (isRecord(status) && typeof status.name === "string") {
    return status.name;
  }

  return null;
}

function firstRecordString(value: Record<string, unknown>, fields: readonly string[]): string | null {
  for (const field of fields) {
    const fieldValue = value[field];

    if (typeof fieldValue === "string" && fieldValue.trim().length > 0) {
      return fieldValue.trim();
    }
  }

  return null;
}

function uniqueLabels(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];

  for (const value of values) {
    const label = value.trim();

    if (label.length === 0 || seen.has(label)) {
      continue;
    }

    labels.push(label);
    seen.add(label);
  }

  return labels;
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
