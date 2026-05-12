-- CreateTable
CREATE TABLE "ReviewArtifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'review',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approvalId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReviewArtifact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ReviewArtifact_projectId_status_idx" ON "ReviewArtifact"("projectId", "status");

-- CreateIndex
CREATE INDEX "ReviewArtifact_subjectType_subjectId_idx" ON "ReviewArtifact"("subjectType", "subjectId");
