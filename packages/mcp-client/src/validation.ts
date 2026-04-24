export class McpValidationError extends Error {
  constructor(
    message: string,
    public readonly fields: string[],
  ) {
    super(message);
    this.name = "McpValidationError";
  }
}

type JsonSchema = {
  type?: string;
  properties?: Record<string, { type?: string; description?: string }>;
  required?: string[];
};

export function validateToolArguments(inputSchemaJson: string, args: unknown): Record<string, unknown> {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    throw new McpValidationError("Tool arguments must be a plain object.", []);
  }

  let schema: JsonSchema;
  try {
    schema = JSON.parse(inputSchemaJson) as JsonSchema;
  } catch {
    throw new McpValidationError("Tool has malformed inputSchemaJson.", []);
  }

  const record = args as Record<string, unknown>;
  const missingFields: string[] = [];

  for (const field of schema.required ?? []) {
    if (!(field in record) || record[field] === undefined || record[field] === null) {
      missingFields.push(field);
    }
  }

  if (missingFields.length > 0) {
    throw new McpValidationError(
      `Missing required fields: ${missingFields.join(", ")}.`,
      missingFields,
    );
  }

  return record;
}
