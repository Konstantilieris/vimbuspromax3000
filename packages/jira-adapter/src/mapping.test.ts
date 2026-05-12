import { readFileSync } from "node:fs";
import { mapJiraIssuesToDrafts, type JiraIssue } from "./mapping";

describe("Jira issue mapping", () => {
  test("maps Epic, Story, Task, and Sub-task issues into draft records", () => {
    const draft = mapJiraIssuesToDrafts(loadFixtureIssues(), {
      acceptanceCriteriaField: "customfield_12345",
    });

    expect(draft.epic).toMatchObject({
      key: "HC-100",
      title: "E6 Jira adapter foundation",
      goal: "Import Jira issue trees into draft planning records.",
      acceptance: [{ label: "Epic drafts are produced" }, { label: "Child issue hierarchy is preserved" }],
    });
    expect(draft.epic.tasks.map((task) => task.stableId)).toEqual(["HC-101", "HC-102"]);
    expect(draft.ignoredIssues).toEqual([]);
    expect(draft.orphanValidations).toEqual([]);

    const story = draft.epic.tasks[0];
    expect(story).toMatchObject({
      stableId: "HC-101",
      title: "Map Jira Story issues",
      description: "Story issues become internal task drafts.",
      type: "story",
      complexity: "medium",
      acceptance: [{ label: "Story acceptance is captured" }, { label: "Story description is preserved" }],
    });
    expect(story?.validations).toHaveLength(1);
    expect(story?.validations[0]).toMatchObject({
      stableId: "HC-103",
      taskStableId: "HC-101",
      testType: "logic",
      title: "Unit test mapping output",
      acceptanceCriteria: [{ label: "Mapper fixture test passes" }],
    });

    const task = draft.epic.tasks[1];
    expect(task).toMatchObject({
      stableId: "HC-102",
      type: "task",
      acceptance: [{ label: "Task acceptance is captured" }, { label: "Task order remains stable" }],
    });
    expect(task?.validations[0]).toMatchObject({
      stableId: "HC-104",
      taskStableId: "HC-102",
      testType: "manual",
      description: "Sub-task becomes a manual validation draft.",
      acceptanceCriteria: [{ label: "Manual reviewer can inspect the imported draft" }],
    });
  });

  test("uses the configured acceptance criteria field instead of fallback labels", () => {
    const issues = loadFixtureIssues();
    const fallbackDraft = mapJiraIssuesToDrafts(issues);
    const configuredDraft = mapJiraIssuesToDrafts(issues, {
      acceptanceCriteriaField: "customfield_12345",
    });

    expect(fallbackDraft.epic.acceptance).toEqual([{ label: "Complete E6 Jira adapter foundation" }]);
    expect(configuredDraft.epic.acceptance).toEqual([
      { label: "Epic drafts are produced" },
      { label: "Child issue hierarchy is preserved" },
    ]);
  });
});

function loadFixtureIssues(): JiraIssue[] {
  const fixtureUrl = new URL("../fixtures/epic-with-children.json", import.meta.url);
  const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8")) as { issues: JiraIssue[] };

  return fixture.issues;
}
