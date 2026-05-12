import {
  DESIGN_COMMANDS,
  getDesignDocsViewSnapshot,
  getDesignResultsViewSnapshot,
  isDesignCommand,
  runDesignCommand,
} from "./design";

describe("design docs CLI commands", () => {
  test("renders sparse design doc snapshots", () => {
    const output = getDesignDocsViewSnapshot([
      {
        id: "asset_1",
        projectId: "project_1",
        taskId: "task_1",
        verificationItemId: "item_1",
        kind: "image",
        relativePath: "docs/design/checkout.png",
        mimeType: "image/png",
        sha256: "abc",
        width: 1280,
        height: 720,
        comparisonMode: "screenshot",
        status: "approved",
      },
    ]);

    expect(output).toContain("design docs");
    expect(output).toContain("approved image docs/design/checkout.png 1280x720 asset_1");
    expect(output).toContain("task=task_1");
    expect(output).toContain("item=item_1");
    expect(output).toContain("mode=screenshot");
  });

  test("renders visual result snapshots", () => {
    const output = getDesignResultsViewSnapshot([
      {
        id: "result_1",
        taskExecutionId: "exec_1",
        verificationItemId: "item_1",
        sourceAssetId: "asset_1",
        mode: "screenshot",
        status: "passed",
        diffPath: ".artifacts/diff.png",
        diffRatio: 0,
        threshold: 0.01,
      },
    ]);

    expect(output).toContain("passed screenshot exec_1 item=item_1 diff=0 threshold=0.01");
    expect(output).toContain("diffPath=.artifacts/diff.png");
  });

  test("lists design docs by project", async () => {
    const requests: string[] = [];
    const mockFetch = async (input: string | URL | Request) => {
      requests.push(String(input));
      return Response.json([
        {
          id: "asset_1",
          projectId: "project_1",
          taskId: null,
          verificationItemId: null,
          kind: "pdf",
          relativePath: "docs/design/spec.pdf",
          mimeType: "application/pdf",
          sha256: "abc",
          pageCount: 4,
          status: "proposed",
        },
      ]);
    };

    const output = await runDesignCommand(
      ["/design", "--project-id", "project_1", "--status", "proposed"],
      { fetch: mockFetch as typeof fetch },
    );

    expect(requests).toEqual(["http://localhost:3000/projects/project_1/source-assets?status=proposed"]);
    expect(output).toContain("proposed pdf docs/design/spec.pdf 4p asset_1");
  });

  test("lists design docs by task", async () => {
    const requests: string[] = [];
    const mockFetch = async (input: string | URL | Request) => {
      requests.push(String(input));
      return Response.json([]);
    };

    const output = await runDesignCommand(["/design", "--task-id", "task_1"], {
      fetch: mockFetch as typeof fetch,
    });

    expect(requests).toEqual(["http://localhost:3000/tasks/task_1/source-assets"]);
    expect(output).toContain("No design docs.");
  });

  test("adds a design doc without sending file bytes through the CLI", async () => {
    const requests: Array<{ method: string; url: string; body?: unknown }> = [];
    const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        method: init?.method ?? "GET",
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return Response.json(
        {
          id: "asset_1",
          projectId: "project_1",
          taskId: "task_1",
          verificationItemId: "item_1",
          kind: "image",
          relativePath: "docs/design/checkout.png",
          mimeType: "image/png",
          sha256: "abc",
          width: 1280,
          height: 720,
          comparisonMode: "screenshot",
          status: "proposed",
        },
        { status: 201 },
      );
    };

    const output = await runDesignCommand(
      [
        "/design:add",
        "--project-id",
        "project_1",
        "--path",
        "docs/design/checkout.png",
        "--task-id",
        "task_1",
        "--verification-item-id",
        "item_1",
        "--comparison-mode",
        "screenshot",
        "--set-expected",
      ],
      { fetch: mockFetch as typeof fetch },
    );

    expect(requests).toEqual([
      {
        method: "POST",
        url: "http://localhost:3000/projects/project_1/source-assets",
        body: {
          relativePath: "docs/design/checkout.png",
          taskId: "task_1",
          verificationItemId: "item_1",
          comparisonMode: "screenshot",
          setAsExpectedAsset: true,
        },
      },
    ]);
    expect(output).toBe("Added design doc docs/design/checkout.png (asset_1) status=proposed.");
  });

  test("approves design docs and lists their visual results", async () => {
    const requests: Array<{ method: string; url: string }> = [];
    const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ method: init?.method ?? "GET", url });

      if (url.endsWith("/approve")) {
        return Response.json({
          id: "asset_1",
          projectId: "project_1",
          kind: "image",
          relativePath: "docs/design/checkout.png",
          mimeType: "image/png",
          sha256: "abc",
          status: "approved",
        });
      }

      return Response.json([
        {
          id: "result_1",
          taskExecutionId: "exec_1",
          verificationItemId: "item_1",
          sourceAssetId: "asset_1",
          mode: "screenshot",
          status: "passed",
          diffRatio: 0,
          threshold: 0.01,
        },
      ]);
    };

    const approveOutput = await runDesignCommand(["/design:approve", "--asset-id", "asset_1"], {
      fetch: mockFetch as typeof fetch,
    });
    const resultsOutput = await runDesignCommand(["/design:results", "--asset-id", "asset_1"], {
      fetch: mockFetch as typeof fetch,
    });

    expect(approveOutput).toBe("Approved design doc docs/design/checkout.png (asset_1).");
    expect(resultsOutput).toContain("passed screenshot exec_1 item=item_1");
    expect(requests).toEqual([
      { method: "POST", url: "http://localhost:3000/source-assets/asset_1/approve" },
      { method: "GET", url: "http://localhost:3000/source-assets/asset_1/visual-results" },
    ]);
  });

  test("exports command predicates", () => {
    for (const command of DESIGN_COMMANDS) {
      expect(isDesignCommand(command)).toBe(true);
    }
    expect(isDesignCommand("/plan")).toBe(false);
  });
});
