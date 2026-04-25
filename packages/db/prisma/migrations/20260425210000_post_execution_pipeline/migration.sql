-- Post-execution pipeline support: retry/escalation tracking on TaskExecution and per-project tuning.

ALTER TABLE "TaskExecution" ADD COLUMN "escalationLevel" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TaskExecution" ADD COLUMN "lastEvalRunId" TEXT;
CREATE INDEX "TaskExecution_lastEvalRunId_idx" ON "TaskExecution"("lastEvalRunId");

ALTER TABLE "Project" ADD COLUMN "autoRetryConfigJson" TEXT;
