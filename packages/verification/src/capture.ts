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
  type Browser = Awaited<ReturnType<typeof chromium.launch>>;
  type BrowserContext = Awaited<ReturnType<Browser["newContext"]>>;

  let browser: Browser;
  try {
    browser = await chromium.launch({
      executablePath: input.browserExecutablePath,
    });
  } catch (error) {
    if (isBrowserMissingError(error)) {
      throw new BrowserNotInstalledError(error);
    }
    throw error;
  }

  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.goto(input.url, { waitUntil: "load" });
    await page.screenshot({ path: input.outputPath, fullPage });
  } finally {
    try {
      await context?.close();
    } finally {
      await browser.close();
    }
  }

  const fileStat = await stat(input.outputPath);

  return {
    path: input.outputPath,
    viewport,
    bytes: fileStat.size,
  };
}

function isBrowserMissingError(error: unknown): boolean {
  if (!isNodeError(error)) {
    return false;
  }

  if (error.code === "ENOENT") {
    return true;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("executable doesn't exist") ||
    message.includes("executable does not exist") ||
    message.includes("executable not found") ||
    message.includes("browser executable not found") ||
    message.includes("please run the following command to download new browsers")
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
