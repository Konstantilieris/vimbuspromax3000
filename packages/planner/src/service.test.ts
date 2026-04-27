import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { PrismaClient } from "@vimbuspromax3000/db/client";
import {
  createPlannerRun,
  createProject,
  getPlannerRunDetail,
} from "@vimbuspromax3000/db";
import { createIsolatedPrisma, removeTempDir } from "@vimbuspromax3000/db/testing";
import { setupModelRegistry } from "@vimbuspromax3000/model-registry";
import {
  annotateProposalComplexity,
  createPlannerService,
} from "./service";
import type { PlannerProposalInput } from "@vimbuspromax3000/db";

describe("annotateProposalComplexity", () => {
  function buildBaseProposal(): PlannerProposalInput {
    return {
      plannerRunId: "planner_run_test",
      summary: "test",
      epics: [
        {
          key: "EPIC-1",
          title: "Epic",
          goal: "Goal",
          tasks: [
            {
              stableId: "TASK-1",
              title: "Tiny task",
              type: "backend",
              complexity: "medium",
              acceptance: [{ label: "ok" }],
              targetFiles: null,
              requires: null,
              verificationPlan: {
                rationale: null,
                items: [
                  {
                    kind: "logic",
                    runner: "vitest",
                    title: "v",
                    description: "v",
                    command: "bun run test:vitest",
                  },
                ],
              },
            },
          ],
        },
      ],
    };
  }

  test("labels a single-file logic-only task as low complexity", () => {
    const annotated = annotateProposalComplexity(buildBaseProposal());

    expect(annotated.epics[0]!.tasks[0]!.complexity).toBe("low");
  });

  test("labels a task with broad verification kinds as high complexity", () => {
    const proposal = buildBaseProposal();
    proposal.epics[0]!.tasks[0]!.verificationPlan.items = [
      { kind: "logic", title: "a", description: "a" },
      { kind: "integration", title: "b", description: "b" },
      { kind: "visual", title: "c", description: "c" },
      { kind: "evidence", title: "d", description: "d" },
    ];

    const annotated = annotateProposalComplexity(proposal);

    expect(annotated.epics[0]!.tasks[0]!.complexity).toBe("high");
  });

  test("labels a high-fanout task as medium when verification is narrow", () => {
    const proposal = buildBaseProposal();
    proposal.epics[0]!.tasks[0]!.targetFiles = [
      "a.ts",
      "b.ts",
      "c.ts",
      "d.ts",
      "e.ts",
      "f.ts",
      "g.ts",
    ];

    const annotated = annotateProposalComplexity(proposal);

    expect(annotated.epics[0]!.tasks[0]!.complexity).toBe("medium");
  });

  test("preserves task identity, verification items, and other fields", () => {
    const proposal = buildBaseProposal();
    const original = proposal.epics[0]!.tasks[0]!;

    const annotated = annotateProposalComplexity(proposal);
    const annotatedTask = annotated.epics[0]!.tasks[0]!;

    expect(annotatedTask.stableId).toBe(original.stableId);
    expect(annotatedTask.title).toBe(original.title);
    expect(annotatedTask.acceptance).toEqual(original.acceptance);
    expect(annotatedTask.verificationPlan.items).toEqual(original.verificationPlan.items);
  });
});

describe("createPlannerService.generateAndPersist", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-planner-svc-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  }, 20000);

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test("persists a complexity label on each generated task derived from the task-intel scorer", async () => {
    const env = { VIMBUS_TEST_KEY: "present" };
    const project = await createProject(prisma, {
      name: "Planner Svc Project",
      rootPath: tempDir,
    });

    await setupModelRegistry(prisma, {
      projectId: project.id,
      providerKey: "openai",
      providerKind: "openai",
      providerStatus: "active",
      secretEnv: "VIMBUS_TEST_KEY",
      modelName: "GPT Planner",
      modelSlug: "gpt-planner",
      capabilities: ["json"],
      slotKeys: ["planner_deep"],
    });

    const plannerRun = await createPlannerRun(prisma, {
      projectId: project.id,
      goal: "Generate proposals with derived complexity",
      moduleName: "api",
    });

    const service = createPlannerService({
      prisma,
      env,
      generator: vi.fn(async () => ({
        object: {
          summary: "Two tasks with different signals",
          epics: [
            {
              key: "epic-1",
              title: "Mixed Complexity Epic",
              goal: "exercise complexity scoring",
              acceptance: ["ok"],
              tasks: [
                {
                  stableId: "task-tiny",
                  title: "Tiny task",
                  type: "backend",
                  complexity: "high", // generator-supplied label that should be overwritten
                  acceptance: ["ok"],
                  verificationPlan: {
                    items: [
                      {
                        kind: "logic",
                        title: "v",
                        description: "v",
                        command: "bun run test:vitest",
                      },
                    ],
                  },
                },
                {
                  stableId: "task-broad",
                  title: "Broad task",
                  type: "backend",
                  complexity: "low", // generator-supplied label that should be overwritten
                  acceptance: ["ok"],
                  verificationPlan: {
                    items: [
                      { kind: "logic", title: "a", description: "a", command: "bun run test:vitest" },
                      { kind: "integration", title: "b", description: "b", command: "bun run test:vitest" },
                      { kind: "visual", title: "c", description: "c" },
                      { kind: "evidence", title: "d", description: "d" },
                    ],
                  },
                },
              ],
            },
          ],
        },
      })),
    });

    const result = await service.generateAndPersist({ plannerRunId: plannerRun.id });

    const persisted = await getPlannerRunDetail(prisma, plannerRun.id);
    const tasks = persisted!.epics[0]!.tasks;
    expect(tasks).toHaveLength(2);

    const tiny = tasks.find((task) => task.stableId.endsWith("TASK-TINY"));
    const broad = tasks.find((task) => task.stableId.endsWith("TASK-BROAD"));

    expect(tiny?.complexity).toBe("low");
    expect(broad?.complexity).toBe("high");

    // The returned proposal record should also carry the derived labels
    const returnedTasks = result.proposal.epics[0]!.tasks;
    expect(returnedTasks.find((task) => task.stableId.endsWith("TASK-TINY"))?.complexity).toBe("low");
    expect(returnedTasks.find((task) => task.stableId.endsWith("TASK-BROAD"))?.complexity).toBe("high");
  }, 30000);
});
