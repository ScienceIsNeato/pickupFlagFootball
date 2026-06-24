"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { latLngToCell } from "h3-js";
import { haversineKm } from "@/lib/geo/distance";
import { badgeHitDistance } from "@/lib/map/hit";
import { TEAM_YELLOW } from "@/lib/brand";
import { ProposeModal } from "./ProposeModal";
import { GameDetailsModal } from "./GameDetailsModal";
import { ProposedDetailsModal } from "./ProposedDetailsModal";

type Claim = { lat: number; lng: number; color: string; count: number };
type Cell = {
  h3: string; lat: number; lng: number; count: number; hasGame: boolean; forming: boolean;
  retired?: boolean; gameColor?: string; gameMembers?: number; claims: Claim[];
};

const MAX_ZOOM = 11;     // at/above this, click a cluster to propose
const PROPOSE_RES = 7;   // proposeGame resolves areas by r7 cell — match that
const MORPH_MS = 1500;   // background-scatter → map-cluster morph
const CATCH_KM_DEFAULT = 24; // ~15mi: the radius around the cursor people would travel to play
const MAX_FLAGS = 18;    // cap on flags drawn per interested cluster
const GAME_BADGE = 92;   // px size of the established-game marker
const PROPOSED_BADGE = 68; // px size of the proposed-site marker (smaller)
const YOU_BADGE = 54;    // px size of the "you are here" marker
// Cursor sentinel: mx/my are set to CURSOR_OFF when the pointer leaves the map;
// CURSOR_ON_THRESHOLD is the "off-map" check that tolerates rounding/jitter.
const CURSOR_OFF = -99999;
const CURSOR_ON_THRESHOLD = -9000;

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
    // Street names along the roads (appear as you zoom in, like a normal map).
    { id: "road-labels", type: "symbol", source: "omt", "source-layer": "transportation_name",
      minzoom: 11,
      layout: {
        "symbol-placement": "line",
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 11,
      },
      paint: { "text-color": LABEL, "text-halo-color": "rgba(255,255,255,0.8)", "text-halo-width": 1.3 } },
    // Water names (rivers, lakes, reservoirs).
    { id: "water-labels", type: "symbol", source: "omt", "source-layer": "water_name",
      layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 11 },
      paint: { "text-color": "#d6e8f2", "text-halo-color": "rgba(20,50,40,0.45)", "text-halo-width": 1 } },
    // Place names: cities → neighborhoods.
    { id: "places", type: "symbol", source: "omt", "source-layer": "place",
      filter: ["in", ["get", "class"], ["literal", ["city", "town", "village", "suburb", "neighbourhood", "hamlet"]]],
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
  gameLl?: [number, number];      // set → claimed flag: always points at this game, ignores the cursor
};
type Cluster = {
  ll: [number, number]; count: number; hasGame: boolean; forming: boolean; h3: string; flags: Flag[];
  retired?: boolean; gameColor?: string; gameMembers?: number; claimedCount: number;
};

type Home = { lat: number; lng: number; maxTravelKm: number; city: string | null; zip: string | null };

