import app from "./app";

const port = Number(process.env.PORT ?? 3000);

Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(`VimbusProMax3000 API listening on http://localhost:${port}`);
