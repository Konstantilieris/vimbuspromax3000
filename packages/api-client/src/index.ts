export * from "./errors";
export * from "./types";
export type { FetchLike, RequestContext, RequestOptions } from "./http";
export { request } from "./http";
export { createApiClient } from "./client";
export type { ApiClient, CreateApiClientOptions } from "./client";
export type { TestSlotInput } from "./endpoints/modelSlots";
export type { CreateBranchInput } from "./endpoints/branches";

export { getCredentialsStatus } from "./auth/credentialsStatus";
export { detectClaudeCli } from "@vimbuspromax3000/model-registry";
export type {
  DetectedClaudeCli,
  DetectClaudeCliOptions,
} from "@vimbuspromax3000/model-registry";

export {
  resolveVimbusStatePath,
  VIMBUS_STATE_FILENAME,
} from "./state/configPath";
export { readVimbusState } from "./state/readState";
export type { VimbusState } from "./state/readState";
export { writeVimbusState } from "./state/writeState";
export type {
  WriteVimbusStateInput,
  WriteVimbusStateResult,
} from "./state/writeState";
