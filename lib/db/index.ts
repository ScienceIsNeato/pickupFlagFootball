import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

// HTTP (one-shot) client — fine for route handlers/server actions. Transactions
// (the engine) will use a WebSocket pool added in a later phase.
const sql = neon(connectionString);
export const db = drizzle({ client: sql, schema });
