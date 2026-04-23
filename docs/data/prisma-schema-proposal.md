# Prisma Schema Proposal

Core loop: `Planner -> Verification Contract -> Approval -> Execution -> Verified Output`.

## Database Target

V1 uses Prisma with SQLite.

Enum-like values are stored as `String` fields in SQLite v1 and validated in application code with TypeScript unions. A later Postgres migration can promote selected fields to native enums and JSON columns.

Evaluation, MCP, policy, benchmark, and LangSmith payloads use JSON text columns in SQLite v1. Application code owns schema validation and migration compatibility.

## Proposed Schema

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
}

model Project {
  id                String   @id @default(cuid())
  name              String
  rootPath          String
  baseBranch        String   @default("main")
  branchNaming      String   @default("tg/<module>/<task-id>-<slug>")
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  plannerRuns       PlannerRun[]
  epics             Epic[]
  assets            SourceOfTruthAsset[]
  approvals         Approval[]
  events            LoopEvent[]
}

model PlannerRun {
  id                String   @id @default(cuid())
  projectId         String
  status            String
  goal              String
  moduleName        String?
  contextPath       String?
  summary           String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  project           Project  @relation(fields: [projectId], references: [id])
  epics             Epic[]
  agentSteps        AgentStep[]

  @@index([projectId, status])
}

model Epic {
  id                String   @id @default(cuid())
  projectId         String
  plannerRunId      String?
  key               String
  title             String
  goal              String
  status            String
  orderIndex        Int
  acceptanceJson    String?
  risksJson         String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  project           Project     @relation(fields: [projectId], references: [id])
  plannerRun        PlannerRun? @relation(fields: [plannerRunId], references: [id])
  tasks             Task[]

  @@unique([projectId, key])
  @@index([projectId, status])
}

model Task {
  id                String   @id @default(cuid())
  epicId            String
  stableId          String
  title             String
  description       String?
  type              String
  complexity        String
  status            String
  orderIndex        Int
  acceptanceJson    String
  targetFilesJson   String?
  requiresJson      String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  epic              Epic                 @relation(fields: [epicId], references: [id])
  verificationPlans VerificationPlan[]
  branch            TaskBranch?
  executions        TaskExecution[]
  assets            SourceOfTruthAsset[]

  @@unique([stableId])
  @@index([epicId, status])
}

model VerificationPlan {
  id                String   @id @default(cuid())
  taskId            String
  status            String
  rationale         String?
  approvedAt        DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  task              Task @relation(fields: [taskId], references: [id])
  items             VerificationItem[]

  @@index([taskId, status])
}

model VerificationItem {
  id                String   @id @default(cuid())
  planId            String
  taskId            String
  kind              String
  runner            String?
  title             String
  description       String
  rationale         String?
  command           String?
  testFilePath      String?
  route             String?
  interaction       String?
  expectedAssetId   String?
  status            String
  orderIndex        Int
  configJson        String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  plan              VerificationPlan @relation(fields: [planId], references: [id])
  testRuns          TestRun[]

  @@index([planId, kind])
  @@index([taskId, status])
}

model SourceOfTruthAsset {
  id                String   @id @default(cuid())
  projectId         String
  taskId            String?
  verificationItemId String?
  kind              String
  relativePath      String
  mimeType          String
  sha256            String
  width             Int?
  height            Int?
  pageCount         Int?
  metadataJson      String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  project           Project @relation(fields: [projectId], references: [id])
  task              Task?   @relation(fields: [taskId], references: [id])

  @@unique([projectId, relativePath])
  @@index([taskId])
}

model Approval {
  id                String   @id @default(cuid())
  projectId         String
  subjectType       String
  subjectId         String
  stage             String
  status            String
  operator          String?
  reason            String?
  createdAt         DateTime @default(now())

  project           Project @relation(fields: [projectId], references: [id])

  @@index([projectId, subjectType, subjectId])
}

model TaskBranch {
  id                String   @id @default(cuid())
  taskId            String   @unique
  name              String   @unique
  base              String
  state             String
  createdAt         DateTime @default(now())
  lastVerifiedAt    DateTime?
  currentHead       String?

  task              Task @relation(fields: [taskId], references: [id])
  executions        TaskExecution[]
}

