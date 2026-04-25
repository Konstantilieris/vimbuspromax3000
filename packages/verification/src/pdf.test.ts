import { describe, expect, it } from "vitest";
import { diffPdfMetadata, type PdfMetadata } from "./pdf";

const baseMeta = (overrides: Partial<PdfMetadata>): PdfMetadata => ({
  pageCount: 1,
  textContent: "",
  bytes: 0,
  ...overrides,
});

describe("diffPdfMetadata", () => {
  it("matches when page count and text are identical", () => {
    const result = diffPdfMetadata(
      baseMeta({ pageCount: 2, textContent: "hello world" }),
      baseMeta({ pageCount: 2, textContent: "hello world" }),
    );

    expect(result).toEqual({
      matched: true,
      pageCountMatch: true,
      textSimilarity: 1,
      actualPageCount: 2,
      expectedPageCount: 2,
    });
  });

  it("fails when page counts differ", () => {
    const result = diffPdfMetadata(
      baseMeta({ pageCount: 1, textContent: "alpha" }),
      baseMeta({ pageCount: 2, textContent: "alpha" }),
    );

    expect(result.matched).toBe(false);
    expect(result.pageCountMatch).toBe(false);
    expect(result.actualPageCount).toBe(1);
    expect(result.expectedPageCount).toBe(2);
  });

  it("computes a similarity below 1 when text drifts", () => {
    const result = diffPdfMetadata(
      baseMeta({ textContent: "alpha bravo charlie" }),
      baseMeta({ textContent: "alpha bravo delta" }),
    );

    expect(result.matched).toBe(false);
    expect(result.textSimilarity).toBeGreaterThan(0);
    expect(result.textSimilarity).toBeLessThan(1);
  });

  it("treats two empty PDFs as fully similar", () => {
    const result = diffPdfMetadata(baseMeta({ textContent: "" }), baseMeta({ textContent: "" }));

    expect(result.matched).toBe(true);
    expect(result.textSimilarity).toBe(1);
  });

  it("honors a custom similarity threshold", () => {
    const result = diffPdfMetadata(
      baseMeta({ textContent: "alpha bravo charlie" }),
      baseMeta({ textContent: "alpha bravo delta" }),
      { textSimilarityThreshold: 0.4 },
    );

    expect(result.matched).toBe(true);
  });
});
