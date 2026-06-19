"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { haversineKm } from "@/lib/geo/distance";
import { TEAM_YELLOW, TEAM_RED } from "@/lib/brand";
import { ProposeModal } from "./ProposeModal";
import { GameDetailsModal } from "./GameDetailsModal";

type Cell = { h3: string; lat: number; lng: number; count: number; hasGame: boolean; forming: boolean };

const MAX_ZOOM = 11;     // at/above this, click a cluster to propose
const PROPOSE_RES = 7;   // proposeGame resolves areas by r7 cell — match that
const MORPH_MS = 1500;   // background-scatter → map-cluster morph
const CATCH_KM_DEFAULT = 24; // ~15mi: the radius around the cursor people would travel to play
const MAX_FLAGS = 18;    // cap on flags drawn per interested cluster
const GAME_BADGE = 46;   // px size of the established-game marker
const PROPOSED_BADGE = 34; // px size of the proposed-site marker (smaller)

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
/** Ease an angle toward a target the short way around (so flags swivel, not spin). */
function easeAngle(cur: number, target: number, k: number): number {
  let d = (target - cur) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return cur + d * k;
}

type Flag = {
  rdx: number; rdy: number;       // rest offset (scattered at the user's area)
  rrot: number;                   // resting facing angle
  sx: number; sy: number;         // morph spawn point (scattered)
  x: number; y: number;           // live position
  size: number; rot: number; phase: number; energy: number; color: string;
  init: boolean;                  // seeded its first live position yet?
};
type Cluster = {
  ll: [number, number]; count: number; hasGame: boolean; forming: boolean; h3: string; flags: Flag[];
};

type Home = { lat: number; lng: number; maxTravelKm: number };

