import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleHttp, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool as PgPool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

// HTTP (one-shot) client — fine for route handlers/server actions. Transactions
// (the engine) use the WebSocket pool in ./pool.
//
// Default: Neon serverless (prod). The e2e tests set DATABASE_DRIVER=node-postgres
// to run the exact same app code against a local Docker Postgres over the stock
// `pg` driver — drizzle normalizes the query API, so nothing else changes.
export const db: NeonHttpDatabase<typeof schema> = (
  process.env.DATABASE_DRIVER === "node-postgres"
    ? drizzlePg(new PgPool({ connectionString }), { schema })
    : drizzleHttp({ client: neon(connectionString), schema })
) as unknown as NeonHttpDatabase<typeof schema>;
