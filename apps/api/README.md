# API Notes

## Local Postgres for tests and smokes

The canonical local Postgres for both `bun run test:postgres` and the manual
two-process smoke below is the `postgres` service in the repo-root
`docker-compose.yml`. It binds `127.0.0.1:55432` and seeds the
`taskgoblin/taskgoblin/taskgoblin` user / password / database.

```bash
docker compose up -d --wait postgres
export DATABASE_URL="postgres://taskgoblin:taskgoblin@127.0.0.1:55432/taskgoblin?schema=public"
docker compose down   # when you're finished
```

`bun run test:postgres` brings the service up, pushes the schema, runs the
smoke, and tears the service down on its own. The two-process smoke below
expects you to leave the service running while the API processes are up.

## Manual two-process LoopEventBus smoke

Use this when changing `VIMBUS_LOOP_BUS` wiring or the Postgres bus adapter.

1. Install dependencies and point the API at the local docker-compose Postgres:

   ```bash
   bun install
   docker compose up -d --wait postgres
   export DATABASE_URL="postgres://taskgoblin:taskgoblin@127.0.0.1:55432/taskgoblin?schema=public"
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
