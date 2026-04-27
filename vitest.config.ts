import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@vimbuspromax3000/db/testing",
        replacement: fileURLToPath(new URL("./packages/db/src/testing.ts", import.meta.url)),
      },
      {
        find: "@vimbuspromax3000/db/client",
        replacement: fileURLToPath(new URL("./packages/db/src/client.ts", import.meta.url)),
      },
      {
        find: "@vimbuspromax3000/db/repositories",
        replacement: fileURLToPath(new URL("./packages/db/src/repositories/index.ts", import.meta.url)),
      },
      {
        find: "@vimbuspromax3000/agent",
        replacement: fileURLToPath(new URL("./packages/agent/src/index.ts", import.meta.url)),
      },
      {
        find: "@vimbuspromax3000/benchmarks",
        replacement: fileURLToPath(new URL("./packages/benchmarks/src/index.ts", import.meta.url)),
      },
      {
        find: "@vimbuspromax3000/db",
        replacement: fileURLToPath(new URL("./packages/db/src/index.ts", import.meta.url)),
      },
      {
        find: "@vimbuspromax3000/evaluator",
        replacement: fileURLToPath(new URL("./packages/evaluator/src/index.ts", import.meta.url)),
      },
      {
        find: "@vimbuspromax3000/mcp-client",
        replacement: fileURLToPath(new URL("./packages/mcp-client/src/index.ts", import.meta.url)),
      },
      {
        find: "@vimbuspromax3000/model-registry",
        replacement: fileURLToPath(new URL("./packages/model-registry/src/index.ts", import.meta.url)),
      },
      {
        find: "@vimbuspromax3000/observability",
        replacement: fileURLToPath(new URL("./packages/observability/src/index.ts", import.meta.url)),
      },
      {
        find: "@vimbuspromax3000/planner",
        replacement: fileURLToPath(new URL("./packages/planner/src/index.ts", import.meta.url)),
      },
      {
        find: "@vimbuspromax3000/policy-engine",
        replacement: fileURLToPath(new URL("./packages/policy-engine/src/index.ts", import.meta.url)),
      },
      {
        find: "@vimbuspromax3000/shared",
        replacement: fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url)),
      },
      {
        find: "@vimbuspromax3000/task-intel",
        replacement: fileURLToPath(new URL("./packages/task-intel/src/index.ts", import.meta.url)),
      },
      {
        find: "@vimbuspromax3000/test-runner",
        replacement: fileURLToPath(new URL("./packages/test-runner/src/index.ts", import.meta.url)),
      },
      {
        find: "@vimbuspromax3000/verification",
        replacement: fileURLToPath(new URL("./packages/verification/src/index.ts", import.meta.url)),
      },
    ],
  },
  test: {
    globals: true,
    include: ["{apps,packages}/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/src/generated/**"],
  },
});
