"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ProposeModal } from "./ProposeModal";

type Cell = { h3: string; lat: number; lng: number; count: number; hasGame: boolean };

const MAX_ZOOM = 11; // at/above this a football can't split → click it to propose
const GR = 52;       // cursor gravity radius (screen px), like the background flags

type Rec = {
  ll: [number, number]; inner: HTMLElement;
  ox: number; oy: number; rox: number; roy: number; energy: number; phase: number;
};

// CARTO's keyless *raster* light basemap (their keyless vector tiles were
// retired). A football-field tone is applied via a CSS filter in globals.css.
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

/** map zoom → H3 resolution: coarser zoomed out (cells merge), finer zoomed in. */
function resForZoom(z: number): number {
  if (z < 5) return 3;
  if (z < 7) return 4;
  if (z < 9) return 5;
  if (z < 11) return 6;
  return 7;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function bubble(cell: Cell): { el: HTMLElement; inner: HTMLElement } {
  const el = document.createElement("div");
  const size = Math.round(38 + Math.min(46, Math.sqrt(cell.count) * 10));
  const glow = cell.hasGame ? "#2bd66f" : "#ffcf33";
  const fs = Math.round(size * 0.4);
  el.style.cssText = `width:${size}px;height:${size}px;cursor:pointer;`;
  // The inner wrapper carries the gravity offset/scale — NOT the marker element,
  // whose transform maplibre owns for positioning.
  el.innerHTML = `<div class="mk-inner" style="position:relative;width:100%;height:100%;transform-origin:center;will-change:transform;">
    <img src="/football.png" width="${size}" height="${size}" alt="" draggable="false"
      style="display:block;filter:drop-shadow(0 0 ${Math.round(size * 0.16)}px ${glow}) drop-shadow(0 2px 3px rgba(0,0,0,.45));"/>
    <span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
      font:700 ${fs}px/1 var(--font-barlow),system-ui,sans-serif;color:#fff;
      text-shadow:0 1px 2px #000,0 0 4px #000,0 0 7px rgba(0,0,0,.85);">${cell.count}</span>
  </div>`;
  el.title = cell.hasGame ? `${cell.count} interested · game scheduled` : `${cell.count} interested`;
  return { el, inner: el.firstElementChild as HTMLElement };
}

export function MapView({ center, zoom = 9 }: { center: [number, number]; zoom?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const recsRef = useRef<Rec[]>([]);
  const [propose, setPropose] = useState<{ h3: string; lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const container = ref.current;
    const map = new maplibregl.Map({
      container, style: STYLE, center, zoom, attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    requestAnimationFrame(() => map.resize());
    map.on("load", () => map.resize());
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container);

    // ── cursor gravity, always on — the map footballs behave like the
    //    background flags: nearby ones pull toward the cursor and drift home ──
    let mx = -99999, my = -99999, raf: number | null = null;
    function frame() {
      let active = false;
      const on = mx > -9000;
      for (const r of recsRef.current) {
        const home = map.project(r.ll);
        const dx = mx - home.x, dy = my - home.y;
        const d = Math.hypot(dx, dy);
        if (on && d < GR) {
          const close = 1 - d / GR, pull = 0.04 + 0.2 * close;
          r.ox += (mx + r.rox - home.x - r.ox) * pull;
          r.oy += (my + r.roy - home.y - r.oy) * pull;
          r.energy += (0.4 + 0.6 * close - r.energy) * 0.14;
        } else {
          r.ox += (0 - r.ox) * 0.07;
          r.oy += (0 - r.oy) * 0.07;
          r.energy += (0 - r.energy) * 0.12;
        }
        if (r.energy < 0.004) r.energy = 0;
        if (r.energy > 0.004) r.phase += 0.2;
        const wob = Math.sin(r.phase) * 7 * r.energy;
        r.inner.style.transform =
          `translate(${r.ox.toFixed(2)}px,${r.oy.toFixed(2)}px) scale(${(1 + 0.16 * r.energy).toFixed(3)}) rotate(${wob.toFixed(2)}deg)`;
        if (r.energy > 0.004 || Math.abs(r.ox) > 0.4 || Math.abs(r.oy) > 0.4) active = true;
      }
      raf = active ? requestAnimationFrame(frame) : null;
    }
    function wake() { if (raf == null) raf = requestAnimationFrame(frame); }
    const onMove = (e: PointerEvent) => {
      const b = container.getBoundingClientRect();
      mx = e.clientX - b.left; my = e.clientY - b.top; wake();
    };
    const onLeave = () => { mx = -99999; my = -99999; wake(); };
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerleave", onLeave);

    let aborted = false;
    async function refresh() {
      const res = resForZoom(map.getZoom());
      const r = await fetch(`/api/map?res=${res}`, { cache: "no-store" });
      if (aborted || !r.ok) return;
      const { cells } = (await r.json()) as { cells: Cell[] };
      markersRef.current.forEach((m) => m.remove());
      const recs: Rec[] = [];
      markersRef.current = cells.map((c) => {
        const { el, inner } = bubble(c);
        el.addEventListener("click", () => {
          if (map.getZoom() >= MAX_ZOOM) setPropose({ h3: c.h3, lat: c.lat, lng: c.lng });
          else map.flyTo({ center: [c.lng, c.lat], zoom: Math.min(MAX_ZOOM, map.getZoom() + 2) });
        });
        recs.push({ ll: [c.lng, c.lat], inner, ox: 0, oy: 0, rox: rand(-18, 18), roy: rand(-18, 18), energy: 0, phase: rand(0, 6.28) });
        return new maplibregl.Marker({ element: el }).setLngLat([c.lng, c.lat]).addTo(map);
      });
      recsRef.current = recs;
      wake();
    }

    void refresh();
    map.on("moveend", refresh);

    return () => {
      aborted = true;
      ro.disconnect();
      if (raf != null) cancelAnimationFrame(raf);
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerleave", onLeave);
      markersRef.current.forEach((m) => m.remove());
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={ref} style={{ width: "100%", height: "100%" }} />
      {propose && (
        <ProposeModal
          h3={propose.h3}
          center={{ lat: propose.lat, lng: propose.lng }}
          onClose={() => setPropose(null)}
        />
      )}
    </div>
  );
}
