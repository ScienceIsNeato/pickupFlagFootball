import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleNeon, type NeonDatabase } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool as PgPool } from "pg";
import * as schema from "./schema";

/**
 * Transaction-capable DB client.
 *
 * The default client (lib/db) uses neon-http, which is one-shot: every query is
 * its own HTTP request, so it can't hold an interactive (read → compute → write)
 * transaction open. The MIME engine needs exactly that — closing a window or
 * sparking a formation is several dependent writes that must commit all-or-
 * nothing — so it runs on this pooled connection instead, where
 * `txnDb.transaction(...)` is a real Postgres transaction with rollback.
 *
 * Prod uses Neon's WebSocket pool; the e2e tests (DATABASE_DRIVER=node-postgres)
 * use a plain `pg` pool against local Docker Postgres, which gives the same real
 * transactions.
 */
function buildTxnDb(): NeonDatabase<typeof schema> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  // Node 21+ ships a global WHATWG WebSocket; the neon serverless driver can use
  // it directly, so we avoid pulling in the `ws` package. (No effect in pg mode.)
  if (!neonConfig.webSocketConstructor && typeof WebSocket !== "undefined") {
    neonConfig.webSocketConstructor = WebSocket as unknown as typeof neonConfig.webSocketConstructor;
  }
  return (
    process.env.DATABASE_DRIVER === "node-postgres"
      ? drizzlePg(new PgPool({ connectionString }), { schema })
      : drizzleNeon({ client: new NeonPool({ connectionString }), schema })
  ) as unknown as NeonDatabase<typeof schema>;
}

// Built LAZILY on first use, never at module load — so `next build` (no DATABASE_URL
// at build; secrets bind at runtime) can import routes that pull this in without
// opening a pool. The proxy keeps the drizzle API (incl. .transaction) identical.
let _txnDb: NeonDatabase<typeof schema> | undefined;
export const txnDb: NeonDatabase<typeof schema> = new Proxy(
  {} as NeonDatabase<typeof schema>,
  {
    get(_t, prop, receiver) {
      const real = (_txnDb ??= buildTxnDb());
      const value = Reflect.get(real as object, prop, receiver);
      return typeof value === "function" ? value.bind(real) : value;
    },
  },
);
