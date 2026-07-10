import type {
  Reporter,
  TestCase,
  TestResult,
  FullResult,
} from "@playwright/test/reporter";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

type Beat = { title: string; img: string };
type Scenario = {
  feature: string;
  scenario: string;
  device: string; // playwright project — "desktop" | "mobile"
  status: TestResult["status"];
  durationMs: number;
  beats: Beat[];
  error?: string;
};

/**
 * Visual story report. Each Gherkin step is a "beat" with a screenshot attached
 * during the run (see steps/hooks.ts). This reporter pairs every beat back to
 * its step text and writes one self-contained HTML page — read the story top to
 * bottom and watch it happen.
 */
export default class BeatReporter implements Reporter {
  private scenarios: Scenario[] = [];
  private readonly outDir = path.join(process.cwd(), "tests/e2e/report/output");

  onTestEnd(test: TestCase, result: TestResult) {
    const beats: Beat[] = [];
    for (const a of result.attachments) {
      if (!a.name.startsWith("beat:")) continue;
      let buf: Buffer | null = a.body ?? null;
      if (!buf && a.path) {
        try {
          buf = readFileSync(a.path);
        } catch {
          buf = null;
        }
      }
      if (!buf) continue;
      beats.push({
        title: a.name.slice("beat:".length),
        img: `data:${a.contentType};base64,${buf.toString("base64")}`,
      });
    }
    this.scenarios.push({
      feature: test.parent?.title || "Feature",
      scenario: test.title,
      device: test.parent?.project()?.name || "desktop",
      status: result.status,
      durationMs: result.duration,
      beats,
      error: result.error?.message?.replace(/\[[0-9;]*m/g, ""), // strip ANSI
    });
  }

  onEnd(result: FullResult) {
    mkdirSync(this.outDir, { recursive: true });
    const file = path.join(this.outDir, "index.html");
    writeFileSync(file, renderHtml(this.scenarios, result));
    // eslint-disable-next-line no-console
    console.log(`\n📸  Story report → ${file}`);
  }
}

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;"); // also safe inside attribute contexts (alt="…")

function renderHtml(scenarios: Scenario[], result: FullResult): string {
  const byFeature = new Map<string, Scenario[]>();
  for (const s of scenarios) {
    const list = byFeature.get(s.feature) ?? [];
    list.push(s);
    byFeature.set(s.feature, list);
  }
  const passed = scenarios.filter((s) => s.status === "passed").length;
  const failed = scenarios.length - passed;

  const features = [...byFeature.entries()]
    .map(([feature, list]) => {
      // Group the per-device runs (desktop + mobile) of each scenario into one card.
      const byScenario = new Map<string, Scenario[]>();
      for (const s of list) {
        const arr = byScenario.get(s.scenario) ?? [];
        arr.push(s);
        byScenario.set(s.scenario, arr);
      }
      const cards = [...byScenario.values()].map((v) => renderScenario(v)).join("\n");
      return `<section class="feature"><h2>${esc(feature)}</h2>${cards}</section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Story report — pickup flag football</title>
<style>
  :root { --ink:#0f1c14; --green:#16633a; --line:#dfe7e1; --muted:#5b6b61; --bg:#f6f8f6; --pass:#16834a; --fail:#c0392b; }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; color:var(--ink); background:var(--bg); }
  header.top { background:var(--green); color:#fff; padding:22px 28px; }
  header.top h1 { margin:0 0 4px; font-size:20px; }
  header.top .sum { opacity:.9; font-size:13px; }
  .wrap { max-width:1100px; margin:0 auto; padding:24px 28px 60px; }
  .feature > h2 { font-size:17px; margin:30px 0 12px; padding-bottom:8px; border-bottom:2px solid var(--green); }
  .scenario { background:#fff; border:1px solid var(--line); border-radius:10px; margin:0 0 18px; overflow:hidden; }
  /* Scenarios are collapsible (native <details>); collapsed by default, failures auto-open. */
  summary.head { display:flex; align-items:center; gap:10px; padding:12px 16px; cursor:pointer; list-style:none; user-select:none; }
  summary.head::-webkit-details-marker { display:none; }
  summary.head:hover { background:#fafcfa; }
  .scenario[open] > summary.head { border-bottom:1px solid var(--line); }
  .scenario > summary.head .name { font-weight:600; }
  .caret { color:var(--muted); font-size:12px; transition:transform .15s ease; }
  .scenario[open] .caret { transform:rotate(90deg); }
  .controls { margin-top:8px; }
  .controls button { font:12px inherit; color:#fff; background:rgba(255,255,255,.18); border:1px solid rgba(255,255,255,.35); border-radius:6px; padding:3px 10px; cursor:pointer; }
  .controls button:hover { background:rgba(255,255,255,.28); }
  .badge { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; padding:3px 8px; border-radius:20px; color:#fff; }
  .badge.passed { background:var(--pass); } .badge.failed,.badge.timedOut { background:var(--fail); }
  .dur { color:var(--muted); font-size:12px; margin-left:auto; }
  .err { background:#fff4f3; color:var(--fail); border-top:1px solid #f3d6d3; padding:10px 16px; font:12px/1.5 ui-monospace,Menlo,monospace; white-space:pre-wrap; }
  .beats { padding:12px 16px 16px; }
  /* Device column headers — one grid row that shares its column template with
     every beat's screenshot row below, so the labels sit exactly above their
     column. */
  .dcols { display:grid; gap:16px; margin-bottom:12px; }
  .dcol-h { display:flex; align-items:center; gap:8px; font-size:12px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
  .dcol-h .dur { margin-left:0; }
  .beat { margin:0 0 22px; }
  .beat-head { display:flex; align-items:flex-start; gap:10px; margin:0 0 8px; }
  .beat-head .n { width:26px; height:26px; border-radius:50%; background:var(--green); color:#fff; font-size:12px; font-weight:700; display:grid; place-items:center; flex:none; }
  .beat-head .txt { font-weight:500; padding-top:3px; }
  /* The same client, every step, side by side: desktop (landscape) gets more
     width than mobile (portrait). Columns align with .dcols above. */
  .beat-shots { display:grid; gap:16px; align-items:start; }
  .beat-shot { min-width:0; }
  .beat-shot img { max-width:100%; border:1px solid var(--line); border-radius:8px; display:block; cursor:zoom-in; background:#fff; }
  .beat-shot[data-device="mobile"] img { max-width:300px; }
  .beat-missing { color:var(--muted); font-size:12px; padding:24px; text-align:center; border:1px dashed var(--line); border-radius:8px; }
  dialog { border:none; background:transparent; max-width:96vw; max-height:96vh; padding:0; }
  dialog::backdrop { background:rgba(8,16,12,.82); }
  dialog img { max-width:96vw; max-height:96vh; border-radius:8px; }
</style></head>
<body>
<header class="top">
  <h1>pickup flag football — story report</h1>
  <div class="sum">${scenarios.length} scenario(s) · <b>${passed} passed</b>${failed ? ` · <b>${failed} failed</b>` : ""} · overall: ${esc(result.status)}</div>
  <div class="controls"><button id="exp" type="button">expand all</button> <button id="col" type="button">collapse all</button></div>
</header>
<div class="wrap">
${features}
</div>
<dialog id="zoom"><img id="zoomImg" alt="" /></dialog>
<script>
  const dlg = document.getElementById('zoom'), zi = document.getElementById('zoomImg');
  document.querySelectorAll('.beat img').forEach(img => img.addEventListener('click', () => { zi.src = img.src; dlg.showModal(); }));
  dlg.addEventListener('click', () => dlg.close());
  document.getElementById('exp').addEventListener('click', () =>
    document.querySelectorAll('details.scenario').forEach(d => { d.open = true; }));
  // Collapse-all keeps failed scenarios open — they must never be hidden.
  document.getElementById('col').addEventListener('click', () =>
    document.querySelectorAll('details.scenario').forEach(d => { d.open = d.dataset.status !== 'passed'; }));
</script>
</body></html>`;
}

const DEVICE_ORDER = ["desktop", "mobile"];
const DEVICE_LABEL: Record<string, string> = { desktop: "💻 desktop", mobile: "📱 mobile" };

// One card per scenario. The same test runs on each client (desktop + mobile);
// this pairs them beat-for-beat so every step's desktop and mobile screenshots
// sit side by side — one row per Gherkin step, one column per client.
function renderScenario(variants: Scenario[]): string {
  // Collapse retries: keep the final run per device.
  const byDevice = new Map<string, Scenario>();
  for (const v of variants) byDevice.set(v.device, v);
  const sorted = [...byDevice.values()].sort(
    (a, b) => DEVICE_ORDER.indexOf(a.device) - DEVICE_ORDER.indexOf(b.device),
  );
  const name = sorted[0].scenario;
  const anyFailed = sorted.some((v) => v.status !== "passed");
  const status = anyFailed ? "failed" : "passed";
  const totalDur = sorted.reduce((n, v) => n + v.durationMs, 0);
  const openAttr = anyFailed ? " open" : ""; // auto-open failures

  // Shared column template — desktop (landscape) gets more room than mobile
  // (portrait). Both the header row and every beat row use it, so columns line up.
  const cols = sorted.map((v) => (v.device === "mobile" ? "1fr" : "1.6fr")).join(" ");
  const gridStyle = `grid-template-columns:${cols}`;

  const colHeads = sorted
    .map((v) => {
      const badge = v.status === "passed" ? "" : ` <span class="badge ${v.status}">${esc(v.status)}</span>`;
      return `<div class="dcol-h">${DEVICE_LABEL[v.device] ?? esc(v.device)}<span class="dur">${(v.durationMs / 1000).toFixed(1)}s</span>${badge}</div>`;
    })
    .join("");

  // A failing client's error sits above the beats, labelled with which client.
  const errs = sorted
    .filter((v) => v.error)
    .map((v) => `<div class="err"><b>${DEVICE_LABEL[v.device] ?? esc(v.device)}</b>\n${esc(v.error!)}</div>`)
    .join("");

  // Zip beats by index: step N's clients share one row. Beat counts match when
  // both clients pass; if one fails early its later cells show a placeholder.
  const maxBeats = Math.max(...sorted.map((v) => v.beats.length));
  const rows: string[] = [];
  for (let i = 0; i < maxBeats; i++) {
    const title = sorted.map((v) => v.beats[i]?.title).find(Boolean) ?? "";
    const cells = sorted
      .map((v) => {
        const b = v.beats[i];
        return `<div class="beat-shot" data-device="${esc(v.device)}">${
          b ? `<img src="${b.img}" alt="${esc(b.title)}" />` : `<div class="beat-missing">no beat</div>`
        }</div>`;
      })
      .join("");
    rows.push(
      `<div class="beat"><div class="beat-head"><span class="n">${i + 1}</span><span class="txt">${esc(title)}</span></div>` +
        `<div class="beat-shots" style="${gridStyle}">${cells}</div></div>`,
    );
  }

  return `<details class="scenario" data-status="${esc(status)}"${openAttr}>
    <summary class="head"><span class="badge ${status}">${esc(status)}</span><span class="name">${esc(
      name,
    )}</span><span class="dur">${(totalDur / 1000).toFixed(1)}s</span><span class="caret" aria-hidden="true">▸</span></summary>
    ${errs}
    <div class="beats">
      <div class="dcols" style="${gridStyle}">${colHeads}</div>
      ${rows.join("\n")}
    </div>
  </details>`;
}
