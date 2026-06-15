import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { execSync } from "node:child_process";
import { World } from "./harness/world";
import { Sim } from "./harness/sim";
import { registered } from "./harness/registry";
import { writeReport } from "./harness/report";
import type { ScenarioResult, SuiteResult } from "./harness/types";

const here = dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = resolve(here, "scenarios");
const OUT_DIR = resolve(here, "report");
const START_ISO = "2026-06-01T09:00:00-05:00"; // fixed sim epoch (deterministic)
const SEED = 4291;

function engineRef(): string {
  try { return execSync("git rev-parse --short HEAD", { cwd: here }).toString().trim(); }
  catch { return "unknown"; }
}

async function main() {
  // discover + import scenario modules (registers them)
  for (const f of readdirSync(SCENARIO_DIR).filter((f) => f.endsWith(".sim.ts")).sort()) {
    await import(pathToFileURL(resolve(SCENARIO_DIR, f)).href);
  }

  const world = await World.create();
  const results: ScenarioResult[] = [];

  for (const reg of registered()) {
    if (reg.pending) {
      results.push({ name: reg.name, intent: reg.intent, status: "pending", beats: [] });
      console.log(`  ◌ ${reg.name} (pending)`);
      continue;
    }
    await world.reset();
    const sim = new Sim(world, START_ISO);
    await sim.init();
    let error: string | undefined;
    try {
      await reg.body(sim);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const failedAsserts = sim.beats.flatMap((b) => b.asserts).filter((a) => !a.ok).length;
    const status = error || failedAsserts > 0 ? "failed" : "passed";
    results.push({ name: reg.name, intent: reg.intent, status, beats: sim.beats, error });
    const mark = status === "passed" ? "✓" : "✗";
    console.log(`  ${mark} ${reg.name}${error ? ` — ${error}` : failedAsserts ? ` — ${failedAsserts} assert(s) failed` : ""}`);
  }

  await world.close();

  const suite: SuiteResult = {
    seed: SEED, engineRef: engineRef(), startedAt: START_ISO, scenarios: results,
  };
  writeReport(suite, OUT_DIR);

  const failed = results.filter((r) => r.status === "failed").length;
  console.log(`\n  report → ${resolve(OUT_DIR, "index.html")}`);
  console.log(`  ${results.filter((r) => r.status === "passed").length} passed · ${failed} failed · ${results.filter((r) => r.status === "pending").length} pending`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
