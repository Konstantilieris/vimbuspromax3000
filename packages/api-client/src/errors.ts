export class ApiError extends Error {
  override readonly name: string = "ApiError";
}

export class ApiHttpError extends ApiError {
  override readonly name = "ApiHttpError";
  readonly status: number;
  readonly code?: string;
  readonly body?: unknown;

  constructor(status: number, message: string, opts: { code?: string; body?: unknown } = {}) {
    super(message);
    this.status = status;
    this.code = opts.code;
    this.body = opts.body;
  }
}

export class ApiNetworkError extends ApiError {
  override readonly name = "ApiNetworkError";
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}
