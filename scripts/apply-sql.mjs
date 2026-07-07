// Apply a .sql file to the database (direct/unpooled connection).
// Usage: node --env-file=.env.local scripts/apply-sql.mjs <file.sql>
import { readFileSync } from "node:fs";
import pg from "pg";

const file = process.argv[2];
if (!file) {
  console.error("usage: apply-sql.mjs <file.sql>");
  process.exit(1);
}
const sql = readFileSync(file, "utf8");
const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL_UNPOOLED / DATABASE_URL not set");
  process.exit(1);
}

const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query(sql);
  console.log(`applied ${file}`);
} finally {
  await client.end();
}
