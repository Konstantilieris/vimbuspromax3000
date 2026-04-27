/**
 * Task complexity scorer.
 *
 * Inputs follow the lightweight signals enumerated in
 * `docs/policy/model-selection.md` ("Complexity Inputs"):
 *
 *   - estimated lines touched (proxy for change footprint)
 *   - fan-out (number of dependent modules / files / call sites)
 *   - verification kind diversity (how many distinct verification kinds the
 *     plan touches)
 *
 * Lines and fan-out each contribute 0, 1, or 2 points. Verification kind
 * diversity contributes 0, 1, or 5 points -- crossing four or more distinct
 * verification kinds is, on its own, a strong signal of cross-cutting risk
 * and routes straight to "high" even when the change footprint is tiny.
 *
 *   - score <= 1                : "low"
 *   - score in [2, 4]           : "medium"
 *   - score >= 5                : "high"
 *
 * The breakdown is returned alongside the score so the policy engine and
 * planner can persist a deterministic explanation of the routing decision.
 */
export const COMPLEXITY_LABELS = ["low", "medium", "high"] as const;
export type ComplexityLabel = (typeof COMPLEXITY_LABELS)[number];

export type TaskComplexityInput = {
  /** Estimated lines of code that will be touched by the task. */
  estimatedLinesTouched: number;
  /**
   * Number of dependent modules, files, or call sites that need to change.
   * Proxy for blast radius / coupling.
   */
  fanOut: number;
  /**
   * Distinct verification kinds the task's verification plan covers
   * (e.g. ["logic", "integration", "visual"]). Duplicates are ignored.
   */
  verificationKinds: readonly string[];
};

export type TaskComplexityBreakdown = {
  lines: number;
  fanOut: number;
  verificationDiversity: number;
};

export type TaskComplexityScore = {
  label: ComplexityLabel;
  score: number;
  breakdown: TaskComplexityBreakdown;
};

const LINES_MEDIUM_THRESHOLD = 50;
const LINES_HIGH_THRESHOLD = 200;
const FAN_OUT_MEDIUM_THRESHOLD = 3;
const FAN_OUT_HIGH_THRESHOLD = 6;
const VERIFICATION_MEDIUM_THRESHOLD = 2;
const VERIFICATION_HIGH_THRESHOLD = 4;

const SCORE_MEDIUM_THRESHOLD = 2;
const SCORE_HIGH_THRESHOLD = 5;

export function scoreTaskComplexity(input: TaskComplexityInput): TaskComplexityScore {
  const breakdown: TaskComplexityBreakdown = {
    lines: scoreLines(input.estimatedLinesTouched),
    fanOut: scoreFanOut(input.fanOut),
    verificationDiversity: scoreVerificationDiversity(input.verificationKinds),
  };

  const score = breakdown.lines + breakdown.fanOut + breakdown.verificationDiversity;

  return {
    label: scoreToLabel(score),
    score,
    breakdown,
  };
}

export function scoreToLabel(score: number): ComplexityLabel {
  if (score >= SCORE_HIGH_THRESHOLD) return "high";
  if (score >= SCORE_MEDIUM_THRESHOLD) return "medium";
  return "low";
}

export function isComplexityLabel(value: unknown): value is ComplexityLabel {
  return typeof value === "string" && (COMPLEXITY_LABELS as readonly string[]).includes(value);
}

function scoreLines(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= LINES_HIGH_THRESHOLD) return 2;
  if (value >= LINES_MEDIUM_THRESHOLD) return 1;
  return 0;
}

function scoreFanOut(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= FAN_OUT_HIGH_THRESHOLD) return 2;
  if (value >= FAN_OUT_MEDIUM_THRESHOLD) return 1;
  return 0;
}

function scoreVerificationDiversity(kinds: readonly string[]): number {
  const distinct = new Set<string>();

  for (const kind of kinds) {
    if (typeof kind === "string" && kind.trim().length > 0) {
      distinct.add(kind.trim().toLowerCase());
    }
  }

  if (distinct.size >= VERIFICATION_HIGH_THRESHOLD) return 5;
  if (distinct.size >= VERIFICATION_MEDIUM_THRESHOLD) return 1;
  return 0;
}
