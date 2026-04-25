import type { EvalContext, JudgeGenerator } from "../types";
import { evaluateToolUsageQuality } from "./tool-usage-quality";

describe("evaluateToolUsageQuality", () => {
  test("scores missing MCP evidence as a visible failed dimension", async () => {
    const generator: JudgeGenerator = async () => {
      throw new Error("LLM judge should not run without MCP calls.");
    };

    const result = await evaluateToolUsageQuality(
      { mcpCalls: [] } as unknown as EvalContext,
      null,
      generator,
      "mock-model",
    );

    expect(result.dimension).toBe("tool_usage_quality");
    expect(result.score).toBe(0);
    expect(result.verdict).toBe("fail");
    expect(result.reasoning).toContain("No MCP tool-use evidence");
    expect(JSON.parse(result.evidenceJson ?? "{}")).toMatchObject({
      finalScore: 0,
      totalCalls: 0,
      missingToolUseEvidence: true,
    });
  });
});
