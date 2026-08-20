#!/usr/bin/env python3
"""Regenerate mobile-audit.html — the LIVING TRACKER artifact at
https://claude.ai/code/artifact/8544195c-cc56-42ee-a965-616138dfc3af

Workflow when a finding's status changes on the mobile rebuild branch:
  1. edit status.json (["fixed"|"partial"|"open"|"superseded", "one-line how"])
     and bump _meta.updated / _meta.tests
  2. python3 docs/design/mobile-audit/build-audit-page.py
  3. republish the generated mobile-audit.html to the SAME artifact URL
     (same file path from the owning conversation, or pass url= from another)
Screenshots in web/ are the BEFORE set - leave them as the baseline."""
import json, base64, html, os
S = os.path.dirname(os.path.abspath(__file__))
d = json.load(open(f"{S}/audit.json"))
status = json.load(open(f"{S}/status.json"))
meta = status.pop("_meta")
gap_dispositions = status.pop("_gaps", None)
round2 = status.pop("_round2", None)
c = {f["id"]: f for f in d["confirmed"]}
gaps = d["gaps"]

def img(name): return "data:image/png;base64," + base64.b64encode(open(f"{S}/web/{name}.png", "rb").read()).decode()
esc = html.escape

THEMES = [
 ("The map is buried under fixed chrome", "The core screen loses roughly half its pixels to an always-open legend, HUD, banners, and a legal-links footer.", ["M3","M4","M10","M32","M33","M35","M37","M38","M45"],
   [("10-map-initial","375px first load: legend, HUD, banner and footer before any touch"),("26-landscape-map","Landscape: the desktop layout leaves a sliver of map"),("21-320-map","320px: ~26% of the screen is usable map")]),
 ("There is no phone navigation model", "Header links vanish under 560px with no replacement; a rostered player can't reach my-games from visible chrome.", ["M2","M12","M34"], []),
 ("Dialogs are desktop modals, not sheets", "Centered fixed-height cards that overflow short viewports, hide their close buttons, and fight the keyboard.", ["M5","M14","M15","M16","M29","M41","M52","M54"],
   [("17-propose-modal","Propose form: the zip input runs off the right edge; submit is below the fold"),("23-320-chat","320px chat: no composer in sight - it's past the card's scroll fold")]),
 ("Forms ignore mobile input basics", "Sub-16px inputs trigger iOS zoom-on-focus everywhere; the only save button is a full page-scroll away.", ["M6","M8","M13","M21","M30","M31","M39"],
   [("19-account-full","The account page linearized: ~2100pt tall, save at the very top, the site footer stranded mid-page")]),
 ("Touch is an afterthought to the cursor", "Sub-44px targets on nearly every control, hover-only features, destructive actions with no confirmation.", ["M7","M11","M24","M26","M27","M28","M40","M53","M62"], []),
 ("No coherent icon language", "Four art styles plus text glyphs and emoji; illegible legend glyphs; 1.5MB badge PNGs drawn at 92px.", ["M22","M36","M50","M51"], []),
 ("The PWA is half-shipped", "Installable, but no safe-area handling, install path only on the splash, wrong theme colors.", ["M9","M48","M49","M59","M60","M61","M63"], []),
 ("Accessibility gaps, one fatal", "The find-and-join flow is canvas-only - invisible to screen readers and keyboards.", ["M1","M42","M43","M44","M56"], []),
 ("Chat doesn't fit the phone", "A 264px window showing 2-3 messages, scroll yanks, frozen timestamps, no delivery feedback.", ["M23","M25","M55"],
   [("14-game-modal-chat-messages","The thread shows 2-3 messages; the top one clips mid-message under a 3-line preamble")]),
 ("The splash undersells on the device that matters", "CTA at the fold, unreadable gallery screenshots, no swipe on the carousel.", ["M18","M19","M20","M47","M57","M58"],
   [("02-splash-full","The whole splash at 375px: readable until the gallery, whose desktop screenshots shrink to illegibility")]),
 ("Small stuff that reads as unfinished", "", ["M46","M64"], []),
]
SEV = {"blocker":("Blocker","sev-blocker"),"major":("Major","sev-major"),"minor":("Minor","sev-minor"),"polish":("Polish","sev-polish")}
ST = {"fixed":("Fixed","st-fixed"),"partial":("Partial","st-partial"),"open":("Open","st-open"),"superseded":("Superseded","st-superseded")}
counts = {"blocker":0,"major":0,"minor":0,"polish":0}
scounts = {"fixed":0,"partial":0,"open":0,"superseded":0}
for f in c.values():
    counts[f["severity"]] += 1
    scounts[status[f["id"]][0]] += 1
