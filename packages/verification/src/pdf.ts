import { readFile } from "node:fs/promises";

// Pixel-diff of rendered PDF pages is deferred; this module only compares
// page count and concatenated text content, which is enough to detect most
// content drift without requiring a canvas backend.

export type PdfMetadata = {
  pageCount: number;
  textContent: string;
  bytes: number;
};

export type PdfDiffOptions = {
  textSimilarityThreshold?: number;
};

export type PdfDiffResult = {
  matched: boolean;
  pageCountMatch: boolean;
  textSimilarity: number;
  actualPageCount: number;
  expectedPageCount: number;
};

export async function readPdfMetadata(path: string): Promise<PdfMetadata> {
  const data = await readFile(path);
  // The legacy build skips browser-only features (canvas/worker) so it loads cleanly under Node/Bun.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(data),
    isEvalSupported: false,
  });
  const doc = await loadingTask.promise;

  const pageTexts: string[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: unknown) =>
        typeof item === "object" && item !== null && "str" in item ? String((item as { str: string }).str) : "",
      )
      .join(" ");
    pageTexts.push(pageText);
  }

  const pageCount = doc.numPages;
  await doc.destroy();

  return {
    pageCount,
    textContent: pageTexts.join("\n").trim(),
    bytes: data.length,
  };
}

export async function comparePdfMetadata(
  actualPath: string,
  expectedPath: string,
  options: PdfDiffOptions = {},
): Promise<PdfDiffResult> {
  const [actual, expected] = await Promise.all([readPdfMetadata(actualPath), readPdfMetadata(expectedPath)]);
  return diffPdfMetadata(actual, expected, options);
}

export function diffPdfMetadata(
  actual: PdfMetadata,
  expected: PdfMetadata,
  options: PdfDiffOptions = {},
): PdfDiffResult {
  const pageCountMatch = actual.pageCount === expected.pageCount;
  const textSimilarity = jaccardSimilarity(actual.textContent, expected.textContent);
  const threshold = options.textSimilarityThreshold ?? 1;

  return {
    matched: pageCountMatch && textSimilarity >= threshold,
    pageCountMatch,
    textSimilarity,
    actualPageCount: actual.pageCount,
    expectedPageCount: expected.pageCount,
  };
}

function jaccardSimilarity(a: string, b: string): number {
  if (a === b) {
    return 1;
  }
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 && tokensB.size === 0) {
    return 1;
  }

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      intersection += 1;
    }
  }
  const unionSize = tokensA.size + tokensB.size - intersection;
  return unionSize === 0 ? 1 : intersection / unionSize;
}

function tokenize(text: string): Set<string> {
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(tokens);
}
