# API Notes

## Manual two-process LoopEventBus smoke

Use this when changing `VIMBUS_LOOP_BUS` wiring or the Postgres bus adapter.

1. Install dependencies and point the API at a Postgres database:

   ```bash
   bun install
   export DATABASE_URL="postgres://user:password@localhost:5432/vimbus"
   export VIMBUS_LOOP_BUS=postgres
   ```

2. Start two API processes against the same `DATABASE_URL`:

   ```bash
   PORT=3000 bun --filter @vimbuspromax3000/api start
   PORT=3001 bun --filter @vimbuspromax3000/api start
   ```

3. Create a project through either process and copy the returned `id`:

   ```bash
   curl -s -X POST http://localhost:3001/projects \
     -H "content-type: application/json" \
     -d '{"name":"Bus Smoke","rootPath":"C:/tmp/vimbus-smoke","baseBranch":"main"}'
   ```

4. Open an SSE stream against process A:

   ```bash
   curl -N "http://localhost:3000/events?projectId=<project-id>&stream=sse"
   ```

5. In another terminal, trigger a loop event through process B:

   ```bash
   curl -s -X POST http://localhost:3001/planner/runs \
     -H "content-type: application/json" \
     -d '{"projectId":"<project-id>","goal":"smoke cross-process bus"}'
   ```

The SSE terminal connected to port `3000` should print `event: planner.started`
for the event written through port `3001`. Unset `VIMBUS_LOOP_BUS` or set it to
any value other than `postgres` to use the in-process bus instead.
