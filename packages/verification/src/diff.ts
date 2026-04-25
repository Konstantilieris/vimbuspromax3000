import { readFile, writeFile } from "node:fs/promises";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export type ImageDiffResult =
  | { matched: true; diffPixels: 0; totalPixels: number }
  | { matched: false; diffPixels: number; totalPixels: number; diffPath?: string }
  | {
      matched: false;
      reason: "size-mismatch";
      actualSize: { width: number; height: number };
      expectedSize: { width: number; height: number };
    }
  | { matched: false; reason: "missing-file"; path: string };

export type CompareImagesOptions = {
  threshold?: number;
  maxDiffPixels?: number;
  diffOutputPath?: string;
};

export async function compareImages(
  actualPath: string,
  expectedPath: string,
  options: CompareImagesOptions = {},
): Promise<ImageDiffResult> {
  const actualBuffer = await readFileSafe(actualPath);
  if (!actualBuffer) {
    return { matched: false, reason: "missing-file", path: actualPath };
  }
  const expectedBuffer = await readFileSafe(expectedPath);
  if (!expectedBuffer) {
    return { matched: false, reason: "missing-file", path: expectedPath };
  }

  const actual = PNG.sync.read(actualBuffer);
  const expected = PNG.sync.read(expectedBuffer);

  if (actual.width !== expected.width || actual.height !== expected.height) {
    return {
      matched: false,
      reason: "size-mismatch",
      actualSize: { width: actual.width, height: actual.height },
      expectedSize: { width: expected.width, height: expected.height },
    };
  }

  const { width, height } = actual;
  const totalPixels = width * height;
  const diffOutput = options.diffOutputPath ? new PNG({ width, height }) : null;
  const threshold = options.threshold ?? 0.1;
  const maxDiffPixels = options.maxDiffPixels ?? 0;

  const diffPixels = pixelmatch(
    actual.data,
    expected.data,
    diffOutput?.data,
    width,
    height,
    { threshold },
  );

  if (diffOutput && options.diffOutputPath) {
    await writeFile(options.diffOutputPath, PNG.sync.write(diffOutput));
  }

  if (diffPixels <= maxDiffPixels) {
    return { matched: true, diffPixels: 0, totalPixels };
  }

  return {
    matched: false,
    diffPixels,
    totalPixels,
    ...(options.diffOutputPath ? { diffPath: options.diffOutputPath } : {}),
  };
}

async function readFileSafe(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if (isNodeFsError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function isNodeFsError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && typeof (value as NodeJS.ErrnoException).code === "string";
}
