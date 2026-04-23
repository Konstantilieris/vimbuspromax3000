-- CreateTable
CREATE TABLE "ProjectSecretRef" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "storageType" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectSecretRef_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModelProvider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "providerKind" TEXT NOT NULL,
    "baseUrl" TEXT,
    "authType" TEXT NOT NULL,
    "secretRefId" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ModelProvider_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ModelProvider_secretRefId_fkey" FOREIGN KEY ("secretRefId") REFERENCES "ProjectSecretRef" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RegisteredModel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "supportsTools" BOOLEAN NOT NULL DEFAULT false,
    "supportsVision" BOOLEAN NOT NULL DEFAULT false,
    "supportsJson" BOOLEAN NOT NULL DEFAULT false,
    "supportsStreaming" BOOLEAN NOT NULL DEFAULT false,
    "contextWindow" INTEGER,
    "costTier" TEXT NOT NULL,
    "speedTier" TEXT NOT NULL,
    "reasoningTier" TEXT NOT NULL,
    "metadataJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RegisteredModel_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ModelProvider" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectModelSlot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "slotKey" TEXT NOT NULL,
    "registeredModelId" TEXT,
    "fallbackRegisteredModelId" TEXT,
    "policyJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectModelSlot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProjectModelSlot_registeredModelId_fkey" FOREIGN KEY ("registeredModelId") REFERENCES "RegisteredModel" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProjectModelSlot_fallbackRegisteredModelId_fkey" FOREIGN KEY ("fallbackRegisteredModelId") REFERENCES "RegisteredModel" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectSecretRef_projectId_label_key" ON "ProjectSecretRef"("projectId", "label");

-- CreateIndex
CREATE INDEX "ProjectSecretRef_projectId_kind_status_idx" ON "ProjectSecretRef"("projectId", "kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ModelProvider_projectId_key_key" ON "ModelProvider"("projectId", "key");

-- CreateIndex
CREATE INDEX "ModelProvider_projectId_status_idx" ON "ModelProvider"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RegisteredModel_providerId_slug_key" ON "RegisteredModel"("providerId", "slug");

-- CreateIndex
CREATE INDEX "RegisteredModel_providerId_isEnabled_idx" ON "RegisteredModel"("providerId", "isEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectModelSlot_projectId_slotKey_key" ON "ProjectModelSlot"("projectId", "slotKey");

-- CreateIndex
CREATE INDEX "ProjectModelSlot_projectId_idx" ON "ProjectModelSlot"("projectId");
