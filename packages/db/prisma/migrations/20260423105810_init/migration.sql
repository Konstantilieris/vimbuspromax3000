-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "rootPath" TEXT NOT NULL,
    "baseBranch" TEXT NOT NULL DEFAULT 'main',
    "branchNaming" TEXT NOT NULL DEFAULT 'tg/<module>/<task-id>-<slug>',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PlannerRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "moduleName" TEXT,
    "contextPath" TEXT,
    "summary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlannerRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Epic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "plannerRunId" TEXT,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "acceptanceJson" TEXT,
    "risksJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Epic_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Epic_plannerRunId_fkey" FOREIGN KEY ("plannerRunId") REFERENCES "PlannerRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "epicId" TEXT NOT NULL,
    "stableId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "complexity" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "acceptanceJson" TEXT NOT NULL,
    "targetFilesJson" TEXT,
    "requiresJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "Epic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerificationPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rationale" TEXT,
    "approvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VerificationPlan_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerificationItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "runner" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rationale" TEXT,
    "command" TEXT,
    "testFilePath" TEXT,
    "route" TEXT,
    "interaction" TEXT,
    "expectedAssetId" TEXT,
    "status" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "configJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VerificationItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "VerificationPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SourceOfTruthAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT,
    "verificationItemId" TEXT,
    "kind" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "pageCount" INTEGER,
    "metadataJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SourceOfTruthAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SourceOfTruthAsset_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "operator" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Approval_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskBranch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "base" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVerifiedAt" DATETIME,
    "currentHead" TEXT,
    CONSTRAINT "TaskBranch_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "policyJson" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskExecution_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TaskExecution_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "TaskBranch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "plannerRunId" TEXT,
    "taskExecutionId" TEXT,
    "role" TEXT NOT NULL,
    "modelName" TEXT,
    "status" TEXT NOT NULL,
    "inputHash" TEXT,
    "outputPath" TEXT,
    "summary" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentStep_plannerRunId_fkey" FOREIGN KEY ("plannerRunId") REFERENCES "PlannerRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AgentStep_taskExecutionId_fkey" FOREIGN KEY ("taskExecutionId") REFERENCES "TaskExecution" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TestRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskExecutionId" TEXT NOT NULL,
    "verificationItemId" TEXT,
    "command" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "exitCode" INTEGER,
    "stdoutPath" TEXT,
    "stderrPath" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TestRun_taskExecutionId_fkey" FOREIGN KEY ("taskExecutionId") REFERENCES "TaskExecution" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TestRun_verificationItemId_fkey" FOREIGN KEY ("verificationItemId") REFERENCES "VerificationItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PatchReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskExecutionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "diffPath" TEXT,
    "summary" TEXT,
    "approvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PatchReview_taskExecutionId_fkey" FOREIGN KEY ("taskExecutionId") REFERENCES "TaskExecution" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LoopEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "taskExecutionId" TEXT,
    "type" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoopEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LoopEvent_taskExecutionId_fkey" FOREIGN KEY ("taskExecutionId") REFERENCES "TaskExecution" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EvalRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "taskExecutionId" TEXT,
    "benchmarkScenarioId" TEXT,
    "status" TEXT NOT NULL,
    "aggregateScore" INTEGER,
    "threshold" INTEGER,
    "verdict" TEXT,
    "inputHash" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "EvalResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "evalRunId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "threshold" INTEGER NOT NULL,
    "verdict" TEXT NOT NULL,
    "evaluatorType" TEXT NOT NULL,
    "modelName" TEXT,
    "promptVersion" TEXT,
    "reasoning" TEXT NOT NULL,
    "evidenceJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvalResult_evalRunId_fkey" FOREIGN KEY ("evalRunId") REFERENCES "EvalRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "McpServer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "transport" TEXT NOT NULL,
    "endpoint" TEXT,
    "trustLevel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "configJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "McpTool" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "mutability" TEXT NOT NULL,
    "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
    "inputSchemaJson" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "McpTool_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "McpServer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "McpToolCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "taskExecutionId" TEXT,
    "toolId" TEXT,
    "serverName" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "mutability" TEXT NOT NULL,
    "approvalId" TEXT,
    "argumentsHash" TEXT,
    "argumentsJson" TEXT,
    "resultSummary" TEXT,
    "errorSummary" TEXT,
    "latencyMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "McpToolCall_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "McpTool" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModelDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "taskExecutionId" TEXT,
    "attempt" INTEGER NOT NULL,
    "complexityLabel" TEXT NOT NULL,
    "selectedSlot" TEXT NOT NULL,
    "selectedModel" TEXT,
    "reason" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "scoreJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "BenchmarkScenario" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "fixturePath" TEXT,
    "expectedToolsJson" TEXT,
    "forbiddenToolsJson" TEXT,
    "thresholdsJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RegressionBaseline" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "benchmarkScenarioId" TEXT NOT NULL,
    "evalRunId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "aggregateScore" INTEGER NOT NULL,
    "dimensionScoresJson" TEXT NOT NULL,
    "toolSummaryJson" TEXT,
    "modelSummaryJson" TEXT,
    "acceptedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LangSmithTraceLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "traceUrl" TEXT,
    "datasetId" TEXT,
    "experimentId" TEXT,
    "runId" TEXT,
    "syncStatus" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "PlannerRun_projectId_status_idx" ON "PlannerRun"("projectId", "status");

