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

  const properties = schema.properties ?? {};
  const unknownFields = Object.keys(record).filter((field) => !(field in properties));

  if (unknownFields.length > 0) {
    throw new McpValidationError(
      `Unknown fields: ${unknownFields.join(", ")}.`,
      unknownFields,
    );
  }

  const invalidFields: string[] = [];

  for (const [field, value] of Object.entries(record)) {
    if (value === undefined || value === null) {
      continue;
    }

    const expectedType = properties[field]?.type;

    if (!expectedType) {
      continue;
    }

    if (!matchesJsonSchemaType(value, expectedType)) {
      invalidFields.push(field);
    }
  }

  if (invalidFields.length > 0) {
    throw new McpValidationError(
      `Invalid field types: ${invalidFields.join(", ")}.`,
      invalidFields,
    );
  }

  return record;
}

function matchesJsonSchemaType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return Number.isInteger(value);
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    default:
      return true;
  }
}
