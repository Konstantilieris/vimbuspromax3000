ALTER TABLE "Project" ADD COLUMN "jiraMappingJson" TEXT;
ALTER TABLE "Epic" ADD COLUMN "jiraIssueKey" TEXT;
ALTER TABLE "Task" ADD COLUMN "jiraIssueKey" TEXT;

CREATE UNIQUE INDEX "Epic_jiraIssueKey_key" ON "Epic"("jiraIssueKey");
CREATE UNIQUE INDEX "Task_jiraIssueKey_key" ON "Task"("jiraIssueKey");
