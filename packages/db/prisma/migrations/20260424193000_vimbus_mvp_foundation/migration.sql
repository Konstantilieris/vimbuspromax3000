-- Vimbus MVP foundation fields for MCP setup, source assets, and visual verification.

PRAGMA foreign_keys=OFF;

CREATE TABLE "new_VerificationItem" (
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
    CONSTRAINT "VerificationItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "VerificationPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VerificationItem_expectedAssetId_fkey" FOREIGN KEY ("expectedAssetId") REFERENCES "SourceOfTruthAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_VerificationItem" (
    "id",
    "planId",
    "taskId",
    "kind",
    "runner",
    "title",
    "description",
    "rationale",
    "command",
    "testFilePath",
    "route",
    "interaction",
    "expectedAssetId",
    "status",
    "orderIndex",
    "configJson",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "planId",
    "taskId",
    "kind",
    "runner",
    "title",
    "description",
    "rationale",
    "command",
    "testFilePath",
    "route",
    "interaction",
    "expectedAssetId",
    "status",
    "orderIndex",
    "configJson",
    "createdAt",
    "updatedAt"
FROM "VerificationItem";

DROP TABLE "VerificationItem";
ALTER TABLE "new_VerificationItem" RENAME TO "VerificationItem";

CREATE INDEX "VerificationItem_planId_kind_idx" ON "VerificationItem"("planId", "kind");
CREATE INDEX "VerificationItem_taskId_status_idx" ON "VerificationItem"("taskId", "status");

CREATE TABLE "new_SourceOfTruthAsset" (
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
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "comparisonMode" TEXT,
    "approvedAt" DATETIME,
    "supersededByAssetId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SourceOfTruthAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SourceOfTruthAsset_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SourceOfTruthAsset_verificationItemId_fkey" FOREIGN KEY ("verificationItemId") REFERENCES "VerificationItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_SourceOfTruthAsset" (
    "id",
    "projectId",
    "taskId",
    "verificationItemId",
    "kind",
    "relativePath",
    "mimeType",
    "sha256",
    "width",
    "height",
    "pageCount",
    "metadataJson",
    "status",
    "comparisonMode",
    "approvedAt",
    "supersededByAssetId",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "projectId",
    "taskId",
    "verificationItemId",
    "kind",
    "relativePath",
    "mimeType",
    "sha256",
    "width",
    "height",
    "pageCount",
    "metadataJson",
    'proposed',
    NULL,
    NULL,
    NULL,
    "createdAt",
    "updatedAt"
FROM "SourceOfTruthAsset";

DROP TABLE "SourceOfTruthAsset";
ALTER TABLE "new_SourceOfTruthAsset" RENAME TO "SourceOfTruthAsset";

CREATE UNIQUE INDEX "SourceOfTruthAsset_projectId_relativePath_key" ON "SourceOfTruthAsset"("projectId", "relativePath");
CREATE INDEX "SourceOfTruthAsset_taskId_idx" ON "SourceOfTruthAsset"("taskId");
CREATE INDEX "SourceOfTruthAsset_verificationItemId_idx" ON "SourceOfTruthAsset"("verificationItemId");
CREATE INDEX "SourceOfTruthAsset_projectId_status_idx" ON "SourceOfTruthAsset"("projectId", "status");

CREATE TABLE "new_McpServer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "transport" TEXT NOT NULL,
    "endpoint" TEXT,
    "trustLevel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "authType" TEXT NOT NULL DEFAULT 'none',
    "credentialRefId" TEXT,
    "lastVerifiedAt" DATETIME,
    "lastError" TEXT,
    "configJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "McpServer_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "McpServer_credentialRefId_fkey" FOREIGN KEY ("credentialRefId") REFERENCES "ProjectSecretRef" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_McpServer" (
    "id",
    "projectId",
    "name",
    "transport",
    "endpoint",
    "trustLevel",
    "status",
    "authType",
    "credentialRefId",
    "lastVerifiedAt",
    "lastError",
    "configJson",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "projectId",
    "name",
    "transport",
    "endpoint",
    "trustLevel",
    "status",
    'none',
    NULL,
    NULL,
    NULL,
    "configJson",
    "createdAt",
    "updatedAt"
FROM "McpServer";

DROP TABLE "McpServer";
ALTER TABLE "new_McpServer" RENAME TO "McpServer";

CREATE UNIQUE INDEX "McpServer_projectId_name_key" ON "McpServer"("projectId", "name");
CREATE INDEX "McpServer_projectId_status_idx" ON "McpServer"("projectId", "status");
CREATE INDEX "McpServer_credentialRefId_idx" ON "McpServer"("credentialRefId");

CREATE TABLE "VisualVerificationResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskExecutionId" TEXT NOT NULL,
    "verificationItemId" TEXT NOT NULL,
    "sourceAssetId" TEXT,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "artifactDirectory" TEXT,
    "actualPath" TEXT,
    "diffPath" TEXT,
    "reportPath" TEXT,
    "sha256" TEXT,
    "diffRatio" REAL,
    "threshold" REAL,
    "metadataJson" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VisualVerificationResult_taskExecutionId_fkey" FOREIGN KEY ("taskExecutionId") REFERENCES "TaskExecution" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VisualVerificationResult_verificationItemId_fkey" FOREIGN KEY ("verificationItemId") REFERENCES "VerificationItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VisualVerificationResult_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "SourceOfTruthAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "VisualVerificationResult_taskExecutionId_status_idx" ON "VisualVerificationResult"("taskExecutionId", "status");
CREATE INDEX "VisualVerificationResult_verificationItemId_idx" ON "VisualVerificationResult"("verificationItemId");
CREATE INDEX "VisualVerificationResult_sourceAssetId_idx" ON "VisualVerificationResult"("sourceAssetId");

PRAGMA foreign_keys=ON;
