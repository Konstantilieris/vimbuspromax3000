/**
 * VIM-30 — attempt-based slot escalation helper tests.
 *
 * The execution runtime (apps/api + packages/agent) calls
 * `selectExecutorSlotForAttempt` whenever it needs to decide which
 * `executor_*` slot to drive a given attempt with. The mapping mirrors the
 * stop conditions documented in `docs/policy/model-selection.md`:
 *   - Attempt 1: `executor_default`
 *   - Attempt 2: `executor_default` (one retry on the same slot)
 *   - Attempt 3: `executor_strong` (escalate to the strong slot)
 *   - Attempt 4+: caller is expected to transition the task to `failed`.
 */
import { selectExecutorSlotForAttempt } from "./index";

describe("selectExecutorSlotForAttempt", () => {
  test("attempt 1 uses executor_default with reason 'initial'", () => {
    const result = selectExecutorSlotForAttempt(1);
    expect(result.kind).toBe("execute");
    expect(result.kind === "execute" && result.slotKey).toBe("executor_default");
    expect(result.kind === "execute" && result.reason).toBe("initial");
  });

  test("attempt 2 retries on the same slot", () => {
    const result = selectExecutorSlotForAttempt(2);
    expect(result.kind).toBe("execute");
    expect(result.kind === "execute" && result.slotKey).toBe("executor_default");
    expect(result.kind === "execute" && result.reason).toBe("retry_same_slot");
  });

  test("attempt 3 escalates to executor_strong", () => {
    const result = selectExecutorSlotForAttempt(3);
    expect(result.kind).toBe("execute");
    expect(result.kind === "execute" && result.slotKey).toBe("executor_strong");
    expect(result.kind === "execute" && result.reason).toBe("escalate_to_strong");
  });

  test("attempt 4 reports terminal failure", () => {
    const result = selectExecutorSlotForAttempt(4);
    expect(result.kind).toBe("fail");
    expect(result.kind === "fail" && result.reason).toBe("max_attempts_exceeded");
  });

  test("attempt 5+ also reports terminal failure", () => {
    const result = selectExecutorSlotForAttempt(7);
    expect(result.kind).toBe("fail");
  });

  test("rejects non-positive attempts", () => {
    expect(() => selectExecutorSlotForAttempt(0)).toThrow();
    expect(() => selectExecutorSlotForAttempt(-1)).toThrow();
  });
});