done_pct = round(100 * (scounts["fixed"] + scounts["superseded"] + scounts["partial"] * 0.5) / len(c))

def finding(f):
    label, cls = SEV[f["severity"]]
    st, note = status[f["id"]]
    stl, stc = ST[st]
    dirn = f'<p class="dir"><span>Direction</span> {esc(f["suggested_direction"])}</p>' if f.get("suggested_direction") and st in ("open","partial") else ""
    return f'''<details class="f{' f--done' if st in ('fixed','superseded') else ''}" data-sev="{f["severity"]}" data-st="{st}">
<summary><span class="chip {cls}">{label}</span><span class="chip st {stc}">{stl}</span><span class="fid">{f["id"]}</span><span class="ft">{esc(f["title"])}</span></summary>
<div class="fb"><p class="stnote {stc}-t"><b>{stl}:</b> {esc(note)}</p><p>{esc(f["why_it_hurts"])}</p><p class="ev">{esc(f["evidence"])}</p>{dirn}</div>
</details>'''

sections = []
for title, blurb, ids, shots in THEMES:
    figs = "".join(f'<figure><img src="{img(n)}" alt="{esc(cap)}" loading="lazy"><figcaption>{esc(cap)}</figcaption></figure>' for n, cap in shots)
    figs = f'<div class="shots">{figs}</div>' if figs else ""
    fixed_n = sum(1 for x in ids if status[x][0] in ("fixed","superseded"))
    rows = "".join(finding(c[x]) for x in ids)
    sections.append(f'''<section class="theme">
<header><h2>{esc(title)} <span class="theme-tally">{fixed_n}/{len(ids)} done</span></h2>{f"<p>{esc(blurb)}</p>" if blurb else ""}</header>
{figs}
<div class="rows">{rows}</div>
</section>''')

GAPST = {"covered":("Covered","st-fixed"),"fixed":("Fixed","st-fixed"),"superseded":("Superseded","st-superseded"),"accepted":("Accepted","st-partial")}
R2ST = {"fixed":("Fixed","st-fixed"),"declined":("Declined","st-partial")}

round2_html = ""
if round2:
    rows = "".join(
        f'<details class="f f--done"><summary>'
        f'<span class="chip {SEV[sev][1]}">{SEV[sev][0]}</span>'
        f'<span class="chip st {R2ST[st][1]}">{R2ST[st][0]}</span>'
        f'<span class="fid">{rid}</span><span class="ft">{esc(note.split(" - ")[0].split(". ")[0])}</span></summary>'
        f'<div class="fb"><p class="stnote {R2ST[st][1]}-t">{esc(note)}</p></div></details>'
        for rid, sev, st, note in round2)
    n_fixed = sum(1 for r in round2 if r[2] == "fixed")
    round2_html = ('<section class="theme"><header>'
        f'<h2>Round 2: the coverage sweep\'s own findings <span class="theme-tally">{n_fixed}/{len(round2)} fixed</span></h2>'
        '<p>Reviewing the 24 newly-captured states surfaced these - including a phone-only regression no desktop test could see.</p>'
        f'</header><div class="rows">{rows}</div></section>')

if gap_dispositions:
    gaps_html = "".join(
        f'<li><span class="chip st {GAPST[st][1]}">{GAPST[st][0]}</span> <strong>{esc(what)}</strong> {esc(note)}</li>'
        for what, st, note in gap_dispositions)
    gaps_head = "Coverage beyond the original sweep"
    gaps_sub = ("Every item the completeness critic named has been run down: captured and reviewed, fixed in code, "
                "superseded by the redesign, or accepted with a stated reason (2 items that are inherently "
                "device/field-data bound). Capture tooling: tests/demos/gap-captures.mts.")
else:
    gaps_html = "".join(f'<li><strong>{esc(g["what"])}</strong> {esc(g["why_it_matters"])}</li>' for g in gaps)
    gaps_head = "What this audit did not cover"
    gaps_sub = "Named so they can be checked later, not forgotten."

