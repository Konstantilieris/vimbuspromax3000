import { createAnthropic } from "@ai-sdk/anthropic";
import { createGateway, gateway as defaultGateway } from "@ai-sdk/gateway";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ModelProviderKind, ResolvedModelSnapshot } from "@vimbuspromax3000/shared";

export type AiSdkRuntimeProviderConfig = {
  providerKind: ModelProviderKind;
  providerKey: string;
  modelSlug: string;
  baseUrl?: string | null;
  apiKey?: string;
};

export type ResolvedAiSdkModelConfig = {
  source: "policy_resolution";
  snapshot: ResolvedModelSnapshot;
  provider: AiSdkRuntimeProviderConfig;
};

export function createAiSdkLanguageModel(config: ResolvedAiSdkModelConfig): unknown {
  const provider = config.provider;

  switch (provider.providerKind) {
    case "gateway":
      return createGatewayModel(provider);
    case "openai":
      return createOpenAI({
        apiKey: provider.apiKey,
        baseURL: provider.baseUrl ?? undefined,
      })(provider.modelSlug);
    case "anthropic":
      return createAnthropic({
        apiKey: provider.apiKey,
        baseURL: provider.baseUrl ?? undefined,
      })(provider.modelSlug);
    case "openai_compatible":
      return createOpenAICompatible({
        name: provider.providerKey,
        apiKey: provider.apiKey,
        baseURL: requireBaseUrl(provider),
      })(provider.modelSlug);
    case "ollama":
      return createOpenAICompatible({
        name: provider.providerKey,
        apiKey: provider.apiKey,
        baseURL: provider.baseUrl ?? "http://localhost:11434/v1",
      })(provider.modelSlug);
  }
}

export function toRuntimeProviderConfig(
  snapshot: ResolvedModelSnapshot,
  provider: {
    baseUrl?: string | null;
    apiKey?: string;
  },
): ResolvedAiSdkModelConfig {
  return {
    source: "policy_resolution",
    snapshot,
    provider: {
      providerKind: snapshot.providerKind,
      providerKey: snapshot.providerKey,
      modelSlug: snapshot.modelSlug,
      baseUrl: provider.baseUrl ?? null,
      apiKey: provider.apiKey,
    },
  };
}

export function formatConcreteModelName(providerKey: string, modelSlug: string): string {
  return `${providerKey}:${modelSlug}`;
}

function createGatewayModel(provider: AiSdkRuntimeProviderConfig) {
  if (provider.apiKey || provider.baseUrl) {
    return createGateway({
      apiKey: provider.apiKey,
      baseURL: provider.baseUrl ?? undefined,
    })(provider.modelSlug);
  }

  return defaultGateway(provider.modelSlug);
}

function requireBaseUrl(provider: AiSdkRuntimeProviderConfig): string {
  if (!provider.baseUrl) {
    throw new Error(`Provider ${provider.providerKey} requires a baseUrl.`);
  }

  return provider.baseUrl;
}
