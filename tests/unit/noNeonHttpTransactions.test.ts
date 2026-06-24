import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Regression guard for a sneaky class of bug: the default `db` (lib/db) is the
// neon-http driver, which is one-shot and THROWS "No transactions support in
// neon-http driver" on an interactive transaction. It works in e2e (which runs
// the pg driver, where transactions are supported), so the failure only shows up
// live against Neon. Interactive transactions must use the pooled `txnDb`
// (lib/db/pool) instead. This bit captain-actions' pause/retire in prod.
//
// Rule: a file that imports the http `db` from "@/lib/db" must not call
// `db.transaction(...)`. (The engine takes its client as a param, so it doesn't
// import `db` here and is correctly ignored.)

const ROOTS = ["app", "lib"];
const importsHttpDb = /import\s*\{[^}]*\bdb\b[^}]*\}\s*from\s*["']@\/lib\/db["']/;
const dbTransaction = /(?<![\w.])db\.transaction\s*\(/;

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
}

test("no neon-http db.transaction() — interactive transactions must use txnDb", () => {
  const files: string[] = [];
  for (const r of ROOTS) walk(r, files);
  const offenders: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    if (!importsHttpDb.test(src)) continue;
    src.split("\n").forEach((line, i) => {
      if (dbTransaction.test(line)) offenders.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `These import the one-shot neon-http \`db\` and call \`db.transaction()\`, which throws against Neon. ` +
      `Use \`txnDb\` from "@/lib/db/pool":\n${offenders.join("\n")}`,
  );
});
