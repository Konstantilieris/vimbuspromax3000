import {
  discoverAnthropicCredentials,
  type DiscoverOptions,
} from "@vimbuspromax3000/model-registry";
import type { AuthStatus } from "../types";

export async function getCredentialsStatus(opts: DiscoverOptions = {}): Promise<AuthStatus> {
  const result = await discoverAnthropicCredentials(opts);
  if (result.found) {
    return { found: true, source: result.source };
  }
  return { found: false, reason: result.reason };
}
