import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleHttp, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool as PgPool } from "pg";
import * as schema from "./schema";

// HTTP (one-shot) client — fine for route handlers/server actions. Transactions
// (the engine) use the WebSocket pool in ./pool.
//
// Default: Neon serverless (prod). The e2e tests set DATABASE_DRIVER=node-postgres
// to run the exact same app code against a local Docker Postgres over the stock
// `pg` driver — drizzle normalizes the query API, so nothing else changes.
function buildDb(): NeonHttpDatabase<typeof schema> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return (
    process.env.DATABASE_DRIVER === "node-postgres"
      ? drizzlePg(new PgPool({ connectionString }), { schema })
      : drizzleHttp({ client: neon(connectionString), schema })
  ) as unknown as NeonHttpDatabase<typeof schema>;
}

// Built LAZILY on first use, never at module load — so `next build` (which has no
// DATABASE_URL; secrets bind at runtime) can import any route that pulls this in
// without trying to open a connection. The proxy keeps the drizzle API identical.
let _db: NeonHttpDatabase<typeof schema> | undefined;
export const db: NeonHttpDatabase<typeof schema> = new Proxy(
  {} as NeonHttpDatabase<typeof schema>,
  {
    get(_t, prop, receiver) {
      const real = (_db ??= buildDb());
      const value = Reflect.get(real as object, prop, receiver);
      return typeof value === "function" ? value.bind(real) : value;
    },
  },
);