// Tiny pull-flag streamer glyph for the legend (matches the map's flags).
function Streamer({ color, wave }: { color: string; wave?: boolean }) {
  return (
    <svg width="22" height="16" viewBox="0 0 22 16" aria-hidden="true">
      <line x1="3" y1="1" x2="3" y2="15" stroke="rgba(255,255,255,0.7)" strokeWidth="1.4" />
      <path
        d={wave
          ? "M3 3 q5 -2 9 0 q4 2 7 0 v4 q-3 2 -7 0 q-4 -2 -9 0 z"
          : "M3 3 h16 v4 H3 z"}
        fill={color}
      />
    </svg>
  );
}

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
  const [gameDetails, setGameDetails] = useState<{ lat: number; lng: number } | null>(null);

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

    // Badge markers: established game + proposed (forming) site.
    const gameBadge = new Image(); gameBadge.src = "/game-badge.png";
    const proposedBadge = new Image(); proposedBadge.src = "/proposed-badge.png";

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
        const flags: Flag[] = [];
        // Only interested clusters show flags; games + forming sites are badges.
        if (!c.hasGame && !c.forming) {
          const shown = Math.max(1, Math.min(MAX_FLAGS, c.count));
          const spread = Math.min(46, 14 + c.count); // rest scatter radius
          for (let i = 0; i < shown; i++) {
            const a = rand(0, Math.PI * 2), rr = Math.sqrt(Math.random()) * spread;
            flags.push({
              rdx: Math.cos(a) * rr, rdy: Math.sin(a) * rr,
              rrot: rand(0, Math.PI * 2),
              sx: first ? rand(0, W) : -1, sy: first ? rand(0, H) : -1,
              x: 0, y: 0,
              size: rand(9, 12), rot: rand(0, Math.PI * 2), phase: rand(0, Math.PI * 2),
              energy: 0, color: i % 2 ? TEAM_RED : TEAM_YELLOW, init: false,
            });
          }
        }
        return { ll: [c.lng, c.lat] as [number, number], count: c.count, hasGame: c.hasGame, forming: c.forming, h3: c.h3, flags };
      });
      dataRes = res;
      if (first) { first = false; morphStart = performance.now(); }
    }

    function drawFlag(f: Flag) {
      const L = f.size * 3, h = f.size * 0.5, seg = 6;
      ctx.save();
      ctx.translate(f.x, f.y); ctx.rotate(f.rot);
      ctx.globalAlpha = 1; // opaque so flags stand out against the field
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

    // Jersey-style count floating above the cursor: how many would play here.
    function drawJersey(n: number, x: number, y: number) {
      const s = String(n);
      ctx.save();
      ctx.font = '900 36px "Arial Narrow", Impact, system-ui, sans-serif';
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const cy = y - 40;
      ctx.lineJoin = "round";
      ctx.lineWidth = 6; ctx.strokeStyle = "rgba(16,40,12,0.9)";
      ctx.strokeText(s, x, cy);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(s, x, cy);
      ctx.restore();
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
      const on = mx > -9000 && !mapMoving;

      // The cursor is a candidate game spot. Interested people within their play
      // radius of it "would play here" — their flags wave + point at the cursor,
      // and we tally them for the jersey number above it.
      const catchKm = homeRef.current?.maxTravelKm ?? CATCH_KM_DEFAULT;
      let mGeo: maplibregl.LngLat | null = null;
      let catchCount = 0;
      if (on) {
        mGeo = map.unproject([mx, my]);
        for (const cl of clustersRef.current) {
          if (!cl.hasGame && !cl.forming && haversineKm(mGeo.lat, mGeo.lng, cl.ll[1], cl.ll[0]) <= catchKm) {
            catchCount += cl.count;
          }
        }
      }

      for (const cl of clustersRef.current) {
        const home = map.project(cl.ll);

        // Established game or proposed (forming) site → a badge marker, anchored
        // by its base at the location.
        if (cl.hasGame || cl.forming) {
          const img = cl.hasGame ? gameBadge : proposedBadge;
          const sz = cl.hasGame ? GAME_BADGE : PROPOSED_BADGE;
          if (img.complete && img.naturalWidth) ctx.drawImage(img, home.x - sz / 2, home.y - sz, sz, sz);
          if (morph > 0.6) {
            ctx.globalAlpha = (morph - 0.6) / 0.4;
            ctx.font = "700 12px system-ui, -apple-system, sans-serif";
            ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.shadowColor = "rgba(0,0,0,.85)"; ctx.shadowBlur = 6;
            ctx.fillText(`${cl.count} in`, home.x, home.y + 9);
            ctx.shadowBlur = 0; ctx.globalAlpha = 1;
          }
          continue;
        }

        // Interested cluster → flags hold their scatter; wave + point at the
        // cursor when it's within play range.
        const waving = on && mGeo != null &&
          haversineKm(mGeo.lat, mGeo.lng, cl.ll[1], cl.ll[0]) <= catchKm;
        for (const f of cl.flags) {
          let tx = home.x + f.rdx, ty = home.y + f.rdy;
          if (morph < 1 && f.sx >= 0) {
            const e = easeOut(morph);
            tx = f.sx + (tx - f.sx) * e; ty = f.sy + (ty - f.sy) * e;
          }
          if (!f.init || mapMoving) {
            f.init = true; f.x = tx; f.y = ty; f.rot = f.rrot;
            f.energy += (0.12 - f.energy) * 0.1;
          } else {
            f.x += (tx - f.x) * 0.12; f.y += (ty - f.y) * 0.12;
            const targetRot = waving ? Math.atan2(my - f.y, mx - f.x) : f.rrot;
            f.rot = easeAngle(f.rot, targetRot, waving ? 0.2 : 0.08);
            const targetE = waving ? 0.55 : 0.1;
            f.energy += (targetE - f.energy) * 0.12;
          }
          f.phase += 0.16 + 0.18 * f.energy;
          drawFlag(f);
        }
      }
      if (on && catchCount > 0) drawJersey(catchCount, mx, my);
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
    const nearestCluster = (px: number, py: number): Cluster | null => {
      let best: Cluster | null = null, bestD = 60;
      for (const cl of clustersRef.current) {
        const p = map.project(cl.ll);
        const d = Math.hypot(p.x - px, p.y - py);
        if (d < bestD) { bestD = d; best = cl; }
      }
      return best;
    };
    map.on("click", async (e) => {
      const hit = nearestCluster(e.point.x, e.point.y);
      if (!hit) return;
      // Click an existing game → its details (works at any zoom).
      if (hit.hasGame) { setGameDetails({ lat: hit.ll[1], lng: hit.ll[0] }); return; }
      // Otherwise propose a new game — needs r7 resolution (high zoom). Cluster
      // refresh is debounced, so pull fresh r7 cells before matching the click.
      if (map.getZoom() < MAX_ZOOM) return;
      if (dataRes < PROPOSE_RES) await refresh();
      const spot = nearestCluster(e.point.x, e.point.y);
      if (spot && !spot.hasGame) setPropose({ h3: spot.h3, lat: spot.ll[1], lng: spot.ll[0] });
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
      <div className="map-legend">
        <span className="legend-item"><Streamer color={TEAM_YELLOW} /> interested player</span>
        <span className="legend-item"><Streamer color={TEAM_YELLOW} wave /> would play near your cursor</span>
        <span className="legend-item"><img src="/game-badge.png" alt="" className="legend-badge" /> existing game</span>
        <span className="legend-item"><img src="/proposed-badge.png" alt="" className="legend-badge" /> proposed game site</span>
      </div>
      {propose && (
        <ProposeModal h3={propose.h3} center={{ lat: propose.lat, lng: propose.lng }} onClose={() => setPropose(null)} />
      )}
      {gameDetails && (
        <GameDetailsModal lat={gameDetails.lat} lng={gameDetails.lng} onClose={() => setGameDetails(null)} />
      )}
    </div>
  );
}
