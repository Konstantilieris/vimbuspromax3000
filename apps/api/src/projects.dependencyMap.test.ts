// VIM-38 Sprint 5 — Surface the per-project dependency map as a real API
// endpoint so the CLI (and downstream tooling) can read the topological
// ordering of tasks without re-deriving it from `requiresJson` strings.
//
// Coverage:
//   1. Linear graph (A -> B -> C, A -> C) returns nodes in topological
//      order and edges referencing stableIds. The tie-breaker is the
//      alphabetically-smallest stableId among tasks that share an
//      in-degree, so we wire two roots whose order under any
//      undeterministic algorithm would otherwise be ambiguous.
//   2. Cycle (A -> B -> C -> A) returns 422 plus the smallest cycle
//      witness (the cycle members themselves, not the entire
//      requires-graph). The handler should normalise the witness so the
//      lexicographically smallest rotation is returned, which keeps the
//      assertion hermetic across runs.
//   3. Empty graph (tasks with no requires) returns the same nodes in
//      a stable, alphabetical-by-stableId order with `edges: []`.
import { createApp } from "./app";
import {
  createIsolatedPrisma,
  removeTempDir,
} from "@vimbuspromax3000/db/testing";
import type { PrismaClient } from "@vimbuspromax3000/db/client";

describe("GET /projects/:id/dependency-map", () => {
  let prisma: PrismaClient;
  let tempDir: string;

  beforeEach(async () => {
    const isolated = await createIsolatedPrisma("vimbus-depmap-");
    prisma = isolated.prisma;
    tempDir = isolated.tempDir;
  });

  afterEach(async () => {
    await prisma.$disconnect();
    removeTempDir(tempDir);
  });

  test("returns nodes in topological order with alphabetical tie-break and edges referencing stableIds", async () => {
    const api = createApp({ prisma });
    const project = await prisma.project.create({
      data: { name: "Linear", rootPath: tempDir, baseBranch: "main" },
    });
    const epic = await prisma.epic.create({
      data: {
        projectId: project.id,
        key: "E-1",
        title: "Epic",
        goal: "g",
        orderIndex: 0,
        status: "proposed",
        acceptanceJson: "[]",
      },
    });

    // Graph: TASK-A -> TASK-B -> TASK-C, TASK-A -> TASK-C, plus an
    // independent root TASK-Z. Both TASK-A and TASK-Z start at in-degree
    // 0. With alphabetical tie-break on stableId we expect TASK-A to be
    // emitted before TASK-Z; without tie-break, the test would flake on
    // any algorithm that uses orderIndex or insertion order.
    await prisma.task.createMany({
      data: [
        // intentionally insert out-of-alphabetical-order so we can prove
        // the route does not lean on the row insertion order
        {
          epicId: epic.id,
          stableId: "TASK-Z",
          title: "Z",
          type: "backend",
          complexity: "low",
          orderIndex: 0,
          status: "proposed",
          acceptanceJson: "[]",
          requiresJson: JSON.stringify([]),
        },
        {
          epicId: epic.id,
          stableId: "TASK-C",
          title: "C",
          type: "backend",
          complexity: "low",
          orderIndex: 1,
          status: "proposed",
          acceptanceJson: "[]",
          requiresJson: JSON.stringify(["TASK-A", "TASK-B"]),
        },
        {
          epicId: epic.id,
          stableId: "TASK-B",
          title: "B",
          type: "backend",
          complexity: "low",
          orderIndex: 2,
          status: "proposed",
          acceptanceJson: "[]",
          requiresJson: JSON.stringify(["TASK-A"]),
        },
        {
          epicId: epic.id,
          stableId: "TASK-A",
          title: "A",
          type: "backend",
          complexity: "low",
          orderIndex: 3,
          status: "proposed",
          acceptanceJson: "[]",
          requiresJson: JSON.stringify([]),
        },
      ],
    });

    const response = await api.fetch(
      new Request(`http://localhost/projects/${project.id}/dependency-map`),
    );
    expect(response.status).toBe(200);
    const body = await response.json();

    // Node payload is a TaskSummary keyed by stableId so the CLI can
    // pretty-print without a second round-trip to /tasks. With Kahn's
    // algorithm + alphabetical tie-break: at start `ready=[A, Z]` and
    // A wins (proving alpha-tie-break — orderIndex would have picked Z
    // first since TASK-Z was inserted first). After A drains B is
    // ready so `ready=[B, Z]` and B wins (alpha again). After B drains
    // C is ready so `ready=[C, Z]` and C wins. Z is emitted last.
    expect(body.nodes.map((node: { stableId: string }) => node.stableId)).toEqual([
      "TASK-A",
      "TASK-B",
      "TASK-C",
      "TASK-Z",
    ]);

    expect(body.nodes[0]).toMatchObject({
      stableId: "TASK-A",
      title: "A",
      status: "proposed",
      type: "backend",
      complexity: "low",
    });
    expect(typeof body.nodes[0].id).toBe("string");
    expect(body.nodes[0].epicKey).toBe("E-1");

    // Edges point from a `requires` entry (the dependency) to the task
    // that depends on it; sorted deterministically (from, then to) so
    // diff-style consumers can rely on the order.
    expect(body.edges).toEqual([
      { from: "TASK-A", to: "TASK-B" },
      { from: "TASK-A", to: "TASK-C" },
      { from: "TASK-B", to: "TASK-C" },
    ]);
  });

  test("returns 422 with the smallest cycle witness when requires-chain forms a cycle", async () => {
    const api = createApp({ prisma });
    const project = await prisma.project.create({
      data: { name: "Cyclic", rootPath: tempDir, baseBranch: "main" },
    });
    const epic = await prisma.epic.create({
      data: {
        projectId: project.id,
        key: "E-2",
        title: "Cycle",
        goal: "g",
        orderIndex: 0,
        status: "proposed",
        acceptanceJson: "[]",
      },
    });

    // 3-cycle TASK-A -> TASK-B -> TASK-C -> TASK-A plus an unrelated
    // tail TASK-D -> TASK-A. The shortest cycle is the 3-cycle (length
    // 3); the route should NOT just return "graph contains a cycle"
    // (the whole node set), but the actual minimum cycle so an operator
    // can fix it by hand.
    await prisma.task.createMany({
      data: [
        {
          epicId: epic.id,
          stableId: "TASK-A",
          title: "A",
          type: "backend",
          complexity: "low",
          orderIndex: 0,
          status: "proposed",
          acceptanceJson: "[]",
          requiresJson: JSON.stringify(["TASK-C"]),
        },
        {
          epicId: epic.id,
          stableId: "TASK-B",
          title: "B",
          type: "backend",
          complexity: "low",
          orderIndex: 1,
          status: "proposed",
          acceptanceJson: "[]",
          requiresJson: JSON.stringify(["TASK-A"]),
        },
        {
          epicId: epic.id,
          stableId: "TASK-C",
          title: "C",
          type: "backend",
          complexity: "low",
          orderIndex: 2,
          status: "proposed",
          acceptanceJson: "[]",
          requiresJson: JSON.stringify(["TASK-B"]),
        },
        // TASK-D feeds into TASK-A but is not part of the cycle; the
        // smallest-cycle response must exclude it.
        {
          epicId: epic.id,
          stableId: "TASK-D",
          title: "D",
          type: "backend",
          complexity: "low",
          orderIndex: 3,
          status: "proposed",
          acceptanceJson: "[]",
          requiresJson: JSON.stringify(["TASK-A"]),
        },
      ],
    });

    const response = await api.fetch(
      new Request(`http://localhost/projects/${project.id}/dependency-map`),
    );
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toBe("cycle");
    // The cycle is normalised so its lexicographically smallest
    // rotation is the canonical witness — A is the smallest stableId
    // in the cycle, so the array must start at A.
    expect(body.cycle).toEqual(["TASK-A", "TASK-B", "TASK-C"]);
    // Sanity: the unrelated tail must not leak into the witness.
    expect(body.cycle).not.toContain("TASK-D");
  });

  test("returns empty edges and alphabetical nodes when no requires are present", async () => {
    const api = createApp({ prisma });
    const project = await prisma.project.create({
      data: { name: "Flat", rootPath: tempDir, baseBranch: "main" },
    });
    const epic = await prisma.epic.create({
      data: {
        projectId: project.id,
        key: "E-3",
        title: "Flat",
        goal: "g",
        orderIndex: 0,
        status: "proposed",
        acceptanceJson: "[]",
      },
    });

    await prisma.task.createMany({
      data: [
        {
          epicId: epic.id,
          stableId: "TASK-Y",
          title: "Y",
          type: "backend",
          complexity: "low",
          orderIndex: 0,
          status: "proposed",
          acceptanceJson: "[]",
        },
        {
          epicId: epic.id,
          stableId: "TASK-X",
          title: "X",
          type: "backend",
          complexity: "low",
          orderIndex: 1,
          status: "proposed",
          acceptanceJson: "[]",
        },
      ],
    });

    const response = await api.fetch(
      new Request(`http://localhost/projects/${project.id}/dependency-map`),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.edges).toEqual([]);
    expect(body.nodes.map((node: { stableId: string }) => node.stableId)).toEqual([
      "TASK-X",
      "TASK-Y",
    ]);
  });

  test("returns 404 when the project does not exist", async () => {
    const api = createApp({ prisma });
    const response = await api.fetch(
      new Request("http://localhost/projects/does-not-exist/dependency-map"),
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toMatch(/project/i);
  });
});
