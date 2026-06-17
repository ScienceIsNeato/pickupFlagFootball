"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { haversineKm } from "@/lib/geo/distance";
import { TEAM_YELLOW, TEAM_BLUE, GRASS } from "@/lib/brand";
import { ProposeModal } from "./ProposeModal";

type Cell = { h3: string; lat: number; lng: number; count: number; hasGame: boolean };

const MAX_ZOOM = 11;     // at/above this, click a cluster to propose
const PROPOSE_RES = 7;   // proposeGame resolves areas by r7 cell — match that
const GR = 130;          // cursor "collect" radius — within this of a cluster, its flags rush to the cursor
const MORPH_MS = 1500;   // background-scatter → map-cluster morph
// When collected, the two teams line up in parallel rows on either side of the
// cursor (the line of scrimmage), tails flapping away from each other.
const TEAM_CAP = 11;     // up to 11 a side
const COL_SP = 13;       // spacing between flags along a team's row
const LINE_GAP = 16;     // gap from the cursor to each team's row

// Football-field basemap: green turf, white "hashmark" roads, muted water.
// Vector tiles (OpenFreeMap / OpenMapTiles schema) so we control the colors
// directly — a raster + CSS filter can't keep roads white over green land.
const FIELD = "#41863c";        // turf green
const FIELD_DK = "#36702f";     // parks / woodland / grass
const WATER = "#35617e";        // muted water
const LABEL = "#16320f";        // dark-green ink
const LABEL_HALO = "rgba(255,255,255,0.6)";
const major = ["motorway", "trunk", "primary"];

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    omt: {
      type: "vector",
      url: "https://tiles.openfreemap.org/planet",
      attribution:
        '© <a href="https://openfreemap.org">OpenFreeMap</a> © OpenMapTiles © OpenStreetMap contributors',
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": FIELD } },
    { id: "landcover", type: "fill", source: "omt", "source-layer": "landcover",
      paint: { "fill-color": FIELD_DK, "fill-opacity": 0.3 } },
    { id: "park", type: "fill", source: "omt", "source-layer": "park",
      paint: { "fill-color": FIELD_DK, "fill-opacity": 0.4 } },
    { id: "water", type: "fill", source: "omt", "source-layer": "water",
      paint: { "fill-color": WATER } },
    { id: "waterway", type: "line", source: "omt", "source-layer": "waterway",
      paint: { "line-color": WATER, "line-width": 1 } },
    // White roads, thin like field hashmarks; minor roads a touch translucent.
    { id: "roads-minor", type: "line", source: "omt", "source-layer": "transportation",
      filter: ["!", ["in", ["get", "class"], ["literal", major]]],
      paint: {
        "line-color": "rgba(255,255,255,0.55)",
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.3, 12, 1, 16, 2.4],
      } },
    { id: "roads-major", type: "line", source: "omt", "source-layer": "transportation",
      filter: ["in", ["get", "class"], ["literal", major]],
      paint: {
        "line-color": "#ffffff",
        "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.6, 12, 2, 16, 4],
      } },
    { id: "places", type: "symbol", source: "omt", "source-layer": "place",
      filter: ["in", ["get", "class"], ["literal", ["city", "town", "village", "suburb"]]],
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 7, 11, 12, 15],
      },
      paint: { "text-color": LABEL, "text-halo-color": LABEL_HALO, "text-halo-width": 1.2 } },
  ],
};

function resForZoom(z: number): number {
  if (z < 5) return 3;
  if (z < 7) return 4;
  if (z < 9) return 5;
  if (z < 11) return 6;
  return 7;
}
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

type Flag = {
  rdx: number; rdy: number;       // rest offset (scattered at the user's area)
  fdx: number; fdy: number;       // row-slot offset from the cursor (when collected)
  frot: number; rrot: number;     // facing when lined up (tail away) / when at rest
  sx: number; sy: number;         // morph spawn point (scattered)
  x: number; y: number;           // live position
  size: number; rot: number; phase: number; energy: number; color: string;
  init: boolean;                  // seeded its first live position yet?
};
type Cluster = {
  ll: [number, number]; count: number; hasGame: boolean; h3: string; flags: Flag[];
  inRange: boolean;               // within the viewer's travel radius of home?
};

type Home = { lat: number; lng: number; maxTravelKm: number };

