import { describe, test, expect } from "vitest";
import type { LoopEvent } from "@vimbuspromax3000/shared";
import {
  acknowledgeNotifications,
  applyLiveViewEvents,
  createLiveViewState,
  getLiveViewSnapshot,
  handleLiveViewKey,
  renderNotificationsPane,
} from "./live";

/**
 * VIM-37 — Operator notifications channel.
 *
 * When the evaluator returns `warn`, when a patch is rejected, or when retry
 * escalation fires, the API emits an `operator.notification` LoopEvent with a
 * `{ severity, subjectType, subjectId }` payload. The CLI surfaces these as a
 * notification badge in the live view, color-coded by severity, and clears
 * the badges when the operator presses key `n`.
 */

const makeNotification = (
  id: string,
  severity: "info" | "warn" | "error",
  subjectType: string,
  subjectId: string,
  taskExecutionId?: string,
): LoopEvent => ({
  id,
  projectId: "proj_notify",
  type: "operator.notification",
  payload: { severity, subjectType, subjectId },
  createdAt: "2026-04-27T12:00:00.000Z",
  taskExecutionId,
});

describe("CLI operator notifications badge (VIM-37)", () => {
  test("evaluator-warn notification renders with warn severity tag", () => {
    const fixture: LoopEvent[] = [
      makeNotification("evt_warn_1", "warn", "eval_run", "eval_42", "exec_1"),
    ];

    const state = applyLiveViewEvents(createLiveViewState(), fixture);
    const snapshot = getLiveViewSnapshot(state);

    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0]?.severity).toBe("warn");
    expect(state.notifications[0]?.subjectType).toBe("eval_run");
    expect(state.notifications[0]?.subjectId).toBe("eval_42");
    expect(snapshot).toContain("Notifications");
    expect(snapshot).toContain("[WARN]");
    expect(snapshot).toContain("eval_run");
    expect(snapshot).toContain("eval_42");
  });

  test("patch-rejected notification renders with error severity tag", () => {
    const fixture: LoopEvent[] = [
      makeNotification("evt_reject_1", "error", "patch_review", "patch_99", "exec_1"),
    ];

    const state = applyLiveViewEvents(createLiveViewState(), fixture);
    const snapshot = getLiveViewSnapshot(state);

    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0]?.severity).toBe("error");
    expect(state.notifications[0]?.subjectType).toBe("patch_review");
    expect(snapshot).toContain("[ERROR]");
    expect(snapshot).toContain("patch_review");
    expect(snapshot).toContain("patch_99");
  });

  test("retry-escalation notification renders with info severity tag", () => {
    const fixture: LoopEvent[] = [
      makeNotification("evt_escalate_1", "info", "task_execution", "exec_77", "exec_77"),
    ];

    const state = applyLiveViewEvents(createLiveViewState(), fixture);
    const snapshot = getLiveViewSnapshot(state);

    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0]?.severity).toBe("info");
    expect(state.notifications[0]?.subjectType).toBe("task_execution");
    expect(snapshot).toContain("[INFO]");
    expect(snapshot).toContain("task_execution");
    expect(snapshot).toContain("exec_77");
  });

  test("notifications pane shows hint to acknowledge with key 'n'", () => {
    const fixture: LoopEvent[] = [
      makeNotification("evt_hint", "warn", "eval_run", "eval_42"),
    ];

    const state = applyLiveViewEvents(createLiveViewState(), fixture);
    const pane = renderNotificationsPane(state);

    expect(pane).toMatch(/press 'n'|key 'n'|n to/i);
  });

  test("acknowledgeNotifications clears the badge state", () => {
    const fixture: LoopEvent[] = [
      makeNotification("evt_clear_1", "warn", "eval_run", "eval_1"),
      makeNotification("evt_clear_2", "error", "patch_review", "patch_1"),
      makeNotification("evt_clear_3", "info", "task_execution", "exec_1"),
    ];

    const stateBefore = applyLiveViewEvents(createLiveViewState(), fixture);
    expect(stateBefore.notifications).toHaveLength(3);

    const stateAfter = acknowledgeNotifications(stateBefore);

    expect(stateAfter.notifications).toHaveLength(0);
    const snapshot = getLiveViewSnapshot(stateAfter);
    expect(snapshot).not.toContain("[WARN]");
    expect(snapshot).not.toContain("[ERROR]");
    expect(snapshot).not.toContain("[INFO]");
  });

  test("handleLiveViewKey('n') clears the badge state", () => {
    const fixture: LoopEvent[] = [
      makeNotification("evt_key_1", "warn", "eval_run", "eval_1"),
    ];

    const stateBefore = applyLiveViewEvents(createLiveViewState(), fixture);
    expect(stateBefore.notifications).toHaveLength(1);

    const stateAfter = handleLiveViewKey(stateBefore, "n");
    expect(stateAfter.notifications).toHaveLength(0);
  });

  test("handleLiveViewKey is a no-op for non-'n' keys", () => {
    const fixture: LoopEvent[] = [
      makeNotification("evt_key_2", "warn", "eval_run", "eval_2"),
    ];

    const stateBefore = applyLiveViewEvents(createLiveViewState(), fixture);
    const stateAfter = handleLiveViewKey(stateBefore, "x");
    expect(stateAfter).toBe(stateBefore);
    expect(stateAfter.notifications).toHaveLength(1);
  });

  test("notifications pane indicates 'no notifications' on idle state", () => {
    const pane = renderNotificationsPane(createLiveViewState());
    expect(pane).toMatch(/no notifications/i);
  });

  test("multiple notifications accumulate and remain ordered by event arrival", () => {
    const fixture: LoopEvent[] = [
      makeNotification("evt_a", "warn", "eval_run", "eval_a"),
      makeNotification("evt_b", "error", "patch_review", "patch_b"),
      makeNotification("evt_c", "info", "task_execution", "exec_c"),
    ];

    const state = applyLiveViewEvents(createLiveViewState(), fixture);
    expect(state.notifications.map((n) => n.subjectId)).toEqual([
      "eval_a",
      "patch_b",
      "exec_c",
    ]);
    const snapshot = getLiveViewSnapshot(state);
    expect(snapshot).toContain("[WARN]");
    expect(snapshot).toContain("[ERROR]");
    expect(snapshot).toContain("[INFO]");
  });

  test("re-applying the same notification event id is a no-op", () => {
    const event = makeNotification("evt_dup", "warn", "eval_run", "eval_dup");
    const once = applyLiveViewEvents(createLiveViewState(), [event]);
    const twice = applyLiveViewEvents(once, [event]);
    expect(twice.notifications).toHaveLength(1);
  });

  test("notifications with malformed payloads are skipped without throwing", () => {
    const malformed: LoopEvent = {
      id: "evt_malformed",
      projectId: "proj_notify",
      type: "operator.notification",
      payload: { severity: "not-a-severity" },
      createdAt: "2026-04-27T12:00:00.000Z",
    };
    const state = applyLiveViewEvents(createLiveViewState(), [malformed]);
    expect(state.notifications).toHaveLength(0);
  });
});
