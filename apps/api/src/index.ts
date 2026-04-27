import { createPrismaClient } from "@vimbuspromax3000/db";
import { createVercelAiSdkAgentGeneratorFactory } from "@vimbuspromax3000/agent";
import { createApp } from "./app";

const port = Number(process.env.PORT ?? 3000);

// VIM-29 Sprint 2: production boot wires the real Vercel AI SDK adapter so
// `POST /tasks/:id/execute` runs the agent loop end-to-end. Tests inject
// their own factory (or `null` to disable) via `createApp` directly.
const prisma = createPrismaClient();
const app = createApp({
  prisma,
  agentGeneratorFactory: createVercelAiSdkAgentGeneratorFactory({
    prisma,
    env: process.env,
  }),
});

Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(`VimbusProMax3000 API listening on http://localhost:${port}`);
