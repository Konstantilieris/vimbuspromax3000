import { stat } from "node:fs/promises";
import type { AxeResults, RunOptions as AxeRunOptions } from "axe-core";

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

export type BrowserNavigationResult = {
  url: string;
  title: string;
  status: number | null;
};

export type RunAxeInput = {
  url: string;
  viewport?: ViewportSize;
  browserExecutablePath?: string;
  axeOptions?: AxeRunOptions;
};

export type RunAxeResult = {
  url: string;
  violations: AxeResults["violations"];
  violationCount: number;
};

export async function navigateBrowser(input: {
  url: string;
  viewport?: ViewportSize;
  browserExecutablePath?: string;
}): Promise<BrowserNavigationResult> {
  return withChromiumPage(input, async (page) => {
    const response = await page.goto(input.url, { waitUntil: "load" });

    return {
      url: page.url(),
      title: await page.title(),
      status: response?.status() ?? null,
    };
  });
}

export async function captureScreenshot(input: CaptureScreenshotInput): Promise<CaptureScreenshotResult> {
  const viewport = input.viewport ?? { width: 1280, height: 720 };
  const fullPage = input.fullPage ?? false;

  await withChromiumPage(
    {
      url: input.url,
      viewport,
      browserExecutablePath: input.browserExecutablePath,
    },
    async (page) => {
      await page.goto(input.url, { waitUntil: "load" });
      await page.screenshot({ path: input.outputPath, fullPage });
    },
  );

  const fileStat = await stat(input.outputPath);

  return {
    path: input.outputPath,
    viewport,
    bytes: fileStat.size,
  };
}

export async function runAxe(input: RunAxeInput): Promise<RunAxeResult> {
  return withChromiumPage(input, async (page) => {
    await page.goto(input.url, { waitUntil: "load" });
    const axe = await import("axe-core");
    const source = axe.source;

    await page.addScriptTag({ content: source });
    const result = await page.evaluate(
      async (options) => {
        const axeRuntime = (globalThis as unknown as { axe?: { run: (options?: unknown) => Promise<AxeResults> } }).axe;
        if (!axeRuntime) {
          throw new Error("axe-core did not load in the browser page.");
        }
        return axeRuntime.run(options);
      },
      input.axeOptions ?? {},
    );

    return {
      url: page.url(),
      violations: result.violations,
      violationCount: result.violations.length,
    };
  });
}

type PlaywrightPage = Awaited<
  ReturnType<Awaited<ReturnType<typeof import("playwright-core")["chromium"]["launch"]>>["newPage"]>
>;

async function withChromiumPage<T>(
  input: { url: string; viewport?: ViewportSize; browserExecutablePath?: string },
  callback: (page: PlaywrightPage) => Promise<T>,
): Promise<T> {
  const viewport = input.viewport ?? { width: 1280, height: 720 };

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
    return await callback(page);
  } finally {
    try {
      await context?.close();
    } finally {
      await browser.close();
    }
  }
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
