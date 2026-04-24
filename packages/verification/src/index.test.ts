import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  ingestSourceAsset,
  planAssetPresenceResult,
  planManualEvidenceResult,
  toAssetReference,
} from "./index";

describe("verification source asset ingestion", () => {
  it("ingests project-root-contained PNG assets with hash and dimensions", async () => {
    const root = await makeTempRoot();
    const assetPath = join(root, "docs", "assets", "one-by-one.png");
    await mkdir(join(root, "docs", "assets"), { recursive: true });
    await writeFile(assetPath, oneByOnePng());

    const asset = await ingestSourceAsset({
      projectRoot: root,
      relativePath: "docs/assets/one-by-one.png",
    });

    expect(asset.relativePath).toBe("docs/assets/one-by-one.png");
    expect(asset.kind).toBe("image");
    expect(asset.mimeType).toBe("image/png");
    expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(asset.status).toBe("proposed");
    expect(asset.approvalRequired).toBe(true);
    expect(asset.metadata).toEqual({
      kind: "image",
      width: 1,
      height: 1,
      format: "png",
    });
  });

  it("rejects parent traversal paths", async () => {
    const root = await makeTempRoot();

    await expect(
      ingestSourceAsset({
        projectRoot: root,
        relativePath: "../outside.png",
      }),
    ).rejects.toThrow("parent traversal");
  });
});

describe("visual result planning helpers", () => {
  it("plans manual evidence as requiring review when evidence exists", () => {
    const result = planManualEvidenceResult({
      item: {
        id: "item-1",
        kind: "evidence",
        title: "Operator screenshot",
      },
      evidenceAssets: [{ relativePath: "docs/assets/run.png", kind: "image" }],
    });

    expect(result.status).toBe("requires_review");
    expect(result.evidenceAssets).toHaveLength(1);
  });

  it("plans asset presence failures with missing asset references", async () => {
    const root = await makeTempRoot();
    const assetPath = join(root, "docs", "assets", "one-by-one.png");
    await mkdir(join(root, "docs", "assets"), { recursive: true });
    await writeFile(assetPath, oneByOnePng());

    const asset = await ingestSourceAsset({
      projectRoot: root,
      relativePath: "docs/assets/one-by-one.png",
    });
    const result = planAssetPresenceResult({
      item: {
        id: "item-2",
        kind: "visual",
        title: "Expected references",
      },
      expectedAssets: [toAssetReference(asset), { relativePath: "docs/assets/missing.png" }],
      availableAssets: [toAssetReference(asset)],
    });

    expect(result.status).toBe("failed");
    expect(result.missingAssets).toEqual([{ relativePath: "docs/assets/missing.png" }]);
  });
});

async function makeTempRoot() {
  const root = join(tmpdir(), `verification-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });

  return root;
}

function oneByOnePng() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64",
  );
}
