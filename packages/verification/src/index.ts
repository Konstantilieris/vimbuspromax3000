import { createHash } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export type SourceAssetKind = "image" | "pdf" | "text" | "binary" | "unknown";
export const SOURCE_ASSET_APPROVAL_REQUIRED_STATUS = "proposed" as const;

export type SourceAssetMetadata =
  | {
      kind: "image";
      width: number | null;
      height: number | null;
      format: "png" | "jpeg" | "gif" | "webp" | "unknown";
    }
  | {
      kind: "pdf";
      pageCount: number | null;
    }
  | {
      kind: "text";
      lineCount: number;
      byteOrderMark: boolean;
    }
  | {
      kind: "binary" | "unknown";
    };

export type SourceAssetDescriptor = {
  relativePath: string;
  absolutePath: string;
  kind: SourceAssetKind;
  mimeType: string;
  sha256: string;
  byteLength: number;
  metadata: SourceAssetMetadata;
  status: typeof SOURCE_ASSET_APPROVAL_REQUIRED_STATUS;
  approvalRequired: true;
};

export type IngestSourceAssetInput = {
  projectRoot: string;
  relativePath: string;
};

export type VerificationItemDescriptor = {
  id: string;
  kind: string;
  title: string;
  expectedAssetId?: string | null;
  expectedAssetPath?: string | null;
};

export type VisualResultPlanStatus = "passed" | "failed" | "requires_review";

export type VisualResultPlan = {
  verificationItemId: string;
  kind: "manual-evidence" | "asset-presence";
  status: VisualResultPlanStatus;
  summary: string;
  expectedAssets: SourceAssetReference[];
  evidenceAssets: SourceAssetReference[];
  missingAssets: SourceAssetReference[];
  notes: string[];
};

export type SourceAssetReference = {
  id?: string;
  relativePath?: string;
  sha256?: string;
  mimeType?: string;
  kind?: SourceAssetKind;
};

export type ManualEvidencePlanInput = {
  item: VerificationItemDescriptor;
  evidenceAssets?: readonly SourceAssetReference[];
  note?: string;
};

export type AssetPresencePlanInput = {
  item: VerificationItemDescriptor;
  expectedAssets: readonly SourceAssetReference[];
  availableAssets: readonly SourceAssetReference[];
  note?: string;
};

export async function ingestSourceAsset(input: IngestSourceAssetInput): Promise<SourceAssetDescriptor> {
  const assetPath = await resolveContainedExistingFile(input.projectRoot, input.relativePath);
  const [fileStat, buffer] = await Promise.all([stat(assetPath.absolutePath), readFile(assetPath.absolutePath)]);
  const detection = detectAssetType(buffer, assetPath.relativePath);

  return {
    relativePath: assetPath.relativePath,
    absolutePath: normalizePath(assetPath.absolutePath),
    kind: detection.kind,
    mimeType: detection.mimeType,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    byteLength: fileStat.size,
    metadata: extractAssetMetadata(buffer, detection),
    status: SOURCE_ASSET_APPROVAL_REQUIRED_STATUS,
    approvalRequired: true,
  };
}

export async function resolveContainedExistingFile(projectRoot: string, relativePath: string) {
  const normalizedRoot = await realpath(projectRoot);
  const cleanRelativePath = normalizeRequestedRelativePath(relativePath);
  const candidatePath = resolve(normalizedRoot, cleanRelativePath);
  const candidateRealPath = await realpath(candidatePath);

  assertContainedPath(normalizedRoot, candidateRealPath);

  const entry = await lstat(candidateRealPath);
  if (!entry.isFile()) {
    throw new Error(`Source asset path is not a file: ${cleanRelativePath}`);
  }

  return {
    relativePath: normalizePath(relative(normalizedRoot, candidateRealPath)),
    absolutePath: candidateRealPath,
  };
}

