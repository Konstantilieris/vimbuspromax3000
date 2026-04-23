import { formatConcreteModelName, toRuntimeProviderConfig } from "./index";
import type { ResolvedModelSnapshot } from "@vimbuspromax3000/shared";

const snapshot: ResolvedModelSnapshot = {
  slotKey: "executor_default",
  providerId: "provider_1",
  providerKey: "openai",
  providerKind: "openai",
  modelId: "model_1",
  modelName: "GPT",
  modelSlug: "gpt-5.4",
  concreteModelName: "openai:gpt-5.4",
  usedFallback: false,
  requiredCapabilities: ["tools", "json"],
};

describe("agent AI SDK runtime config", () => {
  test("formats concrete model names deterministically", () => {
    expect(formatConcreteModelName("openai", "gpt-5.4")).toBe("openai:gpt-5.4");
  });

  test("builds runtime config from a policy snapshot", () => {
    const config = toRuntimeProviderConfig(snapshot, {
      apiKey: "not-a-real-key",
      baseUrl: null,
    });

    expect(config.source).toBe("policy_resolution");
    expect(config.provider.providerKind).toBe("openai");
    expect(config.provider.modelSlug).toBe("gpt-5.4");
  });
});