export function MapView({
  center, zoom = 9, home = null,
}: { center: [number, number]; zoom?: number; home?: Home | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clustersRef = useRef<Cluster[]>([]);
  // The map effect is mount-only; keep home/maxTravelKm live via a ref so a
  // later prop change (e.g. the user edits their travel radius) takes effect on
  // the next refresh without a remount.
  const homeRef = useRef(home);
  homeRef.current = home;
  const [propose, setPropose] = useState<{ h3: string; lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!ref.current || !canvasRef.current) return;
    const container = ref.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const map = new maplibregl.Map({
      container, style: STYLE, center, zoom, attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    const mapEl = map.getCanvasContainer();
    mapEl.style.opacity = "0"; // fade in as the flags morph into place

    function sizeCanvas() {
      const r = container.getBoundingClientRect();
      canvas.width = r.width * dpr; canvas.height = r.height * dpr;
      canvas.style.width = r.width + "px"; canvas.style.height = r.height + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      map.resize();
    }
    requestAnimationFrame(sizeCanvas);
    map.on("load", sizeCanvas);
    const ro = new ResizeObserver(sizeCanvas);
    ro.observe(container);

    let mx = -99999, my = -99999;
    const onMove = (e: PointerEvent) => {
      const b = container.getBoundingClientRect();
      mx = e.clientX - b.left; my = e.clientY - b.top;
    };
    const onLeave = () => { mx = -99999; my = -99999; };
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerleave", onLeave);

    let first = true;
    let morphStart = 0;
    let aborted = false;
    let dataRes = 0; // resolution the current clustersRef was fetched at
    async function refresh() {
      const res = resForZoom(map.getZoom());
      let cells: Cell[];
      try {
        const r = await fetch(`/api/map?res=${res}`, { cache: "no-store" });
        if (aborted || !r.ok) return;
        ({ cells } = (await r.json()) as { cells: Cell[] });
      } catch {
        return; // transient/offline — keep the current flags, try again on next move
      }
      const W = container.clientWidth, H = container.clientHeight;
      clustersRef.current = cells.map((c) => {
        // Show up to two full teams (11 a side). Yellow takes the larger half.
        const shown = Math.max(1, Math.min(TEAM_CAP * 2, c.count));
        const yellow = Math.min(TEAM_CAP, Math.ceil(shown / 2));
        const blue = Math.min(TEAM_CAP, shown - yellow);
        const spread = Math.min(46, 14 + c.count); // rest scatter radius
        const flags: Flag[] = [];
        for (let i = 0; i < shown; i++) {
          const isYellow = i < yellow;
          const idx = isYellow ? i : i - yellow;        // position within the team's row
          const row = isYellow ? yellow : blue;
          // Collected layout: a centered row on the cursor's yellow/blue side,
          // tail flapping away from the other team (yellow up, blue down).
          const fdx = (idx - (row - 1) / 2) * COL_SP + rand(-1.5, 1.5);
          const fdy = (isYellow ? -LINE_GAP : LINE_GAP) + rand(-1.5, 1.5);
          const frot = isYellow ? -Math.PI / 2 : Math.PI / 2;
          // Rest: scattered around the user's area (the cluster centroid).
          const a = rand(0, Math.PI * 2), rr = Math.sqrt(Math.random()) * spread;
          flags.push({
            rdx: Math.cos(a) * rr, rdy: Math.sin(a) * rr,
            fdx, fdy, frot, rrot: rand(0, Math.PI * 2),
            sx: first ? rand(0, W) : -1, sy: first ? rand(0, H) : -1,
            x: 0, y: 0,
            size: rand(9, 12), rot: rand(0, Math.PI * 2), phase: rand(0, Math.PI * 2),
            energy: 0, color: isYellow ? TEAM_YELLOW : TEAM_BLUE, init: false,
          });
        }
        // A cluster is "in range" when its general-area centroid is within the
        // viewer's travel radius of home. With no home set, everything is in
        // range. Out-of-range clusters never get collected into formation.
        const h = homeRef.current;
        const inRange = !h || haversineKm(h.lat, h.lng, c.lat, c.lng) <= h.maxTravelKm;
        return { ll: [c.lng, c.lat] as [number, number], count: c.count, hasGame: c.hasGame, h3: c.h3, flags, inRange };
      });
      dataRes = res;
      if (first) { first = false; morphStart = performance.now(); }
    }

    function drawFlag(f: Flag) {
      const L = f.size * 3, h = f.size * 0.5, seg = 6;
      ctx.save();
      ctx.translate(f.x, f.y); ctx.rotate(f.rot);
      ctx.globalAlpha = 0.5 + 0.5 * f.energy;
      ctx.fillStyle = f.color;
      ctx.beginPath();
      for (let i = 0; i <= seg; i++) {
        const t = i / seg, x = t * L;
        const w = Math.sin(f.phase + t * 6) * h * 1.2 * t * (0.25 + f.energy);
        if (i === 0) ctx.moveTo(x, w - h / 2); else ctx.lineTo(x, w - h / 2);
      }
      for (let i = seg; i >= 0; i--) {
        const t = i / seg, x = t * L;
        const w = Math.sin(f.phase + t * 6) * h * 1.2 * t * (0.25 + f.energy);
        ctx.lineTo(x, w + h / 2);
      }
      ctx.closePath(); ctx.fill(); ctx.restore();
    }

    let raf = 0;
    // While the map is panning/zooming, flags lock to their projected position
    // (see the frame loop) instead of easing — so they stay bolted to the basemap.
    let mapMoving = false;
    function frame() {
      const W = container.clientWidth, H = container.clientHeight;
      ctx.clearRect(0, 0, W, H);
      const morph = morphStart ? Math.min(1, (performance.now() - morphStart) / MORPH_MS) : 0;
      mapEl.style.opacity = easeOut(morph).toFixed(3);
      const on = mx > -9000;

      for (const cl of clustersRef.current) {
        const home = map.project(cl.ll);
        // The cursor "collects" a cluster when it's within GR of the centroid
        // (and the cluster is in travel range, and the map is idle). The flags
        // then rush to the cursor and line up in two rows on either side of it.
        const cdx = mx - home.x, cdy = my - home.y;
        const active = on && !mapMoving && cl.inRange && (cdx * cdx + cdy * cdy) < GR * GR;
        for (const f of cl.flags) {
          // Rest position — scattered at the user's area — with the intro morph.
          let rx = home.x + f.rdx, ry = home.y + f.rdy;
          if (morph < 1 && f.sx >= 0) {
            const e = easeOut(morph);
            rx = f.sx + (rx - f.sx) * e; ry = f.sy + (ry - f.sy) * e;
          }
          if (!f.init || mapMoving) {
            // First seed, or bolt rigidly to the map while it pans/zooms — snap
            // to the rest spot so flags don't lerp-lag behind the basemap.
            f.init = true; f.x = rx; f.y = ry; f.rot = f.rrot;
            f.energy += (0.12 - f.energy) * 0.1;
          } else {
            // Collected → the row slot centered on the cursor; else drift home.
            const tx = active ? mx + f.fdx : rx;
            const ty = active ? my + f.fdy : ry;
            const k = active ? 0.18 : 0.1;            // snappier when collecting
            f.x += (tx - f.x) * k; f.y += (ty - f.y) * k;
            // Face the tail away when lined up; relax to the resting angle at home.
            const targetRot = active ? f.frot : f.rrot;
            f.rot += (targetRot - f.rot) * (active ? 0.18 : 0.06);
            const targetE = active ? 0.5 : 0.12;      // livelier flutter when collected
            f.energy += (targetE - f.energy) * (active ? 0.15 : 0.1);
          }
          f.phase += 0.16 + 0.18 * f.energy;
          drawFlag(f);
        }
        // small translucent count beside the clump
        if (morph > 0.6) {
          ctx.globalAlpha = (morph - 0.6) / 0.4;
          ctx.font = `700 ${cl.count >= 10 ? 13 : 14}px system-ui, -apple-system, sans-serif`;
          ctx.fillStyle = cl.hasGame ? GRASS.l1 : "#ffffff";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.shadowColor = "rgba(0,0,0,.85)"; ctx.shadowBlur = 6;
          ctx.fillText(String(cl.count), home.x, home.y - 2);
          ctx.shadowBlur = 0; ctx.globalAlpha = 1;
        }
      }
      raf = requestAnimationFrame(frame);
    }

    void refresh();
    // debounce: don't hit /api/map on every moveend frame of a pan/zoom
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { void refresh(); }, 250);
    };
    map.on("movestart", () => { mapMoving = true; });
    map.on("moveend", () => { mapMoving = false; });
    map.on("moveend", debouncedRefresh);
    map.on("click", async (e) => {
      if (map.getZoom() < MAX_ZOOM) return;
      // Cluster refresh is debounced on moveend, so right after a zoom-in
      // clustersRef can still hold coarser cells while proposeGame resolves
      // areas at r7. Pull fresh r7 clusters before matching the click so we
      // never submit a stale, wrong-resolution cell.
      if (dataRes < PROPOSE_RES) await refresh();
      let best: Cluster | null = null, bestD = 60;
      for (const cl of clustersRef.current) {
        const p = map.project(cl.ll);
        const d = Math.hypot(p.x - e.point.x, p.y - e.point.y);
        if (d < bestD) { bestD = d; best = cl; }
      }
      if (best) setPropose({ h3: best.h3, lat: best.ll[1], lng: best.ll[0] });
    });
    raf = requestAnimationFrame(frame);

    return () => {
      aborted = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      cancelAnimationFrame(raf);
      ro.disconnect();
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerleave", onLeave);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={ref} style={{ width: "100%", height: "100%" }} />
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
      {propose && (
        <ProposeModal h3={propose.h3} center={{ lat: propose.lat, lng: propose.lng }} onClose={() => setPropose(null)} />
      )}
    </div>
  );
}
