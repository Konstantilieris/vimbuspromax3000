import { getModelCapabilities, hasModelCapabilities } from "./index";

const model = {
  supportsTools: true,
  supportsVision: false,
  supportsJson: true,
  supportsStreaming: true,
};

describe("model registry capability helpers", () => {
  test("extracts declared model capabilities", () => {
    expect(getModelCapabilities(model)).toEqual(["tools", "json", "streaming"]);
  });

  test("checks required capabilities", () => {
    expect(hasModelCapabilities(model, ["tools", "json"])).toBe(true);
    expect(hasModelCapabilities(model, ["vision"])).toBe(false);
  });
});
