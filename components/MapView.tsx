"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { FlagBurst } from "./FlagBurst";
import { ProposeModal } from "./ProposeModal";

type Cell = { h3: string; lat: number; lng: number; count: number; hasGame: boolean };

const MAX_ZOOM = 11; // at/above this, a football can't split → it bursts into flags

type Burst = { x: number; y: number; count: number; h3: string };

// CARTO's keyless *raster* dark basemap. (Their keyless vector tiles were
// retired, which is why the vector gl-style rendered black.) Raster is a single
// self-contained style — no sprite/glyph/vector-tile dependencies to fail.
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
  layers: [{ id: "carto-dark", type: "raster", source: "carto" }],
};

/** map zoom → H3 resolution. Coarser when zoomed out (cells merge), finer when
 *  zoomed in (cells split) — the "groups collapse in and out" effect. */
function resForZoom(z: number): number {
  if (z < 5) return 3;
  if (z < 7) return 4;
  if (z < 9) return 5;
  if (z < 11) return 6;
  return 7;
}

function bubble(cell: Cell): HTMLElement {
  const el = document.createElement("div");
  const size = Math.round(38 + Math.min(46, Math.sqrt(cell.count) * 10));
  const glow = cell.hasGame ? "#2bd66f" : "#ffcf33";
  const fs = Math.round(size * 0.4);
  el.style.cssText = `width:${size}px;height:${size}px;cursor:pointer;`;
  // Inner wrapper carries the hover scale — NOT the marker element itself, whose
  // transform maplibre owns for positioning (scaling it flings the marker to 0,0).
  el.innerHTML = `<div class="mk-inner" style="position:relative;width:100%;height:100%;transform-origin:center;transition:transform .12s;">
    <img src="/football.png" width="${size}" height="${size}" alt="" draggable="false"
      style="display:block;filter:drop-shadow(0 0 ${Math.round(size * 0.16)}px ${glow}) drop-shadow(0 2px 3px rgba(0,0,0,.45));"/>
    <span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
      font:700 ${fs}px/1 var(--font-barlow),system-ui,sans-serif;color:#fff;
      text-shadow:0 1px 2px #000,0 0 4px #000,0 0 7px rgba(0,0,0,.85);transform:translateY(1px);">${cell.count}</span>
  </div>`;
  el.title = cell.hasGame ? `${cell.count} interested · game scheduled` : `${cell.count} interested`;
  const inner = el.firstElementChild as HTMLElement;
  el.addEventListener("mouseenter", () => { inner.style.transform = "scale(1.12)"; });
  el.addEventListener("mouseleave", () => { inner.style.transform = "scale(1)"; });
  return el;
}

export function MapView({ center, zoom = 9 }: { center: [number, number]; zoom?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [burst, setBurst] = useState<Burst | null>(null);
  const [propose, setPropose] = useState<{ h3: string } | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: STYLE,
      center,
      zoom,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    // guard against the container sizing after init (flex/vh layouts)
    // maplibre can mis-measure the container at construction (hydration timing),
    // painting tiles into only part of the canvas. Force a resize on the next
    // frame + on load, and keep observing for later layout changes.
    requestAnimationFrame(() => map.resize());
    map.on("load", () => map.resize());
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(ref.current);

    let aborted = false;
    async function refresh() {
      const res = resForZoom(map.getZoom());
      const r = await fetch(`/api/map?res=${res}`, { cache: "no-store" });
      if (aborted || !r.ok) return;
      const { cells } = (await r.json()) as { cells: Cell[] };
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = cells.map((c) => {
        const el = bubble(c);
        el.addEventListener("click", () => {
          if (map.getZoom() >= MAX_ZOOM) {
            const p = map.project([c.lng, c.lat]);
            setBurst({ x: p.x, y: p.y, count: c.count, h3: c.h3 });
          } else {
            // drill in like Zillow — clusters split as you go
            map.flyTo({ center: [c.lng, c.lat], zoom: Math.min(MAX_ZOOM, map.getZoom() + 2) });
          }
        });
        return new maplibregl.Marker({ element: el }).setLngLat([c.lng, c.lat]).addTo(map);
      });
    }

    // markers are DOM overlays — fetch immediately, don't wait on tile load
    void refresh();
    map.on("moveend", refresh);

    return () => {
      aborted = true;
      ro.disconnect();
      markersRef.current.forEach((m) => m.remove());
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={ref} style={{ width: "100%", height: "100%" }} />
      {burst && (
        <FlagBurst
          origin={{ x: burst.x, y: burst.y }}
          count={burst.count}
          onClose={() => setBurst(null)}
          onPropose={() => { setPropose({ h3: burst.h3 }); setBurst(null); }}
        />
      )}
      {propose && <ProposeModal h3={propose.h3} onClose={() => setPropose(null)} />}
    </div>
  );
}
