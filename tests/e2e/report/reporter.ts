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
      const cards = list.map((s) => renderScenario(s)).join("\n");
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
  .beats { padding:14px 16px; display:grid; gap:16px; }
  .beat { display:grid; grid-template-columns:34px 1fr; gap:12px; align-items:start; }
  .beat .n { width:26px; height:26px; border-radius:50%; background:var(--green); color:#fff; font-size:12px; font-weight:700; display:grid; place-items:center; }
  .beat .body .txt { font-weight:500; margin:3px 0 8px; }
  .beat img { max-width:100%; width:680px; border:1px solid var(--line); border-radius:8px; display:block; cursor:zoom-in; background:#fff; }
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
  const all = (open) => document.querySelectorAll('details.scenario').forEach(d => { d.open = open; });
  document.getElementById('exp').addEventListener('click', () => all(true));
  document.getElementById('col').addEventListener('click', () => all(false));
</script>
</body></html>`;
}

function renderScenario(s: Scenario): string {
  const beats = s.beats
    .map(
      (b, i) =>
        `<div class="beat"><div class="n">${i + 1}</div><div class="body"><div class="txt">${esc(
          b.title,
        )}</div><img src="${b.img}" alt="${esc(b.title)}" /></div></div>`,
    )
    .join("\n");
  const err = s.error ? `<div class="err">${esc(s.error)}</div>` : "";
  // Collapsed by default; auto-open failures so they're never hidden.
  const openAttr = s.status === "passed" ? "" : " open";
  return `<details class="scenario"${openAttr}>
    <summary class="head"><span class="badge ${s.status}">${esc(s.status)}</span><span class="name">${esc(
      s.scenario,
    )}</span><span class="dur">${(s.durationMs / 1000).toFixed(1)}s</span><span class="caret" aria-hidden="true">▸</span></summary>
    ${err}
    <div class="beats">${beats}</div>
  </details>`;
}
