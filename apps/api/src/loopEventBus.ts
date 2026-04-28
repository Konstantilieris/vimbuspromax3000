import {
  buildLoopEventBus,
  resetDefaultLoopEventBus,
  type LoopEventBus,
  type LoopEventBusEnv,
  type PostgresNotifyClient,
} from "@vimbuspromax3000/db";

type ApiLoopEventBusEnv = LoopEventBusEnv & {
  DATABASE_URL?: string;
};

type PgModule = {
  Client: new (config: { connectionString: string }) => PostgresNotifyClient;
};

export type ApiLoopEventBusOptions = {
  env?: ApiLoopEventBusEnv;
  importPg?: () => Promise<PgModule>;
};

function getLoopBusMode(env: ApiLoopEventBusEnv): "postgres" | "memory" {
  return env.VIMBUS_LOOP_BUS?.trim().toLowerCase() === "postgres" ? "postgres" : "memory";
}

async function importPgModule(): Promise<PgModule> {
  const moduleName = "pg";
  return (await import(moduleName)) as PgModule;
}

export async function buildApiLoopEventBus(
  options: ApiLoopEventBusOptions = {},
): Promise<LoopEventBus> {
  const env = options.env ?? (process.env as unknown as ApiLoopEventBusEnv);
  const mode = getLoopBusMode(env);

  if (mode !== "postgres") {
    return buildLoopEventBus({ env: { VIMBUS_LOOP_BUS: "memory" } });
  }

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("VIM-46: VIMBUS_LOOP_BUS=postgres requires DATABASE_URL.");
  }

  const importPg = options.importPg ?? importPgModule;
  return buildLoopEventBus({
    env: { VIMBUS_LOOP_BUS: "postgres" },
    postgres: {
      connect: async () => {
        const { Client } = await importPg();
        return new Client({ connectionString: databaseUrl });
      },
    },
  });
}

export async function installDefaultLoopEventBus(
  options: ApiLoopEventBusOptions = {},
): Promise<LoopEventBus> {
  const bus = await buildApiLoopEventBus(options);
  resetDefaultLoopEventBus(bus);
  return bus;
}
