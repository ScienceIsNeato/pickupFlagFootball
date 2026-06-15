/**
 * One-shot seed: download the Census ZCTA 2023 Gazetteer and populate zip_centroids.
 * Usage: node --env-file=.env.local scripts/seed-zip-centroids.mjs
 */

import https from "https";
import { inflateRawSync } from "zlib";
import pg from "pg";

const DB_URL = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!DB_URL) { console.error("DATABASE_URL_UNPOOLED not set"); process.exit(1); }

const CENSUS_URL =
  "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.zip";

async function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        downloadBuffer(res.headers.location).then(resolve).catch(reject);
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

// Minimal ZIP parser — extract the first file from the archive
function extractFirstFile(buf) {
  let offset = 0;
  while (offset < buf.length - 4) {
    if (buf[offset] === 0x50 && buf[offset+1] === 0x4b &&
        buf[offset+2] === 0x03 && buf[offset+3] === 0x04) {
      const method  = buf.readUInt16LE(offset + 8);
      const compSize = buf.readUInt32LE(offset + 18);
      const fnLen   = buf.readUInt16LE(offset + 26);
      const extraLen = buf.readUInt16LE(offset + 28);
      const dataStart = offset + 30 + fnLen + extraLen;
      const compressed = buf.slice(dataStart, dataStart + compSize);
      if (method === 0) return compressed;           // stored
      if (method === 8) return inflateRawSync(compressed); // deflate
      throw new Error("Unsupported ZIP method: " + method);
    }
    offset++;
  }
  throw new Error("No local file header found in ZIP");
}

// Census ZCTA header: GEOID  NAME  ALAND  AWATER  ALAND_SQMI  AWATER_SQMI  INTPTLAT  INTPTLONG
function parseCensus(tsv) {
  const lines = tsv.split("\n");
  const header = lines[0].split("\t").map(h => h.trim());
  const zipIdx = header.findIndex(h => h === "GEOID");
  const latIdx = header.findIndex(h => h === "INTPTLAT");
  const lngIdx = header.findIndex(h => h === "INTPTLONG");
  if (zipIdx < 0 || latIdx < 0 || lngIdx < 0) {
    throw new Error("Unexpected Census header: " + header.join(", "));
  }
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("\t");
    if (cols.length < 3) continue;
    const zip = cols[zipIdx]?.trim();
    const lat = parseFloat(cols[latIdx]);
    const lng = parseFloat(cols[lngIdx]);
    if (!zip || isNaN(lat) || isNaN(lng)) continue;
    rows.push({ zip, lat, lng });
  }
  return rows;
}

async function seed(rows) {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  await client.query("TRUNCATE zip_centroids");

  const BATCH = 1000;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const vals = batch.map((_, j) => `($${j*3+1}, $${j*3+2}, $${j*3+3})`).join(", ");
    const params = batch.flatMap(r => [r.zip, r.lat, r.lng]);
    await client.query(
      `INSERT INTO zip_centroids (zip, lat, lng) VALUES ${vals} ON CONFLICT DO NOTHING`,
      params
    );
    inserted += batch.length;
    process.stdout.write(`\r  seeded ${inserted}/${rows.length}`);
  }
  console.log(`\n  done: ${inserted} rows`);
  await client.end();
}

(async () => {
  console.log("downloading Census ZCTA gazetteer...");
  const buf = await downloadBuffer(CENSUS_URL);
  console.log(`  got ${(buf.length/1024).toFixed(0)} KB`);
  console.log("extracting...");
  const tsv = extractFirstFile(buf).toString("utf8");
  console.log("parsing...");
  const rows = parseCensus(tsv);
  console.log(`  ${rows.length} ZIP codes`);
  console.log("seeding zip_centroids...");
  await seed(rows);
})();