model TaskExecution {
  id                String   @id @default(cuid())
  taskId            String
  branchId          String
  status            String
  retryCount        Int      @default(0)
  policyJson        String?
  startedAt         DateTime?
  finishedAt        DateTime?
  createdAt         DateTime @default(now())

  task              Task       @relation(fields: [taskId], references: [id])
  branch            TaskBranch @relation(fields: [branchId], references: [id])
  agentSteps        AgentStep[]
  testRuns          TestRun[]
  patchReviews      PatchReview[]
  events            LoopEvent[]

  @@index([taskId, status])
}

model AgentStep {
  id                String   @id @default(cuid())
  plannerRunId      String?
  taskExecutionId   String?
  role              String
  modelName         String?
  status            String
  inputHash         String?
  outputPath        String?
  summary           String?
  startedAt         DateTime?
  finishedAt        DateTime?
  createdAt         DateTime @default(now())

  plannerRun        PlannerRun?    @relation(fields: [plannerRunId], references: [id])
  taskExecution     TaskExecution? @relation(fields: [taskExecutionId], references: [id])
}

model TestRun {
  id                String   @id @default(cuid())
  taskExecutionId   String
  verificationItemId String?
  command           String
  status            String
  exitCode          Int?
  stdoutPath        String?
  stderrPath        String?
  startedAt         DateTime?
  finishedAt        DateTime?
  createdAt         DateTime @default(now())

  taskExecution     TaskExecution    @relation(fields: [taskExecutionId], references: [id])
  verificationItem  VerificationItem? @relation(fields: [verificationItemId], references: [id])
}

model PatchReview {
  id                String   @id @default(cuid())
  taskExecutionId   String
  status            String
  diffPath          String?
  summary           String?
  approvedAt        DateTime?
  createdAt         DateTime @default(now())

  taskExecution     TaskExecution @relation(fields: [taskExecutionId], references: [id])
}

model LoopEvent {
  id                String   @id @default(cuid())
  projectId         String
  taskExecutionId   String?
  type              String
  payloadJson       String
  createdAt         DateTime @default(now())

  project           Project        @relation(fields: [projectId], references: [id])
  taskExecution     TaskExecution? @relation(fields: [taskExecutionId], references: [id])

  @@index([projectId, createdAt])
  @@index([taskExecutionId, createdAt])
}

model EvalRun {
  id                String   @id @default(cuid())
  projectId         String
  taskExecutionId   String?
  benchmarkScenarioId String?
  status            String
  aggregateScore    Int?
  threshold         Int?
  verdict           String?
  inputHash         String?
  startedAt         DateTime?
  finishedAt        DateTime?
  createdAt         DateTime @default(now())

  results           EvalResult[]

  @@index([projectId, createdAt])
  @@index([taskExecutionId, createdAt])
  @@index([benchmarkScenarioId])
}

model EvalResult {
  id                String   @id @default(cuid())
  evalRunId         String
  dimension         String
  score             Int
  threshold         Int
  verdict           String
  evaluatorType     String
  modelName         String?
  promptVersion     String?
  reasoning         String
  evidenceJson      String?
  createdAt         DateTime @default(now())

  evalRun           EvalRun @relation(fields: [evalRunId], references: [id])

  @@index([evalRunId, dimension])
}

model McpServer {
  id                String   @id @default(cuid())
  projectId         String
  name              String
  transport         String
  endpoint          String?
  trustLevel        String
  status            String
  configJson        String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  tools             McpTool[]

  @@unique([projectId, name])
  @@index([projectId, status])
}

model McpTool {
  id                String   @id @default(cuid())
  serverId          String
  name              String
  description       String?
  mutability        String
  approvalRequired  Boolean  @default(false)
  inputSchemaJson   String
  status            String
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  server            McpServer @relation(fields: [serverId], references: [id])
  calls             McpToolCall[]

  @@unique([serverId, name])
  @@index([serverId, status])
}

model McpToolCall {
  id                String   @id @default(cuid())
  projectId         String
  taskExecutionId   String?
  toolId            String?
  serverName        String
  toolName          String
  status            String
  mutability        String
  approvalId        String?
  argumentsHash     String?
  argumentsJson     String?
  resultSummary     String?
  errorSummary      String?
  latencyMs         Int?
  createdAt         DateTime @default(now())
  finishedAt        DateTime?

  tool              McpTool? @relation(fields: [toolId], references: [id])

  @@index([projectId, createdAt])
  @@index([taskExecutionId, createdAt])
  @@index([toolName, status])
}

