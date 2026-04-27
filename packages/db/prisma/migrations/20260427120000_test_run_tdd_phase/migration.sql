-- VIM-31 — TDD red/green-phased TestRun rows.
-- Adds `iterationIndex` (1-based) and `phase` (`pre_red` | `post_green`)
-- to TestRun so the iterative TDD loop can persist one row per phase per
-- iteration. Existing rows are migrated to (iterationIndex=1, phase='post_green')
-- to preserve the prior single-shot semantics.
ALTER TABLE "TestRun" ADD COLUMN "iterationIndex" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "TestRun" ADD COLUMN "phase" TEXT NOT NULL DEFAULT 'post_green';

CREATE INDEX "TestRun_taskExecutionId_iterationIndex_phase_idx" ON "TestRun"("taskExecutionId", "iterationIndex", "phase");
