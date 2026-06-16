import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

/**
 * Transaction-capable DB client.
 *
 * The default client (lib/db) uses neon-http, which is one-shot: every query is
 * its own HTTP request, so it can't hold an interactive (read → compute → write)
 * transaction open. The MIME engine needs exactly that — closing a window or
 * sparking a formation is several dependent writes that must commit all-or-
 * nothing — so it runs on this pooled WebSocket connection instead, where
 * `txnDb.transaction(...)` is a real Postgres transaction with rollback.
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

// Node 21+ ships a global WHATWG WebSocket; the neon serverless driver can use
// it directly, so we avoid pulling in the `ws` package. Only set it once.
if (!neonConfig.webSocketConstructor && typeof WebSocket !== "undefined") {
  neonConfig.webSocketConstructor = WebSocket as unknown as typeof neonConfig.webSocketConstructor;
}

const pool = new Pool({ connectionString });
export const txnDb = drizzle({ client: pool, schema });
