import { join } from "node:path";
import { resolveClaudeConfigDir, type ResolveClaudeOptions } from "@vimbuspromax3000/model-registry";

export const VIMBUS_STATE_FILENAME = "vimbus.state.json";

export function resolveVimbusStatePath(opts: ResolveClaudeOptions = {}): string {
  return join(resolveClaudeConfigDir(opts), VIMBUS_STATE_FILENAME);
}