model ModelDecision {
  id                String   @id @default(cuid())
  projectId         String
  taskExecutionId   String?
  attempt           Int
  complexityLabel   String
  selectedSlot      String
  selectedModel     String?
  reason            String
  state             String
  scoreJson         String?
  createdAt         DateTime @default(now())

  @@index([projectId, createdAt])
  @@index([taskExecutionId, attempt])
}

model BenchmarkScenario {
  id                String   @id @default(cuid())
  projectId         String
  name              String
  status            String
  goal              String
  fixturePath       String?
  expectedToolsJson String?
  forbiddenToolsJson String?
  thresholdsJson    String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@unique([projectId, name])
  @@index([projectId, status])
}

model RegressionBaseline {
  id                String   @id @default(cuid())
  projectId         String
  benchmarkScenarioId String
  evalRunId         String
  status            String
  aggregateScore    Int
  dimensionScoresJson String
  toolSummaryJson   String?
  modelSummaryJson  String?
  acceptedAt        DateTime @default(now())

  @@index([projectId, status])
  @@index([benchmarkScenarioId, status])
}

model LangSmithTraceLink {
  id                String   @id @default(cuid())
  projectId         String
  subjectType       String
  subjectId         String
  traceUrl          String?
  datasetId         String?
  experimentId      String?
  runId             String?
  syncStatus        String
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([projectId, subjectType, subjectId])
  @@index([syncStatus])
}
```

## Postgres Migration Notes

When moving to Postgres:

- Convert enum-like `String` columns to Prisma enums where useful.
- Convert `*Json` text fields to native `Json`.
- Promote high-value status strings to enums after state vocabulary stabilizes.
- Add stronger relational constraints for source asset ownership.
- Add foreign-key relations for benchmark, evaluation, model-decision, and LangSmith records where cross-process concurrency requires them.
- Consider row-level locking for concurrent task execution.

## Model Registry Additions

The executable schema adds these SQLite-backed records:

```prisma
model Project {
  modelProviders ModelProvider[]
  modelSlots     ProjectModelSlot[]
  secretRefs     ProjectSecretRef[]
}

model ProjectSecretRef {
  id          String   @id @default(cuid())
  projectId   String
  kind        String
  label       String
  storageType String
  reference   String
  status      String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  project   Project         @relation(fields: [projectId], references: [id])
  providers ModelProvider[]

  @@unique([projectId, label])
  @@index([projectId, kind, status])
}

model ModelProvider {
  id          String   @id @default(cuid())
  projectId   String
  key         String
  label       String
  providerKind String
  baseUrl     String?
  authType    String
  secretRefId String?
  status      String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  project   Project           @relation(fields: [projectId], references: [id])
  secretRef ProjectSecretRef? @relation(fields: [secretRefId], references: [id])
  models    RegisteredModel[]

  @@unique([projectId, key])
  @@index([projectId, status])
}

model RegisteredModel {
  id                String   @id @default(cuid())
  providerId        String
  name              String
  slug              String
  isEnabled         Boolean  @default(true)
  supportsTools     Boolean  @default(false)
  supportsVision    Boolean  @default(false)
  supportsJson      Boolean  @default(false)
  supportsStreaming Boolean  @default(false)
  contextWindow     Int?
  costTier          String
  speedTier         String
  reasoningTier     String
  metadataJson      String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  provider      ModelProvider      @relation(fields: [providerId], references: [id])
  primarySlots  ProjectModelSlot[] @relation("PrimarySlotModel")
  fallbackSlots ProjectModelSlot[] @relation("FallbackSlotModel")

  @@unique([providerId, slug])
  @@index([providerId, isEnabled])
}

model ProjectModelSlot {
  id                        String   @id @default(cuid())
  projectId                 String
  slotKey                   String
  registeredModelId         String?
  fallbackRegisteredModelId String?
  policyJson                String?
  createdAt                 DateTime @default(now())
  updatedAt                 DateTime @updatedAt

  project       Project          @relation(fields: [projectId], references: [id])
  primaryModel  RegisteredModel? @relation("PrimarySlotModel", fields: [registeredModelId], references: [id])
  fallbackModel RegisteredModel? @relation("FallbackSlotModel", fields: [fallbackRegisteredModelId], references: [id])

  @@unique([projectId, slotKey])
  @@index([projectId])
}
```

The registry schema intentionally stores enum-like values as strings, matching the rest of SQLite v1. Application code validates provider kinds, statuses, slot keys, and tiers through shared TypeScript unions.