page = f'''<title>MIME-FF Mobile Audit</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400&display=swap">
<style>
:root {{
  --ground:#101512; --surface:#1a221d; --surface2:#212b24; --line:#2d3a30;
  --ink:#e8ece7; --ink2:#a7b1a8; --ink3:#79847a; --accent:#e8b33a;
  --blocker:#e05d5d; --major:#e8934a; --minor:#7ea8c9; --polish:#8a9389;
  --fixed:#5fae72; --partial:#d8a544; --open-c:#8a9389; --super:#7b8fa5;
  --chipink:#101512;
}}
@media (prefers-color-scheme: light) {{ :root:not([data-theme="dark"]) {{
  --ground:#f5f7f3; --surface:#ffffff; --surface2:#eef1ec; --line:#d8ded6;
  --ink:#1c231e; --ink2:#4d5850; --ink3:#79847a; --accent:#b5860f;
  --blocker:#c03c3c; --major:#c06f24; --minor:#3d6f96; --polish:#68716a;
  --fixed:#2e7d43; --partial:#a3781a; --open-c:#68716a; --super:#4f6d8c;
  --chipink:#ffffff;
}} }}
:root[data-theme="light"] {{
  --ground:#f5f7f3; --surface:#ffffff; --surface2:#eef1ec; --line:#d8ded6;
  --ink:#1c231e; --ink2:#4d5850; --ink3:#79847a; --accent:#b5860f;
  --blocker:#c03c3c; --major:#c06f24; --minor:#3d6f96; --polish:#68716a;
  --fixed:#2e7d43; --partial:#a3781a; --open-c:#68716a; --super:#4f6d8c;
  --chipink:#ffffff;
}}
* {{ box-sizing:border-box; }}
body {{ background:var(--ground); color:var(--ink); font:15px/1.55 Inter,system-ui,sans-serif; margin:0; padding:0 20px 80px; }}
.wrap {{ max-width:880px; margin:0 auto; }}
h1,h2,h3 {{ font-family:"Barlow Condensed",Inter,sans-serif; text-wrap:balance; }}
.masthead {{ padding:56px 0 8px; border-bottom:3px solid var(--accent); }}
.eyebrow {{ text-transform:uppercase; letter-spacing:.14em; font-size:12px; font-weight:600; color:var(--accent); margin:0 0 6px; }}
h1 {{ font-size:clamp(38px,7vw,58px); font-weight:700; line-height:1.02; margin:0 0 10px; }}
.sub {{ color:var(--ink2); max-width:62ch; margin:0 0 22px; }}
.progress {{ margin:0 0 18px; }}
.progress-bar {{ height:10px; border-radius:99px; background:var(--surface2); overflow:hidden; display:flex; }}
.progress-bar i {{ display:block; height:100%; }}
.progress-cap {{ display:flex; justify-content:space-between; font-size:12.5px; color:var(--ink2); margin-top:6px; }}
.progress-cap b {{ color:var(--fixed); font-variant-numeric:tabular-nums; }}
.board {{ display:flex; gap:10px; flex-wrap:wrap; margin:0 0 30px; }}
.stat {{ background:var(--surface); border:1px solid var(--line); border-radius:6px; padding:10px 16px 12px; min-width:92px; }}
.stat b {{ display:block; font:700 34px/1 "Barlow Condensed",sans-serif; font-variant-numeric:tabular-nums; }}
.stat span {{ font-size:11px; text-transform:uppercase; letter-spacing:.1em; color:var(--ink2); }}
.stat.fx b{{color:var(--fixed)}} .stat.pa b{{color:var(--partial)}} .stat.op b{{color:var(--open-c)}} .stat.su b{{color:var(--super)}}
.filters {{ position:sticky; top:0; z-index:5; background:var(--ground); display:flex; gap:8px; flex-wrap:wrap; align-items:center; padding:12px 0; border-bottom:1px solid var(--line); margin-bottom:8px; }}
.filters .flabel {{ font-size:10px; text-transform:uppercase; letter-spacing:.1em; color:var(--ink3); margin-right:2px; }}
.filters .sep {{ width:1px; align-self:stretch; background:var(--line); margin:0 6px; }}
.filters button {{ font:600 12px/1 Inter,sans-serif; letter-spacing:.06em; text-transform:uppercase; padding:8px 13px; border-radius:99px; border:1px solid var(--line); background:var(--surface); color:var(--ink2); cursor:pointer; }}
.filters button[aria-pressed="true"] {{ background:var(--accent); color:var(--chipink); border-color:var(--accent); }}
.filters button:focus-visible {{ outline:2px solid var(--accent); outline-offset:2px; }}
.theme {{ margin:44px 0 0; }}
.theme header h2 {{ font-size:29px; font-weight:600; margin:0 0 2px; }}
.theme-tally {{ font:600 13px/1 Inter,sans-serif; color:var(--fixed); background:var(--surface2); border-radius:99px; padding:5px 10px; vertical-align:4px; margin-left:6px; }}
.theme header p {{ color:var(--ink2); margin:0 0 14px; max-width:68ch; }}
.shots {{ display:flex; gap:14px; overflow-x:auto; padding:4px 0 12px; }}
.shots figure {{ margin:0; flex:0 0 auto; width:210px; }}
.shots img {{ width:100%; border:1px solid var(--line); border-radius:8px; display:block; }}
.shots figcaption {{ font-size:12px; color:var(--ink2); padding-top:6px; line-height:1.4; }}
.rows {{ display:flex; flex-direction:column; gap:6px; }}
.f {{ background:var(--surface); border:1px solid var(--line); border-radius:6px; }}
.f--done summary .ft {{ color:var(--ink2); }}
.f[hidden] {{ display:none; }}
.f summary {{ display:flex; align-items:baseline; gap:8px; padding:10px 14px; cursor:pointer; list-style:none; flex-wrap:wrap; }}
.f summary::-webkit-details-marker {{ display:none; }}
.f summary:focus-visible {{ outline:2px solid var(--accent); outline-offset:-2px; border-radius:6px; }}
.f[open] summary {{ border-bottom:1px solid var(--line); }}
.chip {{ flex:0 0 auto; font:600 10px/1 Inter,sans-serif; letter-spacing:.08em; text-transform:uppercase; color:var(--chipink); padding:4px 8px; border-radius:4px; position:relative; top:-1px; }}
.sev-blocker{{background:var(--blocker)}} .sev-major{{background:var(--major)}} .sev-minor{{background:var(--minor)}} .sev-polish{{background:var(--polish)}}
.st-fixed{{background:var(--fixed)}} .st-partial{{background:var(--partial)}} .st-open{{background:var(--open-c)}} .st-superseded{{background:var(--super)}}
.fid {{ flex:0 0 auto; font:400 12px/1 "JetBrains Mono",monospace; color:var(--ink3); }}
.ft {{ font-weight:500; }}
.fb {{ padding:12px 14px 14px; }}
.fb p {{ margin:0 0 10px; max-width:72ch; }}
.stnote {{ border-radius:6px; padding:9px 12px; font-size:13.5px; }}
.stnote b {{ text-transform:uppercase; font-size:11px; letter-spacing:.08em; margin-right:4px; }}
.st-fixed-t {{ background:color-mix(in srgb, var(--fixed) 14%, transparent); color:var(--ink); }}
.st-fixed-t b {{ color:var(--fixed); }}
.st-partial-t {{ background:color-mix(in srgb, var(--partial) 14%, transparent); }}
.st-partial-t b {{ color:var(--partial); }}
.st-open-t {{ background:var(--surface2); }} .st-open-t b {{ color:var(--ink3); }}
.st-superseded-t {{ background:color-mix(in srgb, var(--super) 14%, transparent); }}
.st-superseded-t b {{ color:var(--super); }}
.ev {{ font:12.5px/1.6 "JetBrains Mono",monospace; color:var(--ink2); background:var(--surface2); border-radius:6px; padding:10px 12px; overflow-x:auto; }}
.dir span {{ font-weight:600; color:var(--accent); text-transform:uppercase; font-size:11px; letter-spacing:.08em; margin-right:6px; }}
.gaps {{ margin:56px 0 0; border-top:3px solid var(--accent); padding-top:18px; }}
.gaps h2 {{ font-family:"Barlow Condensed",sans-serif; font-size:29px; margin:0 0 4px; }}
.gaps > p {{ color:var(--ink2); margin:0 0 14px; }}
.gaps li {{ margin:0 0 10px; color:var(--ink2); max-width:78ch; }}
.gaps li strong {{ color:var(--ink); font-weight:600; }}
footer.method {{ color:var(--ink3); font-size:13px; margin-top:60px; border-top:1px solid var(--line); padding-top:14px; max-width:72ch; }}
@media (prefers-reduced-motion:no-preference) {{ .f {{ transition:border-color .15s; }} .f:hover {{ border-color:var(--ink3); }} }}
</style>
<div class="wrap">
<header class="masthead">
<p class="eyebrow">MIME-FF &middot; audited 2026-08-19 &middot; tracking branch {esc(meta["branch"])} &middot; updated {esc(meta["updated"])}</p>
<h1>Mobile Audit</h1>
<p class="sub">Every problem a phone user hits, catalogued, verified, and now tracked as the rebuild works through them on <code>{esc(meta["branch"])}</code>. {esc(meta["tests"])}.</p>
<div class="progress">
<div class="progress-bar">
<i style="width:{scounts["fixed"]/len(c)*100:.1f}%;background:var(--fixed)"></i>
<i style="width:{scounts["superseded"]/len(c)*100:.1f}%;background:var(--super)"></i>
<i style="width:{scounts["partial"]/len(c)*100:.1f}%;background:var(--partial)"></i>
</div>
<div class="progress-cap"><span><b>{done_pct}%</b> worked through</span><span>{scounts["fixed"]} fixed &middot; {scounts["superseded"]} superseded &middot; {scounts["partial"]} partial &middot; {scounts["open"]} open</span></div>
</div>
<div class="board">
<div class="stat fx"><b>{scounts["fixed"]}</b><span>fixed</span></div>
<div class="stat pa"><b>{scounts["partial"]}</b><span>partial</span></div>
<div class="stat op"><b>{scounts["open"]}</b><span>open</span></div>
<div class="stat su"><b>{scounts["superseded"]}</b><span>superseded</span></div>
<div class="stat"><b>{len(c)}</b><span>findings</span></div>
</div>
</header>
<nav class="filters" aria-label="filters">
<span class="flabel">Status</span>
<button aria-pressed="true" data-kind="st" data-v="all">All</button>
<button aria-pressed="false" data-kind="st" data-v="open">Open</button>
<button aria-pressed="false" data-kind="st" data-v="partial">Partial</button>
<button aria-pressed="false" data-kind="st" data-v="fixed">Fixed</button>
<span class="sep"></span>
<span class="flabel">Severity</span>
<button aria-pressed="true" data-kind="sev" data-v="all">All</button>
<button aria-pressed="false" data-kind="sev" data-v="blocker">Blocker</button>
<button aria-pressed="false" data-kind="sev" data-v="major">Major</button>
<button aria-pressed="false" data-kind="sev" data-v="minor">Minor</button>
<button aria-pressed="false" data-kind="sev" data-v="polish">Polish</button>
</nav>
{"".join(sections)}
{round2_html}
<section class="gaps">
<h2>{gaps_head}</h2>
<p>{gaps_sub}</p>
<ul>{gaps_html}</ul>
</section>
<footer class="method">Method: production build with seeded demo data and a real login, swept by script at 375&times;812 (iPhone emulation), 320px, and landscape; screenshots plus source fed 12 lens-scoped reviewers; findings deduped, severity-ranked, and adversarially verified; a completeness critic named the gaps. Status chips track the <code>{esc(meta["branch"])}</code> rebuild; the same sweep re-runs after each phase as the before/after record. Screenshots shown are the BEFORE set. Full text: docs/design/mobile-audit.md.</footer>
</div>
<script>
const state = {{ st: "all", sev: "all" }};
document.querySelector(".filters").addEventListener("click", (e) => {{
  const b = e.target.closest("button"); if (!b) return;
  state[b.dataset.kind] = b.dataset.v;
  document.querySelectorAll(`.filters button[data-kind="${{b.dataset.kind}}"]`)
    .forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
  document.querySelectorAll(".f").forEach((f) => {{
    const stOk = state.st === "all" || f.dataset.st === state.st;
    const sevOk = state.sev === "all" || f.dataset.sev === state.sev;
    f.hidden = !(stOk && sevOk);
  }});
  document.querySelectorAll(".theme").forEach((t) => {{
    t.hidden = ![...t.querySelectorAll(".f")].some((f) => !f.hidden);
  }});
}});
</script>'''
open(f"{S}/mobile-audit.html", "w").write(page)
print(f"built: {len(page)//1024}KB · {done_pct}% worked through · {scounts}")
