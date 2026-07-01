import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "@/lib/db/schema";

const here = dirname(fileURLToPath(import.meta.url));
const DB_DIR = resolve(here, "../../../db");
const SCHEMA_SQL = resolve(DB_DIR, "schema.sql");
const MIGRATIONS_DIR = resolve(DB_DIR, "migrations");

export type SimDb = PgliteDatabase<typeof schema>;

/**
 * An embedded Postgres world: real PG16 (pglite/WASM) loaded from the canonical
 * db/schema.sql, so composite FKs, partial unique indexes, GIN, enums and CHECKs
 * are all exercised exactly as in prod. Hermetic — no network, no creds.
 */
export class World {
  readonly pg: PGlite;
  readonly db: SimDb;

  private constructor(pg: PGlite) {
    this.pg = pg;
    this.db = drizzle(pg, { schema });
  }

  static async create(): Promise<World> {
    const pg = new PGlite();
    const world = new World(pg);
    await world.loadSchema();
    await world.seedZips();
    return world;
  }

  /** A small ZIP-centroid fixture so the geo path (zip → centroid → H3) runs
   *  in-process without the 33k-row Census seed. Add scenario-specific ZIPs
   *  with seedZip(). */
  async seedZips() {
    await this.seedZip("52241", "Coralville", "IA", 41.697221, -91.597452);
    await this.seedZip("52240", "Iowa City", "IA", 41.626, -91.503);
    await this.seedZip("80302", "Boulder", "CO", 40.0312, -105.2823);
  }

  async seedZip(zip: string, city: string, state: string, lat: number, lng: number) {
    await this.db
      .insert(schema.zipCentroids)
      .values({ zip, city, state, lat, lng })
      .onConflictDoNothing();
  }

  /** Apply the canonical DDL + ordered migrations. gen_random_uuid() is core in
   *  PG16, so the pgcrypto CREATE EXTENSION line is dropped (pglite has no
   *  contrib by default). */
  private async loadSchema() {
    const strip = (sql: string) => sql.replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;.*$/m, "");
    await this.pg.exec(strip(readFileSync(SCHEMA_SQL, "utf8")));
    if (existsSync(MIGRATIONS_DIR)) {
      for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
        await this.pg.exec(strip(readFileSync(resolve(MIGRATIONS_DIR, f), "utf8")));
      }
    }
  }

  /** Truncate everything except the seeded activity_types row, for a fresh
   *  scenario without paying schema reload cost. */
  async reset() {
    await this.pg.exec(`
      TRUNCATE notifications_sent, game_roster, games, attempt_interest,
        formation_attempts, interest_signals,
        map_aggregates, areas, users RESTART IDENTITY CASCADE;
    `);
  }

  async close() {
    await this.pg.close();
  }
}
