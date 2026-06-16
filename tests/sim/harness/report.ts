import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SuiteResult, ScenarioResult, Perspective } from "./types";

const P: Record<Perspective, { c: string; bg: string; tx: string; label: string }> = {
  engine:      { c: "#7F77DD", bg: "rgba(127,119,221,0.12)", tx: "#AFA9EC", label: "engine" },
  area:        { c: "#1D9E75", bg: "rgba(29,158,117,0.12)",  tx: "#5DCAA5", label: "area / map" },
  participant: { c: "#378ADD", bg: "rgba(55,138,221,0.12)",  tx: "#85B7EB", label: "participant" },
  outbox:      { c: "#BA7517", bg: "rgba(186,117,23,0.14)",  tx: "#EF9F27", label: "outbox" },
};
const ORDER: Perspective[] = ["engine", "area", "participant", "outbox"];

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function statusDot(s: ScenarioResult["status"]): string {
  if (s === "passed") return `<span class="dot good">●</span>`;
  if (s === "failed") return `<span class="dot bad">●</span>`;
  return `<span class="dot pend">○</span>`;
}

function beatCard(b: ScenarioResult["beats"][number]): string {
  const cells = ORDER.map((k) => {
    const p = P[k];
    const on = b.changed.includes(k);
    const val = b.cells[k];
    const dim = val === "—" && !on;
    return `<div class="cell" style="border-left-color:${p.c};background:${on ? p.bg : "transparent"};opacity:${dim ? 0.5 : 1}">
      <div class="cell-l" style="color:${p.tx}">${p.label}</div>
      <div class="cell-v">${esc(val)}</div></div>`;
  }).join("");
  const asserts = b.asserts.map((a) =>
    `<span class="as ${a.ok ? "ok" : "no"}">${a.ok ? "✓" : "✗"} ${esc(a.text)}${
      a.ok ? "" : ` <em>(${esc(a.detail ?? "")})</em>`}</span>`
  ).join("");
  return `<div class="beat">
    <div class="beat-h"><span class="n">${b.n}</span><span class="t">${esc(b.time)}</span><span class="feed">${esc(b.feed)}</span></div>
    <div class="grid">${cells}</div>
    ${asserts ? `<div class="asserts">${asserts}</div>` : ""}
  </div>`;
}

function scenarioBlock(s: ScenarioResult): string {
  if (s.status === "pending") return "";
  return `<section class="block">
    <div class="block-h"><span class="block-t">${esc(s.name)}</span>
      <span class="pill ${s.status}">${s.status}</span></div>
    <div class="intent">${esc(s.intent)}</div>
    ${s.error ? `<div class="err">${esc(s.error)}</div>` : ""}
    <div class="beats">${s.beats.map(beatCard).join("")}</div>
  </section>`;
}

