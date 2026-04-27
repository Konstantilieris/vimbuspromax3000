import { describe, test, expect } from "vitest";
import type { LoopEvent } from "@vimbuspromax3000/shared";
import {
  LIVE_VIEW_PANES,
  applyLiveViewEvents,
  createLiveViewState,
  getLiveViewSnapshot,
  parseSseFrames,
  runLiveViewWithStream,
} from "./live";

describe("CLI 3-pane live view", () => {
  test("declares the three documented panes", () => {
    expect(LIVE_VIEW_PANES).toEqual(["Epics / Tasks", "Control Center", "Evaluator Transcript"]);
  });

  test("snapshot of an empty state contains all three pane headers", () => {
    const snapshot = getLiveViewSnapshot(createLiveViewState());
    for (const pane of LIVE_VIEW_PANES) {
      expect(snapshot).toContain(pane);
    }
    expect(snapshot).toContain("No epics yet.");
    expect(snapshot).toContain("Idle.");
    expect(snapshot).toContain("No evaluator activity.");
  });

  test("reducer routes a fixture event tape into the correct panes", () => {
    const fixture: LoopEvent[] = [
      {
        id: "evt_1",
        projectId: "proj_1",
        type: "planner.proposed",
        payload: {
          epics: [
            {
              key: "EPIC-LIVE-1",
              title: "Wire SSE",
              tasks: [
                { stableId: "TASK-LIVE-1", title: "Bus", status: "ready" },
                { stableId: "TASK-LIVE-2", title: "TUI", status: "planned" },
              ],
            },
          ],
        },
        createdAt: "2026-04-27T12:00:00.000Z",
      },
      {
        id: "evt_2",
        projectId: "proj_1",
        type: "agent.step.started",
        payload: { taskId: "TASK-LIVE-1", model: "executor_default" },
        createdAt: "2026-04-27T12:00:01.000Z",
        taskExecutionId: "exec_1",
      },
      {
        id: "evt_3",
        projectId: "proj_1",
        type: "evaluation.result",
        payload: { dimension: "logic", score: 92, threshold: 80 },
        createdAt: "2026-04-27T12:00:02.000Z",
        taskExecutionId: "exec_1",
      },
      {
        id: "evt_4",
        projectId: "proj_1",
        type: "evaluation.finished",
        payload: { verdict: "passed", aggregateScore: 94 },
        createdAt: "2026-04-27T12:00:03.000Z",
        taskExecutionId: "exec_1",
      },
      {
        id: "evt_5",
        projectId: "proj_1",
        type: "task.failed",
        payload: { taskId: "TASK-LIVE-2", reason: "verification" },
        createdAt: "2026-04-27T12:00:04.000Z",
      },
    ];

    const state = applyLiveViewEvents(createLiveViewState(), fixture);
    const snapshot = getLiveViewSnapshot(state);

    expect(snapshot).toContain("EPIC-LIVE-1 Wire SSE");
    expect(snapshot).toContain("TASK-LIVE-1 Bus [ready]");
    expect(snapshot).toContain("TASK-LIVE-2 TUI [failed]");
    expect(snapshot).toContain("Active execution: exec_1");
    expect(snapshot).toContain("Last event: task.failed");
    expect(snapshot).toContain("logic 92/80");
    expect(snapshot).toContain("passed (94)");
  });

  test("reducer is incremental — re-applying the same event id is a no-op", () => {
    const event: LoopEvent = {
      id: "evt_dup",
      projectId: "p",
      type: "agent.tool.requested",
      payload: { tool: "fs.read" },
      createdAt: "2026-04-27T12:00:00.000Z",
      taskExecutionId: "exec_dup",
    };

    const once = applyLiveViewEvents(createLiveViewState(), [event]);
    const twice = applyLiveViewEvents(once, [event]);

    expect(getLiveViewSnapshot(once)).toBe(getLiveViewSnapshot(twice));
  });

  test("parseSseFrames extracts event/id/data triples from a typical body", () => {
    const body =
      ": heartbeat\n\n" +
      "event: planner.proposed\nid: evt_1\ndata: {\"projectId\":\"p\",\"id\":\"evt_1\",\"type\":\"planner.proposed\",\"payload\":{},\"createdAt\":\"x\"}\n\n" +
      "event: agent.step.started\nid: evt_2\ndata: {\"projectId\":\"p\",\"id\":\"evt_2\",\"type\":\"agent.step.started\",\"payload\":{},\"createdAt\":\"x\",\"taskExecutionId\":\"e\"}\n\n";

    const { frames, remainder } = parseSseFrames(body);
    expect(remainder).toBe("");
    expect(frames.map((frame) => frame.event)).toEqual(["planner.proposed", "agent.step.started"]);
    expect(frames[0]?.id).toBe("evt_1");
    expect(frames[0]?.data).toContain("planner.proposed");
  });

  test("parseSseFrames preserves the partial remainder for the next chunk", () => {
    const partial = "event: planner.started\nid: evt_x\ndata: {\"id\":\"evt";
    const { frames, remainder } = parseSseFrames(partial);
    expect(frames).toEqual([]);
    expect(remainder).toBe(partial);
  });

  test("runLiveViewWithStream consumes a fixture stream and surfaces the final snapshot", async () => {
    const events: LoopEvent[] = [
      {
        id: "evt_1",
        projectId: "p",
        type: "planner.proposed",
        payload: {
          epics: [
            {
              key: "EPIC-FIX-1",
              title: "Fixture epic",
              tasks: [{ stableId: "TASK-FIX-1", title: "Stream wiring", status: "ready" }],
            },
          ],
        },
        createdAt: "2026-04-27T12:00:00.000Z",
      },
      {
        id: "evt_2",
        projectId: "p",
        type: "agent.step.completed",
        payload: { status: "ok" },
        createdAt: "2026-04-27T12:00:01.000Z",
        taskExecutionId: "exec_fix",
      },
    ];

    const body =
      ": heartbeat\n\n" +
      events
        .map(
          (event) =>
            `event: ${event.type}\nid: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`,
        )
        .join("");

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    });

    const snapshots: string[] = [];
    await runLiveViewWithStream(stream, {
      onUpdate: (snapshot) => snapshots.push(snapshot),
    });

    expect(snapshots.length).toBeGreaterThan(0);
    const final = snapshots[snapshots.length - 1] ?? "";
    expect(final).toContain("EPIC-FIX-1 Fixture epic");
    expect(final).toContain("TASK-FIX-1 Stream wiring [ready]");
    expect(final).toContain("Active execution: exec_fix");
    expect(final).toContain("Last event: agent.step.completed");
  });
});
