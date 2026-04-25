import { jsonSchema } from "ai";

export const JUDGE_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["score", "reason"],
  properties: {
    score: {
      type: "integer",
      minimum: 0,
      maximum: 100,
      description: "Score 0-100. 90-100: excellent. 75-89: acceptable. 60-74: weak/warn. <60: unacceptable.",
    },
    reason: {
      type: "string",
      description: "Concise reasoning for the score, referencing specific evidence.",
    },
  },
};

export const judgeOutputSchema = jsonSchema<{ score: number; reason: string }>(JUDGE_OUTPUT_JSON_SCHEMA);
