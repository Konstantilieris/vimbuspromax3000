import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compareImages } from "./diff";

const fixtureRoot = join(tmpdir(), `verification-diff-${crypto.randomUUID()}`);

const SOLID_RED = { r: 255, g: 0, b: 0 } as const;
const SOLID_GREEN = { r: 0, g: 255, b: 0 } as const;

beforeAll(async () => {
  await mkdir(fixtureRoot, { recursive: true });
  await writeFile(join(fixtureRoot, "red-8.png"), encodeSolid(8, 8, SOLID_RED));
  await writeFile(join(fixtureRoot, "red-8-copy.png"), encodeSolid(8, 8, SOLID_RED));
  await writeFile(join(fixtureRoot, "green-8.png"), encodeSolid(8, 8, SOLID_GREEN));
  await writeFile(join(fixtureRoot, "red-16.png"), encodeSolid(16, 16, SOLID_RED));
});

afterAll(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

describe("compareImages", () => {
  it("returns matched=true for identical PNGs", async () => {
    const result = await compareImages(join(fixtureRoot, "red-8.png"), join(fixtureRoot, "red-8-copy.png"));

    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.diffPixels).toBe(0);
      expect(result.totalPixels).toBe(64);
    }
  });

  it("reports diffPixels when colors differ", async () => {
    const result = await compareImages(join(fixtureRoot, "red-8.png"), join(fixtureRoot, "green-8.png"));

    expect(result.matched).toBe(false);
    if (!result.matched && !("reason" in result)) {
      expect(result.diffPixels).toBeGreaterThan(0);
      expect(result.totalPixels).toBe(64);
    }
  });

  it("respects maxDiffPixels tolerance", async () => {
    const result = await compareImages(join(fixtureRoot, "red-8.png"), join(fixtureRoot, "green-8.png"), {
      maxDiffPixels: 1024,
    });

    expect(result.matched).toBe(true);
  });

  it("writes a diff PNG when diffOutputPath is provided", async () => {
    const diffPath = join(fixtureRoot, "diff-out.png");
    const result = await compareImages(join(fixtureRoot, "red-8.png"), join(fixtureRoot, "green-8.png"), {
      diffOutputPath: diffPath,
    });

    expect(result.matched).toBe(false);
    if (!result.matched && !("reason" in result)) {
      expect(result.diffPath).toBe(diffPath);
    }
    const fileStat = await stat(diffPath);
    expect(fileStat.size).toBeGreaterThan(0);
  });

  it("returns size-mismatch when dimensions differ", async () => {
    const result = await compareImages(join(fixtureRoot, "red-8.png"), join(fixtureRoot, "red-16.png"));

    expect(result.matched).toBe(false);
    if (!result.matched && "reason" in result) {
      expect(result.reason).toBe("size-mismatch");
      if (result.reason === "size-mismatch") {
        expect(result.actualSize).toEqual({ width: 8, height: 8 });
        expect(result.expectedSize).toEqual({ width: 16, height: 16 });
      }
    }
  });

  it("returns missing-file when actual is absent", async () => {
    const result = await compareImages(join(fixtureRoot, "missing.png"), join(fixtureRoot, "red-8.png"));

    expect(result.matched).toBe(false);
    if (!result.matched && "reason" in result && result.reason === "missing-file") {
      expect(result.path).toContain("missing.png");
    }
  });

  it("returns missing-file when expected is absent", async () => {
    const result = await compareImages(join(fixtureRoot, "red-8.png"), join(fixtureRoot, "ghost.png"));

    expect(result.matched).toBe(false);
    if (!result.matched && "reason" in result && result.reason === "missing-file") {
      expect(result.path).toContain("ghost.png");
    }
  });
});

function encodeSolid(width: number, height: number, color: { r: number; g: number; b: number }): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (width * y + x) << 2;
      png.data[idx] = color.r;
      png.data[idx + 1] = color.g;
      png.data[idx + 2] = color.b;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}