export function detectAssetType(
  buffer: Buffer,
  relativePath = "",
): { kind: SourceAssetKind; mimeType: string } {
  if (isPng(buffer)) {
    return { kind: "image", mimeType: "image/png" };
  }
  if (isJpeg(buffer)) {
    return { kind: "image", mimeType: "image/jpeg" };
  }
  if (isGif(buffer)) {
    return { kind: "image", mimeType: "image/gif" };
  }
  if (isWebp(buffer)) {
    return { kind: "image", mimeType: "image/webp" };
  }
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return { kind: "pdf", mimeType: "application/pdf" };
  }

  const extensionDetection = mimeFromExtension(relativePath);
  if (extensionDetection) {
    return extensionDetection;
  }

  if (isProbablyText(buffer)) {
    return { kind: "text", mimeType: mimeFromTextExtension(relativePath) };
  }

  return { kind: "binary", mimeType: "application/octet-stream" };
}

export function extractAssetMetadata(
  buffer: Buffer,
  detection: { kind: SourceAssetKind; mimeType: string },
): SourceAssetMetadata {
  if (detection.kind === "image") {
    return extractImageMetadata(buffer, detection.mimeType);
  }

  if (detection.kind === "pdf") {
    return {
      kind: "pdf",
      pageCount: countPdfPages(buffer),
    };
  }

  if (detection.kind === "text") {
    return {
      kind: "text",
      lineCount: countTextLines(buffer),
      byteOrderMark: hasUtf8Bom(buffer),
    };
  }

  return {
    kind: detection.kind === "unknown" ? "unknown" : "binary",
  };
}

export function planManualEvidenceResult(input: ManualEvidencePlanInput): VisualResultPlan {
  const evidenceAssets = [...(input.evidenceAssets ?? [])];
  const hasEvidence = evidenceAssets.length > 0;

  return {
    verificationItemId: input.item.id,
    kind: "manual-evidence",
    status: hasEvidence ? "requires_review" : "failed",
    summary: hasEvidence
      ? "Manual evidence was collected and requires operator review."
      : "Manual evidence is required but no evidence asset was provided.",
    expectedAssets: [],
    evidenceAssets,
    missingAssets: [],
    notes: [input.note].filter(isPresent),
  };
}

export function planAssetPresenceResult(input: AssetPresencePlanInput): VisualResultPlan {
  const availableAssets = [...input.availableAssets];
  const expectedAssets = [...input.expectedAssets];
  const missingAssets = expectedAssets.filter((expected) => !hasMatchingAsset(expected, availableAssets));

  return {
    verificationItemId: input.item.id,
    kind: "asset-presence",
    status: missingAssets.length === 0 ? "passed" : "failed",
    summary:
      missingAssets.length === 0
        ? "All expected visual source assets are present."
        : `${missingAssets.length} expected visual source asset(s) are missing.`,
    expectedAssets,
    evidenceAssets: availableAssets,
    missingAssets,
    notes: [input.note].filter(isPresent),
  };
}

export function toAssetReference(asset: SourceAssetDescriptor, id?: string): SourceAssetReference {
  return {
    id,
    relativePath: asset.relativePath,
    sha256: asset.sha256,
    mimeType: asset.mimeType,
    kind: asset.kind,
  };
}

function normalizeRequestedRelativePath(relativePath: string) {
  const trimmed = relativePath.trim();

  if (!trimmed) {
    throw new Error("Source asset relative path is required.");
  }

  if (isAbsolute(trimmed)) {
    throw new Error(`Source asset path must be project-root-relative: ${relativePath}`);
  }

  const normalized = trimmed.replace(/\\/g, "/");
  if (normalized.split("/").some((part) => part === "..")) {
    throw new Error(`Source asset path cannot contain parent traversal: ${relativePath}`);
  }

  return normalized;
}

function assertContainedPath(rootPath: string, candidatePath: string) {
  const pathDiff = relative(rootPath, candidatePath);
  const escapesRoot = pathDiff === ".." || pathDiff.startsWith(`..${sep}`) || isAbsolute(pathDiff);

  if (escapesRoot) {
    throw new Error(`Source asset path must stay inside project root: ${candidatePath}`);
  }
}

function extractImageMetadata(buffer: Buffer, mimeType: string): SourceAssetMetadata {
  if (mimeType === "image/png" && buffer.length >= 24) {
    return {
      kind: "image",
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
      format: "png",
    };
  }

  if (mimeType === "image/gif" && buffer.length >= 10) {
    return {
      kind: "image",
      width: buffer.readUInt16LE(6),
      height: buffer.readUInt16LE(8),
      format: "gif",
    };
  }

  if (mimeType === "image/jpeg") {
    const dimensions = readJpegDimensions(buffer);
    return {
      kind: "image",
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      format: "jpeg",
    };
  }

  if (mimeType === "image/webp") {
    const dimensions = readWebpDimensions(buffer);
    return {
      kind: "image",
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      format: "webp",
    };
  }

  return {
    kind: "image",
    width: null,
    height: null,
    format: "unknown",
  };
}