export function renderReport(suite: SuiteResult): string {
  const passed = suite.scenarios.filter((s) => s.status === "passed").length;
  const failed = suite.scenarios.filter((s) => s.status === "failed").length;
  const pending = suite.scenarios.filter((s) => s.status === "pending").length;

  const tocRows = suite.scenarios.map((s) => {
    const beatN = s.status === "pending" ? "—" : `${s.beats.length} beats`;
    const right = s.status === "failed"
      ? `<span class="rt bad">${esc(firstFail(s))}</span>`
      : s.status === "pending" ? `<span class="rt pend">awaiting engine</span>` : "";
    return `<tr><td class="ic">${statusDot(s.status)}</td>
      <td class="nm"><b>${esc(s.name)}</b> <span class="muted">— ${esc(s.intent)}</span></td>
      <td class="bn">${beatN}</td><td class="rtc">${right}</td></tr>`;
  }).join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MIME sim suite</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,system-ui,"Segoe UI",sans-serif;background:#0e0f13;color:#f4f4fb;font-size:13px;line-height:1.45}
  .page{max-width:980px;margin:0 auto;padding:22px 18px 60px}
  .head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;padding-bottom:12px;border-bottom:1px solid #2a2a3a;margin-bottom:16px}
  .head h1{font-size:18px;font-weight:600}
  .meta{font-size:12px;color:#7d7d97;font-family:ui-monospace,Menlo,monospace}
  .tally{margin-left:auto;display:flex;gap:6px}
  .tag{font-size:12px;padding:2px 10px;border-radius:999px}
  .tag.good{background:rgba(103,197,184,0.15);color:#67c5b8}
  .tag.bad{background:rgba(255,122,122,0.15);color:#ff7a7a}
  .tag.pend{background:rgba(255,255,255,0.06);color:#a3a3bd}
  .sec-l{font-size:12px;color:#a3a3bd;margin-bottom:8px}
  table{width:100%;border-collapse:collapse;border:1px solid #2a2a3a;border-radius:10px;overflow:hidden;margin-bottom:26px}
  td{padding:9px 8px;border-bottom:1px solid #20202e;vertical-align:middle}
  tr:last-child td{border-bottom:none}
  td.ic{width:24px;text-align:center}.dot{font-size:12px}.dot.good{color:#67c5b8}.dot.bad{color:#ff7a7a}.dot.pend{color:#6b6b85}
  td.nm{font-size:13px}.muted{color:#7d7d97}
  td.bn{width:70px;color:#7d7d97;font-family:ui-monospace,monospace;font-size:12px}
  td.rtc{width:130px;text-align:right}.rt{font-size:11px}.rt.bad{color:#ff7a7a}.rt.pend{color:#7d7d97}
  .block{margin-bottom:26px}
  .block-h{display:flex;align-items:baseline;gap:9px;margin-bottom:3px}
  .block-t{font-size:14px;font-weight:600}
  .pill{font-size:11px;padding:1px 9px;border-radius:999px}
  .pill.passed{background:rgba(103,197,184,0.15);color:#67c5b8}
  .pill.failed{background:rgba(255,122,122,0.15);color:#ff7a7a}
  .intent{font-size:12px;color:#a3a3bd;margin-bottom:10px}
  .err{font-size:12px;color:#ff7a7a;background:rgba(255,122,122,0.08);border:1px solid rgba(255,122,122,0.25);border-radius:8px;padding:8px 10px;margin-bottom:10px;font-family:ui-monospace,monospace}
  .beats{display:flex;flex-direction:column;gap:8px}
  .beat{border:1px solid #2a2a3a;border-radius:10px;padding:10px 12px;background:#15161d}
  .beat-h{display:flex;align-items:baseline;gap:8px;margin-bottom:8px}
  .beat-h .n{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#534AB7;color:#fff;font-size:11px;font-weight:600}
  .beat-h .t{font-family:ui-monospace,monospace;font-size:11px;color:#7d7d97}
  .beat-h .feed{font-size:13px}
  .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
  .cell{border-left:3px solid;border-radius:0;padding:3px 9px}
  .cell-l{font-size:10px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:1px}
  .cell-v{font-size:12px;font-family:ui-monospace,Menlo,monospace;color:#e4e4f5}
  .asserts{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  .as{font-size:11px;padding:1px 8px;border-radius:6px}
  .as.ok{color:#67c5b8;background:rgba(103,197,184,0.12)}
  .as.no{color:#ff7a7a;background:rgba(255,122,122,0.12)}
  .as em{color:#c98;font-style:normal}
</style></head><body><div class="page">
  <div class="head">
    <h1>MIME sim suite</h1>
    <span class="meta">seed ${suite.seed} · clock injected · engine ${esc(suite.engineRef)}</span>
    <span class="tally">
      <span class="tag good">${passed} passed</span>
      ${failed ? `<span class="tag bad">${failed} failed</span>` : ""}
      ${pending ? `<span class="tag pend">${pending} pending</span>` : ""}
    </span>
  </div>
  <div class="sec-l">scenarios</div>
  <table><tbody>${tocRows}</tbody></table>
  ${suite.scenarios.map(scenarioBlock).join("")}
</div></body></html>`;
}

function firstFail(s: ScenarioResult): string {
  for (const b of s.beats) {
    const f = b.asserts.find((a) => !a.ok);
    if (f) return `beat ${b.n} ✗`;
  }
  return s.error ? "error" : "";
}

export function writeReport(suite: SuiteResult, outDir: string) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "index.html"), renderReport(suite), "utf8");
  writeFileSync(resolve(outDir, "summary.json"), JSON.stringify({
    seed: suite.seed, engineRef: suite.engineRef, startedAt: suite.startedAt,
    scenarios: suite.scenarios.map((s) => ({
      name: s.name, status: s.status, beats: s.beats.length,
      failed: s.beats.flatMap((b) => b.asserts).filter((a) => !a.ok).length,
    })),
  }, null, 2), "utf8");
}
