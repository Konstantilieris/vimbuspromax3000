import type { PlannerProposalInput } from "@vimbuspromax3000/db";
import type { ModelSlotKey } from "@vimbuspromax3000/shared";
import type { PlannerGenerator, PlannerRunDetail } from "../service";

/**
 * Shape produced by the underlying generator before normalization. Mirrors the
 * monolithic `GeneratedPlannerProposal` shape in `service.ts` but kept local so
 * agents can pass it between stages without leaking the full normalized type.
 *
 * This is the "rich" shape -- the final shape after the verification designer
 * has filled in `verificationPlan.items` for every task.
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
 * Skeleton epic shape produced by the epic planner. The epic planner now owns
 * ONLY epic-level metadata (title, goal, acceptance, risks). Tasks are filled
 * in by the task writer, verification items by the verification designer.
 */
export type EpicSkeleton = {
  key?: string;
  title?: string;
  goal?: string;
  orderIndex?: number;
  acceptance?: unknown;
  risks?: unknown;
};

/**
 * Task shape produced by the task writer. Tasks at this stage may not yet have
 * a verification plan -- that is the verification designer's job.
 */
export type TaskSkeleton = NonNullable<
  GeneratedPlannerProposal["epics"][number]["tasks"][number]
>;

/**
 * Resolves a model slot for a given agent role. Each agent calls this with its
 * own role identity so per-agent slot routing flows through the existing
 * `resolveModelSlot` helper. The orchestrator does NOT cache results, so the
 * resolver is invoked once per agent stage.
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
  summary?: string;
  epics: EpicSkeleton[];
  reasoning?: string;
};

export type TaskWriterOutput = {
  summary?: string;
  /**
   * Epics enriched with tasks. Verification plans may still be empty -- the
   * verification designer fills those in.
   */
  epics: Array<EpicSkeleton & { tasks: TaskSkeleton[] }>;
  reasoning?: string;
};

export type VerificationDesignerOutput = {
  generated: GeneratedPlannerProposal;
  reasoning?: string;
};

export type ReviewerVerdict =
  | { ok: true; output: VerificationDesignerOutput }
  | { ok: false; reason: string; missingTaskTitles: string[] };

export type OrchestratorOutput = {
  proposal: PlannerProposalInput;
  reasoning?: string;
};