function readJpegDimensions(buffer: Buffer) {
  let offset = 2;

  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    if (marker === undefined || marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }

    const blockLength = buffer.readUInt16BE(offset + 2);
    if (blockLength < 2 || offset + 2 + blockLength > buffer.length) {
      return null;
    }

    if (isJpegStartOfFrame(marker) && offset + 8 < buffer.length) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + blockLength;
  }

  return null;
}

function readWebpDimensions(buffer: Buffer) {
  if (buffer.length < 30 || !isWebp(buffer)) {
    return null;
  }

  const chunkType = buffer.subarray(12, 16).toString("ascii");

  if (chunkType === "VP8X" && buffer.length >= 30) {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }

  if (chunkType === "VP8 " && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }

  if (chunkType === "VP8L" && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }

  return null;
}

function countPdfPages(buffer: Buffer) {
  const text = buffer.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page\b/g);

  return matches?.length ?? null;
}

function countTextLines(buffer: Buffer) {
  if (buffer.length === 0) {
    return 0;
  }

  const text = buffer.toString("utf8");
  const newlineCount = text.match(/\n/g)?.length ?? 0;

  return text.endsWith("\n") ? newlineCount : newlineCount + 1;
}

function hasMatchingAsset(expected: SourceAssetReference, availableAssets: readonly SourceAssetReference[]) {
  return availableAssets.some((asset) => {
    if (expected.id && asset.id === expected.id) {
      return true;
    }
    if (expected.sha256 && asset.sha256 === expected.sha256) {
      return true;
    }
    if (expected.relativePath && asset.relativePath === expected.relativePath) {
      return true;
    }

    return false;
  });
}

function isJpegStartOfFrame(marker: number) {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function isPng(buffer: Buffer) {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function isJpeg(buffer: Buffer) {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function isGif(buffer: Buffer) {
  const header = buffer.subarray(0, 6).toString("ascii");

  return header === "GIF87a" || header === "GIF89a";
}

function isWebp(buffer: Buffer) {
  return (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

function isProbablyText(buffer: Buffer) {
  if (buffer.length === 0) {
    return true;
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let suspicious = 0;

  for (const byte of sample) {
    if (byte === 0) {
      return false;
    }

    const isControl = byte < 32 && ![0x09, 0x0a, 0x0d, 0x0c, 0x08].includes(byte);
    if (isControl) {
      suspicious += 1;
    }
  }

  return suspicious / sample.length < 0.05;
}

function hasUtf8Bom(buffer: Buffer) {
  return buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
}

function mimeFromTextExtension(relativePath: string) {
  const lowerPath = relativePath.toLowerCase();

  if (lowerPath.endsWith(".json")) {
    return "application/json";
  }
  if (lowerPath.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (lowerPath.endsWith(".html") || lowerPath.endsWith(".htm")) {
    return "text/html";
  }
  if (lowerPath.endsWith(".md")) {
    return "text/markdown";
  }

  return "text/plain";
}

function mimeFromExtension(relativePath: string): { kind: SourceAssetKind; mimeType: string } | null {
  const lowerPath = relativePath.toLowerCase();

  if (lowerPath.endsWith(".png")) {
    return { kind: "image", mimeType: "image/png" };
  }
  if (lowerPath.endsWith(".jpg") || lowerPath.endsWith(".jpeg")) {
    return { kind: "image", mimeType: "image/jpeg" };
  }
  if (lowerPath.endsWith(".gif")) {
    return { kind: "image", mimeType: "image/gif" };
  }
  if (lowerPath.endsWith(".webp")) {
    return { kind: "image", mimeType: "image/webp" };
  }
  if (lowerPath.endsWith(".svg")) {
    return { kind: "image", mimeType: "image/svg+xml" };
  }
  if (lowerPath.endsWith(".pdf")) {
    return { kind: "pdf", mimeType: "application/pdf" };
  }

  return null;
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function normalizePath(path: string) {
  return path.replace(/\\/g, "/");
}