// Crosshair glyph for the legend (matches the map's right-click cursor).
function Crosshair() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r="6" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="1.4" />
      <path d="M9 0v4M9 14v4M0 9h4M14 9h4" stroke="rgba(255,255,255,0.85)" strokeWidth="1.4" />
    </svg>
  );
}

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
  center, zoom = 9, home = null, mineOnly = false,
}: { center: [number, number]; zoom?: number; home?: Home | null; mineOnly?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clustersRef = useRef<Cluster[]>([]);
  const refreshRef = useRef<(() => void) | null>(null); // lets the propose handler refetch /api/map
  // The map effect is mount-only; keep home/maxTravelKm live via a ref so a
  // later prop change (e.g. the user edits their travel radius) takes effect on
  // the next refresh without a remount.
  const homeRef = useRef(home);
  homeRef.current = home;
  // Imperatively-updated DOM (avoids per-frame React re-renders): a hover tip and
  // the four live legend counts.
  const tipRef = useRef<HTMLDivElement>(null);
  const cInterested = useRef<HTMLSpanElement>(null);
  const cWaving = useRef<HTMLSpanElement>(null);
  const cGames = useRef<HTMLSpanElement>(null);
  const cProposed = useRef<HTMLSpanElement>(null);
  const cClaimed = useRef<HTMLSpanElement>(null);
  const [propose, setPropose] = useState<{ h3: string; lat: number; lng: number } | null>(null);
  const [gameDetails, setGameDetails] = useState<{ lat: number; lng: number } | null>(null);
  const [proposedDetails, setProposedDetails] = useState<{ lat: number; lng: number; anchor: { x: number; y: number; badgeHeight: number } } | null>(null);

  useEffect(() => {
    if (!ref.current || !canvasRef.current) return;
    const container = ref.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const map = new maplibregl.Map({
      container, style: STYLE, center, zoom, attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    mapRef.current = map;
    // E2E seam: the game/proposed badges are drawn on a canvas, so tests can't
    // select them. Under the e2e build flag only, expose the map so a test can
    // center on a seeded game and click its badge for real. Dead-code-eliminated
    // from every normal build (NEXT_PUBLIC_E2E is inlined at build time).
    if (process.env.NEXT_PUBLIC_E2E === "1") {
      (window as unknown as { __e2eMap?: maplibregl.Map }).__e2eMap = map;
    }
    const mapEl = map.getCanvasContainer();
    mapEl.style.opacity = "0"; // fade in as the flags morph into place

    // Badge markers: established game + proposed (forming) site.
    const gameBadge = new Image(); gameBadge.src = "/game-badge.png";
    const proposedBadge = new Image(); proposedBadge.src = "/proposed-badge.png";
    const youBadge = new Image(); youBadge.src = "/you-badge.png";

    function sizeCanvas() {
      const r = container.getBoundingClientRect();
      canvas.width = r.width * dpr; canvas.height = r.height * dpr;
      canvas.style.width = r.width + "px"; canvas.style.height = r.height + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      map.resize();
    }
    requestAnimationFrame(sizeCanvas);
    map.on("load", sizeCanvas);

    // Your travel-radius ring — visualizes the "area of interest" from which you
    // may propose a game. Synthesizes a polygon (great-circle), rotates and
    // scales with the basemap. Tracks home/maxTravelKm via homeRef.
    function radiusGeoJSON(lat: number, lng: number, km: number): GeoJSON.Feature {
      const R = 6371, pts = 96, coords: number[][] = [];
      const φ1 = (lat * Math.PI) / 180, λ1 = (lng * Math.PI) / 180, δ = km / R;
      for (let i = 0; i <= pts; i++) {
        const θ = (i / pts) * 2 * Math.PI;
        const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
        const λ2 = λ1 + Math.atan2(
          Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
          Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
        );
        coords.push([(λ2 * 180) / Math.PI, (φ2 * 180) / Math.PI]);
      }
      return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [coords] } };
    }
    map.on("load", () => {
      const h = homeRef.current; if (!h || mineOnly) return;
      map.addSource("home-radius", { type: "geojson", data: radiusGeoJSON(h.lat, h.lng, h.maxTravelKm) });
      map.addLayer({ id: "home-radius-fill", type: "fill", source: "home-radius",
        paint: { "fill-color": "#ffffff", "fill-opacity": 0.06 } });
      map.addLayer({ id: "home-radius-line", type: "line", source: "home-radius",
        paint: { "line-color": "#ffffff", "line-opacity": 0.55, "line-width": 1.5, "line-dasharray": [3, 3] } });
    });
    const ro = new ResizeObserver(sizeCanvas);
    ro.observe(container);

    let mx = CURSOR_OFF, my = CURSOR_OFF;
    let lastMoveAt = 0; // for the "settle → right-click to propose" idle hint
    const onMove = (e: PointerEvent) => {
      const b = container.getBoundingClientRect();
      mx = e.clientX - b.left; my = e.clientY - b.top;
      lastMoveAt = performance.now();
    };
    const onLeave = () => { mx = CURSOR_OFF; my = CURSOR_OFF; };
    // Always suppress the native browser context menu over the map — right-click
    // is our "propose a game here" gesture.
    const onCtxMenu = (ev: MouseEvent) => ev.preventDefault();
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerleave", onLeave);
    container.addEventListener("contextmenu", onCtxMenu);

    let first = true;
    let morphStart = 0;
    let aborted = false;
    let dataRes = 0; // resolution the current clustersRef was fetched at
    async function refresh() {
      const res = resForZoom(map.getZoom());
      let cells: Cell[];
      try {
        const r = await fetch(`/api/map?res=${res}${mineOnly ? "&mine=1" : ""}`, { cache: "no-store" });
        if (aborted || !r.ok) return;
        ({ cells } = (await r.json()) as { cells: Cell[] });
      } catch (e) {
        console.error("[map refresh error]", e);
        return; // transient/offline — keep the current flags, try again on next move
      }
      const W = container.clientWidth, H = container.clientHeight;
      const mkFlag = (n: number, spread: number, color: (i: number) => string, gameLl?: [number, number]): Flag[] => {
        const flags: Flag[] = [];
        const shown = Math.max(1, Math.min(MAX_FLAGS, n));
        for (let i = 0; i < shown; i++) {
          const a = rand(0, Math.PI * 2), rr = Math.sqrt(Math.random()) * spread;
          flags.push({
            rdx: Math.cos(a) * rr, rdy: Math.sin(a) * rr,
            rrot: rand(0, Math.PI * 2),
            sx: first ? rand(0, W) : -1, sy: first ? rand(0, H) : -1,
            x: 0, y: 0,
            size: rand(9, 12), rot: rand(0, Math.PI * 2), phase: rand(0, Math.PI * 2),
            energy: 0, color: color(i), init: false, gameLl,
          });
        }
        return flags;
      };
      clustersRef.current = cells.map((c) => {
        const flags: Flag[] = [];
        // Free interest → team-colored flags that court the cursor (badge cells
        // show only their claimed flags, not free ones, to keep the marker clean).
        if (!c.hasGame && !c.forming && c.count > 0) {
          // Free interest renders as a single yellow team — explicit design
          // choice (red is reserved for game-claimed flags, which carry team
          // colors per game). Don't re-introduce the alternation here even if
          // a reviewer reads single-color as a regression.
          flags.push(...mkFlag(c.count, Math.min(46, 14 + c.count), () => TEAM_YELLOW));
        }
        // Claimed interest → game-colored flags that always point at their game.
        let claimedCount = 0;
        for (const cm of c.claims ?? []) {
          claimedCount += cm.count;
          flags.push(...mkFlag(cm.count, Math.min(46, 14 + cm.count), () => cm.color, [cm.lng, cm.lat]));
        }
        return {
          ll: [c.lng, c.lat] as [number, number], count: c.count, hasGame: c.hasGame,
          forming: c.forming, retired: c.retired, h3: c.h3, flags, gameColor: c.gameColor, gameMembers: c.gameMembers,
          claimedCount,
        };
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

    // PASS 2 of the frame: draw the established-game ring + badge image and the
    // proposed-site badge ON TOP of all flags, plus the floating "N in" count.
    // Returns whichever badge the cursor is currently over (or null) so frame()
    // can wire the tooltip + cursor style without re-walking the cluster list.
    function drawBadgesPass(morph: number): "game" | "forming" | null {
      let over: "game" | "forming" | null = null;
      const on = mx > CURSOR_ON_THRESHOLD && !mapMoving;
      // "You are here" — your home point (geocoded address, or ZIP centroid as
      // the fallback). Drawn clipped to a circle so the square badge art reads
      // as a round marker, with a white rim for contrast against the grass.
      const me = homeRef.current;
      if (me && youBadge.complete && youBadge.naturalWidth) {
        const p = map.project([me.lng, me.lat]);
        const r = YOU_BADGE / 2;
        ctx.save();
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
        ctx.drawImage(youBadge, p.x - r, p.y - r, YOU_BADGE, YOU_BADGE);
        ctx.restore();
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.lineWidth = 2; ctx.strokeStyle = "rgba(255,255,255,0.92)"; ctx.stroke();
      }
      for (const cl of clustersRef.current) {
        if (!cl.hasGame && !cl.forming) continue;
        const home = map.project(cl.ll);
        const img = cl.hasGame ? gameBadge : proposedBadge;
        const sz = cl.hasGame ? GAME_BADGE : PROPOSED_BADGE;
        if (cl.hasGame && cl.gameColor) {   // colored ring matching the game's color
          ctx.beginPath();
          ctx.arc(home.x, home.y - sz / 2, sz * 0.42, 0, Math.PI * 2);
          ctx.lineWidth = 5; ctx.strokeStyle = cl.gameColor; ctx.stroke();
        }
        // Retired games read as inactive: desaturated + dimmed (no ring above,
        // no "N in" count below).
        const dim = cl.hasGame && !!cl.retired;
        if (img.complete && img.naturalWidth) {
          if (dim) { ctx.save(); ctx.filter = "grayscale(1)"; ctx.globalAlpha = 0.5; }
          ctx.drawImage(img, home.x - sz / 2, home.y - sz, sz, sz);
          if (dim) ctx.restore();
        }
        if (on && mx >= home.x - sz / 2 && mx <= home.x + sz / 2 && my >= home.y - sz && my <= home.y) {
          over = cl.hasGame ? "game" : "forming";
        }
        if (morph > 0.6 && !dim) {
          ctx.globalAlpha = (morph - 0.6) / 0.4;
          ctx.font = "700 13px system-ui, -apple-system, sans-serif";
          ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.shadowColor = "rgba(0,0,0,.85)"; ctx.shadowBlur = 6;
          ctx.fillText(`${cl.hasGame ? cl.gameMembers ?? 0 : cl.count} in`, home.x, home.y + 11);
          ctx.shadowBlur = 0; ctx.globalAlpha = 1;
        }
      }
      return over;
    }

    let raf = 0;
    let frameErr = false;
    // While the map is panning/zooming, flags lock to their projected position
    // (see the frame loop) instead of easing — so they stay bolted to the basemap.
    let mapMoving = false;

    // PASS 1 — flags, drawn under the badges (drawn first so game/proposed badges
    // sit on top). Returns the in-viewport tallies for the legend. Split out of
    // frame() to keep the per-frame loop readable.
    function drawFlagsPass(
      morph: number, on: boolean, mGeo: maplibregl.LngLat | null,
      catchKm: number, bounds: maplibregl.LngLatBounds,
    ) {
      let nInterested = 0, nGames = 0, nProposed = 0, nClaimed = 0;
      for (const cl of clustersRef.current) {
        const home = map.project(cl.ll);
        if (bounds.contains(cl.ll)) {
          nClaimed += cl.claimedCount;
          if (cl.hasGame) nGames++; else if (cl.forming) nProposed++; else nInterested += cl.count;
        }
        // Free flags court the cursor when it's within play range; claimed flags
        // always point at their own game and ignore the cursor.
        const waving = on && mGeo != null && !cl.hasGame && !cl.forming &&
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
            let targetRot: number, targetE: number;
            if (f.gameLl) {                 // claimed → point at the game, ignore cursor
              const gp = map.project(f.gameLl);
              // Match free-idle energy: the "pointing" comes from rotation; we
              // don't want claimed flags wiggling like crazy just because we're
              // showing more of them now (multi-game rosters, my-games view).
              targetRot = Math.atan2(gp.y - f.y, gp.x - f.x); targetE = 0.1;
            } else if (waving) {            // free + courted → point at cursor
              targetRot = Math.atan2(my - f.y, mx - f.x); targetE = 0.55;
            } else {                        // free + idle
              targetRot = f.rrot; targetE = 0.1;
            }
            f.rot = easeAngle(f.rot, targetRot, f.gameLl || waving ? 0.2 : 0.08);
            f.energy += (targetE - f.energy) * 0.12;
          }
          // Wiggle rate — calmed down from the original 0.16 + 0.18*e formula.
          // With more claimed flags onscreen (multi-game rosters + my-games view)
          // the original base read as frantic in aggregate; halving keeps the
          // individual-flag character without the swarm flicker.
          f.phase += 0.09 + 0.10 * f.energy;
          drawFlag(f);
        }
      }
      return { nInterested, nGames, nProposed, nClaimed };
    }

    function frame() {
     try {
      const W = container.clientWidth, H = container.clientHeight;
      ctx.clearRect(0, 0, W, H);
      const morph = morphStart ? Math.min(1, (performance.now() - morphStart) / MORPH_MS) : 0;
      mapEl.style.opacity = easeOut(morph).toFixed(3);
      const on = mx > CURSOR_ON_THRESHOLD && !mapMoving;

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

      // Live counts within the current viewport (for the legend) + badge hover.
      const bounds = map.getBounds();
      let overBadge: "game" | "forming" | null = null;

      // PASS 1 — flags (under the badges); returns the in-viewport tallies.
      const { nInterested, nGames, nProposed, nClaimed } = drawFlagsPass(morph, on, mGeo, catchKm, bounds);

      // PASS 2 — game + proposed badges, on top of all flags. Returns the badge
      // category under the cursor (for the tooltip + cursor style above).
      overBadge = drawBadgesPass(morph);
      if (on && catchCount > 0) drawJersey(catchCount, mx, my);

      // Cursor: pointer over a badge (clickable), crosshair otherwise. Tooltip:
      // over a badge → "click…" immediately; over open space + settled → propose.
      let hoverText: string | null = null;
      if (overBadge) hoverText = overBadge === "game" ? "click to see game details" : "click to see this proposal";
      else if (!mineOnly && on && performance.now() - lastMoveAt > 120) hoverText = "right-click to propose a game here";
      mapEl.style.cursor = overBadge ? "pointer" : "crosshair";
      const tip = tipRef.current;
      if (tip) {
        if (hoverText) {
          tip.textContent = hoverText; tip.style.display = "block";
          tip.style.left = `${mx + 16}px`; tip.style.top = `${my + 18}px`;
        } else tip.style.display = "none";
      }
      // Live legend counts.
      if (cInterested.current) cInterested.current.textContent = String(nInterested);
      if (cWaving.current) cWaving.current.textContent = String(catchCount);
      if (cGames.current) cGames.current.textContent = String(nGames);
      if (cProposed.current) cProposed.current.textContent = String(nProposed);
      if (cClaimed.current) cClaimed.current.textContent = String(nClaimed);
     } catch (e) {
      if (!frameErr) { frameErr = true; console.error("[map frame error]", e); }
     }
      raf = requestAnimationFrame(frame);
    }

    void refresh();
    refreshRef.current = () => { void refresh(); };
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
      // Hit-test the actual drawn badge rectangle (anchored at the base, extending
      // up), not a fat disc around the base — otherwise a click on a tall game
      // badge can land closer to a neighboring marker's base and pick the wrong
      // one. badgeHitDistance matches drawBadgesPass's drawImage geometry exactly.
      let best: Cluster | null = null, bestD = Infinity;
      for (const cl of clustersRef.current) {
        const p = map.project(cl.ll);
        const size = cl.hasGame ? GAME_BADGE : cl.forming ? PROPOSED_BADGE : null;
        const d = badgeHitDistance({ x: p.x, y: p.y }, { x: px, y: py }, size);
        if (d != null && d < bestD) { bestD = d; best = cl; }
      }
      return best;
    };
    map.on("click", async (e) => {
      const hit = nearestCluster(e.point.x, e.point.y);
      if (!hit) return;
      // Click an existing game → its details (works at any zoom).
      if (hit.hasGame) { setGameDetails({ lat: hit.ll[1], lng: hit.ll[0] }); return; }
      // Click a proposed (forming) site → its details + any vote tallies.
      if (hit.forming) {
        const p = map.project(hit.ll);
        // map.project is relative to the map container, but the modal portals to
        // <body> and positions in a fixed full-viewport overlay — so offset by the
        // container's viewport rect (notably the 64px app-header pad) to align.
        const rect = container.getBoundingClientRect();
        setProposedDetails({ lat: hit.ll[1], lng: hit.ll[0], anchor: { x: p.x + rect.left, y: p.y + rect.top, badgeHeight: PROPOSED_BADGE } });
        return;
      }
      // Otherwise propose a new game — needs r7 resolution (high zoom). Cluster
      // refresh is debounced, so pull fresh r7 cells before matching the click.
      if (map.getZoom() < MAX_ZOOM) return;
      if (dataRes < PROPOSE_RES) await refresh();
      const spot = nearestCluster(e.point.x, e.point.y);
      if (spot && !spot.hasGame && !spot.forming) setPropose({ h3: spot.h3, lat: spot.ll[1], lng: spot.ll[0] });
    });
    // Right-click anywhere, any zoom → propose a game at that point. The modal's
    // address picker sets the precise venue; the server resolves the area from it.
    map.on("contextmenu", (e) => {
      e.preventDefault();
      if (mineOnly) return;
      const { lat, lng } = e.lngLat;
      setPropose({ h3: latLngToCell(lat, lng, PROPOSE_RES), lat, lng });
    });
    raf = requestAnimationFrame(frame);

    return () => {
      aborted = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      cancelAnimationFrame(raf);
      ro.disconnect();
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerleave", onLeave);
      container.removeEventListener("contextmenu", onCtxMenu);
      if (process.env.NEXT_PUBLIC_E2E === "1") {
        const w = window as unknown as { __e2eMap?: maplibregl.Map };
        if (w.__e2eMap === map) delete w.__e2eMap; // don't leave a destroyed handle behind
      }
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On a successful propose: optimistically drop a proposed badge at the exact
  // clicked point so it shows instantly, then refetch so the real forming cell
  // (area centroid) takes over.
  const handleProposed = (p: { lat: number; lng: number }) => {
    clustersRef.current = [
      ...clustersRef.current,
      { ll: [p.lng, p.lat], count: 0, hasGame: false, forming: true, h3: `opt:${p.lat},${p.lng}`, flags: [], claimedCount: 0 },
    ];
    refreshRef.current?.();
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={ref} style={{ width: "100%", height: "100%" }} />
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
      <div className="map-legend">
        {home && <span className="legend-item"><img src="/you-badge.png" alt="" className="legend-badge" /> you</span>}
        <span className="legend-item"><Streamer color={TEAM_YELLOW} /> interested player <span ref={cInterested} className="legend-n">0</span></span>
        <span className="legend-item"><Streamer color={TEAM_YELLOW} wave /> would play near your cursor <span ref={cWaving} className="legend-n">0</span></span>
        <span className="legend-item"><img src="/game-badge.png" alt="" className="legend-badge" /> existing game <span ref={cGames} className="legend-n">0</span></span>
        <span className="legend-item"><img src="/proposed-badge.png" alt="" className="legend-badge" /> proposed game site <span ref={cProposed} className="legend-n">0</span></span>
        <span className="legend-item"><Streamer color="#94a3b8" /> claimed (in a game) <span ref={cClaimed} className="legend-n">0</span></span>
        <span className="legend-item"><Crosshair /> right-click to propose game</span>
      </div>
      <div ref={tipRef} className="map-tip" style={{ display: "none" }}>Click to see game details</div>
      {propose && (
        <ProposeModal h3={propose.h3} center={{ lat: propose.lat, lng: propose.lng }}
          home={home} onClose={() => setPropose(null)} onProposed={handleProposed} />
      )}
      {gameDetails && (
        <GameDetailsModal lat={gameDetails.lat} lng={gameDetails.lng} onClose={() => setGameDetails(null)}
          onChanged={() => refreshRef.current?.()} />
      )}
      {proposedDetails && (
        <ProposedDetailsModal lat={proposedDetails.lat} lng={proposedDetails.lng}
          anchor={proposedDetails.anchor} onClose={() => setProposedDetails(null)} />
      )}
    </div>
  );
}
