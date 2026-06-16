"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ProposeModal } from "./ProposeModal";

type Cell = { h3: string; lat: number; lng: number; count: number; hasGame: boolean };

const MAX_ZOOM = 11;     // at/above this, click a cluster to propose
const PROPOSE_RES = 7;   // proposeGame resolves areas by r7 cell — match that
const GR = 120;          // cursor gravity radius — the background flag physics
const MORPH_MS = 1500;   // background-scatter → map-cluster morph
const COLORS = ["#f5c518", "#e2483f", "#2fb673", "#f59e2a"];

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 256,
      attribution: '© <a href="https://carto.com/">CARTO</a> © OpenStreetMap contributors',
    },
  },
  layers: [{ id: "carto", type: "raster", source: "carto" }],
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
  rdx: number; rdy: number;       // rest offset within the cluster
  sx: number; sy: number;         // morph spawn point (scattered)
  x: number; y: number;           // live position
  ox: number; oy: number;         // gather jitter
  size: number; rot: number; phase: number; energy: number; color: string;
  init: boolean;                  // seeded its first live position yet?
};
type Cluster = { ll: [number, number]; count: number; hasGame: boolean; h3: string; flags: Flag[] };

export function MapView({ center, zoom = 9 }: { center: [number, number]; zoom?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clustersRef = useRef<Cluster[]>([]);
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
        const n = Math.max(1, Math.min(12, c.count));
        const spread = Math.min(42, 10 + c.count);
        const flags: Flag[] = [];
        for (let i = 0; i < n; i++) {
          const a = rand(0, Math.PI * 2), rr = Math.sqrt(Math.random()) * spread;
          flags.push({
            rdx: Math.cos(a) * rr, rdy: Math.sin(a) * rr,
            sx: first ? rand(0, W) : -1, sy: first ? rand(0, H) : -1,
            x: 0, y: 0, ox: rand(-10, 10), oy: rand(-10, 10),
            size: rand(8, 13), rot: rand(0, Math.PI * 2), phase: rand(0, Math.PI * 2),
            energy: 0, color: COLORS[(Math.random() * COLORS.length) | 0], init: false,
          });
        }
        return { ll: [c.lng, c.lat] as [number, number], count: c.count, hasGame: c.hasGame, h3: c.h3, flags };
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
    function frame() {
      const W = container.clientWidth, H = container.clientHeight;
      ctx.clearRect(0, 0, W, H);
      const morph = morphStart ? Math.min(1, (performance.now() - morphStart) / MORPH_MS) : 0;
      mapEl.style.opacity = easeOut(morph).toFixed(3);
      const on = mx > -9000;

      for (const cl of clustersRef.current) {
        const home = map.project(cl.ll);
        for (const f of cl.flags) {
          let tx = home.x + f.rdx, ty = home.y + f.rdy;
          if (morph < 1 && f.sx >= 0) {
            const e = easeOut(morph);
            tx = f.sx + (tx - f.sx) * e; ty = f.sy + (ty - f.sy) * e;
          }
          if (!f.init) { f.init = true; f.x = tx; f.y = ty; } // seed once; (0,0) is a valid target
          const dx = mx - f.x, dy = my - f.y, d = Math.hypot(dx, dy);
          if (on && d < GR) {
            const close = 1 - d / GR, pull = 0.05 + 0.22 * close;
            f.x += (mx + f.ox - f.x) * pull; f.y += (my + f.oy - f.y) * pull;
            f.energy += (0.5 + 0.5 * close - f.energy) * 0.15;
          } else {
            f.x += (tx - f.x) * 0.1; f.y += (ty - f.y) * 0.1;
            f.energy += (0.12 - f.energy) * 0.1; // gentle resting flutter
          }
          f.phase += 0.16 + 0.18 * f.energy;
          drawFlag(f);
        }
        // small translucent count beside the clump
        if (morph > 0.6) {
          ctx.globalAlpha = (morph - 0.6) / 0.4;
          ctx.font = `700 ${cl.count >= 10 ? 13 : 14}px system-ui, -apple-system, sans-serif`;
          ctx.fillStyle = cl.hasGame ? "#2fb673" : "#ffffff";
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
