import { stat } from "node:fs/promises";

export class BrowserNotInstalledError extends Error {
  override readonly name = "BrowserNotInstalledError";

  constructor(cause?: unknown) {
    super(
      "Playwright Chromium is not installed. Install it with `npx playwright install chromium` before running visual capture.",
      cause instanceof Error ? { cause } : undefined,
    );
  }
}

export type ViewportSize = { width: number; height: number };

export type CaptureScreenshotInput = {
  url: string;
  outputPath: string;
  viewport?: ViewportSize;
  fullPage?: boolean;
  browserExecutablePath?: string;
};

export type CaptureScreenshotResult = {
  path: string;
  viewport: ViewportSize;
  bytes: number;
};

export async function captureScreenshot(input: CaptureScreenshotInput): Promise<CaptureScreenshotResult> {
  const viewport = input.viewport ?? { width: 1280, height: 720 };
  const fullPage = input.fullPage ?? false;

  // Lazy-load so importing this module does not require Playwright browsers to be installed.
  const { chromium } = await import("playwright-core");

  let browser;
  try {
    browser = await chromium.launch({
      executablePath: input.browserExecutablePath,
    });
  } catch (error) {
    throw new BrowserNotInstalledError(error);
  }

  try {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.goto(input.url, { waitUntil: "load" });
    await page.screenshot({ path: input.outputPath, fullPage });
  } finally {
    await browser.close();
  }

  const fileStat = await stat(input.outputPath);

  return {
    path: input.outputPath,
    viewport,
    bytes: fileStat.size,
  };
}
