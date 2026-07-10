import type {
  Reporter,
  TestCase,
  TestResult,
  FullResult,
} from "@playwright/test/reporter";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

// A beat is one Gherkin step. The "desktop" run shoots each step at desktop AND
// phone width (steps/hooks.ts), so a beat carries both — the report puts them
// side by side. Email beats are viewport-independent and span both columns.
type Beat = { title: string; desktop?: string; mobile?: string; full?: string };
type Scenario = {
  feature: string;
  scenario: string;
  project: string;
  status: TestResult["status"];
  durationMs: number;
  beats: Beat[];
  error?: string;
};

/**
 * Visual story report. Each Gherkin step is a "beat" screenshotted during the
 * run (see steps/hooks.ts). The suite runs ONCE (the "desktop" project); every
 * beat is captured at desktop and phone width so the two clients sit side by
 * side — same test, both views, no duplicate runs. The "mobile" project re-runs
 * only the @mobile map/HUD scenarios on a real phone as a pass/fail regression
 * net; it attaches no beats, and a failure there flags the matching card.
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
      const img = `data:${a.contentType};base64,${buf.toString("base64")}`;
      const rest = a.name.slice("beat:".length);
      const m = /^(d|m|full):([\s\S]*)$/.exec(rest);
      const kind = m ? m[1] : "d";
      const title = m ? m[2] : rest;
      if (kind === "m") {
        // The phone shot of the step just attached — pair it with its desktop.
        const last = beats[beats.length - 1];
        if (last && last.mobile === undefined && last.full === undefined) last.mobile = img;
        else beats.push({ title, mobile: img });
      } else if (kind === "full") {
        beats.push({ title, full: img });
      } else {
        beats.push({ title, desktop: img });
      }
    }
    this.scenarios.push({
      feature: test.parent?.title || "Feature",
      scenario: test.title,
      project: test.parent?.project()?.name || "desktop",
      status: result.status,
      durationMs: result.duration,
      beats,
      error: result.error?.message?.replace(/\[[0-9;]*m/g, ""), // strip ANSI
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
  // The report is built from the desktop run (it holds the beats); the mobile
  // run is a pass/fail net keyed back to its scenario by title.
  const desktopRuns = scenarios.filter((s) => s.project !== "mobile");
  const mobileByTitle = new Map<string, Scenario>();
  for (const s of scenarios) if (s.project === "mobile") mobileByTitle.set(s.scenario, s);

  const byFeature = new Map<string, Scenario[]>();
  for (const s of desktopRuns) {
    const list = byFeature.get(s.feature) ?? [];
    list.push(s);
    byFeature.set(s.feature, list);
  }

  const passed = desktopRuns.filter((s) => s.status === "passed").length;
  const failed = desktopRuns.length - passed;
  const mobileRuns = [...mobileByTitle.values()];
  const mobileFailed = mobileRuns.filter((s) => s.status !== "passed").length;

  const features = [...byFeature.entries()]
    .map(([feature, list]) => {
      const cards = list.map((s) => renderScenario(s, mobileByTitle.get(s.scenario))).join("\n");
      return `<section class="feature"><h2>${esc(feature)}</h2>${cards}</section>`;
    })
    .join("\n");

  const mobileNote = mobileRuns.length
    ? ` · 📱 ${mobileRuns.length} mobile check${mobileRuns.length === 1 ? "" : "s"}${
        mobileFailed ? ` (<b>${mobileFailed} failed</b>)` : " passed"
      }`
    : "";

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
  .badge.mobilefail { background:var(--fail); }
  .dur { color:var(--muted); font-size:12px; margin-left:auto; }
  .err { background:#fff4f3; color:var(--fail); border-top:1px solid #f3d6d3; padding:10px 16px; font:12px/1.5 ui-monospace,Menlo,monospace; white-space:pre-wrap; }
  .beats { padding:12px 16px 16px; }
  /* Client column headers — one grid row that shares its column template with
     every beat's screenshot row below, so the labels sit above their column. */
  .dcols { display:grid; gap:16px; margin-bottom:12px; }
  .dcol-h { display:flex; align-items:center; gap:8px; font-size:12px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
  .beat { margin:0 0 22px; }
  .beat-head { display:flex; align-items:flex-start; gap:10px; margin:0 0 8px; }
  .beat-head .n { width:26px; height:26px; border-radius:50%; background:var(--green); color:#fff; font-size:12px; font-weight:700; display:grid; place-items:center; flex:none; }
  .beat-head .txt { font-weight:500; padding-top:3px; }
  /* The same step, both clients side by side: desktop (landscape) gets more
     width than mobile (portrait). Columns align with .dcols above. */
  .beat-shots { display:grid; gap:16px; align-items:start; }
  .beat-shot { min-width:0; }
  .beat-shot img { max-width:100%; border:1px solid var(--line); border-radius:8px; display:block; cursor:zoom-in; background:#fff; }
  .beat-shot[data-device="mobile"] img { max-width:300px; }
  .beat-missing { color:var(--muted); font-size:12px; padding:24px; text-align:center; border:1px dashed var(--line); border-radius:8px; }
  /* Email beats aren't viewport-specific — one image across both columns. */
  .beat-full img { max-width:100%; border:1px solid var(--line); border-radius:8px; display:block; cursor:zoom-in; background:#fff; }
  dialog { border:none; background:transparent; max-width:96vw; max-height:96vh; padding:0; }
  dialog::backdrop { background:rgba(8,16,12,.82); }
  dialog img { max-width:96vw; max-height:96vh; border-radius:8px; }
</style></head>
<body>
<header class="top">
  <h1>pickup flag football — story report</h1>
  <div class="sum">${desktopRuns.length} scenario(s) · <b>${passed} passed</b>${failed ? ` · <b>${failed} failed</b>` : ""}${mobileNote} · overall: ${esc(result.status)}</div>
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

// One card per scenario: header, then every beat with its two clients paired.
// `mobileRun` (if the scenario is @mobile-tagged) contributes only pass/fail —
// a failure there fails the card and shows its error.
function renderScenario(s: Scenario, mobileRun?: Scenario): string {
  const mobileFailed = !!mobileRun && mobileRun.status !== "passed";
  const status = s.status !== "passed" || mobileFailed ? "failed" : "passed";
  const openAttr = status === "passed" ? "" : " open"; // auto-open failures

  // desktop | mobile column template, reused by the header and every beat row.
  const gridStyle = "grid-template-columns:1.6fr 1fr";

  const errs =
    (s.error ? `<div class="err">${esc(s.error)}</div>` : "") +
    (mobileFailed
      ? `<div class="err"><b>📱 mobile check failed</b>\n${esc(mobileRun!.error ?? "(no message)")}</div>`
      : "");

  const beats = s.beats
    .map((b, i) => {
      const head = `<div class="beat-head"><span class="n">${i + 1}</span><span class="txt">${esc(b.title)}</span></div>`;
      if (b.full) {
        return `<div class="beat">${head}<div class="beat-full"><img src="${b.full}" alt="${esc(b.title)}" /></div></div>`;
      }
      const cell = (device: "desktop" | "mobile", img?: string) =>
        `<div class="beat-shot" data-device="${device}">${
          img ? `<img src="${img}" alt="${esc(b.title)}" />` : `<div class="beat-missing">no shot</div>`
        }</div>`;
      return `<div class="beat">${head}<div class="beat-shots" style="${gridStyle}">${cell("desktop", b.desktop)}${cell("mobile", b.mobile)}</div></div>`;
    })
    .join("\n");

  const mobileBadge = mobileFailed
    ? ` <span class="badge mobilefail">📱 mobile</span>`
    : mobileRun
      ? ` <span class="badge passed">📱 mobile ✓</span>`
      : "";

  return `<details class="scenario" data-status="${esc(status)}"${openAttr}>
    <summary class="head"><span class="badge ${status}">${esc(status)}</span><span class="name">${esc(
      s.scenario,
    )}</span>${mobileBadge}<span class="dur">${(s.durationMs / 1000).toFixed(1)}s</span><span class="caret" aria-hidden="true">▸</span></summary>
    ${errs}
    <div class="beats">
      <div class="dcols" style="${gridStyle}"><div class="dcol-h">💻 desktop</div><div class="dcol-h">📱 mobile</div></div>
      ${beats}
    </div>
  </details>`;
}
