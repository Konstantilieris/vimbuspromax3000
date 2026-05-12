import {
  VALIDATION_COMMANDS,
  getValidationDetailSnapshot,
  getValidationListSnapshot,
  isValidationCommand,
  runValidationCommand,
} from "./validation";

const validationFixture = {
  id: "validation_1",
  taskId: "task_1",
  verificationItemId: "item_1",
  testType: "playwright",
  status: "proposed",
  title: "Checkout is keyboard accessible",
  description: "Exercise checkout with keyboard-only navigation.",
  acceptanceCriteriaJson: JSON.stringify([{ label: "focus ring visible" }]),
  rationale: "Primary accessibility path.",
  command: "bunx playwright test checkout.spec.ts",
  testFilePath: "tests/checkout.spec.ts",
  metadataJson: JSON.stringify({ source: "planner" }),
  orderIndex: 2,
  approvalId: null,
  legacyVerificationItemId: "legacy_item_1",
  lastTaskExecutionId: "exec_1",
  lastTestRunId: "run_1",
  lastExitCode: 0,
  resultSummary: "Passed in CI.",
  resultJson: JSON.stringify({ passed: true }),
  artifactPath: ".artifacts/validation/checkout.json",
  approvedAt: null,
  rejectedAt: null,
  startedAt: "2026-05-11T10:00:00.000Z",
  finishedAt: "2026-05-11T10:01:00.000Z",
  createdAt: "2026-05-11T09:00:00.000Z",
  updatedAt: "2026-05-11T10:01:00.000Z",
};

describe("validation CLI commands", () => {
  test("renders validation list snapshots", () => {
    const output = getValidationListSnapshot([validationFixture]);

    expect(output).toContain("validations");
    expect(output).toContain(
      "- [2] proposed playwright Checkout is keyboard accessible (validation_1)",
    );
    expect(output).toContain("command=bunx playwright test checkout.spec.ts");
    expect(output).toContain("file=tests/checkout.spec.ts");
    expect(output).toContain("result=Passed in CI.");
  });

  test("renders inline validation details", () => {
    const output = getValidationDetailSnapshot(validationFixture);

    expect(output).toContain("Validation: validation_1");
    expect(output).toContain("Task: task_1");
    expect(output).toContain("Title: Checkout is keyboard accessible");
    expect(output).toContain('Acceptance: [{"label":"focus ring visible"}]');
    expect(output).toContain("Command: bunx playwright test checkout.spec.ts");
    expect(output).toContain("Last execution: exec_1");
    expect(output).toContain("Artifact: .artifacts/validation/checkout.json");
    expect(output).not.toContain("/review/");
  });

  test("lists validations by task id", async () => {
    const requests: Array<{ method: string; url: string }> = [];
    const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ method: init?.method ?? "GET", url: String(input) });
      return Response.json([validationFixture]);
    };

    const output = await runValidationCommand(["/validation:list", "--task-id", "task_1"], {
      fetch: mockFetch as typeof fetch,
    });

    expect(requests).toEqual([
      { method: "GET", url: "http://localhost:3000/tasks/task_1/validations" },
    ]);
    expect(output).toContain("Checkout is keyboard accessible");
  });

  test("/validation:show accepts a positional validation id", async () => {
    const requests: Array<{ method: string; url: string }> = [];
    const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ method: init?.method ?? "GET", url: String(input) });
      return Response.json(validationFixture);
    };

    const output = await runValidationCommand(["/validation:show", "validation_1"], {
      fetch: mockFetch as typeof fetch,
    });

    expect(requests).toEqual([
      { method: "GET", url: "http://localhost:3000/validations/validation_1" },
    ]);
    expect(output).toContain("Description: Exercise checkout with keyboard-only navigation.");
  });

  test("/validation:show accepts --validation-id", async () => {
    const requests: string[] = [];
    const mockFetch = async (input: string | URL | Request) => {
      requests.push(String(input));
      return Response.json(validationFixture);
    };

    await runValidationCommand(["/validation:show", "--validation-id", "validation_1"], {
      fetch: mockFetch as typeof fetch,
    });

    expect(requests).toEqual(["http://localhost:3000/validations/validation_1"]);
  });

  test("approves and rejects validations with mocked fetch", async () => {
    const requests: Array<{ method: string; url: string; body?: unknown }> = [];
    const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ method, url, body });

      if (url.endsWith("/approve")) {
        return Response.json({
          validation: { ...validationFixture, status: "approved" },
          approval: {
            id: "approval_1",
            subjectType: "validation",
            subjectId: "validation_1",
            stage: "validation_review",
            status: "granted",
          },
        });
      }

      return Response.json({
        validation: { ...validationFixture, id: "validation_2", status: "rejected" },
        approval: {
          id: "approval_2",
          subjectType: "validation",
          subjectId: "validation_2",
          stage: "validation_review",
          status: "rejected",
        },
      });
    };

    const approveOutput = await runValidationCommand(
      ["/validation:approve", "validation_1", "--operator", "ak", "--reason", "Looks good"],
      { fetch: mockFetch as typeof fetch },
    );
    const rejectOutput = await runValidationCommand(
      ["/validation:reject", "--validation-id=validation_2", "--operator", "ak"],
      { fetch: mockFetch as typeof fetch },
    );

    expect(approveOutput).toBe("Approved validation validation_1 (approved; approval=granted).");
    expect(rejectOutput).toBe("Rejected validation validation_2 (rejected; approval=rejected).");
    expect(requests).toEqual([
      {
        method: "POST",
        url: "http://localhost:3000/validations/validation_1/approve",
        body: { operator: "ak", reason: "Looks good" },
      },
      {
        method: "POST",
        url: "http://localhost:3000/validations/validation_2/reject",
        body: { operator: "ak" },
      },
    ]);
  });

  test("requires a task id for listing and validation id for decisions", async () => {
    await expect(runValidationCommand(["/validation:list"])).rejects.toThrow(
      "Missing required option --task-id.",
    );
    await expect(runValidationCommand(["/validation:approve"])).rejects.toThrow(
      "Missing required option --validation-id or positional <validation-id>.",
    );
  });

  test("exports command predicates", () => {
    for (const command of VALIDATION_COMMANDS) {
      expect(isValidationCommand(command)).toBe(true);
    }
    expect(isValidationCommand("/review:list")).toBe(false);
  });
});
