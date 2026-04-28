export const TASKGOBLIN_BROWSER_SERVER_NAME = "taskgoblin-browser";
export const BROWSER_NAVIGATE_TOOL_NAME = "navigate";
export const BROWSER_SCREENSHOT_TOOL_NAME = "screenshot";
export const BROWSER_RUN_AXE_TOOL_NAME = "run_axe";

export const BROWSER_VIEWPORT_SCHEMA = {
  type: "object",
  properties: {
    width: { type: "integer", description: "Viewport width in pixels." },
    height: { type: "integer", description: "Viewport height in pixels." },
  },
  required: ["width", "height"],
  additionalProperties: false,
} as const;

export const BROWSER_NAVIGATE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    url: { type: "string", description: "Absolute http(s), file, or data URL to load." },
    viewport: BROWSER_VIEWPORT_SCHEMA,
    browserExecutablePath: {
      type: "string",
      description: "Optional Chromium executable path for hermetic CI environments.",
    },
  },
  required: ["url"],
  additionalProperties: false,
} as const;

export const BROWSER_SCREENSHOT_INPUT_SCHEMA = {
  type: "object",
  properties: {
    url: { type: "string", description: "Absolute http(s), file, or data URL to capture." },
    outputPath: { type: "string", description: "Path where the PNG screenshot should be written." },
    viewport: BROWSER_VIEWPORT_SCHEMA,
    fullPage: { type: "boolean", description: "Capture the full page instead of the viewport." },
    browserExecutablePath: {
      type: "string",
      description: "Optional Chromium executable path for hermetic CI environments.",
    },
  },
  required: ["url", "outputPath"],
  additionalProperties: false,
} as const;

export const BROWSER_RUN_AXE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    url: { type: "string", description: "Absolute http(s), file, or data URL to audit." },
    viewport: BROWSER_VIEWPORT_SCHEMA,
    browserExecutablePath: {
      type: "string",
      description: "Optional Chromium executable path for hermetic CI environments.",
    },
  },
  required: ["url"],
  additionalProperties: false,
} as const;

export type BrowserViewport = {
  width: number;
  height: number;
};

export type BrowserNavigateInput = {
  url: string;
  viewport?: BrowserViewport;
  browserExecutablePath?: string;
};

export type BrowserScreenshotInput = BrowserNavigateInput & {
  outputPath: string;
  fullPage?: boolean;
};

export type BrowserRunAxeInput = BrowserNavigateInput;

export type BrowserNavigateSuccess = {
  ok: true;
  url: string;
  title: string;
  status: number | null;
};

export type BrowserScreenshotSuccess = {
  ok: true;
  path: string;
  viewport: BrowserViewport;
  bytes: number;
};

export type BrowserAxeViolation = {
  id: string;
  impact?: string | null;
  description?: string;
  help?: string;
  helpUrl?: string;
  nodes?: unknown[];
};

export type BrowserAxeSuccess = {
  ok: true;
  url: string;
  violations: BrowserAxeViolation[];
  violationCount: number;
};

export type BrowserFailure = {
  ok: false;
  code: BrowserWrapperErrorCode;
  message: string;
};

export type BrowserWrapperErrorCode =
  | "INVALID_ARGUMENTS"
  | "BROWSER_NOT_INSTALLED"
  | "NAVIGATION_FAILED"
  | "SCREENSHOT_FAILED"
  | "AXE_FAILED";

export type BrowserNavigateResult = BrowserNavigateSuccess | BrowserFailure;
export type BrowserScreenshotResult = BrowserScreenshotSuccess | BrowserFailure;
export type BrowserRunAxeResult = BrowserAxeSuccess | BrowserFailure;

export type BrowserWrapperRuntime = {
  navigate(input: BrowserNavigateInput): Promise<Omit<BrowserNavigateSuccess, "ok">>;
  screenshot(input: BrowserScreenshotInput): Promise<Omit<BrowserScreenshotSuccess, "ok">>;
  runAxe(input: BrowserRunAxeInput): Promise<Omit<BrowserAxeSuccess, "ok">>;
};

export type BrowserWrapper = {
  readonly serverName: typeof TASKGOBLIN_BROWSER_SERVER_NAME;
  readonly navigateToolName: typeof BROWSER_NAVIGATE_TOOL_NAME;
  readonly screenshotToolName: typeof BROWSER_SCREENSHOT_TOOL_NAME;
  readonly runAxeToolName: typeof BROWSER_RUN_AXE_TOOL_NAME;
  navigate(input: unknown): Promise<BrowserNavigateResult>;
  screenshot(input: unknown): Promise<BrowserScreenshotResult>;
  runAxe(input: unknown): Promise<BrowserRunAxeResult>;
};

class BrowserWrapperInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserWrapperInputError";
  }
}

export function createBrowserWrapper(options: { runtime?: BrowserWrapperRuntime } = {}): BrowserWrapper {
  const runtime = options.runtime ?? createDefaultRuntime();

  return {
    serverName: TASKGOBLIN_BROWSER_SERVER_NAME,
    navigateToolName: BROWSER_NAVIGATE_TOOL_NAME,
    screenshotToolName: BROWSER_SCREENSHOT_TOOL_NAME,
    runAxeToolName: BROWSER_RUN_AXE_TOOL_NAME,

    async navigate(input) {
      try {
        const parsed = parseNavigateInput(input);
        const result = await runtime.navigate(parsed);
        return { ok: true, ...result };
      } catch (error) {
        return toBrowserFailure(error, "NAVIGATION_FAILED");
      }
    },

    async screenshot(input) {
      try {
        const parsed = parseScreenshotInput(input);
        const result = await runtime.screenshot(parsed);
        return { ok: true, ...result };
      } catch (error) {
        return toBrowserFailure(error, "SCREENSHOT_FAILED");
      }
    },

    async runAxe(input) {
      try {
        const parsed = parseNavigateInput(input);
        const result = await runtime.runAxe(parsed);
        return {
          ok: true,
          ...result,
          violationCount: result.violations.length,
        };
      } catch (error) {
        return toBrowserFailure(error, "AXE_FAILED");
      }
    },
  };
}

function parseNavigateInput(input: unknown): BrowserNavigateInput {
  const record = parseObjectInput(input);
  const url = requireString(record, "url");

  return {
    url,
    viewport: parseViewport(record.viewport),
    browserExecutablePath: optionalString(record, "browserExecutablePath"),
  };
}

function parseScreenshotInput(input: unknown): BrowserScreenshotInput {
  const parsed = parseNavigateInput(input);
  const record = parseObjectInput(input);

  return {
    ...parsed,
    outputPath: requireString(record, "outputPath"),
    fullPage: optionalBoolean(record, "fullPage"),
  };
}

function parseObjectInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BrowserWrapperInputError("Browser wrapper arguments must be an object.");
  }

  return input as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, fieldName: string): string {
  const value = record[fieldName];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BrowserWrapperInputError(`${fieldName} must be a non-empty string.`);
  }

  return value;
}

function optionalString(record: Record<string, unknown>, fieldName: string): string | undefined {
  const value = record[fieldName];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BrowserWrapperInputError(`${fieldName} must be a non-empty string.`);
  }

  return value;
}

function optionalBoolean(record: Record<string, unknown>, fieldName: string): boolean | undefined {
  const value = record[fieldName];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new BrowserWrapperInputError(`${fieldName} must be a boolean.`);
  }

  return value;
}

function parseViewport(value: unknown): BrowserViewport | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BrowserWrapperInputError("viewport must be an object.");
  }

  const record = value as Record<string, unknown>;
  const width = record.width;
  const height = record.height;

  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new BrowserWrapperInputError("viewport width and height must be positive integers.");
  }

  return { width, height };
}

function toBrowserFailure(error: unknown, fallbackCode: BrowserWrapperErrorCode): BrowserFailure {
  if (error instanceof BrowserWrapperInputError) {
    return {
      ok: false,
      code: "INVALID_ARGUMENTS",
      message: error.message,
    };
  }

  if (isBrowserNotInstalledError(error)) {
    return {
      ok: false,
      code: "BROWSER_NOT_INSTALLED",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    ok: false,
    code: fallbackCode,
    message: error instanceof Error ? error.message : String(error),
  };
}

function isBrowserNotInstalledError(error: unknown): boolean {
  return error instanceof Error && error.name === "BrowserNotInstalledError";
}

function createDefaultRuntime(): BrowserWrapperRuntime {
  return {
    async navigate(input) {
      const { navigateBrowser } = await import("@vimbuspromax3000/verification");
      return navigateBrowser(input);
    },
    async screenshot(input) {
      const { captureScreenshot } = await import("@vimbuspromax3000/verification");
      return captureScreenshot(input);
    },
    async runAxe(input) {
      const { runAxe } = await import("@vimbuspromax3000/verification");
      return runAxe(input);
    },
  };
}
