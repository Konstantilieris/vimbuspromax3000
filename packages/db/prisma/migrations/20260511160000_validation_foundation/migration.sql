-- Validation data-model foundation.
-- Validation is the first-class replacement for task acceptance checks while
-- preserving an optional link to the legacy VerificationItem row during rollout.

CREATE TABLE "Validation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "verificationItemId" TEXT,
    "testType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "acceptanceCriteriaJson" TEXT NOT NULL DEFAULT '[]',
    "rationale" TEXT,
    "command" TEXT,
    "testFilePath" TEXT,
    "metadataJson" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "approvalId" TEXT,
    "legacyVerificationItemId" TEXT,
    "lastTaskExecutionId" TEXT,
    "lastTestRunId" TEXT,
    "lastExitCode" INTEGER,
    "resultSummary" TEXT,
    "resultJson" TEXT,
    "artifactPath" TEXT,
    "approvedAt" DATETIME,
    "rejectedAt" DATETIME,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Validation_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Validation_verificationItemId_fkey" FOREIGN KEY ("verificationItemId") REFERENCES "VerificationItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Validation_lastTaskExecutionId_fkey" FOREIGN KEY ("lastTaskExecutionId") REFERENCES "TaskExecution" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Validation_lastTestRunId_fkey" FOREIGN KEY ("lastTestRunId") REFERENCES "TestRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "Validation" (
    "id",
    "taskId",
    "verificationItemId",
    "testType",
    "status",
    "title",
    "description",
    "acceptanceCriteriaJson",
    "rationale",
    "command",
    "testFilePath",
    "metadataJson",
    "orderIndex",
    "legacyVerificationItemId",
    "createdAt",
    "updatedAt"
)
SELECT
    'val_' || lower(hex(randomblob(12))),
    "taskId",
    "id",
    CASE
        WHEN "runner" = 'playwright' THEN 'playwright'
        ELSE "kind"
    END,
    CASE
        WHEN "status" = 'approved' THEN 'approved'
        WHEN "status" = 'running' THEN 'running'
        WHEN "status" = 'green' THEN 'passed'
        WHEN "status" IN ('red', 'failed') THEN 'failed'
        ELSE 'proposed'
    END,
    "title",
    "description",
    COALESCE((SELECT "Task"."acceptanceJson" FROM "Task" WHERE "Task"."id" = "VerificationItem"."taskId"), '[]'),
    "rationale",
    "command",
    "testFilePath",
    "configJson",
    "orderIndex",
    "id",
    "createdAt",
    "updatedAt"
FROM "VerificationItem"
WHERE NOT EXISTS (
    SELECT 1
    FROM "Validation"
    WHERE "Validation"."verificationItemId" = "VerificationItem"."id"
);

CREATE UNIQUE INDEX "Validation_verificationItemId_key" ON "Validation"("verificationItemId");
CREATE UNIQUE INDEX "Validation_legacyVerificationItemId_key" ON "Validation"("legacyVerificationItemId");
CREATE INDEX "Validation_taskId_status_idx" ON "Validation"("taskId", "status");
CREATE INDEX "Validation_taskId_testType_idx" ON "Validation"("taskId", "testType");
CREATE INDEX "Validation_lastTaskExecutionId_idx" ON "Validation"("lastTaskExecutionId");
CREATE INDEX "Validation_lastTestRunId_idx" ON "Validation"("lastTestRunId");