-- CreateIndex
CREATE INDEX "Epic_projectId_status_idx" ON "Epic"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Epic_projectId_key_key" ON "Epic"("projectId", "key");

-- CreateIndex
CREATE INDEX "Task_epicId_status_idx" ON "Task"("epicId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Task_stableId_key" ON "Task"("stableId");

-- CreateIndex
CREATE INDEX "VerificationPlan_taskId_status_idx" ON "VerificationPlan"("taskId", "status");

-- CreateIndex
CREATE INDEX "VerificationItem_planId_kind_idx" ON "VerificationItem"("planId", "kind");

-- CreateIndex
CREATE INDEX "VerificationItem_taskId_status_idx" ON "VerificationItem"("taskId", "status");

-- CreateIndex
CREATE INDEX "SourceOfTruthAsset_taskId_idx" ON "SourceOfTruthAsset"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceOfTruthAsset_projectId_relativePath_key" ON "SourceOfTruthAsset"("projectId", "relativePath");

-- CreateIndex
CREATE INDEX "Approval_projectId_subjectType_subjectId_idx" ON "Approval"("projectId", "subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskBranch_taskId_key" ON "TaskBranch"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskBranch_name_key" ON "TaskBranch"("name");

-- CreateIndex
CREATE INDEX "TaskExecution_taskId_status_idx" ON "TaskExecution"("taskId", "status");

-- CreateIndex
CREATE INDEX "LoopEvent_projectId_createdAt_idx" ON "LoopEvent"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "LoopEvent_taskExecutionId_createdAt_idx" ON "LoopEvent"("taskExecutionId", "createdAt");

-- CreateIndex
CREATE INDEX "EvalRun_projectId_createdAt_idx" ON "EvalRun"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "EvalRun_taskExecutionId_createdAt_idx" ON "EvalRun"("taskExecutionId", "createdAt");

-- CreateIndex
CREATE INDEX "EvalRun_benchmarkScenarioId_idx" ON "EvalRun"("benchmarkScenarioId");

-- CreateIndex
CREATE INDEX "EvalResult_evalRunId_dimension_idx" ON "EvalResult"("evalRunId", "dimension");

-- CreateIndex
CREATE INDEX "McpServer_projectId_status_idx" ON "McpServer"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "McpServer_projectId_name_key" ON "McpServer"("projectId", "name");

-- CreateIndex
CREATE INDEX "McpTool_serverId_status_idx" ON "McpTool"("serverId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "McpTool_serverId_name_key" ON "McpTool"("serverId", "name");

-- CreateIndex
CREATE INDEX "McpToolCall_projectId_createdAt_idx" ON "McpToolCall"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "McpToolCall_taskExecutionId_createdAt_idx" ON "McpToolCall"("taskExecutionId", "createdAt");

-- CreateIndex
CREATE INDEX "McpToolCall_toolName_status_idx" ON "McpToolCall"("toolName", "status");

-- CreateIndex
CREATE INDEX "ModelDecision_projectId_createdAt_idx" ON "ModelDecision"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ModelDecision_taskExecutionId_attempt_idx" ON "ModelDecision"("taskExecutionId", "attempt");

-- CreateIndex
CREATE INDEX "BenchmarkScenario_projectId_status_idx" ON "BenchmarkScenario"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BenchmarkScenario_projectId_name_key" ON "BenchmarkScenario"("projectId", "name");

-- CreateIndex
CREATE INDEX "RegressionBaseline_projectId_status_idx" ON "RegressionBaseline"("projectId", "status");

-- CreateIndex
CREATE INDEX "RegressionBaseline_benchmarkScenarioId_status_idx" ON "RegressionBaseline"("benchmarkScenarioId", "status");

-- CreateIndex
CREATE INDEX "LangSmithTraceLink_projectId_subjectType_subjectId_idx" ON "LangSmithTraceLink"("projectId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "LangSmithTraceLink_syncStatus_idx" ON "LangSmithTraceLink"("syncStatus");
