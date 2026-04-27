import type { PlannerProposalInput } from "@vimbuspromax3000/db";
import type { ModelSlotKey } from "@vimbuspromax3000/shared";
import type { PlannerGenerator, PlannerRunDetail } from "../service";

/**
 * Shape produced by the underlying generator before normalization. Mirrors the
 * monolithic `GeneratedPlannerProposal` shape in `service.ts` but kept local so
 * agents can pass it between stages without leaking the full normalized type.
 */
export type GeneratedPlannerProposal = {
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

/**
 * Resolves a model slot for a given agent role. Sprint 2 does NOT yet route
 * agents to per-role slots (that is Sprint 3 scope) -- the orchestrator only
 * resolves the epic-planner slot today and uses it for the single underlying
 * generator call. The interface lives here so per-agent slot routing can be
 * wired without changing agent signatures next sprint.
 */
export type PlannerSlotResolver = (
  role: PlannerAgentRole,
) => Promise<{ slotKey: ModelSlotKey; model: unknown; concreteModelName: string }>;

export type PlannerAgentRole =
  | "epic_planner"
  | "task_writer"
  | "verification_designer"
  | "reviewer";

export type PlannerAgentDeps = {
  generator: PlannerGenerator;
  slotResolver: PlannerSlotResolver;
};

/**
 * Inputs passed across the pipeline. Sprint 2 uses the original PlannerRunDetail
 * directly (interview JSON lives on it). Sprint 3 will introduce a richer
 * structured-context object produced by the context-ingest agent.
 */
export type AgentInput = {
  plannerRun: PlannerRunDetail;
  seed: number;
};

export type EpicPlannerOutput = {
  generated: GeneratedPlannerProposal;
  reasoning?: string;
};

export type TaskWriterOutput = EpicPlannerOutput;

export type VerificationDesignerOutput = EpicPlannerOutput;

export type ReviewerVerdict =
  | { ok: true; output: VerificationDesignerOutput }
  | { ok: false; reason: string; missingTaskTitles: string[] };

export type OrchestratorOutput = {
  proposal: PlannerProposalInput;
  reasoning?: string;
};
